import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { MemberWithUser, User } from '@backspace/shared';
import { menuPositionFor, useContextMenuStore, type ContextMenuItem, type ContextMenuCheckbox } from '../../../stores/contextMenuStore';
import { getMyUserIdForOrigin, useSpaceStore, type TaggedSpace } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { PermissionBits, hasPermissionBit } from '../../../utils/permissions';
import { viewerCanActOn, viewerCanEditMemberRoles, viewerCanManageRoleAt } from '../../../utils/roleHierarchy';
import { changeMemberRole, getCurrentMember, isRoleWritePending, subscribeMemberRoles, type MemberTarget } from './memberRoleActions';
import { friendshipMenuItems, reportUserMenuItem, runMemberAction, sendMemberMessage } from './memberSocialActions';
import { MemberNicknameDialog } from './MemberNicknameDialog';
import { MemberRemovalDialog } from './MemberRemovalDialog';
import { TimeoutDialog } from './TimeoutDialog';
import { isTimedOut, removeMemberTimeout } from './memberTimeout';
import { spaceMemberName, userDisplayName } from '../../../utils/identity';
import { Icon } from '../../ui/Icon';

type MemberDialog = {
  target: MemberTarget;
  nickname: string | null;
  /** The member's name in this space (nickname or account name). */
  name: string;
  /** The account name, shown when there is no nickname. */
  accountName: string;
  self: boolean;
  action: 'nickname' | 'kick' | 'ban' | 'timeout';
};

function roleMenuItems(target: MemberTarget): ContextMenuCheckbox[] {
  const { spaces, members, roles } = useSpaceStore.getState();
  const space = spaces.find((item) => item.id === target.spaceId);
  // Mirror the upstream hierarchy gate; the server still authorizes every write.
  return roles.filter(r => r.spaceId === target.spaceId && r.id !== target.spaceId && space && viewerCanManageRoleAt(space, members, r.position)).sort((a, b) => b.position - a.position).map(role => ({
    type: 'checkbox', key: role.id, label: role.name,
    subscribe: subscribeMemberRoles,
    getChecked: () => !!getCurrentMember(target)?.roles?.some(r => r.id === role.id),
    getDisabled: () => isRoleWritePending(target) || !getCurrentMember(target),
    onChange: checked => { void changeMemberRole(target, role.id, checked); },
  }));
}

function memberMenuPermissions(space: TaggedSpace, member: MemberWithUser) {
  const self = getMyUserIdForOrigin(space._instanceOrigin) === member.userId;
  const protectedMember = self || member.userId === space.ownerId;
  const { members, roles, spacePermissions } = useSpaceStore.getState();
  const permissions = spacePermissions.get(space.id);
  const canModerate = viewerCanActOn(space, members, member);
  const can = (bit: bigint) => hasPermissionBit(permissions, bit);
  return {
    self,
    // Another member's nickname: MANAGE_SPACE and a higher rank, as the server checks.
    nickname: self || (!protectedMember && canModerate && can(PermissionBits.MANAGE_SPACE)),
    roles: viewerCanEditMemberRoles(space, members, roles, permissions, member),
    kick: !protectedMember && canModerate && can(PermissionBits.KICK_MEMBERS),
    ban: !protectedMember && canModerate && can(PermissionBits.BAN_MEMBERS),
    // Timeouts follow the same hierarchy as kick and ban, on their own bit.
    timeout: !protectedMember && canModerate && can(PermissionBits.MODERATE_MEMBERS),
  };
}

