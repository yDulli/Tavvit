interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  /**
   * Accessible name. A switch carries no text of its own, so where the visible
   * label is not wired to it, pass the same words here.
   */
  ariaLabel?: string;
}

/**
 * An on/off switch: a small capsule track on the ink well, edged by the strong line, that fills
 * with the signal when on (white, with a black thumb; an accent a person chose, with a white one);
 * off, the thumb is the quiet grey. It springs across.
 */
export function Toggle({ enabled, onChange, disabled, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`toggle-track relative inline-flex h-[18px] w-8 flex-shrink-0 items-center rounded-full border ${
        enabled ? 'border-accent-soft bg-accent-primary' : 'border-border-soft bg-surface-input'
      } ${
        disabled
          ? 'cursor-not-allowed opacity-50'
          : enabled
            ? 'hover:bg-accent-primary-hover'
            : 'hover:border-interactive-muted'
      }`}
    >
      <span
        aria-hidden="true"
        className={`toggle-thumb inline-block h-3 w-3 rounded-full ${
          enabled ? 'translate-x-[15px] bg-on-accent' : 'translate-x-[2px] bg-txt-tertiary'
        }`}
      />
    </button>
  );
}
