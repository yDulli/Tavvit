import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getMyUserIdForOrigin, useSpaceStore, type TaggedSpace } from '../../../stores/spaceStore';
import { useChatStore } from '../../../stores/chatStore';
import { useUIStore } from '../../../stores/uiStore';
import { menuPositionFor, useContextMenuStore, type ContextMenuItem } from '../../../stores/contextMenuStore';
import { spaceInviteUrl } from '../../../utils/inviteParser';
import { markConversationRead } from '../../../utils/markConversationRead';
import { describeCodedError } from '../../../i18n/errors';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { TransferOwnershipModal } from '../../modals/TransferOwnershipModal';
import { NotificationSettingsModal, type NotificationSettingsModalTarget } from '../../notifications/NotificationSettingsModal';

/** The unread channels of a space, as the client knows them now. */
function unreadChannelsOf(spaceId: string): string[] {
  const { unreadChannels } = useChatStore.getState();
  const { channelToSpaceMap } = useSpaceStore.getState();
  return [...unreadChannels].filter((channelId) => channelToSpaceMap.get(channelId) === spaceId);
}

/**
 * The right-click menu of a space, wherever the space is shown (the space tabs,
 * Home's space tiles): mark it read, copy an invite, its notification
 * settings, hand it over (the owner) or leave it (everyone else). The dialogs
 * the items open are returned as `dialogs`, for the caller to render.
 */
export function useSpaceContextMenu() {
  const { t } = useTranslation(['spaces', 'common', 'legal']);
  const navigate = useNavigate();
  const [transferSpaceId, setTransferSpaceId] = useState<string | null>(null);
  const [notificationTarget, setNotificationTarget] = useState<NotificationSettingsModalTarget | null>(null);
  const [leaveSpaceId, setLeaveSpaceId] = useState<string | null>(null);

  const open = (spaceId: string, event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const space: TaggedSpace | undefined = useSpaceStore.getState().spaces.find((candidate) => candidate.id === spaceId);
    if (!space) return;
    const origin = space._instanceOrigin ?? '';
    const isOwner = space.ownerId === getMyUserIdForOrigin(origin);
    const unread = unreadChannelsOf(spaceId);

    const items: ContextMenuItem[] = [
      {
        key: 'mark-read',
        type: 'action',
        label: t('common:contextMenu.markRead'),
        hidden: unread.length === 0,
        icon: <Icon name="check" size={16} />,
        onClick: () => {
          void Promise.all(unread.map((channelId) => markConversationRead(channelId))).then((results) => {
            if (results.some((ok) => !ok)) useUIStore.getState().addToast(t('common:contextMenu.markReadFailed'), 'warning');
          });
        },
      },
      { key: 'read-separator', type: 'separator' },
      {
        key: 'invite',
        type: 'action',
        label: t('common:actions.invitePeople'),
        icon: <Icon name="user-plus" size={16} />,
        onClick: async () => {
          try {
            const code = await useSpaceStore.getState().generateInvite(spaceId);
            await navigator.clipboard.writeText(spaceInviteUrl(space._instanceOrigin, code));
            useUIStore.getState().addToast(
              t(space.visibility === 'request' ? 'spaces:sidebar.space.inviteCopiedRequest' : 'spaces:sidebar.space.inviteCopied'),
              'success',
              3000,
            );
          } catch (err) {
            useUIStore.getState().addToast(describeCodedError(err, t('spaces:sidebar.space.inviteFailed')), 'warning', 3000);
          }
        },
      },
      {
        key: 'notifications',
        type: 'action',
        label: t('spaces:notifications.open'),
        icon: <Icon name="bell" size={16} />,
        // The settings live on the instance that hosts the space.
        onClick: () => setNotificationTarget({ kind: 'space', origin, spaceId, spaceName: space.name }),
      },
      { key: 'manage-separator', type: 'separator' },
      {
        key: 'transfer',
        type: 'action',
        label: t('spaces:sidebar.space.transferOwnership'),
        hidden: !isOwner,
        icon: <Icon name="crown" size={16} />,
        onClick: () => setTransferSpaceId(spaceId),
      },
      {
        key: 'leave',
        type: 'action',
        label: t('spaces:sidebar.space.leave'),
        hidden: isOwner,
        danger: true,
        icon: <Icon name="logout" size={16} />,
        onClick: () => setLeaveSpaceId(spaceId),
      },
      {
        key: 'report',
        type: 'action',
        label: t('legal:report.menuSpace'),
        hidden: isOwner,
        icon: <Icon name="flag" size={16} />,
        onClick: () => useUIStore.getState().openModal('report', { target: { type: 'space', id: spaceId, origin, label: space.name } }),
      },
    ];
    useContextMenuStore.getState().open(menuPositionFor(event), items);
  };

  const leaving = leaveSpaceId ? useSpaceStore.getState().spaces.find((space) => space.id === leaveSpaceId) : undefined;
  const dialogs = (
    <>
      {transferSpaceId && (
        <TransferOwnershipModal spaceId={transferSpaceId} onClose={() => setTransferSpaceId(null)} />
      )}
      {notificationTarget && (
        <NotificationSettingsModal target={notificationTarget} onClose={() => setNotificationTarget(null)} />
      )}
      {leaveSpaceId && (
        <ConfirmDialog
          isOpen
          onClose={() => setLeaveSpaceId(null)}
          onConfirm={() => {
            if (useSpaceStore.getState().currentSpaceId === leaveSpaceId) {
              navigate('/channels/@me');
              useSpaceStore.getState().setCurrentSpace(null);
              useUIStore.getState().setShowDms(true);
            }
            void useSpaceStore.getState().leaveSpace(leaveSpaceId);
            setLeaveSpaceId(null);
          }}
          title={leaving ? t('spaces:sidebar.space.leaveConfirm.titleNamed', { name: leaving.name }) : t('spaces:sidebar.space.leaveConfirm.title')}
          description={t('spaces:sidebar.space.leaveConfirm.description')}
          variant="danger"
          confirmLabel={t('common:actions.leave')}
        />
      )}
    </>
  );

  return { open, dialogs };
}
