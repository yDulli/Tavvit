import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '@backspace/shared';
import { useSocialStore, type TaggedFriend } from '../../stores/socialStore';
import { useUIStore } from '../../stores/uiStore';
import { selectPeoplePanelOpen } from '../../stores/peoplePanel';
import { useFriendBuckets } from '../../hooks/useFriendBuckets';
import { friendRowKey, type HomeFriend } from '../../utils/homeSummary';
import { parseFederatedUsername, isFederationGlobeApplicable, userDisplayName } from '../../utils/identity';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { useStreaming } from '../../stores/activityStore';
import { friendProfileUser, useFriendDoing } from '../home/friendDoing';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { SidePanel } from './SidePanel';
import { useUserContextMenu } from './userMenu/useUserContextMenu';

/**
 * One online friend: who, which instance they are from when it is not this
 * one, and what they are doing in words. Pressing the row opens their profile
 * card beside the column.
 */
function ActiveFriendRow({ row, onOpen, onContextMenu }: {
  row: HomeFriend;
  onOpen: (event: React.MouseEvent<HTMLButtonElement>, friend: TaggedFriend) => void;
  onContextMenu: (event: React.MouseEvent, friend: TaggedFriend) => void;
}) {
  const canonical = useCanonicalUserView(row.friend as unknown as User, row.friend._instanceOrigin);
  const streaming = useStreaming(row.friend, row.friend._instanceOrigin);
  const name = userDisplayName(canonical);
  const doing = useFriendDoing(row, canonical);
  const domain = isFederationGlobeApplicable(canonical) ? parseFederatedUsername(canonical.username).domain : null;
  return (
    <li>
      <button
        type="button"
        onClick={(event) => onOpen(event, row.friend)}
        onContextMenu={(event) => onContextMenu(event, row.friend)}
        className="list-row w-full items-start text-left"
      >
        <Avatar
          src={canonical.avatar}
          name={name}
          size={32}
          status={canonical.status}
          streaming={streaming}
          userId={canonical.homeUserId ?? canonical.id}
          avatarColor={canonical.avatarColor}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-ui font-medium leading-5 text-txt-primary">{name}</span>
            {domain && <span className="min-w-0 truncate font-mono text-label text-txt-tertiary">@{domain}</span>}
          </span>
          <span className={`block truncate text-meta leading-4 ${doing.busy ? 'text-txt-secondary' : 'text-txt-tertiary'}`}>{doing.line}</span>
          {doing.detail && <span className="block truncate text-meta leading-4 text-txt-tertiary">{doing.detail}</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * The people column beside the DM side of the app: the friends who are
 * online right now, and nobody else. Friends on voice come first (with the
 * space they are in), then those sharing an activity (playing, listening,
 * watching, streaming), then the rest of who is around; within each, by name
 * (utils/homeSummary.ts, `bucketFriends`). Offline friends are not listed:
 * the column answers "who could I talk to now", and the Friends page keeps
 * the whole list.
 *
 * `onAddFriends` is where the column can send someone with nobody online to
 * find more people; the button is left out without it.
 */
export function ActivityPanel({ onAddFriends }: { onAddFriends?: () => void }) {
  const { t } = useTranslation(['social', 'common']);
  const friends = useSocialStore((s) => s.friends);
  const loadFriends = useSocialStore((s) => s.loadFriends);
  const memberListOpen = useUIStore(selectPeoplePanelOpen);
  const openUserProfile = useUIStore((s) => s.openUserProfile);
  const buckets = useFriendBuckets();
  const userMenu = useUserContextMenu();

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  const online = useMemo(() => [...buckets.inVoice, ...buckets.active, ...buckets.around], [buckets]);

  if (!memberListOpen) return null;

  const handleOpen = (event: React.MouseEvent<HTMLButtonElement>, friend: TaggedFriend) => {
    event.stopPropagation();
    openUserProfile(friendProfileUser(friend), friend._instanceOrigin, event.currentTarget.getBoundingClientRect(), 'left');
  };

  return (
    <SidePanel>
      <h2 className="side-panel-head">
        <span className="text-ui font-medium text-txt-primary">{t('social:activity.title')}</span>
        {online.length > 0 && (
          <>
            <span aria-hidden="true" className="font-mono text-meta tabular text-txt-tertiary">{online.length}</span>
            <span className="sr-only">{t('social:activity.onlineCount', { count: online.length })}</span>
          </>
        )}
      </h2>
      <div className="px-2.5 pb-4 pt-3">

        {online.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true">
              <Icon name="users" size={18} />
            </span>
            <p className="empty-state-title">{t('social:activity.nobodyTitle')}</p>
            <p className="empty-state-body">
              {friends.length > 0 ? t('social:activity.nobodyBody') : t('social:activity.noFriendsBody')}
            </p>
            {onAddFriends && (
              <button type="button" onClick={onAddFriends} className="btn-outline btn-sm mt-2">
                <Icon name="user-plus" size={14} />
                {t('social:activity.addFriends')}
              </button>
            )}
          </div>
        ) : (
          <ul className="mt-1 space-y-px">
            {online.map((row) => (
              <ActiveFriendRow
                key={friendRowKey(row.friend)}
                row={row}
                onOpen={handleOpen}
                // The column is on the right, so the profile card opens to its left.
                onContextMenu={(event, friend) => userMenu.open(event, friendProfileUser(friend), friend._instanceOrigin, 'left')}
              />
            ))}
          </ul>
        )}
      </div>
      {userMenu.dialogs}
    </SidePanel>
  );
}
