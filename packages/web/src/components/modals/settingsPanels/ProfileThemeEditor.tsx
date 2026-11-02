import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseHexColor } from '@backspace/shared/src/color.js';
import {
  PROFILE_THEME_PRESETS,
  bannerBackground,
  cardEdge,
  cardTint,
  presetOf,
  profileThemeOf,
} from '../../../utils/profileTheme';
import { SettingsField, SWATCH_ROW, SwatchButton } from './_shared/SettingsControls';

export interface ProfileThemeColors {
  primary: string | null;
  secondary: string | null;
}

interface ProfileThemeEditorProps {
  value: ProfileThemeColors;
  onChange: (next: ProfileThemeColors) => void;
}

/**
 * One colour: a picker and a hex field that follow each other. A hex that is
 * not complete yet stays in the field and changes nothing until it is.
 */
function ColorField({ name, color, disabled, onPick }: {
  name: string;
  color: string | null;
  disabled?: boolean;
  onPick: (hex: string) => void;
}) {
  const { t } = useTranslation('settings');
  const [text, setText] = useState(color ?? '');
  useEffect(() => { setText(color ?? ''); }, [color]);

  return (
    <div className="min-w-0">
      <div className="mb-1 text-meta text-txt-secondary">{name}</div>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          aria-label={t('account.profile.theme.picker', { name })}
          value={color && parseHexColor(color) ? color.toLowerCase() : '#7443fc'}
          disabled={disabled}
          onChange={(e) => onPick(e.target.value)}
          className="h-8 w-8 flex-shrink-0 cursor-pointer appearance-none rounded-md border border-border-soft bg-surface-input p-[3px] transition-colors hover:enabled:border-interactive-muted disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-color-swatch]:rounded-[3px] [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-0"
        />
        <input
          type="text"
          aria-label={t('account.profile.theme.hex', { name })}
          value={text}
          disabled={disabled}
          maxLength={7}
          placeholder={t('account.profile.bannerColor.hexPlaceholder')}
          onChange={(e) => {
            setText(e.target.value);
            if (parseHexColor(e.target.value)) onPick(e.target.value);
          }}
          className="input-standard h-8 w-24 px-2 py-0 font-mono text-meta"
        />
      </div>
    </div>
  );
}

/**
 * The profile theme: ready-made pairs to start from, two colours to make one's
 * own, and a preview of the banner and card the colours will paint. Nothing is
 * saved here; the account panel saves with the rest of the profile.
 */
export function ProfileThemeEditor({ value, onChange }: ProfileThemeEditorProps) {
  const { t } = useTranslation(['settings', 'common']);
  const theme = profileThemeOf({ accentColor: value.primary, accentColorSecondary: value.secondary });
  const activePreset = presetOf({ accentColor: value.primary, accentColorSecondary: value.secondary });

  return (
    <SettingsField label={t('settings:account.profile.theme.label')} hint={t('settings:account.profile.theme.hint')}>
      <ul className={`${SWATCH_ROW} mb-3`} aria-label={t('settings:account.profile.theme.presets')}>
        {PROFILE_THEME_PRESETS.map((preset) => (
          <li key={preset.id}>
            <SwatchButton
              wide
              label={t(`settings:account.profile.theme.preset.${preset.id}`)}
              background={`linear-gradient(135deg, ${preset.primary}, ${preset.secondary})`}
              selected={activePreset?.id === preset.id}
              onClick={() => onChange({ primary: preset.primary, secondary: preset.secondary })}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <ColorField
          name={t('settings:account.profile.theme.first')}
          color={value.primary}
          onPick={(hex) => onChange({ primary: hex, secondary: value.secondary })}
        />
        <ColorField
          name={t('settings:account.profile.theme.second')}
          color={value.secondary}
          disabled={value.primary === null}
          onPick={(hex) => onChange({ primary: value.primary, secondary: hex })}
        />
        {value.primary !== null && (
          <button
            type="button"
            onClick={() => onChange({ primary: null, secondary: null })}
            className="btn-quiet h-8 px-2.5 text-meta"
          >
            {t('common:actions.clear')}
          </button>
        )}
      </div>

      {theme && (
        <div
          data-testid="profile-theme-preview"
          className="mt-3 overflow-hidden rounded-lg border bg-surface-channel"
          style={{ borderColor: cardEdge(theme), backgroundImage: cardTint(theme) }}
        >
          <div className="h-10" style={{ background: bannerBackground(theme) }} />
          <div className="px-3 pb-2.5 pt-2 text-meta text-txt-tertiary">{t('settings:account.profile.theme.preview')}</div>
        </div>
      )}
    </SettingsField>
  );
}
