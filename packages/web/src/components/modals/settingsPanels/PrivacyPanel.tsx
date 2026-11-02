import { useTranslation } from 'react-i18next';
import { useActivityStore } from '../../../stores/activityStore';
import { useExternalMediaStore } from '../../../stores/externalMediaStore';
import { api } from '../../../api/client';
import { BlockedPeopleSection } from './BlockedPeopleSection';
import { ContactRulesSection } from './ContactRulesSection';
import { SettingsPage, SettingsSection, ToggleRow } from './_shared/SettingsControls';

export function PrivacyPanel() {
  const { t } = useTranslation(['settings', 'common', 'legal']);
  const showActivity = useActivityStore((s) => s.showActivity);
  const alwaysAllowExternal = useExternalMediaStore((s) => s.alwaysAllow);
  const setAlwaysAllowExternal = useExternalMediaStore((s) => s.setAlwaysAllow);

  return (
    <SettingsPage title={t('settings:privacy.title')}>
      <ContactRulesSection />

      {/* Content from other servers */}
      <SettingsSection title={t('legal:external.settingsTitle')}>
        <ToggleRow
          label={t('legal:external.settingsLabel')}
          description={t('legal:external.settingsDescription')}
          enabled={alwaysAllowExternal}
          onChange={setAlwaysAllowExternal}
        />
      </SettingsSection>

      {/* Activity Status */}
      <SettingsSection title={t('settings:privacy.activity.sectionTitle')}>
        <ToggleRow
          label={t('settings:privacy.activity.label')}
          description={t('settings:privacy.activity.description')}
          enabled={showActivity}
          onChange={async (enabled) => {
            try {
              await api.users.update({ showActivity: enabled });
              useActivityStore.getState().setShowActivity(enabled);
            } catch (err) {
              console.error('Failed to update activity visibility:', err);
            }
          }}
        />
      </SettingsSection>

      <BlockedPeopleSection />
    </SettingsPage>
  );
}
