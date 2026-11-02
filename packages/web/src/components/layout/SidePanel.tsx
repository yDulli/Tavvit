import React, { useEffect, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';

interface SidePanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'className'> {
  children: React.ReactNode;
  /** Extra classes for the column itself. */
  className?: string;
}

/**
 * The column on the right of the conversation (the members of a space, the
 * friends' activity, the people in a group DM): a column on the side colour,
 * parted from the conversation by a hairline, that scrolls its content. The
 * three of them share this shell so that switching between them swaps
 * like-shaped columns. It is desktop-only; the phone shows each of them as a
 * screen of its own.
 *
 * In a compact window it floats over the right edge of the conversation
 * rather than narrowing it, and going back to the conversation (a press
 * anywhere in `main`) puts it away. Its toggle is exempt, so the toggle closes
 * it rather than closing and reopening it.
 */
export function SidePanel({ children, className = '', ...rest }: SidePanelProps): React.JSX.Element {
  const isCompact = useUIStore((s) => s.isCompact);
  const closeCompactPanel = useUIStore((s) => s.closeCompactPanel);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isCompact) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest('[data-people-toggle]')) return;
      if (target.closest('main')) closeCompactPanel();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isCompact, closeCompactPanel]);

  return (
    <div
      {...rest}
      ref={panelRef}
      className={`w-[var(--sidebar-width)] flex-shrink-0 select-none hidden desktop:block border-l border-border-hard bg-surface-members lit compact:absolute compact:bottom-0 compact:right-0 compact:top-[var(--topbar-height)] compact:z-[120] compact:shadow-elevation-high ${className}`}
    >
      <div className="h-full overflow-y-auto no-scrollbar">
        {children}
      </div>
    </div>
  );
}
