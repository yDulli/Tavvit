import { useTranslation } from 'react-i18next';
import { useAppearanceStore } from '../../../stores/appearanceStore';
import { CHAT_TEXT_SCALES } from '../../../utils/appTheme';
import { SettingsSection, ToggleRow } from './_shared/SettingsControls';
import { LightSetting } from './LookSections';

/** How chat text is drawn, whether animation is cut down and whether light falls on the panels, on this device. */
export function ReadingSection() {
  const { t } = useTranslation('settings');
  const scale = useAppearanceStore((s) => s.chatTextScale);
  const reduceMotion = useAppearanceStore((s) => s.reduceMotion);
  const setScale = useAppearanceStore((s) => s.setChatTextScale);
  const setReduceMotion = useAppearanceStore((s) => s.setReduceMotion);

  return (
    <SettingsSection title={t('appearance.reading.title')}>
      <div>
        <label htmlFor="chat-text-size" className="block text-ui font-medium text-txt-primary">{t('appearance.reading.textSize.label')}</label>
        <p id="chat-text-size-description" className="mt-0.5 text-meta leading-snug text-txt-tertiary">{t('appearance.reading.textSize.description')}</p>
        <select
          id="chat-text-size"
          aria-describedby="chat-text-size-description"
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          className="input-standard mt-2.5 w-full"
        >
          {CHAT_TEXT_SCALES.map((value) => (
            <option key={value} value={value}>{Math.round(value * 100)}%</option>
          ))}
        </select>
      </div>

      <ToggleRow
        label={t('appearance.reading.reduceMotion.label')}
        description={t('appearance.reading.reduceMotion.description')}
        enabled={reduceMotion}
        onChange={setReduceMotion}
      />

      <LightSetting />
    </SettingsSection>
  );
}
