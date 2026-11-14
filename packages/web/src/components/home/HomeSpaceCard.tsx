import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaggedSpace } from '../../stores/spaceStore';
import { getSpaceGradient } from '../../utils/gradients';
import { lightFromColor } from '../../utils/placeLight';
import { Icon } from '../ui/Icon';
import { SpaceGlyph } from '../layout/SpaceSidebar';
import { iconSrc } from '../inbox/InboxPage';
import { UnreadBadge } from '../inbox/UnreadBadge';
import { GoChip } from './HomeHero';

/**
 * A space as a card of Home: a frame lit from its corner in the space's own colour, with its
 * picture and what is waiting there at the top (mentions in the signal, other unread messages as a
 * quiet figure), its name and what it is about (or the instance it lives on), and at its foot who
 * is talking in its voice channels, friends first. A space on another instance says so while the
 * connection to it is out. The whole card opens the space.
 */
export function HomeSpaceCard({ space, mentions, unreadTotal, unread, friendsInVoice, peopleInVoice, reconnecting, onOpen, onContextMenu }: {
  space: TaggedSpace;
  mentions: number;
  /** The unread messages its instance counted; 0 when that instance sends no counts. */
  unreadTotal: number;
  /** Some text channel of it has unread messages, counted or not. */
  unread: boolean;
  friendsInVoice: number;
  /** Everyone in its voice channels except the viewer. */
  peopleInVoice: number;
  /** The name of its instance while the connection to it is out; null otherwise. */
  reconnecting: string | null;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  const { t } = useTranslation(['home', 'spaces']);
  const remoteHost = useMemo(() => {
    if (!space._instanceOrigin) return null;
    try { return new URL(space._instanceOrigin).host; } catch { return space._instanceOrigin; }
  }, [space._instanceOrigin]);
  const light = lightFromColor(getSpaceGradient(space.id, space.name, space.avatarColor).from);
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        onContextMenu={onContextMenu}
        style={light ? ({ '--tile': light } as React.CSSProperties) : undefined}
        className={`home-space surface-card lift spotlight go-host ${light ? 'tinted-card' : ''} ${reconnecting ? 'opacity-60' : ''}`}
      >
        <span className="flex items-start justify-between gap-3">
          <SpaceGlyph id={space.id} name={space.name} icon={space.icon ? iconSrc(space.icon) : null} avatarColor={space.avatarColor} size={44} />
          <span className="flex min-h-[20px] items-center">
            {mentions > 0 ? (
              <UnreadBadge count={mentions} label={t('home:spaces.mentions', { count: mentions })} />
            ) : unreadTotal > 0 ? (
              <UnreadBadge
                count={unreadTotal}
                tone="muted"
                label={unreadTotal > 99 ? t('spaces:sidebar.space.unreadMessagesOver99') : t('spaces:sidebar.space.unreadMessages', { count: unreadTotal })}
              />
            ) : unread ? (
              <UnreadBadge count={null} tone="muted" />
            ) : null}
          </span>
        </span>

        <span className="mt-5 block min-w-0">
          <span className="home-space-name block truncate">{space.name}</span>
          {remoteHost ? (
            <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-meta text-txt-tertiary">
              {reconnecting ? (
                <>
                  <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-amber" />
                  <span className="truncate">{t('spaces:sidebar.space.reconnecting', { instance: reconnecting })}</span>
                </>
              ) : (
                <>
                  <Icon name="globe" size={12} className="flex-shrink-0" />
                  <span className="truncate font-mono">{remoteHost}</span>
                </>
              )}
            </span>
          ) : space.description ? (
            <span className="mt-1.5 line-clamp-2 text-ui leading-[1.45] text-txt-secondary">{space.description}</span>
          ) : null}
        </span>

        <span className="home-space-foot">
          {friendsInVoice > 0 ? (
            <span className="flex min-w-0 items-center gap-1.5 text-meta text-txt-secondary">
              <Icon name="volume" size={13} className="flex-shrink-0 text-status-online" />
              <span className="truncate">{t('home:spaces.inVoice', { count: friendsInVoice })}</span>
            </span>
          ) : peopleInVoice > 0 ? (
            <span className="flex min-w-0 items-center gap-1.5 text-meta text-txt-secondary">
              <Icon name="volume" size={13} className="flex-shrink-0 text-txt-tertiary" />
              <span className="truncate">{t('home:spaces.peopleInVoice', { count: peopleInVoice })}</span>
            </span>
          ) : (
            <span aria-hidden="true" className="font-mono text-meta text-txt-tertiary/60">—</span>
          )}
          <GoChip />
        </span>
      </button>
    </li>
  );
}

/** The last card of a short row of spaces (or the only one): make one, or join one. */
export function SpaceSuggestTile({ alone, onCreate, onJoin }: { alone: boolean; onCreate: () => void; onJoin: () => void }): React.JSX.Element {
  const { t } = useTranslation('home');
  return (
    <li className="min-w-0">
      <div className="home-space home-space-new">
        <span aria-hidden="true" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-border-soft text-txt-tertiary">
          <Icon name="plus" size={18} />
        </span>
        {alone && <p className="mt-5 text-ui leading-[1.45] text-txt-secondary">{t('spaces.empty')}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          <button type="button" onClick={onCreate} className="btn-outline btn-sm">{t('spaces.create')}</button>
          <button type="button" onClick={onJoin} className="btn-quiet btn-sm">{t('spaces.join')}</button>
        </div>
      </div>
    </li>
  );
}
