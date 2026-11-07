import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ExploreSpace } from '@backspace/shared';
import { wornSpaceTagOf, type SpaceTag, type WornSpaceTag } from '@backspace/shared/src/spaceTags';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { useSpaceJoin } from '../../hooks/useSpaceJoin';
import { RoleGlyph } from '../../roles/RoleIcon';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { getApiForOrigin } from '../../utils/crossStoreResolvers';
import { Avatar } from './Avatar';

/**
 * Space tags (docs/systems/space-tags.md): the mark of a space a person wears beside their name,
 * its symbol and letters in its colour. A click opens a card with the space: open it, join it,
 * ask to, or wear the tag too. What a host sends is checked again (`wornSpaceTagOf`), so a tag
 * this client cannot draw shows nothing.
 */

/** The tag a person wears, as this client draws it, or null. */
export function shownSpaceTag(person: { spaceTag?: unknown } | null | undefined): WornSpaceTag | null {
  return wornSpaceTagOf(person?.spaceTag);
}

/** The tag itself, not a control: on the card, in the settings' preview. */
export function SpaceTagMark({ tag, className = '' }: { tag: SpaceTag; className?: string }) {
  return (
    <span className={`space-tag ${className}`} data-color={tag.color} data-static="true">
      <RoleGlyph id={tag.glyph} size={11} />
      <span>{tag.text}</span>
    </span>
  );
}

/**
 * A worn tag beside a name. `origin` is the instance that sent the person, where the space is.
 * It is a span and not a button, since it sits inside things that open when clicked (a row of a
 * list, a name), and its click goes no further than itself.
 */
export function SpaceTagChip({ tag, origin, className = '' }: { tag: WornSpaceTag; origin: string; className?: string }) {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen((was) => !was);
  };
  return (
    <>
      <span
        ref={anchorRef}
        role="button"
        tabIndex={0}
        aria-label={t('common:spaceTag.label', { tag: tag.text })}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggle(event); }}
        className={`space-tag flex-shrink-0 ${className}`}
        data-color={tag.color}
      >
        <RoleGlyph id={tag.glyph} size={11} />
        <span>{tag.text}</span>
      </span>
      {open && <SpaceTagCard tag={tag} origin={origin} anchorRef={anchorRef} onClose={close} />}
    </>
  );
}

type CardState =
  | { status: 'loading' }
  | { status: 'ready'; space: ExploreSpace & { _instanceOrigin: string }; tag: SpaceTag }
  | { status: 'gone' };

/** What a click on a tag shows: the space, how many are in it, and what one can do. */
function SpaceTagCard({ tag, origin, anchorRef, onClose }: {
  tag: WornSpaceTag;
  origin: string;
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const { t } = useTranslation(['common']);
  const cardRef = useRef<HTMLDivElement>(null);
  const portalContainer = usePortalContainer();
  const { style } = useFloatingPosition(anchorRef, cardRef, { placement: 'bottom', offset: 8, enabled: true });
  const [state, setState] = useState<CardState>({ status: 'loading' });

  useDismissOnEscape(true, onClose);

  useEffect(() => {
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => document.removeEventListener('pointerdown', onPress, true);
  }, [anchorRef, onClose]);

  useEffect(() => {
    let live = true;
    getApiForOrigin(origin).explore.spaceTag(tag.spaceId)
      .then((answer) => {
        if (live) setState({ status: 'ready', space: { ...answer.space, _instanceOrigin: origin }, tag: answer.tag });
      })
      .catch(() => {
        if (live) setState({ status: 'gone' });
      });
    return () => {
      live = false;
    };
  }, [origin, tag.spaceId]);

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={t('common:spaceTag.label', { tag: tag.text })}
      style={style}
      className="z-[260] w-[288px] rounded-lg p-3 glass animate-pop"
      onClick={(event) => event.stopPropagation()}
    >
      {state.status === 'loading' && <div className="h-[92px] animate-pulse rounded-md bg-surface-input" aria-hidden="true" />}
      {state.status === 'gone' && (
        <p className="text-meta leading-snug text-txt-secondary">{t('common:spaceTag.card.gone')}</p>
      )}
      {state.status === 'ready' && <SpaceTagCardBody space={state.space} tag={state.tag} onClose={onClose} />}
    </div>,
    portalContainer,
  );
}

