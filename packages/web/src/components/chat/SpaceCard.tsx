import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DirectoryEntry } from '@backspace/shared';
import type { TaggedExploreSpace } from '../../stores/exploreStore';
import { getSpaceGradient } from '../../utils/gradients';
import { bannerFill, lightFromColor } from '../../utils/placeLight';
import { extractDominantColors, colorsToGradient } from '../../utils/colorExtractor';
import { useSpaceJoin } from '../../hooks/useSpaceJoin';
import { useConnectedOrigins } from '../../hooks/useConnectedOrigins';
import { ExternalImage, useBlockedHost } from '../ui/ExternalMedia';
import { BadgeList } from '../../badges/BadgeList';
import { Icon } from '../ui/Icon';

/** Length cap of the optional message on a join request; the modal and the card share it. */
export const REQUEST_MESSAGE_MAX_LENGTH = 200;

/**
 * The Outer Space variant of the card. When set, the card belongs to an
 * instance the session has no connection to: the origin chip is always shown,
 * the closed-registration badge appears when the instance takes no new
 * accounts, and the single action hands the entry to the connect flow instead
 * of joining through `useSpaceJoin`.
 */
export interface OuterCardProps {
  entry: DirectoryEntry;
  onConnect: (entry: DirectoryEntry) => void;
}

export interface SpaceCardProps {
  space: TaggedExploreSpace;
  onJoinSuccess: (spaceId: string) => void;
  outer?: OuterCardProps;
}

/** The `TaggedExploreSpace` an Outer card renders for a directory entry. */
export function outerEntryToSpace(entry: DirectoryEntry): TaggedExploreSpace {
  return { ...entry, _instanceOrigin: entry.origin, joined: false };
}

