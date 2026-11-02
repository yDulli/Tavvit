import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { badgeDefinition, type BadgeId, type BadgeTone } from '@backspace/shared/src/badges';
import { useDismissOnEscape } from '../hooks/useDismissOnEscape';
import { useFloatingPosition } from '../hooks/useFloatingPosition';
import { usePortalContainer } from '../hooks/usePortalContainer';
import { BadgeGlyph } from './BadgeGlyph';
import { BADGE_TONE_CLASS } from './badgeText';

/** The colour of each tone as channels, for the light behind the drawing. */
const TONE_CHANNELS: Record<BadgeTone, string> = {
  neutral: 'var(--text-secondary)',
  violet: 'var(--accent-primary-soft)',
  amber: 'var(--accent-amber)',
  sky: 'var(--accent-sky)',
  mint: 'var(--accent-mint)',
};

/**
 * What a badge says when someone clicks it: the drawing large, its name and what it means.
 * Above whatever it was opened from, and it leaves that open: a press anywhere else and Escape
 * close only this.
 */
export function BadgeCard({ id, name, description, anchorRef, onClose }: {
  id: BadgeId;
  name: string;
  description: string;
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const portalContainer = usePortalContainer();
  const { style } = useFloatingPosition(anchorRef, cardRef, { placement: 'bottom', offset: 8, enabled: true });
  const tone = badgeDefinition(id)?.tone ?? 'neutral';

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

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={name}
      style={style}
      className="z-[260] flex w-[272px] items-start gap-3 rounded-lg p-3 glass animate-pop"
      onClick={(event) => event.stopPropagation()}
    >
      <span
        aria-hidden="true"
        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${BADGE_TONE_CLASS[tone]}`}
        style={{
          background: `radial-gradient(100% 100% at 50% 0%, rgb(${TONE_CHANNELS[tone]} / .26), rgb(${TONE_CHANNELS[tone]} / .07))`,
          boxShadow: `inset 0 0 0 1px rgb(${TONE_CHANNELS[tone]} / .24), 0 8px 24px -10px rgb(${TONE_CHANNELS[tone]} / .6)`,
        }}
      >
        <BadgeGlyph id={id} size={24} />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-semibold tracking-[-0.01em] text-txt-primary">{name}</span>
        <span className="mt-0.5 block text-meta leading-snug text-txt-secondary">{description}</span>
      </span>
    </div>,
    portalContainer,
  );
}
