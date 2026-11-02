import { RoleIcon } from '../../roles/RoleIcon';
import { OwnerTitleHeading } from './OwnerTitleHeading';
import { useMemberContextMenu } from './memberMenu/useMemberContextMenu';
import { MemberTimeoutIndicator } from './memberMenu/MemberTimeoutIndicator';
import { useContextMenuStore } from '../../stores/contextMenuStore';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemberWithUser, Activity, Role } from '@backspace/shared';
import { useFormatters } from '../../i18n/formatters';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { selectPeoplePanelOpen } from '../../stores/peoplePanel';
import { useActivityStore, activitiesFor } from '../../stores/activityStore';
import { Avatar, avatarRadius } from '../ui/Avatar';
import { ActivityCard, hasRichActivity, getActivityAccentClass } from '../ui/ActivityCard';
import { getPrimaryActivity } from '@backspace/shared/src/activities.js';
import { parseFederatedUsername, isFederationGlobeApplicable, spaceMemberName } from '../../utils/identity';
import { useSpaceOrigin } from '../../hooks/useSpaceOrigin';
import { useCanonicalUserView } from '../../utils/userViewLookup';
import { resolveAssetUrl } from '../../utils/assetUrls';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { groupMembers, memberNameStyle, memberIconRole, ownerGroupTitle, ownerHasOwnGroup, type MemberGroupKind } from '../../utils/memberGroups';
import { Icon } from '../ui/Icon';
import { SidePanel } from './SidePanel';

function MemberSidebarRow({
  member,
  isOffline,
  colorStyle,
  ownerMark,
  iconRole,
  activities,
  isRichActivity,
  accentClass,
  onClickMember,
  onContextMenuMember,
}: {
  member: MemberWithUser;
  isOffline: boolean;
  colorStyle: React.CSSProperties | undefined;
  /** The owner's crown title, when the owner is listed among the roles (null for everyone else). */
  ownerMark: string | null;
  /** The emoji of the member's top role that has one. */
  iconRole: Role | null;
  activities: Activity[];
  isRichActivity: boolean;
  accentClass: string;
  onClickMember: (e: React.MouseEvent | React.KeyboardEvent, member: MemberWithUser, user: MemberWithUser['user']) => void;
  onContextMenuMember: (e: React.MouseEvent | React.KeyboardEvent, member: MemberWithUser, user: MemberWithUser['user']) => void;
}) {
  const origin = useSpaceOrigin(member.spaceId);
  const canonical = useCanonicalUserView(member.user, origin);
  const displayName = spaceMemberName(member, canonical);

  const rowClass = isRichActivity
    ? `list-row gap-2.5 py-2 pl-1.5 pr-2 mb-px cursor-pointer rounded-l-none border-l-2 ${accentClass}`
    : 'list-row gap-2.5 px-2 py-1.5 cursor-pointer group';

  // The row is a control: Enter and Space open the profile like a click, and
  // the menu key or Shift+F10 open the member menu like a right click.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClickMember(e, member, canonical);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      onContextMenuMember(e, member, canonical);
    }
  };

  return (
    <div
      key={member.userId}
      onClick={(e) => onClickMember(e, member, canonical)}
      onContextMenu={(e) => onContextMenuMember(e, member, canonical)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-haspopup="menu"
      data-context-menu
      className={rowClass}
    >
      <Avatar
        src={(member.avatar ? resolveAssetUrl(member.avatar, origin) : null) ?? canonical.avatar}
        name={displayName}
        size={32}
        status={isOffline ? 'offline' : canonical.status}
        className={isOffline ? 'opacity-60' : undefined}
        user={canonical}
      />
      <div className="flex-1 min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          <span
            className={`text-ui leading-[1.2] font-medium truncate ${colorStyle ? (isOffline ? 'opacity-60' : '') : (isOffline ? 'text-txt-tertiary' : 'text-txt-primary')}`}
            style={colorStyle}
          >
            {displayName}
          </span>
          {ownerMark && (
            <span role="img" aria-label={ownerMark} title={ownerMark} className="inline-flex flex-shrink-0 text-accent-amber">
              <Icon name="crown" size={13} />
            </span>
          )}
          {iconRole?.icon && <RoleIcon icon={iconRole.icon} color={iconRole.color} colorSecondary={iconRole.colorSecondary} size={14} />}
          <MemberTimeoutIndicator timedOutUntil={member.timedOutUntil} />
        </div>
        {!isOffline && isFederationGlobeApplicable(canonical) && (
          <div className="truncate font-mono text-label leading-[1.3] text-txt-tertiary">@{parseFederatedUsername(canonical.username).domain}</div>
        )}
        {!isOffline && (
          <ActivityCard
            activities={activities}
            fallbackCustomStatus={canonical.customStatus}
          />
        )}
      </div>
    </div>
  );
}

