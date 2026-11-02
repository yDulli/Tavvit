import type { ReactNode, Ref } from 'react';
import { Icon } from '../../../ui/Icon';

/**
 * The device pickers of Voice & Video: a button drawn like the app's other
 * dropdowns (`select.input-standard`) that opens a list in the page.
 * Settings-panel-internal, kept under `_shared/` because nothing else needs it.
 */
export function DevicePicker({ selectedLabel, open, onToggle, pickerRef, children }: {
  selectedLabel: string;
  open: boolean;
  onToggle: () => void;
  /** Lets the owner close the list on a press outside it. */
  pickerRef: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div ref={pickerRef}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="input-standard flex w-full items-center justify-between gap-2 pr-2 text-left"
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <Icon
          name="chevron-down"
          size={14}
          strokeWidth={2}
          className={`flex-shrink-0 text-txt-tertiary transition-transform duration-100 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-1 max-h-64 overflow-y-auto scrollbar-thin rounded-md border border-border-soft bg-surface-input py-1">
          {children}
        </div>
      )}
    </div>
  );
}

export interface DropdownItemProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

/**
 * Single row of a device picker. A check marks the active row and the other
 * labels are indented by its width, so they all line up.
 */
export function DropdownItem({ label, active, onClick }: DropdownItemProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2 px-2.5 text-left text-ui transition-colors hover:bg-interactive-hover active:bg-interactive-active ${
        active ? 'font-medium text-txt-primary' : 'text-txt-secondary hover:text-txt-primary'
      }`}
    >
      <span className="flex w-4 flex-shrink-0 justify-center">
        {active && <Icon name="check" size={14} strokeWidth={2} className="text-accent-soft" />}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
