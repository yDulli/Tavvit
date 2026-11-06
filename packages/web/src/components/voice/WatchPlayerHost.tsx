import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WATCH_LIMITS, WATCH_REACTIONS, type WatchAction, type WatchProvider, type WatchReaction } from '@backspace/shared/src/watch';
import { useConnectedOrigins } from '../../hooks/useConnectedOrigins';
import { describeError } from '../../i18n/errors';
import { layoutRect } from '../../platform/interfaceScale';
import { getMyUserIdForOrigin } from '../../stores/authStore';
import { useExternalMediaStore } from '../../stores/externalMediaStore';
import { getChannelOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useWatchStore, type WatchEntry } from '../../stores/watchStore';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { createWatchPlayer, watchPlayerAddress, type WatchPlayer } from '../../utils/watchPlayers';
import { needsSeek, roomPositionMs, SETTLE_TOLERANCE_MS } from '../../utils/watchSync';
import { watchProviderName } from '../../utils/watchTitle';
import { useBlockedHost } from '../ui/ExternalMedia';
import { Icon } from '../ui/Icon';
import { RangeSlider } from '../ui/RangeSlider';
import { PIP_HEIGHT, PIP_WIDTH, restingPipPosition } from './pipBounds';
import { WatchLinkForm } from './WatchLinkForm';

/**
 * The one player of watching together (docs/systems/watch-together.md). It is mounted with the app,
 * beside the call's audio, so the video goes on unbroken wherever the person goes: over the call's
 * place for it (`WatchStage`) while that view is open, and anywhere else in the place of the call's
 * floating window, which steps aside for it. Where that window would not show (the phone, whose
 * call has its own bars, or with the setting off) the video plays on unseen, as the call's sound does.
 */

const VOLUME_KEY = 'tavvit.watch.volume';
const DEFAULT_VOLUME = 80;

function storedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function storeVolume(value: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(value));
  } catch {
    // Without storage (a private window) the volume holds for this page only.
  }
}

/** Subtitles are one's own, like the volume: off until asked for, then kept for the next video. */
const CAPTIONS_KEY = 'tavvit.watch.captions';

function storedCaptions(): boolean {
  try {
    return localStorage.getItem(CAPTIONS_KEY) === 'on';
  } catch {
    return false;
  }
}

function storeCaptions(on: boolean): void {
  try {
    localStorage.setItem(CAPTIONS_KEY, on ? 'on' : 'off');
  } catch {
    // Without storage the choice holds for this page only.
  }
}

/** A position as the video's clock shows it: m:ss, or h:mm:ss for a long one. */
export function formatWatchTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Where the call's place for the video is, in layout pixels, while it is there. */
function useSlotBox(slot: HTMLElement | null): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    if (!slot) {
      setBox(null);
      return undefined;
    }
    const read = () => {
      const rect = layoutRect(slot.getBoundingClientRect());
      setBox((previous) => (previous && previous.top === rect.top && previous.left === rect.left
        && previous.width === rect.width && previous.height === rect.height
        ? previous
        : { top: rect.top, left: rect.left, width: rect.width, height: rect.height }));
    };
    // At once, so the frame lies over its place before the view is first painted; then once a
    // frame for every change.
    read();
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    observer.observe(document.body);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    // A panel opening beside the place moves it without resizing it.
    const timer = setInterval(measure, 1000);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      clearInterval(timer);
    };
  }, [slot]);
  return box;
}

/** The place of the call's floating window (`PictureInPicture`), which the video takes while it floats. */
function floatingBox(): Box {
  const { x, y } = restingPipPosition();
  return { top: y, left: x, width: PIP_WIDTH, height: PIP_HEIGHT };
}

export function WatchPlayerHost() {
  const channelId = useVoiceStore((state) => state.currentVoiceChannelId);
  const entry = useWatchStore((state) => (channelId ? state.sessions.get(channelId) : undefined));
  // Put away for this call alone: another call starts with its video shown, and a view rebuilt
  // around this one (the layout changing between phone and desktop) keeps what the person chose.
  const hidden = useWatchStore((state) => state.videoHiddenFor !== null && state.videoHiddenFor === channelId);

  // The session of a call this client left is not its to follow.
  useEffect(() => {
    const { sessions, forgetCall } = useWatchStore.getState();
    for (const id of [...sessions.keys()]) if (id !== channelId) forgetCall(id);
  }, [channelId]);

  if (!channelId || !entry?.session.current || hidden) return null;
  return <WatchFrame key={channelId} channelId={channelId} entry={entry} />;
}

