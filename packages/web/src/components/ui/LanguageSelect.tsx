import { useTranslation } from 'react-i18next';
import { availableLanguages, getLanguage, setLanguage, supportedLanguages, type SupportedLanguage } from '../../i18n';

/**
 * The language picker. Each option is shown in its own language, and the
 * list is deliberately not translated: a user who cannot read the current
 * language still has to be able to find their own.
 */
export function LanguageSelect({ id, className }: { id?: string; className?: string }) {
  const { t } = useTranslation(['common']);
  const current = getLanguage();
  // A previewed unreleased language (dev `?lang=`) is shown as the current
  // option so the select does not silently display the wrong value.
  const options = availableLanguages.some((l) => l.code === current)
    ? availableLanguages
    : [...availableLanguages, ...supportedLanguages.filter((l) => l.code === current)];

  return (
    <select
      id={id}
      aria-label={t('common:language.label')}
      value={current}
      onChange={(e) => { void setLanguage(e.target.value as SupportedLanguage); }}
      className={className}
    >
      {options.map((language) => (
        <option key={language.code} value={language.code} lang={language.code}>
          {language.nativeName}
        </option>
      ))}
    </select>
  );
}
