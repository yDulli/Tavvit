import { useTranslation } from 'react-i18next';
import {
  DEFAULT_DM_POLICY,
  DEFAULT_FRIEND_REQUEST_POLICY,
  DM_POLICIES,
  FRIEND_REQUEST_POLICIES,
  type DmPolicy,
  type FriendRequestPolicy,
} from '@backspace/shared';
import { describeError } from '../../../i18n/errors';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { SettingBlock, SettingsSection } from './_shared/SettingsControls';

/**
 * Who may start something with this person. The server applies it
 * (`utils/contactPolicy.ts`); both are saved the moment they are chosen.
 */
export function ContactRulesSection() {
  const { t } = useTranslation(['settings']);
  const dmPolicy = useAuthStore((s) => s.user?.dmPolicy) ?? DEFAULT_DM_POLICY;
  const friendRequestPolicy = useAuthStore((s) => s.user?.friendRequestPolicy) ?? DEFAULT_FRIEND_REQUEST_POLICY;
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const addToast = useUIStore((s) => s.addToast);

  const save = (change: { dmPolicy?: DmPolicy; friendRequestPolicy?: FriendRequestPolicy }) => {
    updateProfile(change).catch((error: unknown) => addToast(describeError(error), 'warning'));
  };

  const dmLabels: Record<DmPolicy, string> = {
    anyone: t('settings:privacy.contact.dm.options.anyone'),
    friends_and_spaces: t('settings:privacy.contact.dm.options.friendsAndSpaces'),
    friends: t('settings:privacy.contact.dm.options.friends'),
    nobody: t('settings:privacy.contact.dm.options.nobody'),
  };
  const requestLabels: Record<FriendRequestPolicy, string> = {
    anyone: t('settings:privacy.contact.requests.options.anyone'),
    shared_spaces: t('settings:privacy.contact.requests.options.sharedSpaces'),
    nobody: t('settings:privacy.contact.requests.options.nobody'),
  };

  return (
    <SettingsSection title={t('settings:privacy.contact.title')}>
      <SettingBlock label={t('settings:privacy.contact.dm.label')} description={t('settings:privacy.contact.dm.description')}>
        {(labelId) => (
          <select
            aria-labelledby={labelId}
            value={dmPolicy}
            onChange={(event) => save({ dmPolicy: event.target.value as DmPolicy })}
            className="input-standard w-full"
          >
            {[...DM_POLICIES].reverse().map((policy) => <option key={policy} value={policy}>{dmLabels[policy]}</option>)}
          </select>
        )}
      </SettingBlock>
      <SettingBlock label={t('settings:privacy.contact.requests.label')} description={t('settings:privacy.contact.requests.description')}>
        {(labelId) => (
          <select
            aria-labelledby={labelId}
            value={friendRequestPolicy}
            onChange={(event) => save({ friendRequestPolicy: event.target.value as FriendRequestPolicy })}
            className="input-standard w-full"
          >
            {[...FRIEND_REQUEST_POLICIES].reverse().map((policy) => <option key={policy} value={policy}>{requestLabels[policy]}</option>)}
          </select>
        )}
      </SettingBlock>
    </SettingsSection>
  );
}
