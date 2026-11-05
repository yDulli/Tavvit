import { stickerUrl } from '@backspace/shared/src/stickers';
import { emojiIdOfReaction } from '@backspace/shared/src/customEmoji';
import { CustomEmojiImage } from '../ui/CustomEmojiImage';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Reaction } from '@backspace/shared';
import { useFormatters } from '../../i18n/formatters';
import { useSelfIdentity } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useBump } from '../../hooks/useBump';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape';
import { getCanonicalUserView } from '../../utils/userViewLookup';
import { parseFederatedUsername } from '../../utils/identity';
import { isOwnReaction, reactionSentence, summarizeReactors } from './reactionSummary';
import { useContextMenuStore } from '../../stores/contextMenuStore';
import { buildImageMenuItems } from './imageMenuItems';
import { useConnectedOrigins } from '../../hooks/useConnectedOrigins';
import { useBlockedHost } from '../ui/ExternalMedia';
import { Icon } from '../ui/Icon';

interface ReactionPillProps {
  emoji: string;
  /** Every reaction on the message with this emoji. */
  reactions: readonly Reaction[];
  /** The instance that issued the message and its reactions. */
  origin: string;
  /**
   * The instance whose emoji an `emoji:<id>` reaction names: the message's in a space, the first
   * reactor's home in a direct message. `origin` without it.
   */
  emojiOrigin?: string;
  /** It was not there when the message's row mounted: it comes in with a small jump. */
  added?: boolean;
  onToggle: () => void;
}

const SHOW_DELAY_MS = 300;
/** Longest name the tooltip prints before cutting it with an ellipsis. */
const MAX_NAME_CHARS = 32;

function truncateName(name: string): string {
  const chars = Array.from(name);
  return chars.length > MAX_NAME_CHARS ? `${chars.slice(0, MAX_NAME_CHARS - 1).join('')}…` : name;
}

/**
 * One reaction under a message: the emoji and its count, toggling the
 * current user's reaction on click. Hover or keyboard focus (not the focus a
 * mouse click leaves behind) shows who reacted in a `.glass` tooltip above
 * the pill, styled like the shared `Tooltip`; the same sentence is the
 * button's accessible description, so screen readers and touch users (who
 * get no hover tooltip) still have it. Escape closes it either way.
 *
 * Reactor names come from the reaction rows the message already carries
 * (every read path and the `reaction_added` event attach the reacting user),
 * routed through the cross-instance user views so a remote user shows their
 * home instance's name rather than a stub's.
 */
