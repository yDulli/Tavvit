import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VoiceUser } from './VoiceUser';
import { StreamTile } from './StreamTile';
import { useVoiceStore } from '../../stores/voiceStore';
import { deriveGridTiles } from '../../hooks/useLiveKit';
import { useGridLayout } from '../../hooks/useGridLayout';
import type { ParticipantInfo, GridTile } from '../../hooks/useLiveKit';
import { useTrackStats } from '../../hooks/useTrackStats';
import { useWatchStore } from '../../stores/watchStore';
import { WatchStage } from './WatchStage';
import { Icon } from '../ui/Icon';

interface VoiceGridProps {
  participants: ParticipantInfo[];
}

/** Below this height a tile's full-size avatar would run into its caption. */
const COMPACT_TILE_HEIGHT = 140;

/** A tile is pressed to focus it; a press on something inside it belongs to that control. */
function pressOnKey(event: React.KeyboardEvent, press: () => void): void {
  if (event.target !== event.currentTarget) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  press();
}

export function VoiceGrid({ participants }: VoiceGridProps) {
  const { t } = useTranslation(['voice', 'common']);
  const focusedParticipantId = useVoiceStore((s) => s.focusedParticipantId);
  const setFocusedParticipant = useVoiceStore((s) => s.setFocusedParticipant);
  const watchingStreams = useVoiceStore((s) => s.watchingStreams);
  const currentVoiceChannelId = useVoiceStore((s) => s.currentVoiceChannelId);
  // The call watches something together (docs/systems/watch-together.md): its video takes the stage.
  const watching = useWatchStore((s) => (currentVoiceChannelId ? s.sessions.get(currentVoiceChannelId)?.session.current != null : false));
  const videoHidden = useWatchStore((s) => s.videoHiddenFor !== null && s.videoHiddenFor === currentVoiceChannelId);
  const [stripHidden, setStripHidden] = useState(false);

  const tiles = useMemo(() => deriveGridTiles(participants), [participants]);
  const shouldCollectStreamStats = tiles.some((tile) =>
    tile.kind === 'stream'
    && (tile.participant.isLocal || watchingStreams.has(tile.participant.userId)),
  );
  // One WebRTC poller feeds every stream tile. Running useTrackStats inside
  // each tile multiplied full PeerConnection scans by the number of streams.
  const streamStats = useTrackStats(shouldCollectStreamStats);

  const { cols, tileWidth, tileHeight, ref: gridRef } = useGridLayout(tiles.length);

  // Reset strip visibility when focus target changes
  useEffect(() => {
    setStripHidden(false);
  }, [focusedParticipantId]);

  // Unfocus if the focused stream tile no longer exists
  useEffect(() => {
    const currentStreamKeys = new Set(
      tiles
        .filter(
          (t): t is GridTile & { kind: 'stream' } =>
            t.kind === 'stream' && t.screenTrack?.readyState === 'live',
        )
        .map((t) => t.key),
    );

    if (
      focusedParticipantId &&
      focusedParticipantId.endsWith(':stream') &&
      !currentStreamKeys.has(focusedParticipantId)
    ) {
      setFocusedParticipant(null);
    }
  }, [tiles, focusedParticipantId, setFocusedParticipant]);

  // Render a single tile polymorphically
  const renderTile = (tile: GridTile, size: { large?: boolean; compact?: boolean }) =>
    tile.kind === 'user' ? (
      <VoiceUser tile={tile} {...size} />
    ) : (
      <StreamTile tile={tile} {...size} stats={streamStats} />
    );

  // Watching together: the video on the stage, everyone in the call in a strip under it.
  if (watching && !videoHidden) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex-1 min-h-0 p-2">
          <WatchStage className="h-full w-full rounded-lg bg-black/40" />
        </div>
        {tiles.length > 0 && (
          <div className="h-[120px] max-h-[calc(20*var(--app-vh))] min-h-[80px] flex-shrink-0 flex items-center gap-2 p-2 overflow-x-auto no-scrollbar">
            {tiles.map((tile) => (
              <div key={tile.key} className="h-full aspect-video flex-shrink-0 rounded-lg first:ml-auto last:mr-auto">
                {renderTile(tile, { compact: true })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const showWatch = watching && videoHidden && (
    <button
      type="button"
      onClick={() => { if (currentVoiceChannelId) useWatchStore.getState().setVideoHidden(currentVoiceChannelId, false); }}
      className="absolute left-4 top-4 z-10 btn-quiet btn-sm"
    >
      <Icon name="watch" size={14} />
      {t('voice:watch.show')}
    </button>
  );

  if (tiles.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center relative">
        {showWatch}
        <div className="empty-state">
          <div className="empty-state-icon">
            <Icon name="volume" size={18} />
          </div>
          <p className="empty-state-body">
            {t('voice:grid.waitingForOthers')}
          </p>
        </div>
      </div>
    );
  }

  const focusedTile = focusedParticipantId
    ? tiles.find((t) => t.key === focusedParticipantId)
    : null;

  // Focus mode: one large tile + bottom strip
  if (focusedTile) {
    const otherTiles = tiles.filter((t) => t.key !== focusedParticipantId);
    return (
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {showWatch}
        {/* Main focused view */}
        <div
          className="flex-1 p-2 min-h-0 cursor-pointer relative"
          onClick={() => setFocusedParticipant(null)}
          title={t('voice:grid.returnToGridHint')}
        >
          {renderTile(focusedTile, { large: true })}
          {/* Grid button — top-right */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFocusedParticipant(null);
            }}
            className="absolute top-4 right-4 z-10 flex h-7 items-center gap-1.5 rounded-md bg-black/60 px-2.5 text-meta font-medium text-white/80 transition-colors duration-100 hover:bg-black/80 hover:text-white active:bg-black/90"
            title={t('voice:grid.backToGrid')}
          >
            <Icon name="grid" size={14} />
            {t('voice:grid.gridButton')}
          </button>
        </div>

        {/* Centered Hide/Show Members button — divider between focused tile and strip */}
        {otherTiles.length > 0 && (
          <div className="flex justify-center flex-shrink-0 py-0.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setStripHidden(!stripHidden);
              }}
              className="btn-quiet btn-sm"
              title={stripHidden ? t('voice:grid.showMembers') : t('voice:grid.hideMembers')}
              aria-expanded={!stripHidden}
            >
              <Icon name={stripHidden ? 'chevron-up' : 'chevron-down'} size={14} />
              {stripHidden ? t('voice:grid.showMembers') : t('voice:grid.hideMembers')}
            </button>
          </div>
        )}

        {/* Bottom strip of other tiles. The auto margins centre a short row;
            `justify-center` would push a long one out past the scrollable start. */}
        {!stripHidden && otherTiles.length > 0 && (
          <div className="h-[120px] max-h-[calc(20*var(--app-vh))] min-h-[80px] flex-shrink-0 flex items-center gap-2 p-2 overflow-x-auto no-scrollbar">
            {otherTiles.map((t) => (
              <div
                key={t.key}
                role="button"
                tabIndex={0}
                onClick={() => setFocusedParticipant(t.key)}
                onKeyDown={(e) => pressOnKey(e, () => setFocusedParticipant(t.key))}
                className="h-full aspect-video flex-shrink-0 cursor-pointer rounded-lg first:ml-auto last:mr-auto"
              >
                {renderTile(t, { compact: true })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Default grid mode — container-aware layout via ResizeObserver
  return (
    <div ref={gridRef} className="flex-1 overflow-hidden min-h-0 relative">
      {showWatch}
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${tileWidth}px)`,
          gridAutoRows: `${tileHeight}px`,
          gap: '8px',
          justifyContent: 'center',
          alignContent: 'center',
        }}
      >
        {tiles.map((t) => (
          <div
            key={t.key}
            role="button"
            tabIndex={0}
            onClick={() => setFocusedParticipant(t.key)}
            onKeyDown={(e) => pressOnKey(e, () => setFocusedParticipant(t.key))}
            className="cursor-pointer rounded-lg"
          >
            {renderTile(t, { compact: tileHeight < COMPACT_TILE_HEIGHT })}
          </div>
        ))}
      </div>
    </div>
  );
}