export function useMemberContextMenu(space: TaggedSpace | undefined) {
  const { t } = useTranslation(['spaces', 'social', 'common']);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<MemberDialog | null>(null);
  const spaceId = space?.id;
  const origin = space?._instanceOrigin;

  useEffect(() => {
    setDialog(null);
    // A context menu cannot keep acting on members of a space we've left.
    return () => { useContextMenuStore.getState().close(); };
  }, [spaceId, origin]);

  const open = (event: MouseEvent | KeyboardEvent, member: MemberWithUser, canonical: User) => {
    event.preventDefault();
    event.stopPropagation();
    if (!space) return;
    useUIStore.getState().closeUserProfile();
    const anchor = event.currentTarget.getBoundingClientRect();
    const pointer = menuPositionFor(event);
    const target = { origin: space._instanceOrigin, spaceId: space.id, userId: member.userId };
    const allowed = memberMenuPermissions(space, member);
    const memberName = spaceMemberName(member, canonical);
    const showDialog = (action: MemberDialog['action']) => setDialog({
      target, action, nickname: member.nickname, self: allowed.self,
      name: memberName, accountName: userDisplayName(canonical),
    });
    const user = member.user;
    const roles = roleMenuItems(target);
    // The roster row as the store holds it now: a timeout set or lifted since
    // the list rendered decides which of the two items is offered.
    const timedOut = isTimedOut(getCurrentMember(target) ?? member, Date.now());
    const items: ContextMenuItem[] = [
      {
        type: 'action', key: 'profile', label: t('spaces:members.menu.profile'),
        icon: <Icon name="user" size={16} />,
        onClick: () => {
          useUIStore.getState().openUserProfile(canonical, target.origin, anchor, 'left', { spaceId: member.spaceId, userId: member.userId });
        }
      },
      {
        type: 'action', key: 'message', label: t('social:profile.sendMessage'), hidden: allowed.self,
        icon: <Icon name="message" size={16} />,
        onClick: () => { void runMemberAction(() => sendMemberMessage(user, target.origin, navigate)); }
      },
      ...(allowed.self ? [] : [...friendshipMenuItems(user, target.origin, t), reportUserMenuItem(member.userId, user.username, target.origin)]),
      { type: 'separator', key: 'member-separator' },
      {
        type: 'action', key: 'nickname', label: t('spaces:members.menu.nickname'), hidden: !allowed.nickname,
        icon: <Icon name="edit" size={16} />,
        onClick: () => showDialog('nickname')
      },
      {
        // Only the member themselves sets their profile for the space.
        type: 'action', key: 'space-profile', label: t('spaces:members.menu.spaceProfile'), hidden: !allowed.self,
        icon: <Icon name="user" size={16} />,
        onClick: () => useUIStore.getState().openModal('spaceProfile', { spaceId: target.spaceId })
      },
      {
        type: 'submenu', key: 'roles', label: t('spaces:members.menu.roles'),
        hidden: !allowed.roles || roles.length === 0,
        icon: <Icon name="shield" size={16} />,
        children: roles
      },
      { type: 'separator', key: 'moderation-separator' },
      {
        type: 'action', key: 'timeout', label: t('spaces:members.menu.timeout'), danger: true,
        icon: <Icon name="hourglass" size={16} />,
        hidden: !allowed.timeout || timedOut, onClick: () => showDialog('timeout')
      },
      {
        type: 'action', key: 'remove-timeout', label: t('spaces:members.menu.removeTimeout'),
        icon: <Icon name="hourglass" size={16} />,
        hidden: !allowed.timeout || !timedOut, onClick: () => { void removeMemberTimeout(target, memberName); }
      },
      {
        type: 'action', key: 'kick', label: t('spaces:settings.members.kick'), danger: true,
        icon: <Icon name="logout" size={16} />,
        hidden: !allowed.kick, onClick: () => showDialog('kick')
      },
      {
        type: 'action', key: 'ban', label: t('spaces:settings.members.ban'), danger: true,
        icon: <Icon name="alert" size={16} />,
        hidden: !allowed.ban, onClick: () => showDialog('ban')
      },
    ];
    useContextMenuStore.getState().open(pointer, items);
  };

  let dialogs = null;
  if (dialog?.action === 'nickname') {
    dialogs = (
      <MemberNicknameDialog target={dialog.target} nickname={dialog.nickname} accountName={dialog.accountName}
        self={dialog.self} onClose={() => setDialog(null)} />
    );
  } else if (dialog?.action === 'timeout') {
    dialogs = <TimeoutDialog target={dialog.target} name={dialog.name} onClose={() => setDialog(null)} />;
  } else if (dialog) {
    dialogs = <MemberRemovalDialog target={dialog.target} action={dialog.action} name={dialog.name} onClose={() => setDialog(null)} />;
  }
  return { open, dialogs };
}
