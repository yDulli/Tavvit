import { useTranslation } from 'react-i18next';
import type { DmChannel, User } from '@backspace/shared';
import { Avatar } from '../ui/Avatar';
import { AvatarStack } from '../ui/AvatarStack';
import { Tooltip } from '../ui/Tooltip';
import { Icon } from '../ui/Icon';
import { isMine, isFederationGlobeApplicable, userDisplayName } from '../../utils/identity';
import { useDmViewer } from '../../hooks/useDmViewer';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { formatDmTimestamp, formatDmSidebarPreview, formatDmHeaderName } from '../../utils/dmFormatters';
import { getRejectedPeerOrigins, getAwaitingApprovalPeerOrigins } from '../../hooks/useWebSocket';
import { DmRowUnreadBadge } from './DmUnreadBadge';

function isMemberUnreachable(homeInstance: string | null | undefined): boolean {
  if (!homeInstance) return false;
  const normalized = homeInstance.startsWith('http') ? homeInstance : `https://${homeInstance}`;
  return getRejectedPeerOrigins().has(normalized);
}

function isMemberAwaitingApproval(homeInstance: string | null | undefined): boolean {
  if (!homeInstance) return false;
  const normalized = homeInstance.startsWith('http') ? homeInstance : `https://${homeInstance}`;
  return getAwaitingApprovalPeerOrigins().has(normalized);
}

interface DmListItemProps {
  dm: DmChannel;
  isActive: boolean;
  isUnread: boolean;
  user: User;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onLeave: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
}

/**
 * One conversation in the DM list: a 44px navigation row with the partner's
 * avatar (presence on its corner) or the group's, the name, the last message
 * and when it was sent, and the unread count. The open conversation carries
 * the selected mark (`data-active`), an unread one is drawn brighter
 * (`data-unread`). The close (or, for a group, leave) button takes the place
 * of the time while the pointer or focus is on the row, and stays on the open
 * one.
 */
export function DmListItem({ dm, isActive, isUnread, user, onSelect, onClose, onLeave, onContextMenu }: DmListItemProps) {
  const { t } = useTranslation('dm');
  const viewer = useDmViewer(dm.id);
  const otherMembers = dm.members.filter(m => !isMine(m, viewer.origin, viewer.self));
  const isGroup = !!dm.ownerId;

  // Route the 1-on-1 partner through the canonical view cache. The hook runs
  // on every render, with the signed-in user standing in for a group, so a
  // conversation that changes shape never changes the hook count. Group member
  // avatars are canonicalised per slot inside AvatarStack.
  const rawFirstOther = isGroup ? null : (otherMembers[0] ?? null);
  const firstOtherCanonical = useCanonicalUserView(rawFirstOther ?? user, viewer.origin);
  if (otherMembers.length === 0 && !isGroup) return null;
  const firstOther = rawFirstOther ? firstOtherCanonical : null;

  // Groups → `formatDmHeaderName` (honors `dm.name`, falls back to joined
  // names — same path used by the chat header, welcome hero, and mobile).
  // 1-on-1 keeps the canonical-view name so replicated aliases stay correct.
  const displayName = isGroup
    ? formatDmHeaderName(dm, viewer)
    : firstOther ? userDisplayName(firstOther) : '';

  // Group globe: at least one member is federated → render once with comma-joined tooltip.
  const groupFederatedMembers = isGroup
    ? dm.members.filter(m => isFederationGlobeApplicable(m))
    : [];
  const showGroupGlobe = isGroup && groupFederatedMembers.length > 0;
  const unreachable = !!firstOther && isMemberUnreachable(firstOther.homeInstance);
  const awaitingApproval = !!firstOther && !unreachable && isMemberAwaitingApproval(firstOther.homeInstance);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isGroup) {
      onLeave(dm.id);
    } else {
      onClose(dm.id);
    }
  };

  // formatDmSidebarPreview handles user/system messages and applies the
  // sender prefix for group user-messages; an empty group says how many it has.
  const preview = formatDmSidebarPreview(dm, viewer);
  const previewText = preview ?? (isGroup ? t('groupInfo.memberCount', { count: dm.members.length }) : null);
  const lit = isActive || isUnread;
  const closeLabel = isGroup ? t('list.leaveGroup') : t('list.close');
  // The close button sits over the time: the time steps aside whenever it shows.
  const timeHidden = isActive ? 'invisible' : 'group-hover:invisible group-focus-within:invisible';
  const fedBadgeClass = `flex-shrink-0 ${lit ? 'text-txt-secondary' : 'text-txt-tertiary'}`;

  return (
    <div className="group relative" onContextMenu={onContextMenu ? (e) => onContextMenu(e, dm.id) : undefined}>
      <button
        type="button"
        onClick={() => onSelect(dm.id)}
        data-active={isActive ? 'true' : undefined}
        data-unread={isUnread ? 'true' : undefined}
        aria-current={isActive ? 'page' : undefined}
        className="nav-item h-11 w-full text-left"
      >
        {isGroup ? (
          <AvatarStack members={otherMembers} origin={viewer.origin} size={32} border="channel" iconUrl={dm.icon} />
        ) : (
          <Avatar src={firstOther?.avatar} name={displayName} size={32} status={firstOther?.status} userId={firstOther?.homeUserId ?? firstOther?.id} user={firstOther ?? undefined} />
        )}

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1">
            <span className={`min-w-0 truncate text-ui leading-[18px] ${lit ? 'font-semibold text-txt-primary' : 'font-medium'}`}>
              {displayName}
            </span>
            {showGroupGlobe && (
              <Tooltip content={groupFederatedMembers.map(m => m.username).join(', ')} position="top">
                <Icon name="globe" size={12} className={fedBadgeClass} />
              </Tooltip>
            )}
            {!isGroup && firstOther && isFederationGlobeApplicable(firstOther) && (
              <Tooltip content={firstOther.username} position="top">
                <Icon name="globe" size={12} className={fedBadgeClass} />
              </Tooltip>
            )}
            {unreachable && (
              <Tooltip content={t('list.peerRejected')} position="top">
                <Icon name="alert" size={12} strokeWidth={2} className="flex-shrink-0 text-txt-danger" />
              </Tooltip>
            )}
            {awaitingApproval && (
              <Tooltip content={t('list.peerAwaiting')} position="top">
                <Icon name="hourglass" size={12} strokeWidth={2} className="flex-shrink-0 text-txt-warning" />
              </Tooltip>
            )}
            {dm.lastMessage && (
              <span className={`ml-auto flex-shrink-0 pl-1.5 font-mono text-label font-normal tabular ${isUnread ? 'text-txt-secondary' : 'text-txt-tertiary'} ${timeHidden}`}>
                {formatDmTimestamp(dm.lastMessage.createdAt)}
              </span>
            )}
          </span>
          {(previewText || isUnread) && (
            <span className="mt-px flex min-w-0 items-center gap-1.5">
              <span className={`min-w-0 flex-1 truncate text-meta font-normal leading-4 ${lit ? 'text-txt-secondary' : 'text-txt-tertiary'}`}>
                {previewText ?? ''}
              </span>
              {isUnread && <DmRowUnreadBadge dmId={dm.id} />}
            </span>
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={handleClose}
        aria-label={closeLabel}
        className={`icon-btn absolute right-1.5 top-1 h-5 w-5 transition-opacity ${
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
        }`}
      >
        <Icon name="x" size={12} strokeWidth={2.2} />
      </button>
    </div>
  );
}
