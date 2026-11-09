import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { User } from '@backspace/shared';
import { menuPositionFor, useContextMenuStore, type ContextMenuItem } from '../../../stores/contextMenuStore';
import { useSelfIdentity } from '../../../stores/authStore';
import { useBlockStore } from '../../../stores/blockStore';
import { useUIStore } from '../../../stores/uiStore';
import { isMine, isPersonAccount, parseFederatedUsername } from '../../../utils/identity';
import { describeError } from '../../../i18n/errors';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Icon } from '../../ui/Icon';
import { friendshipMenuItems, reportUserMenuItem, runMemberAction, sendMemberMessage } from '../memberMenu/memberSocialActions';

/** Where a profile card opens beside the row it was asked from. */
type Side = 'left' | 'right';

/**
 * The right-click menu of a person outside a space's member list: a friend
 * on Home, in "Active now" or on the Friends page, a mention in a message.
 * Profile, a direct message, the friendship action that fits, the username
 * to copy, and a block (asked about first) or its lifting. A member of the
 * open space gets the member menu instead (memberMenu/useMemberContextMenu),
 * which adds what the space allows.
 *
 * The block confirmation is returned as `dialogs`, for the caller to render.
 */
export function useUserContextMenu() {
  const { t } = useTranslation(['spaces', 'social', 'common']);
  const navigate = useNavigate();
  const self = useSelfIdentity();
  const [blocking, setBlocking] = useState<{ user: User; name: string } | null>(null);
  const [pending, setPending] = useState(false);

  const unblock = async (user: User, name: string) => {
    try {
      await useBlockStore.getState().unblock(user.id);
      useUIStore.getState().addToast(t('social:block.unblocked', { name }), 'success');
    } catch (err) {
      useUIStore.getState().addToast(t('social:block.unblockFailed', { name, reason: describeError(err) }), 'warning');
    }
  };

  const block = async () => {
    if (!blocking) return;
    setPending(true);
    try {
      await useBlockStore.getState().block(blocking.user);
      useUIStore.getState().addToast(t('social:block.blocked', { name: blocking.name }), 'success');
    } catch (err) {
      useUIStore.getState().addToast(t('social:block.failed', { name: blocking.name, reason: describeError(err) }), 'warning');
    } finally {
      setPending(false);
      setBlocking(null);
    }
  };

  /**
   * Opens the menu for `user`, a row the instance at `origin` issued. `side`
   * is where the profile card opens from the row (the right column's rows
   * open it to their left).
   */
  const open = (event: MouseEvent | KeyboardEvent, user: User, origin: string, side: Side = 'right') => {
    event.preventDefault();
    event.stopPropagation();
    useUIStore.getState().closeUserProfile();
    const anchor = event.currentTarget.getBoundingClientRect();
    const mine = isMine(user, origin, self);
    const name = user.displayName ?? parseFederatedUsername(user.username).baseName;
    // A block is the home instance's and names home rows (BlockUserButton), so
    // a person met on another instance cannot be blocked from here.
    const canBlock = origin === '' && !mine;
    const blocked = useBlockStore.getState().blockedIds.has(user.id);
    const items: ContextMenuItem[] = [
      {
        type: 'action', key: 'profile', label: t('spaces:members.menu.profile'),
        icon: <Icon name="user" size={16} />,
        onClick: () => useUIStore.getState().openUserProfile(user, origin, anchor, side),
      },
      {
        type: 'action', key: 'message', label: t('social:profile.sendMessage'), hidden: mine || !isPersonAccount(user),
        icon: <Icon name="message" size={16} />,
        onClick: () => { void runMemberAction(() => sendMemberMessage(user, origin, navigate)); },
      },
      ...(mine ? [] : [...friendshipMenuItems(user, origin, t), reportUserMenuItem(user.id, user.username, origin)]),
      { type: 'separator', key: 'copy-separator' },
      {
        type: 'action', key: 'copy-username', label: t('common:contextMenu.copyUsername'),
        icon: <Icon name="copy" size={16} />,
        onClick: () => {
          void navigator.clipboard.writeText(user.username).then(
            () => useUIStore.getState().addToast(t('common:contextMenu.usernameCopied'), 'success', 2000),
            () => useUIStore.getState().addToast(t('common:contextMenu.clipboardFailed'), 'warning'),
          );
        },
      },
      { type: 'separator', key: 'block-separator' },
      {
        type: 'action', key: 'unblock', label: t('social:block.unblock'), hidden: !canBlock || !blocked,
        icon: <Icon name="check" size={16} />,
        onClick: () => { void unblock(user, name); },
      },
      {
        type: 'action', key: 'block', label: t('social:block.action'), hidden: !canBlock || blocked, danger: true,
        icon: <Icon name="alert" size={16} />,
        onClick: () => setBlocking({ user, name }),
      },
    ];
    useContextMenuStore.getState().open(menuPositionFor(event), items);
  };

  const dialogs = (
    <ConfirmDialog
      isOpen={blocking !== null}
      onClose={() => setBlocking(null)}
      onConfirm={() => { void block(); }}
      title={t('social:block.confirmTitle', { name: blocking?.name ?? '' })}
      description={t('social:block.confirmBody', { name: blocking?.name ?? '' })}
      confirmLabel={t('social:block.confirmAction')}
      loading={pending}
    />
  );

  return { open, dialogs };
}