export function ReactionPill({ emoji, reactions, origin, emojiOrigin = origin, added = false, onToggle }: ReactionPillProps) {
  const { t } = useTranslation(['chat', 'common', 'legal']);
  const bumps = useBump(reactions.length);
  const stickerAddress = stickerUrl(emoji);
  // A sticker from a server this client does not talk to is not fetched until the person says
  // yes to that server (docs/systems/legal.md): until then the pill shows a plain picture mark.
  const blockedHost = useBlockedHost(stickerAddress, useConnectedOrigins());
  const imageUrl = blockedHost ? null : stickerAddress;
  const customEmojiId = emojiIdOfReaction(emoji);
  const fmt = useFormatters();
  const self = useSelfIdentity();
  const isMobile = useUIStore((s) => s.isMobile);
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  // A show is scheduled but its delay has not run out yet.
  const [pending, setPending] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const portalContainer = usePortalContainer();
  const tooltipOpen = open && !isMobile;
  const { style } = useFloatingPosition(anchorRef, floatingRef, {
    placement: 'top',
    offset: 8,
    enabled: tooltipOpen,
  });

  useEffect(() => () => clearTimeout(showTimerRef.current), []);

  const mine = reactions.some((r) => isOwnReaction(r, origin, self));

  const nameOf = (reaction: Reaction): string => {
    const user = reaction.user
      ?? useSpaceStore.getState().members.find((m) => m.userId === reaction.userId)?.user;
    if (!user) return t('common:states.unknown');
    const view = getCanonicalUserView(user, origin);
    return truncateName(view.displayName || parseFederatedUsername(view.username).baseName);
  };

  const summary = summarizeReactors(reactions, (r) => isOwnReaction(r, origin, self), nameOf);
  const sentence = reactionSentence(summary, t, fmt);
  const before = sentence.text.slice(0, sentence.namesStart);
  const names = sentence.text.slice(sentence.namesStart, sentence.namesStart + sentence.namesLength);
  const after = sentence.text.slice(sentence.namesStart + sentence.namesLength);

  const show = () => {
    clearTimeout(showTimerRef.current);
    setPending(true);
    showTimerRef.current = setTimeout(() => {
      setPending(false);
      setOpen(true);
    }, SHOW_DELAY_MS);
  };
  const hide = () => {
    clearTimeout(showTimerRef.current);
    setPending(false);
    setOpen(false);
  };

  // Escape dismisses the tooltip however it opened, and cancels one still
  // waiting out its delay; it stays closed until the pointer or focus leaves
  // and comes back.
  useDismissOnEscape(pending || tooltipOpen, hide);

  // A sticker pill gets the image menu a sticker message gets ("Add to my
  // stickers", save, copy) instead of the message menu. An emoji pill keeps
  // the message menu.
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!imageUrl) return;
    e.preventDefault();
    e.stopPropagation();
    hide();
    const items = buildImageMenuItems({
      imageUrl, sourceUrl: imageUrl, stickerSource: emoji, stickerName: t('chat:stickers.sticker'),
    });
    useContextMenuStore.getState().open({ x: e.clientX, y: e.clientY }, items);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={onToggle}
        onContextMenu={handleContextMenu}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) show();
        }}
        onBlur={hide}
        aria-pressed={mine}
        aria-describedby={descriptionId}
        className={`glass-pill flex min-h-6 items-center gap-1.5 rounded-md px-1.5 py-px leading-none cursor-pointer active:bg-interactive-active ${
          mine ? 'glass-pill-mine' : ''
        }${added ? ' bump' : ''}`}
      >
        {imageUrl ? <img src={imageUrl} alt={t('chat:stickers.sticker')} className="h-7 w-7 overflow-hidden object-contain text-2xs" />
          : stickerAddress ? <span title={t('legal:external.compactTitle', { host: blockedHost })}><Icon name="image" size={16} className="text-txt-tertiary" /></span>
          : customEmojiId ? <CustomEmojiImage id={customEmojiId} origin={emojiOrigin} size="inline" className="!h-4 !min-w-4 align-middle" />
          : <span className="text-body leading-none">{emoji}</span>}
        <span key={bumps} className={`tabular font-mono text-label font-medium ${mine ? 'text-accent-soft' : 'text-txt-secondary'}${bumps > 0 ? ' bump' : ''}`}>
          {fmt.formatNumber(reactions.length)}
        </span>
      </button>
      <span id={descriptionId} className="sr-only">{sentence.text}</span>
      {tooltipOpen && createPortal(
        <div
          ref={floatingRef}
          role="tooltip"
          style={style}
          className={`glass flex items-center pointer-events-none animate-fade-in ${imageUrl
            ? 'flex-col w-[224px] max-w-[calc(100*var(--app-vw)-24px)] rounded-lg overflow-hidden'
            : 'rounded-md px-2.5 py-1.5 gap-2 max-w-[360px]'}`}
        >
          {imageUrl ? <div className="w-full p-4">
            <img src={imageUrl} alt={t('chat:stickers.preview')} className="w-full h-40 object-contain" />
          </div>
            : stickerAddress ? <Icon name="image" size={16} className="flex-shrink-0 text-txt-tertiary" />
            : customEmojiId ? <CustomEmojiImage id={customEmojiId} origin={emojiOrigin} size="inline" className="!h-5 !min-w-5 align-middle flex-shrink-0" />
            : <span className="text-base leading-none flex-shrink-0">{emoji}</span>}
          <span className={`text-ui leading-[18px] text-txt-secondary [overflow-wrap:anywhere] ${imageUrl ? 'w-full border-t border-border-soft px-3 py-2.5 text-center' : ''}`}>
            {before}
            <span className="font-medium text-txt-primary">{names}</span>
            {after}
          </span>
        </div>,
        portalContainer,
      )}
    </>
  );
}
