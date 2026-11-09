import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { BadgeId } from '@backspace/shared/src/badges';
import { useDismissOnEscape } from '../hooks/useDismissOnEscape';
import { useFloatingPosition } from '../hooks/useFloatingPosition';
import { usePortalContainer } from '../hooks/usePortalContainer';
import { BadgeGlyph } from './BadgeGlyph';

/**
 * What a badge says when someone clicks it, kept small: at its side a narrow stage of the badge
 * sheet's ground where the picture stands in a light of its own colour (the picture itself,
 * blurred), beside it its category, its name and what it means. Above whatever it was opened
 * from, and it leaves that open: a press anywhere else and Escape close only this; a press on
 * what opened it is that one's to answer (it toggles).
 */
export function BadgeCard({ id, name, description, category, anchorRef, onClose }: {
  id: BadgeId;
  name: string;
  description: string;
  /** The kind of thing it says, named (`useBadgeText`); left out when empty. */
  category?: string;
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const portalContainer = usePortalContainer();
  const { style } = useFloatingPosition(anchorRef, cardRef, { placement: 'bottom', offset: 6, enabled: true });

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
      className="badge-card z-[260] glass animate-pop"
      onClick={(event) => event.stopPropagation()}
    >
      <span aria-hidden="true" className="badge-stage" data-testid="badge-stage">
        <BadgeGlyph id={id} size={104} className="badge-stage-light" />
        <BadgeGlyph id={id} size={30} className="badge-stage-mark" />
      </span>
      <span className="min-w-0 px-3 py-2.5">
        {category && <span className="label-mono block">{category}</span>}
        <span className="mt-0.5 block text-ui font-semibold tracking-[-0.01em] text-txt-primary">{name}</span>
        <span className="mt-0.5 block text-meta leading-snug text-txt-secondary">{description}</span>
      </span>
    </div>,
    portalContainer,
  );
}
