import React, { useId, useRef } from 'react';
import { RangeSlider } from '../../../ui/RangeSlider';
import { SlidingMark } from '../../../ui/SlidingMark';
import { Toggle } from '../../../ui/Toggle';

/**
 * The building blocks of a settings page: the page itself, a titled card, a
 * labelled setting or form field, and the controls they are made of (cards with
 * a picture, a segmented choice, a switch, a slider, a colour swatch). Every
 * choice here is a radio group, so the arrow keys move between its options the
 * way they do in any native one.
 *
 * They share one look: a page is a `.page-title` over sections 24px apart; a
 * section is a `.label-mono` heading over a 6px `.surface-card` with 16px of
 * padding; a setting's name is 13px medium over a 12px line about it; a form
 * field's name is a `.field-label`; a chosen option is edged in violet.
 */

/**
 * A settings panel: its title, a line about it when it needs one, and its
 * sections. On a phone the screen's bar already names the panel, so the screen
 * hides the title (`PANEL_BODY` in `layout/mobileClasses.ts`).
 */
export function SettingsPage({ title, intro, children }: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{title}</h2>
        {intro && <p className="mt-1.5 text-ui leading-relaxed text-txt-secondary">{intro}</p>}
      </div>
      {children}
    </div>
  );
}

export function SettingsSection({ title, aside, lead, description, tone = 'neutral', flush = false, children }: {
  title: string;
  /** Something small at the far end of the heading, such as a count. */
  aside?: React.ReactNode;
  /** What stands above the card, such as a live preview. */
  lead?: React.ReactNode;
  description?: string;
  /** `danger` edges the card in rose, for what cannot be undone. */
  tone?: 'neutral' | 'danger';
  /** No padding: the rows inside run to the card's edge and bring their own. */
  flush?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="label-mono">{title}</h3>
        {aside}
      </div>
      {lead && <div className="mb-3">{lead}</div>}
      <div
        className={`surface-card rounded-lg ${flush ? 'overflow-hidden' : 'space-y-5 p-4'} ${
          tone === 'danger' ? 'border-accent-rose/25 bg-accent-rose/[0.04]' : ''
        }`}
      >
        {description && (
          <p className={`text-meta leading-relaxed text-txt-tertiary ${flush ? 'border-b border-border-hard px-4 py-3' : ''}`}>
            {description}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

/** One setting: its name, a line about it and the control. The name labels the control for assistive technology. */
export function SettingBlock({ label, description, children }: {
  label: string;
  description?: string;
  children: (labelId: string) => React.ReactNode;
}): React.JSX.Element {
  const labelId = useId();
  return (
    <div>
      <div id={labelId} className="text-ui font-medium text-txt-primary">{label}</div>
      {description && <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">{description}</p>}
      <div className="mt-2.5">{children(labelId)}</div>
    </div>
  );
}

/**
 * A field of a form: its name over it, and a line about it when it needs one.
 * `htmlFor` makes the name a real label; for a control that is not one input,
 * `labelId` lets the control point back at the name instead.
 */
export function SettingsField({ label, hint, htmlFor, labelId, children }: {
  label: string;
  hint?: string;
  htmlFor?: string;
  labelId?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const name = `field-label ${hint ? 'mb-0.5' : ''}`;
  return (
    <div>
      {htmlFor
        ? <label id={labelId} htmlFor={htmlFor} className={name}>{label}</label>
        : <div id={labelId} className={name}>{label}</div>}
      {hint && <p className="mb-2 text-meta leading-snug text-txt-tertiary">{hint}</p>}
      {children}
    </div>
  );
}

/** What went wrong with a form, in the form. */
export function FormError({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-meta leading-snug text-txt-danger">
      {children}
    </div>
  );
}

/**
 * Arrow keys move a radio group's choice to its neighbour, and focus with it.
 * For a choice laid out on its own (the camera backgrounds); the controls
 * below use it themselves.
 */
export function useRadioArrows<T extends string>(ids: readonly T[], value: T, onChange: (id: T) => void) {
  const group = useRef<HTMLDivElement>(null);
  return {
    ref: group,
    onKeyDown: (event: React.KeyboardEvent) => {
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
      if (!forward && !backward) return;
      event.preventDefault();
      const next = ids[(ids.indexOf(value) + (forward ? 1 : ids.length - 1)) % ids.length];
      if (next === undefined) return;
      onChange(next);
      requestAnimationFrame(() => group.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
    },
  };
}

export interface ChoiceOption<T extends string> {
  id: T;
  label: string;
  description?: string;
  /** A small picture of what the choice does. */
  preview?: React.ReactNode;
}

/** Choices as cards with a picture, one of which is selected. */
export function OptionCards<T extends string>({ labelledBy, value, options, onChange, columns = options.length }: {
  labelledBy: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (id: T) => void;
  columns?: number;
}): React.JSX.Element {
  const arrows = useRadioArrows(options.map((option) => option.id), value, onChange);
  return (
    <div
      ref={arrows.ref}
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={arrows.onKeyDown}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.id)}
            className={`rounded-lg border p-2 text-left transition-colors duration-100 ${
              selected
                ? 'border-accent-primary bg-accent-primary/[0.06]'
                : 'border-border-hard hover:border-interactive-muted hover:bg-interactive-hover active:bg-interactive-active'
            }`}
          >
            {option.preview && (
              <span className="mb-2 flex h-14 items-center justify-center overflow-hidden rounded-md bg-surface-input" aria-hidden="true">
                {option.preview}
              </span>
            )}
            <span className="flex items-center gap-1.5 px-0.5">
              <span
                aria-hidden="true"
                className={`h-2 w-2 flex-shrink-0 rounded-full border ${selected ? 'border-accent-primary bg-accent-primary' : 'border-interactive-muted'}`}
              />
              <span className="min-w-0 truncate text-ui font-medium text-txt-primary">{option.label}</span>
            </span>
            {option.description && <span className="mt-1 block px-0.5 text-meta leading-snug text-txt-tertiary">{option.description}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Choices as one segmented strip, for the ones that need no picture. */
export function SegmentedControl<T extends string>({ labelledBy, value, options, onChange }: {
  labelledBy: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (id: T) => void;
}): React.JSX.Element {
  const arrows = useRadioArrows(options.map((option) => option.id), value, onChange);
  return (
    <div
      ref={arrows.ref}
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={arrows.onKeyDown}
      className="sliding-list flex w-full gap-0.5 rounded-md border border-border-soft bg-surface-input p-0.5"
    >
      <SlidingMark variant="pill" selector="[role='radio'][aria-checked='true']" />
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.id)}
            className={`relative min-h-8 min-w-0 flex-auto rounded px-2 py-1 text-ui font-medium transition-colors duration-100 ${
              selected
                ? 'text-txt-primary'
                : 'text-txt-tertiary hover:bg-interactive-hover hover:text-txt-primary active:bg-interactive-active'
            }`}
          >
            {option.label}
            {selected && <span aria-hidden="true" data-active-line="" className="active-line absolute inset-x-2 bottom-0 h-[2px]" />}
          </button>
        );
      })}
    </div>
  );
}

/** A setting that is on or off. */
export function ToggleRow({ label, description, enabled, disabled, onChange }: {
  label: string;
  description?: string;
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className={`text-ui font-medium ${disabled ? 'text-txt-tertiary' : 'text-txt-primary'}`}>{label}</div>
        {description && <div className="mt-0.5 text-meta leading-snug text-txt-tertiary">{description}</div>}
      </div>
      <Toggle enabled={enabled} disabled={disabled} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

/** A slider with its value at the far end of its name. */
export function SliderRow({ id, label, value, min, max, step, onChange, track, valueLabel }: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** A CSS background for the track, for a slider that runs through colours. */
  track?: string;
  /** What to show for the value when it is not the bare number. */
  valueLabel?: string;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-ui font-medium text-txt-primary">{label}</label>
        <span className="tabular font-mono text-meta text-txt-tertiary">{valueLabel ?? value}</span>
      </div>
      <RangeSlider id={id} value={value} min={min} max={max} step={step} onChange={onChange} track={track} />
    </div>
  );
}

/**
 * One colour to pick, 28px square (36px wide for a pair). Its ring stands off
 * the colour and takes no room, so a row of swatches lines up with the text
 * above it. The chosen one is ringed in the text colour, because a violet ring
 * would vanish beside the violet swatch. A row of them uses `SWATCH_ROW`.
 */
export function SwatchButton({ label, background, selected, wide = false, onClick }: {
  label: string;
  /** A CSS background: a colour, or the gradient of a pair. */
  background: string;
  selected: boolean;
  wide?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      data-tooltip=""
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={`block h-7 rounded ring-offset-2 ring-offset-surface-chat transition-shadow duration-100 ${wide ? 'w-9' : 'w-7'} ${
        selected ? 'ring-2 ring-txt-primary' : 'hover:ring-1 hover:ring-interactive-muted'
      }`}
      style={{ background }}
    />
  );
}

/** The gap of a row of swatches: wider than a ring and its offset, so two rings never touch. */
export const SWATCH_ROW = 'flex flex-wrap gap-2.5';
