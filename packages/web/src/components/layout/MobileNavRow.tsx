import React from 'react';

interface MobileNavRowProps {
  icon: React.ReactNode;
  label: string;
  /** Drawn at the trailing edge, before the chevron; a badge must name itself. */
  badge?: React.ReactNode;
  onClick: () => void;
}

/**
 * A row that leads to a screen of its own: the You screen, the settings hub and
 * the instance hub. Full width and flat, 48px tall, so those lists are one list.
 */
export function MobileNavRow({ icon, label, badge, onClick }: MobileNavRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="list-row min-h-12 w-full rounded-none px-4 py-2"
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-txt-secondary">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-body text-txt-primary">{label}</span>
      {badge}
      <svg className="h-4 w-4 flex-shrink-0 text-txt-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </button>
  );
}
