import { useTranslation } from 'react-i18next';
import { isTranslationTarget, TRANSLATION_TARGETS } from '@backspace/shared/src/translation';
import { useTranslationTargetStore } from '../../../stores/translationTargetStore';
import { LanguageSelect } from '../../ui/LanguageSelect';
import { SettingsSection } from './_shared/SettingsControls';

export function LanguageSection() {
  const { t } = useTranslation(['common']);
  const chosenTarget = useTranslationTargetStore((s) => s.chosenTarget);
  const setChosenTarget = useTranslationTargetStore((s) => s.setChosenTarget);
  return (
    <SettingsSection title={t('common:language.label')} description={t('common:language.description')}>
      <LanguageSelect id="language-select" className="input-standard w-full" />
      <div className="mt-4">
        <label htmlFor="translate-target" className="field-label">{t('common:language.translate.label')}</label>
        <select
          id="translate-target"
          value={chosenTarget ?? ''}
          onChange={(event) => setChosenTarget(isTranslationTarget(event.target.value) ? event.target.value : null)}
          className="input-standard w-full"
        >
          <option value="">{t('common:language.translate.same')}</option>
          {TRANSLATION_TARGETS.map((target) => (
            <option key={target.code} value={target.code} lang={target.code}>{target.nativeName}</option>
          ))}
        </select>
        <p className="mt-1.5 text-meta text-txt-tertiary">{t('common:language.translate.hint')}</p>
      </div>
    </SettingsSection>
  );
}
