import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { accentColorProblem, parseHexColor } from '@backspace/shared/src/color.js';
import { useAppearanceStore } from '../../../stores/appearanceStore';
import { ACCENT_CHOICES } from '../../../utils/appTheme';
import { SettingsSection, SWATCH_ROW, SwatchButton } from './_shared/SettingsControls';

/**
 * The person's own accent colour for buttons and highlights. Only a colour the
 * server's own rule would accept can be chosen (white button text must stay
 * readable on it and it must stay visible on the dark panels), and the reason is
 * said when one is not. Without a choice the instance's colour is used.
 */
export function AccentSection() {
  const { t } = useTranslation(['settings', 'common']);
  const accent = useAppearanceStore((s) => s.accent);
  const setAccent = useAppearanceStore((s) => s.setAccent);
  const [text, setText] = useState(accent ?? '');
  const [problem, setProblem] = useState<'too_light' | 'too_dark' | null>(null);

  // A colour set from a swatch, or cleared, shows in the field.
  useEffect(() => { setText(accent ?? ''); setProblem(null); }, [accent]);

  const handleText = (value: string) => {
    setText(value);
    if (!parseHexColor(value)) { setProblem(null); return; }
    const found = accentColorProblem(value);
    if (found === null) { setProblem(null); setAccent(value); return; }
    // `invalid` cannot happen for a complete hex; the other two are the reasons shown.
    setProblem(found === 'too_light' || found === 'too_dark' ? found : null);
  };

  return (
    <SettingsSection title={t('settings:appearance.accent.title')} description={t('settings:appearance.accent.description')}>
      <ul className={SWATCH_ROW} aria-label={t('settings:appearance.accent.title')}>
        {ACCENT_CHOICES.map((choice) => (
          <li key={choice.id}>
            <SwatchButton
              label={t(`settings:appearance.accent.name.${choice.id}`)}
              background={choice.hex}
              selected={accent === choice.hex}
              onClick={() => setAccent(choice.hex)}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label={t('settings:appearance.accent.hex')}
          value={text}
          maxLength={7}
          placeholder={t('settings:account.profile.bannerColor.hexPlaceholder')}
          onChange={(e) => handleText(e.target.value)}
          aria-invalid={problem !== null}
          className="input-standard h-8 w-28 px-2 py-0 font-mono text-meta"
        />
        {accent !== null && (
          <button type="button" onClick={() => setAccent(null)} className="btn-quiet btn-sm">
            {t('settings:appearance.accent.useInstance')}
          </button>
        )}
      </div>
      {problem !== null && (
        <p role="alert" className="text-meta text-txt-danger">{t(`settings:appearance.accent.problem.${problem}`)}</p>
      )}
    </SettingsSection>
  );
}
