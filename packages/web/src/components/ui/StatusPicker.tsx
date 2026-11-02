import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChosenUserStatus } from '@backspace/shared';
import { describeError } from '../../i18n/errors';
import { selectMyChosenStatus, useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { SegmentedControl } from '../modals/settingsPanels/_shared/SettingsControls';

/**
 * The status a person chooses, saved the moment they choose it. On their own card,
 * on the phone's You screen and in the account settings: one click from
 * wherever they are, and never part of a form with a save button.
 */
export function StatusPicker({ className }: { className?: string }) {
  const { t } = useTranslation(['settings', 'common']);
  const labelId = useId();
  // The chosen status lives on the account that owns it (utils/selfStatus.ts).
  const status: ChosenUserStatus = useAuthStore(selectMyChosenStatus) ?? 'online';
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const addToast = useUIStore((s) => s.addToast);

  const choose = (next: ChosenUserStatus) => {
    if (next === status) return;
    updateProfile({ status: next }).catch((error: unknown) => {
      addToast(describeError(error), 'warning');
    });
  };

  return (
    <div className={className}>
      <div id={labelId} className="field-label">{t('settings:account.details.status.label')}</div>
      <SegmentedControl
        labelledBy={labelId}
        value={status}
        onChange={choose}
        options={[
          { id: 'online', label: t('common:states.online') },
          { id: 'idle', label: t('common:states.idle') },
          { id: 'dnd', label: t('common:states.doNotDisturb') },
        ]}
      />
    </div>
  );
}
