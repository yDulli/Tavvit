import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPosition } from '../../hooks/useFloatingPosition';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { useUIStore } from '../../stores/uiStore';
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape';
import { TooltipBubble } from './TooltipBubble';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
  /** Stays quiet for now, for when what it is on has opened something that says more. */
  disabled?: boolean;
}

/**
 * A tooltip of its own, for a mark that is not a control and whose words are not its accessible name:
 * a federation globe, a status, the owner's crown, a badge, a federated space tab. An icon-only
 * control needs none of this: `TooltipLayer` shows its `aria-label`. Whatever stands inside one of
 * these is left to it by the layer (`data-tooltip-owner`), so nothing gets two.
 */
export function Tooltip({ content, children, position = 'right', delay = 200, disabled = false }: TooltipProps) {
  const isMobile = useUIStore((s) => s.isMobile);

  const [isVisible, setIsVisible] = useState(false);
  // A show is scheduled but its delay has not run out yet.
  const [isPending, setIsPending] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const portalContainer = usePortalContainer();

  const { style } = useFloatingPosition(anchorRef, floatingRef, {
    placement: position,
    offset: 8,
    enabled: isVisible,
  });

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsPending(true);
    timeoutRef.current = setTimeout(() => {
      setIsPending(false);
      setIsVisible(true);
    }, delay);
  };

  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsPending(false);
    setIsVisible(false);
  };

  // Escape closes it, or cancels one still waiting out its delay; it reopens
  // only when the pointer leaves and comes back.
  useDismissOnEscape(!isMobile && (isPending || isVisible), hide);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // No tooltips on touch devices: render the children unwrapped. This has to
  // sit below every hook call, because isMobile flips when the viewport
  // crosses the mobile breakpoint, and an early return above the hooks would
  // change the hook count between two renders of the same component.
  if (isMobile) return <>{children}</>;

  return (
    // A span, so that it may stand inside a button, as a badge in the space's header does.
    <span
      ref={anchorRef}
      data-tooltip-owner=""
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      // The keyboard gets what the pointer gets; a click's focus is not a request for it.
      onFocus={(e) => { if (e.target.matches(':focus-visible')) show(); }}
      onBlur={hide}
    >
      {children}
      {isVisible && !disabled && createPortal(
        <TooltipBubble ref={floatingRef} style={style}>{content}</TooltipBubble>,
        portalContainer,
      )}
    </span>
  );
}
