import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useIsSpaceOwner } from '../../../hooks/useIsSpaceOwner';
import { useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { NotificationSettingsControls } from '../../notifications/NotificationSettingsControls';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { SettingsPage, SettingsSection } from '../settingsPanels/_shared/SettingsControls';

/**
 * What belongs to the person looking, not to the space: how it notifies them,
 * who they are in it, and the way out. Every member has this tab, whatever their
 * roles, so someone with no permissions does not open a form they cannot use.
 */
export function YourSpacePanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const navigate = useNavigate();
  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);
  const space = useSpaceStore((s) => s.spaces.find((entry) => entry.id === spaceId));
  const isOwner = useIsSpaceOwner(spaceId);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  if (!space) return null;

  const leave = () => {
    closeModal();
    if (useSpaceStore.getState().currentSpaceId === spaceId) {
      navigate('/channels/@me');
      useSpaceStore.getState().setCurrentSpace(null);
      useUIStore.getState().setShowDms(true);
    }
    void useSpaceStore.getState().leaveSpace(spaceId);
  };

  return (
    <SettingsPage title={t('spaces:settings.nav.tabs.you')}>
      <SettingsSection title={t('spaces:settings.you.notifications')}>
        <NotificationSettingsControls origin={space._instanceOrigin ?? ''} spaceId={spaceId} channelId={null} />
      </SettingsSection>

      <SettingsSection title={t('spaces:settings.you.profile.title')}>
        <p className="text-ui leading-relaxed text-txt-secondary">{t('spaces:settings.you.profile.description')}</p>
        <button type="button" onClick={() => openModal('spaceProfile', { spaceId })} className="btn-outline">
          {t('spaces:settings.you.profile.action')}
        </button>
      </SettingsSection>

      {!isOwner && (
        <SettingsSection title={t('spaces:settings.you.leave.title')}>
          <p className="text-ui leading-relaxed text-txt-secondary">{t('spaces:settings.you.leave.description')}</p>
          <button type="button" onClick={() => setConfirmingLeave(true)} className="btn-danger">
            {t('spaces:sidebar.space.leave')}
          </button>
        </SettingsSection>
      )}

      <ConfirmDialog
        isOpen={confirmingLeave}
        onClose={() => setConfirmingLeave(false)}
        onConfirm={leave}
        title={t('spaces:sidebar.space.leaveConfirm.titleNamed', { name: space.name })}
        description={t('spaces:sidebar.space.leaveConfirm.description')}
        variant="danger"
        confirmLabel={t('common:actions.leave')}
      />
    </SettingsPage>
  );
}