export function MemberSidebar() {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatNumber } = useFormatters();
  const members = useSpaceStore((s) => s.members);
  const spaces = useSpaceStore((s) => s.spaces);
  const currentSpaceId = useSpaceStore((s) => s.currentSpaceId);
  const loadingSpaceId = useSpaceStore((s) => s.loadingSpaceId);
  const memberListOpen = useUIStore(selectPeoplePanelOpen);
  const openUserProfile = useUIStore((s) => s.openUserProfile);
  const userActivities = useActivityStore((s) => s.userActivities);

  const space = spaces.find(s => s.id === currentSpaceId);
  const ownerId = space?.ownerId;
  const memberMenu = useMemberContextMenu(space);
  const spaceOrigin = space?._instanceOrigin ?? '';

  const ownerGroup = ownerHasOwnGroup(space);
  const { groups: roleGroups, offline: offlineMembers } = useMemo(() => groupMembers(members, ownerId, ownerGroup), [members, ownerId, ownerGroup]);

  const isLoadingSpace = !!loadingSpaceId && loadingSpaceId === currentSpaceId;
  const showMemberSkeleton = useDelayedLoading(isLoadingSpace);

  if (!memberListOpen) return null;

  const getMemberColor = (member: MemberWithUser): React.CSSProperties | undefined => memberNameStyle(member, ownerId);
  // Listed among the roles, the owner is told apart by a crown, which comes
  // from owning the space, never from a role. Badges are shown on the
  // profile only (docs/systems/badges.md).
  const ownerMarkOf = (member: MemberWithUser): string | null => (
    !ownerGroup && member.userId === ownerId ? (space && ownerGroupTitle(space)) || t('spaces:members.groups.owner') : null
  );

  const handleMemberClick = (e: React.MouseEvent | React.KeyboardEvent, member: MemberWithUser, user: MemberWithUser['user']) => {
    e.stopPropagation();
    // Left-click remains profile-only, even for moderators.
    useContextMenuStore.getState().close();
    const origin = useSpaceStore.getState().spaces.find(s => s.id === member.spaceId)?._instanceOrigin ?? '';
    openUserProfile(user, origin, e.currentTarget.getBoundingClientRect(), 'left', { spaceId: member.spaceId, userId: member.userId });
  };

  const groupHeading = (kind: MemberGroupKind, label: string | null): string => {
    if (kind === 'owner') return t('spaces:members.groups.owner');
    if (kind === 'online') return t('common:states.online');
    return label ?? '';
  };

  const renderMember = (member: MemberWithUser, isOffline = false) => {
    // Roles do not depend on presence: an offline member keeps their colour,
    // dimmed with the rest of the row.
    const colorStyle = getMemberColor(member);
    const activities = activitiesFor(userActivities, member.user, spaceOrigin);
    const isRichActivity = !isOffline && hasRichActivity(activities);
    const primary = getPrimaryActivity(activities);
    const accentClass = primary ? getActivityAccentClass(primary.type) : '';
    return (
      <MemberSidebarRow
        key={member.userId}
        member={member}
        isOffline={isOffline}
        colorStyle={colorStyle}
        ownerMark={ownerMarkOf(member)}
        iconRole={memberIconRole(member)}
        activities={activities}
        isRichActivity={isRichActivity}
        accentClass={accentClass}
        onClickMember={handleMemberClick}
        onContextMenuMember={memberMenu.open}
      />
    );
  };

  return (
    <>
    {memberMenu.dialogs}
    <SidePanel>
      {showMemberSkeleton ? (
        <div className="p-3" role="status" aria-label={t('spaces:members.loading')}>
          {/* The real rows' geometry and the avatars' own corner, so nothing moves when the members arrive. */}
          {[2, 5].map((rows, group) => (
            <div key={group} className="mb-4">
              <div className="mb-1 flex h-[14px] items-center px-2">
                <div className="skeleton skeleton-bar" style={{ height: 10, width: group === 0 ? '40%' : '50%', animationDelay: `${group * 0.25}s` }} />
              </div>
              {Array.from({ length: rows }, (_, i) => {
                const delay = `${(group * 2 + i) * 0.12}s`;
                return (
                  <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
                    <div className="skeleton h-8 w-8 flex-shrink-0" style={{ borderRadius: avatarRadius(32), animationDelay: delay }} />
                    <div className="skeleton skeleton-bar" style={{ width: `${45 + ((group + i) * 19) % 30}%`, animationDelay: delay }} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
      <div className="p-3">
        {/* Role-based groups */}
        {roleGroups.map((group) => (
          <div key={group.key} className="mb-4">
            {group.kind === 'owner' && space ? (
              <OwnerTitleHeading key={space.id} space={space} count={group.members.length} />
            ) : (
              <h3 className="label-mono px-2 mb-1">
                {groupHeading(group.kind, group.label)} — {formatNumber(group.members.length)}
              </h3>
            )}
            {group.members.map((m) => renderMember(m))}
          </div>
        ))}

        {/* Offline */}
        {offlineMembers.length > 0 && (
          <div>
            <h3 className="label-mono px-2 mb-1">
              {t('common:states.offline')} — {formatNumber(offlineMembers.length)}
            </h3>
            {offlineMembers.map((m) => renderMember(m, true))}
          </div>
        )}
      </div>
      )}
    </SidePanel>
    </>
  );
}
