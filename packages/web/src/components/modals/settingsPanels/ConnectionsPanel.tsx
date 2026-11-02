import { useTranslation } from 'react-i18next';
import { ConnectedInstances } from '../ConnectedInstances';
import { SettingsPage } from './_shared/SettingsControls';

export function ConnectionsPanel() {
  const { t } = useTranslation(['settings']);
  return (
    <SettingsPage title={t('settings:connections.title')}>
      <ConnectedInstances />
    </SettingsPage>
  );
}
