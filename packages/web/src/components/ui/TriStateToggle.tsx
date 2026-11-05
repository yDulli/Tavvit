import React from 'react';
import { useTranslation } from 'react-i18next';

export type TriState = 'allow' | 'neutral' | 'deny';

export function TriStateToggle({
  value,
  onChange,
  disabled,
  label,
}: {
  value: TriState;
  onChange: (v: TriState) => void;
  /** Locked: the current state stays visible, but no button changes it. */
  disabled?: boolean;
  /** Names the group of three buttons, e.g. the permission it sets. */
  label?: string;
}) {
  const { t } = useTranslation(['spaces']);
  // Three small square buttons in one sunken strip; the one in force is filled
  // in its own tone (rose for deny, neutral, violet for allow).
  const btnClass = (v: TriState, active: boolean) => {
    const base = 'w-6 h-6 flex items-center justify-center rounded transition-colors text-meta font-semibold';
    const interaction = disabled ? 'cursor-not-allowed' : 'cursor-pointer';
    if (!active) return `${base} ${interaction} text-txt-tertiary${disabled ? '' : ' hover:bg-interactive-hover hover:text-txt-secondary active:bg-interactive-active'}`;
    switch (v) {
      case 'deny': return `${base} ${interaction} bg-accent-rose/15 text-accent-rose`;
      case 'neutral': return `${base} ${interaction} bg-interactive-selected text-txt-secondary`;
      case 'allow': return `${base} ${interaction} bg-accent-primary/20 text-accent-soft`;
    }
  };

  const names: Record<TriState, string> = {
    deny: t('spaces:permissions.tristate.deny'),
    neutral: t('spaces:permissions.tristate.neutral'),
    allow: t('spaces:permissions.tristate.allow'),
  };

  const button = (v: TriState, glyph: string, next: TriState) => (
    <button
      data-tooltip=""
      type="button"
      className={btnClass(v, value === v)}
      onClick={() => !disabled && onChange(next)}
      disabled={disabled}
      aria-pressed={value === v}
      aria-label={names[v]}
    >
      {glyph}
    </button>
  );

  return (
    <div
      role="group"
      aria-label={label}
      className={`flex items-center gap-0.5 rounded-md border border-border-hard bg-surface-input p-0.5${disabled ? ' opacity-50' : ''}`}
    >
      {button('deny', '✕', value === 'deny' ? 'neutral' : 'deny')}
      {button('neutral', '/', 'neutral')}
      {button('allow', '✓', value === 'allow' ? 'neutral' : 'allow')}
    </div>
  );
}
