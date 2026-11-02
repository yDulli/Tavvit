import { useTranslation } from 'react-i18next';
import { LanguageSection } from './LanguageSection';
import { SettingsPage } from './_shared/SettingsControls';

export function LanguagePanel() {
  const { t } = useTranslation(['settings']);
  return (
    <SettingsPage title={t('settings:nav.tabs.language')}>
      <LanguageSection />
    </SettingsPage>
  );
}