function WatchFrame({ channelId, entry }: { channelId: string; entry: WatchEntry }) {
  const { t } = useTranslation(['voice', 'legal', 'common']);
  const navigate = useNavigate();
  const session = entry.session;
  const current = session.current!;
  const origin = getChannelOrigin(channelId);
  const myId = getMyUserIdForOrigin(origin);
  const slot = useWatchStore((state) => state.slot);
  const slotBox = useSlotBox(slot);
  const allowHost = useExternalMediaStore((state) => state.allowHost);
  const setAlwaysAllow = useExternalMediaStore((state) => state.setAlwaysAllow);
  const addToast = useUIStore((state) => state.addToast);
  const permissions = useSpaceStore((state) => state.channelPermissions.get(channelId));
  const spaceId = useSpaceStore((state) => state.channelToSpaceMap.get(channelId));

  const frameRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const [player, setPlayer] = useState<WatchPlayer | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [volume, setVolume] = useState(storedVolume);
  const [captions, setCaptions] = useState(storedCaptions);
  const [, setTick] = useState(0);

  const mayControl = session.control === 'everyone' || session.starterId === myId;
  // Why the controls do nothing for this viewer: read after their names, and their tooltips' second line.
  const controlledHintId = useId();
  const mayEnd = mayControl || hasPermissionBit(permissions, PermissionBits.MOVE_MEMBERS);
  const mayAdd = hasPermissionBit(permissions, PermissionBits.STREAM);
  const isStarter = session.starterId === myId;

  const address = watchPlayerAddress(current);
  // A video its provider gave no title for is named by its provider, never by its link.
  const titleOf = (item: { title: string; provider: WatchProvider }) =>
    item.title || t('voice:watch.untitled', { provider: watchProviderName(item.provider) });
  const title = titleOf(current);
  const blockedHost = useBlockedHost(address, useConnectedOrigins());

  // Over the call's place for it, floating in the place of the call's own window, or on unseen where
  // that window would not show (the phone has its own bars for a call; the setting may be off).
  const isMobile = useUIStore((state) => state.isMobile);
  const pipEnabled = useVoiceStore((state) => state.pipEnabled);
  const mode: 'stage' | 'float' | 'unseen' = slotBox ? 'stage' : !isMobile && pipEnabled ? 'float' : 'unseen';
  const staged = mode === 'stage';
  const showing = !blockedHost;

  // The player of the video that plays now: made again only when another plays.
  useEffect(() => {
    const mount = mountRef.current;
    if (!showing || !mount) return undefined;
    const latest = entryRef.current;
    const made = createWatchPlayer(current, roomPositionMs(latest.session, latest.offsetMs), {
      onEnded: () => {
        const now = entryRef.current.session;
        if (now.current?.id !== current.id) return;
        if (now.control !== 'everyone' && now.starterId !== myId) return;
        void useWatchStore.getState().change(channelId, { action: 'next', itemId: current.id }).catch(() => undefined);
      },
      onBlocked: () => setBlocked(true),
      onPlaying: () => setBlocked(false),
    });
    mount.appendChild(made.element);
    setPlayer(made);
    return () => {
      made.destroy();
      setPlayer(null);
      setBlocked(false);
    };
    // `current` is the same video while its id is: a new session object for it changes nothing here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id, showing, channelId, myId]);

  // Kept with the room: playing or paused as it is, moved back when it runs away from it. Once
  // the player has started, and again after each change in the room, it is put close to the room
  // first; after that only a wider drift moves it, so a player is not sought back and forth.
  useEffect(() => {
    if (!player) return undefined;
    let settled = false;
    const align = () => {
      const { session: now, offsetMs } = entryRef.current;
      const room = roomPositionMs(now, offsetMs);
      if (now.playing) player.play();
      else player.pause();
      const at = player.currentMs();
      if (needsSeek(at, room, settled ? WATCH_LIMITS.DRIFT_TOLERANCE_MS : SETTLE_TOLERANCE_MS)) player.seek(room);
      else settled = true;
    };
    align();
    const timer = setInterval(align, 1000);
    return () => clearInterval(timer);
  }, [player, entry]);

  // How loud: one's own volume for the video, the call's output, quieter while someone speaks (as a
  // stream is), and silent while deafened.
  const outputVolume = useVoiceStore((state) => state.outputVolume);
  const deafened = useVoiceStore((state) => {
    if (state.isDeafened) return true;
    const myVoiceId = getMyUserIdForOrigin(origin);
    return spaceId !== undefined && myVoiceId !== undefined && state.spaceDeafenedUserIds.has(`${spaceId}:${myVoiceId}`);
  });
  const ducked = useVoiceStore((state) => state.streamAttenuationEnabled
    && state.participants.some((participant) => !participant.isLocal && state.speakingParticipantIds.has(participant.identity)));
  const duckStrength = useVoiceStore((state) => state.streamAttenuationStrength);
  const effectiveVolume = deafened ? 0 : Math.min(100, volume * (outputVolume / 100) * (ducked ? 1 - duckStrength / 100 : 1));
  useEffect(() => {
    player?.setVolume(effectiveVolume);
  }, [player, effectiveVolume]);

  // Subtitles as this viewer chose, on every player of the session (off unless asked for).
  useEffect(() => {
    player?.setCaptions?.(captions);
  }, [player, captions]);

  // The clock under the picture moves on its own.
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const box = slotBox ?? floatingBox();
  // A frame too narrow for the queue beside the picture lays it over the picture instead.
  const narrow = box.width < 560;
  const canFullscreen = document.fullscreenEnabled === true;
  const position = roomPositionMs(session, entry.offsetMs);
  const duration = player?.durationMs() ?? null;

  const act = (action: WatchAction) => {
    useWatchStore.getState().change(channelId, action).catch((err: unknown) => addToast(describeError(err), 'warning'));
  };
  const react = (reaction: WatchReaction) => {
    useWatchStore.getState().react(channelId, reaction).catch((err: unknown) => addToast(describeError(err), 'warning'));
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen?.();
  };
  const backToCall = () => {
    if (spaceId) navigate(`/channels/${spaceId}/${channelId}`);
  };
  const putAway = () => useWatchStore.getState().setVideoHidden(channelId, true);

  return (
    <div
      ref={frameRef}
      role="region"
      aria-label={t('voice:watch.title')}
      aria-hidden={mode === 'unseen' || undefined}
      data-watch-frame={mode}
      data-paused={session.playing && !blocked ? undefined : ''}
      className={`watch-frame fixed flex flex-col overflow-hidden rounded-lg ${
        mode === 'stage'
          ? 'z-[30] border border-border-hard bg-surface-base'
          : mode === 'float' ? 'glass z-[40] bg-black' : 'invisible pointer-events-none'
      }`}
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
    >
      {!mayControl && <span id={controlledHintId} className="sr-only">{t('voice:watch.controlledByStarter')}</span>}
      {/* What plays, and how the frame sits. Above the picture, where the provider draws nothing of its own. */}
      {staged && (
        <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border-hard pl-3 pr-1.5">
          <Icon name="watch" size={15} className="flex-shrink-0 text-accent-soft" />
          <p className="min-w-0 flex-1 truncate text-ui font-medium text-txt-primary" title={title}>{title}</p>
          {canFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="icon-btn"
              aria-label={fullscreen ? t('voice:watch.exitFullscreen') : t('voice:watch.fullscreen')}
            >
              <Icon name="maximize" size={16} />
            </button>
          )}
          <button type="button" onClick={putAway} className="icon-btn" aria-label={t('voice:watch.hide')}>
            <Icon name="eye-off" size={16} />
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* The picture. The player draws here and is never moved, whatever the frame does; nobody
            reaches it directly, the room steers it. */}
        <div className="relative min-w-0 flex-1 bg-black">
          <div ref={mountRef} className="absolute inset-0" aria-hidden="true" />
          <div className="absolute inset-0" />

          {blockedHost && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="surface-card max-w-[360px] rounded-lg px-4 py-3 text-ui">
                <p className="truncate font-medium text-txt-primary">{title}</p>
                <p className="mt-1 break-words leading-snug text-txt-secondary">{t('legal:external.notice', { host: blockedHost })}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1">
                  <button type="button" onClick={() => allowHost(blockedHost)} className="btn-outline btn-sm">{t('legal:external.load')}</button>
                  <button type="button" onClick={() => setAlwaysAllow(true)} className="btn-quiet btn-sm">{t('legal:external.always')}</button>
                </div>
              </div>
            </div>
          )}

          {blocked && !blockedHost && (
            <button type="button" onClick={() => player?.play()} className="absolute inset-0 flex items-center justify-center bg-black/55">
              <span className="btn-hero btn-lg pointer-events-none">
                <Icon name="play" size={18} />
                {t('voice:watch.blocked')}
              </span>
            </button>
          )}

          <FlyingReactions channelId={channelId} />

          {/* Floating: the way back to the call, and away. Shown under the pointer only, so the
              provider's own marks at the top left stay readable. */}
          {!staged && (
            <div className="watch-chrome absolute right-1.5 top-1.5 flex gap-1">
              <button data-tooltip="" type="button" onClick={backToCall} className="watch-chrome-btn" aria-label={t('voice:watch.backToCall')}>
                <Icon name="chevron-up" size={16} />
              </button>
              <button data-tooltip="" type="button" onClick={putAway} className="watch-chrome-btn" aria-label={t('voice:watch.hide')}>
                <Icon name="x" size={16} />
              </button>
            </div>
          )}
        </div>

        {staged && queueOpen && (
          <div
            className={`flex flex-col bg-surface-channel ${
              narrow ? 'absolute inset-0 z-[1]' : 'w-[280px] flex-shrink-0 border-l border-border-hard'
            }`}
          >
            <div className="flex h-9 flex-shrink-0 items-center justify-between pl-3 pr-1.5">
              <h2 className="label-mono">{t('voice:watch.queue')}</h2>
              <button type="button" onClick={() => setQueueOpen(false)} className="icon-btn" aria-label={t('common:actions.close')}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
              <p className="label-mono px-1 pb-1">{t('voice:watch.nowPlaying')}</p>
              <p className="truncate px-1 pb-3 text-ui text-txt-primary" title={title}>{title}</p>
              <p className="label-mono px-1 pb-1">{t('voice:watch.upNext')}</p>
              {session.queue.length === 0 && <p className="px-1 py-2 text-meta text-txt-tertiary">{t('voice:watch.queueEmpty')}</p>}
              <ul className="flex flex-col gap-0.5">
                {session.queue.map((item) => (
                  <li key={item.id} className="list-row flex items-center gap-2 rounded-md px-1.5 py-1">
                    <span className="min-w-0 flex-1 truncate text-ui text-txt-secondary" title={titleOf(item)}>{titleOf(item)}</span>
                    {mayControl && (
                      <button type="button" onClick={() => act({ action: 'remove', itemId: item.id })} className="icon-btn" aria-label={t('voice:watch.remove')}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2 border-t border-border-hard p-3">
              {mayAdd && <WatchLinkForm channelId={channelId} running />}
              {isStarter && (
                <button
                  type="button"
                  onClick={() => act({ action: 'control', control: session.control === 'everyone' ? 'starter' : 'everyone' })}
                  className="btn-quiet btn-sm self-start"
                >
                  {session.control === 'everyone' ? t('voice:watch.controlStarter') : t('voice:watch.controlEveryone')}
                </button>
              )}
              {mayEnd && (
                <button
                  type="button"
                  onClick={() => useWatchStore.getState().end(channelId).catch((err: unknown) => addToast(describeError(err), 'warning'))}
                  className="btn-outline btn-sm self-start"
                >
                  {t('voice:watch.end')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* The room's controls, reactions, and one's own volume. Under the picture, clear of the
          provider's marks in it. */}
      {staged && (
        <div className="flex flex-shrink-0 flex-col gap-0.5 border-t border-border-hard px-2 pb-1.5 pt-1">
          {duration !== null && (
            <SeekBar
              position={position}
              duration={duration}
              disabled={!mayControl}
              label={t('voice:watch.seek')}
              onSeek={(positionMs) => act({ action: 'seek', positionMs })}
            />
          )}
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              disabled={!mayControl}
              onClick={() => act({ action: session.playing ? 'pause' : 'play' })}
              className="icon-btn icon-btn-lg"
              aria-label={session.playing ? t('voice:watch.pause') : t('voice:watch.play')}
              aria-describedby={mayControl ? undefined : controlledHintId}
            >
              <Icon name={session.playing ? 'pause' : 'play'} size={18} />
            </button>
            <button
              type="button"
              disabled={!mayControl}
              onClick={() => act({ action: 'next', itemId: current.id })}
              className="icon-btn"
              aria-label={t('voice:watch.next')}
              aria-describedby={mayControl ? undefined : controlledHintId}
            >
              <Icon name="skip" size={16} />
            </button>
            <span className="ml-1 flex-shrink-0 whitespace-nowrap font-mono text-meta tabular-nums text-txt-secondary">
              {formatWatchTime(position)}
              {duration !== null && <span className="text-txt-tertiary"> / {formatWatchTime(duration)}</span>}
            </span>
            <div className="mx-auto flex min-w-0 items-center gap-0.5 overflow-x-auto px-2 no-scrollbar" role="group" aria-label={t('voice:watch.reactions')}>
              {WATCH_REACTIONS.map((reaction) => (
                <button
                  data-tooltip=""
                  key={reaction}
                  type="button"
                  onClick={() => react(reaction)}
                  className="watch-reaction-btn"
                  aria-label={t('voice:watch.react', { reaction })}
                >
                  {reaction}
                </button>
              ))}
            </div>
            {player?.setCaptions && (
              <button
                data-tooltip=""
                type="button"
                onClick={() => {
                  setCaptions(!captions);
                  storeCaptions(!captions);
                }}
                aria-pressed={captions}
                data-active={captions ? 'true' : undefined}
                className="icon-btn flex-shrink-0"
                aria-label={t('voice:watch.captions')}
              >
                <Icon name="captions" size={16} />
              </button>
            )}
            {!narrow && (
              <label className="flex w-28 flex-shrink-0 items-center gap-1.5 text-txt-tertiary">
                <Icon name="volume" size={14} className="flex-shrink-0" />
                <RangeSlider
                  value={volume}
                  min={0}
                  max={100}
                  onChange={(next) => {
                    setVolume(next);
                    storeVolume(next);
                  }}
                  aria-label={t('voice:watch.volume')}
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => setQueueOpen((open) => !open)}
              aria-expanded={queueOpen}
              data-active={queueOpen ? 'true' : undefined}
              className="icon-btn relative"
              aria-label={t('voice:watch.queue')}
            >
              <Icon name="list" size={16} />
              {session.queue.length > 0 && <span className="count-badge absolute -right-1.5 -top-1.5">{session.queue.length}</span>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Where the video stands, to drag to another place. While it is held the bar shows where it is
 * held; the room hears of the new place once it is let go, not at every step on the way.
 */
function SeekBar({ position, duration, disabled, label, onSeek }: {
  position: number;
  duration: number;
  disabled: boolean;
  label: string;
  onSeek: (positionMs: number) => void;
}) {
  const [held, setHeld] = useState<number | null>(null);
  const commit = () => {
    if (held === null) return;
    onSeek(held);
    setHeld(null);
  };
  return (
    <RangeSlider
      min={0}
      max={Math.round(duration)}
      step={1000}
      value={held ?? Math.min(Math.round(position), Math.round(duration))}
      disabled={disabled}
      onChange={setHeld}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      aria-label={label}
    />
  );
}

/** The reactions in the air over the picture; the store lands each after its flight. */
function FlyingReactions({ channelId }: { channelId: string }) {
  const reactions = useWatchStore((state) => state.reactions);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {reactions.filter((entry) => entry.channelId === channelId).map((entry) => (
        <span key={entry.id} className="watch-reaction" style={{ left: `${12 + ((entry.id * 37) % 76)}%` }}>
          {entry.reaction}
        </span>
      ))}
    </div>
  );
}
