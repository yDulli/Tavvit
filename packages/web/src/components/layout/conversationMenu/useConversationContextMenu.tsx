import { messagePath } from '../../../utils/openThread';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { User } from '@backspace/shared';
import { menuPositionFor, useContextMenuStore, type ContextMenuItem } from '../../../stores/contextMenuStore';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { getChannelOrigin, useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { useVoiceStore } from '../../../stores/voiceStore';
import { isMine, selfIdentityOf } from '../../../utils/identity';
import { isDeletedPartnerDm } from '../../../utils/dmFormatters';
import { markConversationRead } from '../../../utils/markConversationRead';
import { canStartDmCall, isDmCallRunning, joinDmCall, startDmCall } from '../../../utils/voiceActions';
import { hasPermissionBit, PermissionBits } from '../../../utils/permissions';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { NotificationSettingsModal, type NotificationSettingsModalTarget } from '../../notifications/NotificationSettingsModal';

/** Where a profile card opens beside the row it was asked from. */
type Side = 'left' | 'right';

function toast(message: string, kind: 'success' | 'warning', duration?: number): void {
  useUIStore.getState().addToast(message, kind, duration);
}

/**
 * The right-click menus of a conversation, wherever one is listed (the
 * sidebar, Home, the inbox, a channel's header): a direct message (one person
 * or a group) and a space channel. Each starts with what is most often wanted
 * there (mark it read, the person's profile, a call) and ends with leaving it.
 * The dialogs the items open (a channel's notification settings, leaving a
 * group) are returned as `dialogs`, for the caller to render once.
 */
export function useConversationContextMenu() {
  const { t } = useTranslation(['spaces', 'dm', 'chat', 'common']);
  const navigate = useNavigate();
  const [leaveDmId, setLeaveDmId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [notificationTarget, setNotificationTarget] = useState<NotificationSettingsModalTarget | null>(null);

  const markRead = (channelId: string) => {
    void markConversationRead(channelId).then((ok) => {
      if (!ok) toast(t('common:contextMenu.markReadFailed'), 'warning');
    });
  };

  const copy = (text: string, done: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast(done, 'success', 2000),
      () => toast(t('common:contextMenu.clipboardFailed'), 'warning'),
    );
  };

  /** Leaves the open conversation first when it is the one going away. */
  const leaveIfOpen = (channelId: string) => {
    if (useChatStore.getState().currentChannelId !== channelId) return;
    navigate('/channels/@me');
    useChatStore.getState().setCurrentChannel(null);
  };

  const closeDm = (dmId: string) => {
    leaveIfOpen(dmId);
    void useSpaceStore.getState().closeDm(dmId);
  };

  /** The right-click menu of a direct message. `side` is where a profile card opens from the row. */
  const openDm = (event: MouseEvent | KeyboardEvent, dmId: string, side: Side = 'right') => {
    event.preventDefault();
    event.stopPropagation();
    const dm = useSpaceStore.getState().dmChannels.find((candidate) => candidate.id === dmId);
    if (!dm) return;
    const anchor = event.currentTarget.getBoundingClientRect();
    const auth = useAuthStore.getState();
    const viewer = { origin: getChannelOrigin(dm.id), self: selfIdentityOf(auth.user, auth.myRowIds) };
    const isGroup = !!dm.ownerId;
    const partner: User | undefined = isGroup ? undefined : dm.members.find((member) => !isMine(member, viewer.origin, viewer.self));
    const partnerGone = isDeletedPartnerDm(dm, viewer);
    const unread = useChatStore.getState().unreadChannels.has(dm.id);
    const callBusy = !canStartDmCall(useVoiceStore.getState());

    const items: ContextMenuItem[] = [
      {
        type: 'action', key: 'mark-read', label: t('common:contextMenu.markRead'), hidden: !unread,
        icon: <Icon name="check" size={16} />,
        onClick: () => markRead(dm.id),
      },
      {
        type: 'action', key: 'profile', label: t('spaces:members.menu.profile'), hidden: !partner,
        icon: <Icon name="user" size={16} />,
        onClick: () => { if (partner) useUIStore.getState().openUserProfile(partner, viewer.origin, anchor, side); },
      },
      {
        type: 'action', key: 'call', label: t('spaces:main.dm.startVoiceCall'), hidden: partnerGone, disabled: callBusy,
        icon: <Icon name="phone" size={16} />,
        onClick: () => {
          navigate(`/channels/@me/${dm.id}`);
          if (isDmCallRunning(useVoiceStore.getState(), dm.id)) joinDmCall(dm.id);
          else startDmCall(dm.id);
        },
      },
      {
        type: 'action', key: 'copy-username', label: t('common:contextMenu.copyUsername'), hidden: !partner,
        icon: <Icon name="copy" size={16} />,
        onClick: () => { if (partner) copy(partner.username, t('common:contextMenu.usernameCopied')); },
      },
      { type: 'separator', key: 'leave-separator' },
      {
        type: 'action', key: 'close', label: t('dm:list.close'), hidden: isGroup,
        icon: <Icon name="x" size={16} />,
        onClick: () => closeDm(dm.id),
      },
      {
        type: 'action', key: 'leave-group', label: t('spaces:sidebar.dmList.leaveGroup'), hidden: !isGroup, danger: true,
        icon: <Icon name="logout" size={16} />,
        onClick: () => setLeaveDmId(dm.id),
      },
    ];
    useContextMenuStore.getState().open(menuPositionFor(event), items);
  };

  /** The right-click menu of a space channel, text or voice, open or not. */
  const openChannel = (event: MouseEvent | KeyboardEvent, channelId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const store = useSpaceStore.getState();
    const entry = store.spaceChannelIndex.get(channelId);
    if (!entry) return;
    const unread = useChatStore.getState().unreadChannels.has(channelId);
    const isText = entry.type !== 'voice';
    // Channel settings edits the channels of the open space, with their resolved permissions.
    const canEdit = store.currentSpaceId === entry.spaceId
      && hasPermissionBit(store.channelPermissions.get(channelId), PermissionBits.MANAGE_CHANNELS);
    const link = `${entry.origin || window.location.origin}/channels/${entry.spaceId}/${channelId}`;

    const items: ContextMenuItem[] = [
      {
        type: 'action', key: 'mark-read', label: t('common:contextMenu.markRead'), hidden: !unread,
        icon: <Icon name="check" size={16} />,
        onClick: () => markRead(channelId),
      },
      {
        type: 'action', key: 'notifications', label: t('spaces:notifications.open'), hidden: !isText,
        icon: <Icon name="bell" size={16} />,
        // The settings live on the instance that hosts the space.
        onClick: () => setNotificationTarget({ kind: 'channel', origin: entry.origin, spaceId: entry.spaceId, channelId, channelName: entry.name }),
      },
      {
        type: 'action', key: 'copy-link', label: t('chat:menu.copyLink'),
        icon: <Icon name="link" size={16} />,
        onClick: () => copy(link, t('chat:menu.linkCopied')),
      },
      { type: 'separator', key: 'manage-separator' },
      {
        type: 'action', key: 'edit', label: t('common:contextMenu.editChannel'), hidden: !canEdit,
        icon: <Icon name="settings" size={16} />,
        onClick: () => useUIStore.getState().openModal('channelSettings', { channelId }),
      },
    ];
    useContextMenuStore.getState().open(menuPositionFor(event), items);
  };

  /**
   * The right-click menu of a mention in the inbox or on Home: open the
   * conversation at the message, mark its channel read, copy a link that
   * opens there too (`?message=`, MainContent).
   */
  const openMention = (event: MouseEvent | KeyboardEvent, mention: { origin: string; spaceId: string; channelId: string; messageId: string }) => {
    event.preventDefault();
    event.stopPropagation();
    const path = messagePath(mention.spaceId, mention.channelId, mention.messageId);
    const unread = useChatStore.getState().unreadChannels.has(mention.channelId);
    const items: ContextMenuItem[] = [
      {
        type: 'action', key: 'jump', label: t('common:contextMenu.jumpToMessage'),
        icon: <Icon name="arrow-down" size={16} />,
        onClick: () => navigate(path),
      },
      {
        type: 'action', key: 'mark-read', label: t('common:contextMenu.markRead'), hidden: !unread,
        icon: <Icon name="check" size={16} />,
        onClick: () => markRead(mention.channelId),
      },
      { type: 'separator', key: 'copy-separator' },
      {
        type: 'action', key: 'copy-link', label: t('common:contextMenu.copyMessageLink'),
        icon: <Icon name="link" size={16} />,
        onClick: () => copy(`${mention.origin || window.location.origin}${path}`, t('chat:menu.linkCopied')),
      },
    ];
    useContextMenuStore.getState().open(menuPositionFor(event), items);
  };

  const dialogs = (
    <>
      {notificationTarget && (
        <NotificationSettingsModal target={notificationTarget} onClose={() => setNotificationTarget(null)} />
      )}
      <ConfirmDialog
        isOpen={leaveDmId !== null}
        onClose={() => setLeaveDmId(null)}
        onConfirm={async () => {
          if (!leaveDmId) return;
          setLeaving(true);
          try {
            leaveIfOpen(leaveDmId);
            await useSpaceStore.getState().leaveDm(leaveDmId);
            setLeaveDmId(null);
          } catch {
            // leaveDm reports its own errors.
          } finally {
            setLeaving(false);
          }
        }}
        title={t('spaces:sidebar.dmList.leaveGroupConfirm.title')}
        description={t('spaces:sidebar.dmList.leaveGroupConfirm.description')}
        confirmLabel={t('common:actions.leave')}
        variant="danger"
        loading={leaving}
      />
    </>
  );

  return { openDm, openChannel, openMention, askLeaveGroup: setLeaveDmId, dialogs };
}
