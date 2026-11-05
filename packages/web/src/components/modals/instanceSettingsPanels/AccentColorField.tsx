import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { accentColorProblem, deriveAccentScale, parseHexColor, toHexColor } from '@backspace/shared/src/color.js';
import { DEFAULT_ACCENT_COLOR } from '@backspace/shared/src/constants.js';

/**
 * Colours offered as one-click choices, the built-in violet first. Each one is
 * checked against the same rule the server enforces (see
 * AccentColorField.test.tsx), so a swatch is never a colour the save would
 * refuse.
 */
export const ACCENT_PRESETS = [
  '#7466e8',
  '#4f5bd5',
  '#2f7de1',
  '#12907f',
  '#2e9a4e',
  '#b86e00',
  '#d6407a',
  '#d4483b',
] as const;

const HEX_IN_PROGRESS = /^#?[0-9a-fA-F]{0,6}$/;

function normalize(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

interface AccentColorFieldProps {
  /** The chosen `#rrggbb`, or null for the built-in colour. */
  value: string | null;
  onChange: (next: string | null) => void;
}

/**
 * The instance accent colour: eight swatches, a field for any other hex colour
 * and a sample of what buttons will look like. The field says what is wrong
 * with a colour while the administrator types, instead of letting the save fail.
 */
export function AccentColorField({ value, onChange }: AccentColorFieldProps) {
  const { t } = useTranslation('admin');
  const effective = value ?? DEFAULT_ACCENT_COLOR;
  // What is typed in the field. It follows `value` until the user edits it.
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? effective;

  const candidate = normalize(shown);
  const problem = candidate.length === 7 ? accentColorProblem(candidate) : 'invalid';
  const rgb = problem === null ? parseHexColor(candidate) : null;
  const sample = rgb ? deriveAccentScale(rgb) : null;

  const handleText = (next: string) => {
    if (!HEX_IN_PROGRESS.test(next)) return;
    setText(next);
    const hex = normalize(next).toLowerCase();
    if (hex.length === 7 && accentColorProblem(hex) === null) onChange(hex);
  };

  const pick = (hex: string) => {
    setText(null);
    onChange(hex === DEFAULT_ACCENT_COLOR ? null : hex);
  };

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('general.accent.label')} className="flex flex-wrap gap-2">
        {ACCENT_PRESETS.map((hex) => {
          const selected = effective.toLowerCase() === hex && text === null;
          return (
            <button
              data-tooltip=""
              key={hex}
              type="button"
              aria-pressed={selected}
              aria-label={hex}
              onClick={() => pick(hex)}
              style={{ backgroundColor: hex }}
              className={`h-8 w-8 rounded-md border-2 transition-shadow duration-100 ${
                selected ? 'border-white shadow-[0_0_0_2px_rgb(var(--accent-primary-soft))]' : 'border-transparent hover:border-white/40'
              }`}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-meta text-txt-tertiary">
          <span>{t('general.accent.custom')}</span>
          <input
            type="text"
            value={shown}
            onChange={(e) => handleText(e.target.value)}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem !== null}
            aria-describedby="instance-colour-hint"
            className="input-standard h-8 w-28 py-0 font-mono text-ui"
          />
        </label>
        <button
          type="button"
          onClick={() => pick(DEFAULT_ACCENT_COLOR)}
          disabled={value === null && text === null}
          className="btn-quiet"
        >
          {t('general.accent.useDefault')}
        </button>
        {sample && (
          <span
            aria-hidden="true"
            className="inline-flex h-8 items-center rounded-md px-3 text-ui font-medium text-white"
            style={{ backgroundColor: toHexColor(sample.base) }}
          >
            {t('general.accent.preview')}
          </span>
        )}
      </div>

      <p id="instance-colour-hint" role={problem !== null ? 'alert' : undefined} className="text-meta text-txt-danger empty:hidden">
        {problem === 'invalid' && text !== null ? t('general.accent.invalid') : null}
        {problem === 'too_light' ? t('general.accent.tooLight') : null}
        {problem === 'too_dark' ? t('general.accent.tooDark') : null}
      </p>
    </div>
  );
}
