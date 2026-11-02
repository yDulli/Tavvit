import { createElement } from 'react';
import i18n from '../../../i18n';
import { Icon, type IconName } from '../../ui/Icon';
import { openDirectMessage } from '../../../utils/openDirectMessage';
import { selfIdentityOf } from '../../../utils/identity';
import type { User } from '@backspace/shared';
import type { TFunction } from 'i18next';
import { useAuthStore } from '../../../stores/authStore';
import { useSocialStore } from '../../../stores/socialStore';
import { useUIStore } from '../../../stores/uiStore';
import type { ContextMenuAction } from '../../../stores/contextMenuStore';
import { getFriendshipStatus } from '../../../utils/friendshipStatus';
import { friendRequestTarget } from '../../../utils/friendRequestTarget';
import { describeError } from '../../../i18n/errors';

export async function runMemberAction(action: () => Promise<unknown>): Promise<void> {
  try { await action(); }
  catch (error) { useUIStore.getState().addToast(describeError(error), 'warning'); }
}

export async function sendMemberMessage(user: User, origin: string, navigate: (path: string) => void): Promise<void> {
  const channelId = await openDirectMessage(user, origin);
  useUIStore.getState().setShowDms(true);
  navigate('/channels/@me/' + channelId);
}

const menuIcon = (name: IconName) => createElement(Icon, { name, size: 16 });

/** Report a person to the operator of the instance they are seen on. `id` is their id there. */
export function reportUserMenuItem(id: string, name: string, origin: string): ContextMenuAction {
  return {
    type: 'action',
    key: 'report-user',
    label: i18n.t('legal:report.menuUser'),
    icon: menuIcon('flag'),
    onClick: () => useUIStore.getState().openModal('report', { target: { type: 'user', id, origin, label: name } }),
  };
}

export function friendshipMenuItems(user: User, origin: string, t: TFunction<readonly ['spaces', 'social', 'common']>): ContextMenuAction[] {
  const social = useSocialStore.getState();
  const auth = useAuthStore.getState();
  const friendship = getFriendshipStatus({ viewedUser: user, origin, self: selfIdentityOf(auth.user, auth.myRowIds), ...social });
  const action = (key: string, icon: IconName, label: string, run: () => Promise<unknown>): ContextMenuAction => ({
    type: 'action', key, label, icon: menuIcon(icon), onClick: () => { void runMemberAction(run); },
  });
  switch (friendship.state) {
    case 'self': return [];
    case 'friends': return [action('remove-friend', 'x', t('social:friend.remove'), () => social.removeFriend(friendship.friend, friendship.friend._instanceOrigin))];
    case 'outbound_pending': return [action('cancel-friend', 'x', t('social:request.cancel'), () => social.cancelFriendRequest(friendship.request.id, friendship.request._instanceOrigin, friendship.request.user ?? undefined))];
    case 'inbound_pending': return [
      action('accept-friend', 'check', t('common:actions.accept'), () => social.updateFriendRequest(friendship.request.id, friendship.request._instanceOrigin, 'accepted', friendship.request.user ?? undefined)),
      action('decline-friend', 'x', t('common:actions.decline'), () => social.updateFriendRequest(friendship.request.id, friendship.request._instanceOrigin, 'declined', friendship.request.user ?? undefined)),
    ];
    case 'none': {
      // The home identity is authoritative; a replica's username may only be a label.
      return [action('add-friend', 'user-plus', t('social:profile.addFriend'), () => social.sendFriendRequest(friendRequestTarget(user, origin)))];
    }
  }
}
