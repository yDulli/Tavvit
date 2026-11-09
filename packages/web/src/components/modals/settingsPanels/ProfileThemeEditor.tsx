import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseHexColor } from '@backspace/shared/src/color.js';
import { PROFILE_THEME_STYLES } from '@backspace/shared/src/profileFields.js';
import {
  PROFILE_THEME_PRESETS,
  bannerBackground,
  presetOf,
  profileCardLook,
  profileThemeOf,
  type ProfileThemeStyle,
} from '../../../utils/profileTheme';
import { SegmentedControl, SettingsField, SWATCH_ROW, SwatchButton } from './_shared/SettingsControls';

export interface ProfileThemeColors {
  primary: string | null;
  secondary: string | null;
  /** How strongly the two colours colour the card. */
  style: ProfileThemeStyle;
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
  const styleLabel = useId();
  const theme = profileThemeOf({ accentColor: value.primary, accentColorSecondary: value.secondary });
  const activePreset = presetOf({ accentColor: value.primary, accentColorSecondary: value.secondary });
  const themed = theme ? profileCardLook(theme, value.style) : null;

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
              onClick={() => onChange({ ...value, primary: preset.primary, secondary: preset.secondary })}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <ColorField
          name={t('settings:account.profile.theme.first')}
          color={value.primary}
          onPick={(hex) => onChange({ ...value, primary: hex })}
        />
        <ColorField
          name={t('settings:account.profile.theme.second')}
          color={value.secondary}
          disabled={value.primary === null}
          onPick={(hex) => onChange({ ...value, secondary: hex })}
        />
        {value.primary !== null && (
          <button
            type="button"
            onClick={() => onChange({ ...value, primary: null, secondary: null })}
            className="btn-quiet h-8 px-2.5 text-meta"
          >
            {t('common:actions.clear')}
          </button>
        )}
      </div>

      {theme && themed && (
        <>
          <div className="mt-4">
            <div id={styleLabel} className="mb-1 text-meta text-txt-secondary">{t('settings:account.profile.theme.style.label')}</div>
            <SegmentedControl
              labelledBy={styleLabel}
              value={value.style}
              options={PROFILE_THEME_STYLES.map((id) => ({ id, label: t(`settings:account.profile.theme.style.${id}`) }))}
              onChange={(style) => onChange({ ...value, style })}
            />
          </div>
          <div
            data-testid="profile-theme-preview"
            data-style={value.style}
            className="mt-3 overflow-hidden rounded-lg border bg-surface-channel"
            style={themed.card}
          >
            <div className="h-10" style={{ background: bannerBackground(theme) }} />
            <div className={themed.panel ? 'profile-panel mx-1.5 mb-1.5 mt-1.5 px-2.5 pb-2 pt-1.5' : 'px-3 pb-2.5 pt-2'}>
              <div className="text-ui font-semibold text-txt-primary">{t('settings:account.profile.theme.previewName')}</div>
              <div className="text-meta text-txt-tertiary">{t('settings:account.profile.theme.preview')}</div>
            </div>
          </div>
        </>
      )}
    </SettingsField>
  );
}
