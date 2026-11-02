import { useTranslation } from 'react-i18next';
import { ThemeSection } from './ThemeSection';
import { AccentSection } from './AccentSection';
import { MessagesSection, ShapeSection, TypefaceSection } from './LookSections';
import { SettingsPage } from './_shared/SettingsControls';

/**
 * Presentation preferences that belong to this browser or app rather than to
 * the account: they are stored locally and they apply on the login screen,
 * before there is an account at all.
 */
export function AppearancePanel() {
  const { t } = useTranslation(['settings']);

  return (
    <SettingsPage title={t('settings:appearance.title')}>
      <ThemeSection />
      <AccentSection />
      <MessagesSection />
      <ShapeSection />
      <TypefaceSection />
    </SettingsPage>
  );
}
