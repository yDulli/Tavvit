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
 * An on/off switch: a small track with square-ish corners (5px, like a button)
 * and a round thumb, violet while on and the muted control grey while off.
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
      className={`toggle-track relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-md ${
        enabled ? 'bg-accent-primary' : 'bg-interactive-muted'
      } ${
        disabled
          ? 'cursor-not-allowed opacity-50'
          : enabled
            ? 'hover:bg-accent-primary-hover active:bg-accent-primary-active'
            : 'hover:bg-interactive-muted/80 active:bg-interactive-muted/60'
      }`}
    >
      <span
        aria-hidden="true"
        className={`toggle-thumb inline-block h-3.5 w-3.5 rounded-full bg-white ${
          enabled ? 'translate-x-[19px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}
