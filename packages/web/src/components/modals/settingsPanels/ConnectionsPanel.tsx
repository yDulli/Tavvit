import { useTranslation } from 'react-i18next';
import { ConnectedInstances } from '../ConnectedInstances';
import { SensitiveBlock } from '../../ui/Sensitive';
import { SettingsPage } from './_shared/SettingsControls';

export function ConnectionsPanel() {
  const { t } = useTranslation(['settings']);
  return (
    <SettingsPage title={t('settings:connections.title')}>
      {/* Which servers this account reaches, and as whom: streamer mode hides the whole list. */}
      <SensitiveBlock>
        <ConnectedInstances />
      </SensitiveBlock>
    </SettingsPage>
  );
}