export function SpaceCard({
  space,
  onJoinSuccess,
  outer,
}: SpaceCardProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const {
    isJoined,
    isPublic,
    isPending,
    joining,
    joinError,
    showRequestForm,
    requestMessage,
    setRequestMessage,
    openRequestForm,
    cancelRequestForm,
    join,
    sendRequest,
  } = useSpaceJoin(space);

  const [iconGradient, setIconGradient] = useState<string | null>(null);

  const spaceTone = getSpaceGradient(space.id, space.name, space.avatarColor);
  const fallbackGradient = spaceTone.gradient;
  const light = lightFromColor(spaceTone.from);
  const originLabel = space._instanceOrigin
    ? (() => { try { return new URL(space._instanceOrigin).host; } catch { return space._instanceOrigin; } })()
    : null;

  const iconUrl = space.icon
    ? (space.icon.startsWith('http') || space.icon.startsWith('/') ? space.icon : `/api/uploads/${space.icon}`)
    : null;
  const bannerAddress = space.banner
    ? (space.banner.startsWith('http') || space.banner.startsWith('/') ? space.banner : `/api/uploads/${space.banner}`)
    : null;
  // An Outer Space card is a space on someone else's instance: its pictures wait for a yes, as
  // anything from another server does (docs/systems/legal.md), unless this client talks to it.
  const trustedOrigins = useConnectedOrigins();
  const iconBlocked = useBlockedHost(iconUrl, trustedOrigins) !== null;
  const bannerUrl = useBlockedHost(bannerAddress, trustedOrigins) === null ? bannerAddress : null;

  // Extract dominant colors from icon when no banner is set
  useEffect(() => {
    if (bannerUrl || !iconUrl || iconBlocked) return;
    let cancelled = false;
    extractDominantColors(iconUrl)
      .then(colors => {
        if (!cancelled && colors.length > 0) setIconGradient(colorsToGradient(colors));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [iconUrl, bannerUrl, iconBlocked]);

  const handlePublicJoin = async () => {
    const full = await join();
    if (full) onJoinSuccess(full.id);
  };

  const handleViewSpace = () => {
    onJoinSuccess(space.id);
  };

  const closedToNewAccounts = outer !== undefined && outer.entry.federatedRegistrationOpen === false;

  return (
    <div style={{ '--tile': light } as React.CSSProperties} className="surface-card lift spotlight rounded-lg overflow-hidden flex flex-col">
      {/* Banner area */}
      <div className={`h-24 relative overflow-hidden ${bannerUrl ? '' : 'banner-depth'}`}>
        {/* Background layer */}
        {bannerUrl ? (
          <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0" style={{ background: iconGradient ?? bannerFill(spaceTone.from) }} />
        )}

        {/* Joined badge (top-left) */}
        {isJoined && (
          <div className="absolute top-2 left-2 z-[2]">
            <span className="flex items-center gap-1 rounded-sm bg-black/65 px-1.5 py-0.5 font-mono text-2xs uppercase tracking-[0.04em] text-txt-primary">
              <Icon name="check" size={10} />
              {t('spaces:explore.badges.joined')}
            </span>
          </div>
        )}

        {/* Closed-registration badge (top-left, Outer cards only; an Outer card is never joined) */}
        {closedToNewAccounts && (
          <div className="absolute top-2 left-2 z-[2]">
            <span className="flex items-center gap-1 rounded-sm bg-black/65 px-1.5 py-0.5 font-mono text-2xs uppercase tracking-[0.04em] text-txt-danger">
              <Icon name="lock" size={10} />
              {t('spaces:explore.outer.closedBadge')}
            </span>
          </div>
        )}

        {/* Visibility badge */}
        <div className="absolute top-2 right-2 z-[2]">
          <span className={`flex items-center gap-1 rounded-sm bg-black/65 px-1.5 py-0.5 font-mono text-2xs uppercase tracking-[0.04em] ${isPublic ? 'text-txt-secondary' : 'text-txt-warning'}`}>
            {isPublic ? t('spaces:explore.badges.public') : t('spaces:explore.badges.request')}
          </span>
        </div>

      </div>

      {/* Overlapping icon */}
      <div className="relative px-4 -mt-6 z-10">
        {iconUrl && iconBlocked ? (
          <ExternalImage src={iconUrl} alt={space.name} compact placeholderClassName="w-12 h-12 ring-[3px] ring-surface-chat" />
        ) : iconUrl ? (
          <img
            src={iconUrl}
            alt={space.name}
            className="w-12 h-12 rounded-lg object-cover ring-[3px] ring-surface-chat"
          />
        ) : (
          <div
            className="w-12 h-12 rounded-lg ring-[3px] ring-surface-chat flex items-center justify-center text-title font-semibold text-white/90"
            style={{ background: fallbackGradient }}
          >
            {space.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pt-2.5 pb-4 flex flex-col flex-1">
        <div className="mb-1 flex min-w-0 items-center gap-1.5">
          <h3 className="min-w-0 truncate text-lead font-semibold text-txt-primary">{space.name}</h3>
          <BadgeList badges={space.badges ?? []} size="md" />
        </div>

        {space.description ? (
          <p className="text-ui leading-[1.45] text-txt-secondary line-clamp-2 mb-3 flex-1">
            {space.description}
          </p>
        ) : (
          <p className="text-ui text-txt-tertiary mb-3 flex-1">{t('spaces:explore.noDescription')}</p>
        )}

        <div className="flex min-w-0 items-center gap-3 text-meta text-txt-tertiary mb-3">
          <span className="flex flex-shrink-0 items-center gap-1.5">
            <Icon name="users" size={13} />
            {t('spaces:explore.memberCount', { count: space.memberCount })}
          </span>
          {originLabel && (
            <span className="flex min-w-0 items-center gap-1.5">
              <Icon name="globe" size={12} className="flex-shrink-0" />
              <span className="truncate">{originLabel}</span>
            </span>
          )}
        </div>

        {/* Action area */}
        {joinError && !outer && (
          <div role="alert" className="text-meta text-txt-danger mb-2">{joinError}</div>
        )}

        {/* A grid of cards has no one main action, so the signal colour stays
            off them: every card's action is the same outlined button. */}
        {outer ? (
          <button
            type="button"
            onClick={() => outer.onConnect(outer.entry)}
            className="btn-outline w-full"
          >
            {isPublic ? t('spaces:explore.outer.connectAndJoin') : t('spaces:explore.outer.connectAndRequest')}
          </button>
        ) : isJoined ? (
          <button
            type="button"
            onClick={handleViewSpace}
            className="btn-quiet w-full"
          >
            {t('spaces:explore.viewSpace')}
          </button>
        ) : isPublic ? (
          <button
            type="button"
            onClick={handlePublicJoin}
            disabled={joining}
            aria-busy={joining}
            className="btn-outline w-full"
          >
            {joining ? t('spaces:explore.joining') : t('spaces:explore.join')}
          </button>
        ) : isPending ? (
          <button
            type="button"
            disabled
            className="btn-outline w-full"
          >
            {t('spaces:explore.requestPending')}
          </button>
        ) : showRequestForm ? (
          <div className="space-y-2">
            <textarea
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value.slice(0, REQUEST_MESSAGE_MAX_LENGTH))}
              placeholder={t('spaces:explore.requestMessagePlaceholder')}
              rows={2}
              className="input-standard w-full resize-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={sendRequest}
                disabled={joining}
                aria-busy={joining}
                className="btn-primary flex-1"
              >
                {joining ? t('spaces:explore.sendingRequest') : t('spaces:explore.sendRequest')}
              </button>
              <button
                type="button"
                onClick={cancelRequestForm}
                className="btn-quiet"
              >
                {t('common:actions.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openRequestForm}
            className="btn-outline w-full"
          >
            {t('spaces:explore.requestToJoin')}
          </button>
        )}
      </div>
    </div>
  );
}
