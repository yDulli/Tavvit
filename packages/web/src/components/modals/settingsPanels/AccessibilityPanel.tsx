import { useTranslation } from 'react-i18next';
import { InterfaceScaleSection } from './InterfaceScaleSection';
import { AccessibilitySection } from './LookSections';
import { ReadingSection } from './ReadingSection';
import { SettingsPage } from './_shared/SettingsControls';

/** What makes the app easier to read and to use, on this device. */
export function AccessibilityPanel() {
  const { t } = useTranslation(['settings']);
  return (
    <SettingsPage title={t('settings:nav.tabs.accessibility')}>
      <ReadingSection />
      <AccessibilitySection />
      <InterfaceScaleSection />
    </SettingsPage>
  );
}