function SpaceTagCardBody({ space, tag, onClose }: {
  space: ExploreSpace & { _instanceOrigin: string };
  tag: SpaceTag;
  onClose: () => void;
}) {
  const { t } = useTranslation(['common']);
  const { formatNumber } = useFormatters();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const { isJoined, isPending, joining, joinError, join, sendRequest } = useSpaceJoin(space);
  const [wearing, setWearing] = useState(false);
  const [wearError, setWearError] = useState('');

  // A tag is worn on the instance that holds the space: from this page, a space of its own instance.
  const ownInstance = space._instanceOrigin === '';
  const worn = shownSpaceTag(me)?.spaceId === space.id && ownInstance;
  const iconUrl = space.icon
    ? (space.icon.startsWith('http') || space.icon.startsWith('/') ? space.icon : `/api/uploads/${space.icon}`)
    : null;

  const open = (spaceId: string) => {
    onClose();
    useSpaceStore.getState().setCurrentSpace(spaceId);
    navigate(`/channels/${spaceId}`);
  };

  const wear = async (spaceId: string | null) => {
    setWearing(true);
    setWearError('');
    try {
      await updateProfile({ spaceTag: spaceId });
    } catch (err) {
      setWearError(err instanceof Error ? describeError(err) : t('common:spaceTag.card.wearFailed'));
    } finally {
      setWearing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Avatar src={iconUrl} name={space.name} size={40} userId={space.id} avatarColor={space.avatarColor} palette="space" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-body font-semibold text-txt-primary">{space.name}</span>
            <SpaceTagMark tag={tag} />
          </div>
          <div className="font-mono text-label text-txt-tertiary">
            {t('common:spaceTag.card.members', { count: space.memberCount, formatted: formatNumber(space.memberCount) })}
          </div>
        </div>
      </div>
      {space.description && <p className="line-clamp-3 text-meta leading-snug text-txt-secondary">{space.description}</p>}
      {(joinError || wearError) && <p role="alert" className="text-meta text-txt-danger">{joinError || wearError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {isJoined ? (
          <button type="button" className="btn-primary btn-sm" onClick={() => open(space.id)}>{t('common:spaceTag.card.open')}</button>
        ) : space.visibility === 'public' ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={joining}
            aria-busy={joining}
            onClick={async () => {
              const full = await join();
              if (full) open(full.id);
            }}
          >
            {t('common:spaceTag.card.join')}
          </button>
        ) : space.visibility === 'request' ? (
          isPending ? (
            <span className="text-meta text-txt-secondary">{t('common:spaceTag.card.requested')}</span>
          ) : (
            <button type="button" className="btn-outline btn-sm" disabled={joining} aria-busy={joining} onClick={() => void sendRequest()}>
              {t('common:spaceTag.card.request')}
            </button>
          )
        ) : (
          <span className="text-meta text-txt-tertiary">{t('common:spaceTag.card.inviteOnly')}</span>
        )}
        {isJoined && ownInstance && (
          worn ? (
            <button type="button" className="btn-quiet btn-sm" disabled={wearing} aria-busy={wearing} onClick={() => void wear(null)}>
              {t('common:spaceTag.card.takeOff')}
            </button>
          ) : (
            <button type="button" className="btn-outline btn-sm" disabled={wearing} aria-busy={wearing} onClick={() => void wear(space.id)}>
              {t('common:spaceTag.card.wear')}
            </button>
          )
        )}
      </div>
    </div>
  );
}
