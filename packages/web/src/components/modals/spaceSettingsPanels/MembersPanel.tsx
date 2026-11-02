import { RoleIcon } from '../../../roles/RoleIcon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../ui/Avatar';
import { MemberRemovalDialog } from '../../layout/memberMenu/MemberRemovalDialog';
import { useSpaceStore, getApiForOrigin } from '../../../stores/spaceStore';
import { parseFederatedUsername, isFederationGlobeApplicable, userDisplayName } from '../../../utils/identity';
import { useSpaceOrigin } from '../../../hooks/useSpaceOrigin';
import { useCanonicalUserView } from '../../../utils/userViewLookup';
import { hasPermissionBit, PermissionBits, stringToPermissions } from '../../../utils/permissions';
import {
  myUserIdInSpace,
  viewerCanActOn,
  viewerCanEditMemberRoles,
  viewerCanManageRoleAt,
  viewerHoldsEveryBit,
  useViewerHeldPermissions,
} from '../../../utils/roleHierarchy';
import { useFormatters } from '../../../i18n/formatters';
import { LOCK_ICON } from '../../ui/LockNote';
import { describeError } from '../../../i18n/errors';
import { Icon } from '../../ui/Icon';
import type { MemberWithUser, Role } from '@backspace/shared';


/** Why a role checkbox is locked: the role ranks too high, or it carries bits the viewer lacks. */
type RoleLock = 'rank' | 'bits';

function MembersPanelRow({
  member,
  spaceId,
  ownerId,
  isExpanded,
  expandable,
  canKick,
  canBan,
  isSelf,
  assignableRoles,
  manageableRoleIds,
  memberRoleIds,
  savedRoleIds,
  heldPermissions,
  hasPendingChanges,
  onToggleExpand,
  onRoleToggle,
  onSaveRoles,
  onCancelRoleChange,
  onPendingAction,
}: {
  member: MemberWithUser;
  spaceId: string;
  ownerId: string | undefined;
  isExpanded: boolean;
  expandable: boolean;
  canKick: boolean;
  canBan: boolean;
  isSelf: boolean;
  assignableRoles: Role[];
  /** Roles the viewer may hand out or take back (below their own top role). */
  manageableRoleIds: Set<string>;
  memberRoleIds: Set<string>;
  /** The member's roles as the server has them; a role not among them is being given. */
  savedRoleIds: Set<string>;
  /** The viewer's bits in the space (held-bits rule); null when not loaded. */
  heldPermissions: bigint | null;
  hasPendingChanges: boolean;
  onToggleExpand: (userId: string) => void;
  onRoleToggle: (userId: string, roleId: string, currentRoleIds: Set<string>) => void;
  onSaveRoles: (userId: string) => void;
  onCancelRoleChange: (userId: string) => void;
  onPendingAction: (action: { type: 'kick' | 'ban'; userId: string; displayName: string }) => void;
}) {
  const { t } = useTranslation(['spaces', 'common']);
  const canonical = useCanonicalUserView(member.user, useSpaceOrigin(member.spaceId));
  const isOwner = member.userId === ownerId;
  const displayName = userDisplayName(canonical);

  // A role is locked when it ranks at or above the viewer (hierarchy), or when
  // giving it would hand out bits the viewer does not hold (held-bits rule).
  // Taking a role the member already has is governed by the hierarchy alone.
  const roleLocks = new Map<string, RoleLock>();
  for (const role of assignableRoles) {
    if (!manageableRoleIds.has(role.id)) roleLocks.set(role.id, 'rank');
    else if (!savedRoleIds.has(role.id) && !viewerHoldsEveryBit(heldPermissions, stringToPermissions(role.permissions))) {
      roleLocks.set(role.id, 'bits');
    }
  }
  const lockKinds = (['rank', 'bits'] as const).filter((kind) => [...roleLocks.values()].includes(kind));
  const lockReason: Record<RoleLock, string> = {
    rank: t('spaces:settings.members.rolesAboveYou'),
    bits: t('spaces:settings.members.rolesUnheld'),
  };

  return (
    <div>
      <div
        className={`flex min-h-[52px] items-center justify-between gap-3 px-3 py-2 transition-colors duration-100 ${
          expandable ? 'cursor-pointer hover:bg-interactive-hover' : ''
        } ${isExpanded ? 'bg-interactive-hover' : ''}`}
        onClick={() => {
          if (expandable) onToggleExpand(member.userId);
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Avatar
            src={canonical.avatar}
            name={displayName}
            size={32}
            status={canonical.status}
            user={canonical}
          />
          <div className="min-w-0">
            <div className="text-ui font-medium text-txt-primary truncate">
              {displayName}
              {isFederationGlobeApplicable(canonical) && (
                <span className="ml-1 text-2xs text-txt-tertiary opacity-60">@{parseFederatedUsername(canonical.username).domain}</span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1 flex-wrap">
              {/* The owner's mark comes from owning the space, never from a role. */}
              {isOwner && (
                <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-px rounded bg-accent-amber/10 text-accent-amber font-medium">
                  <Icon name="crown" size={10} />
                  {t('spaces:settings.members.owner')}
                </span>
              )}
              {member.roles?.filter((r) => r.id !== spaceId).map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 text-2xs px-1.5 py-px rounded font-medium"
                  style={{ backgroundColor: `${r.color}20`, color: r.color }}
                >
                  {r.icon && <RoleIcon icon={r.icon} color={r.color} colorSecondary={r.colorSecondary} size={11} />}
                  {r.name}
                </span>
              ))}
              {!isOwner && (!member.roles || member.roles.filter((r) => r.id !== spaceId).length === 0) && (
                <span className="text-2xs text-txt-tertiary">{t('spaces:settings.members.noRoles')}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {canBan && !isSelf && !isOwner && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPendingAction({ type: 'ban', userId: member.userId, displayName }); }}
              className="btn-quiet btn-sm hover:bg-accent-rose/10 hover:text-txt-danger"
            >
              {t('spaces:settings.members.ban')}
            </button>
          )}
          {canKick && !isSelf && !isOwner && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPendingAction({ type: 'kick', userId: member.userId, displayName }); }}
              className="btn-quiet btn-sm hover:bg-accent-rose/10 hover:text-txt-danger"
            >
              {t('spaces:settings.members.kick')}
            </button>
          )}
          {expandable && (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-label={displayName}
              onClick={(e) => { e.stopPropagation(); onToggleExpand(member.userId); }}
              className="icon-btn"
            >
              <svg
                className={`w-4 h-4 transition-transform duration-100 ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Role checkboxes — only shown when expanded */}
      {isExpanded && expandable && (
        <div className="space-y-1.5 border-t border-border-hard py-2.5 pl-[56px] pr-3">
          {assignableRoles.map((role) => {
            const lock = roleLocks.get(role.id);
            const manageable = lock === undefined;
            return (
              <label
                key={role.id}
                title={lock ? lockReason[lock] : undefined}
                className={`flex items-center gap-2 group/role ${manageable ? 'cursor-pointer' : 'cursor-default opacity-50'}`}
              >
                <input
                  type="checkbox"
                  checked={memberRoleIds.has(role.id)}
                  disabled={!manageable}
                  onChange={() => onRoleToggle(member.userId, role.id, memberRoleIds)}
                />
                <span
                  className="text-ui font-medium"
                  style={{ color: role.color !== '#9ca3af' ? role.color : undefined }}
                >
                  {role.name}
                </span>
              </label>
            );
          })}
          {lockKinds.length > 0 && (
            <div className="flex items-start gap-2 pt-1 text-meta leading-snug text-txt-tertiary">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="flex-shrink-0 mt-[2px]">
                <path d={LOCK_ICON} />
              </svg>
              <span>
                {lockKinds.map((kind) => <span key={kind} className="block">{lockReason[kind]}</span>)}
              </span>
            </div>
          )}
          {hasPendingChanges && (
            <div className="flex items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => onSaveRoles(member.userId)}
                className="btn-primary btn-sm"
              >
                {t('common:actions.save')}
              </button>
              <button
                type="button"
                onClick={() => onCancelRoleChange(member.userId)}
                className="btn-quiet btn-sm"
              >
                {t('common:actions.cancel')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The role filter's value for members who hold no role besides @everyone. */
const NO_ROLE = '__none__';

interface MembersPanelProps {
  spaceId: string;
}

export function MembersPanel({ spaceId }: MembersPanelProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const f = useFormatters();
  const spaces = useSpaceStore((s) => s.spaces);
  const members = useSpaceStore((s) => s.members);
  const roles = useSpaceStore((s) => s.roles);
  const loadSpaceDetail = useSpaceStore((s) => s.loadSpaceDetail);
  const setMembers = useSpaceStore((s) => s.setMembers);
  const spacePermissions = useSpaceStore((s) => s.spacePermissions);
  const heldPermissions = useViewerHeldPermissions(spaceId);

  const space = spaces.find((s) => s.id === spaceId);
  const spaceApi = getApiForOrigin(space?._instanceOrigin ?? '');
  const myPerms = spacePermissions.get(spaceId);
  const canKick = hasPermissionBit(myPerms, PermissionBits.KICK_MEMBERS);
  const canBan = hasPermissionBit(myPerms, PermissionBits.BAN_MEMBERS);

  const [pendingRoleChanges, setPendingRoleChanges] = useState<Map<string, Set<string>>>(new Map());
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<{ type: 'kick' | 'ban'; userId: string; displayName: string } | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // Assignable roles: exclude @everyone (where role.id === spaceId)
  const assignableRoles = roles.filter((r) => r.id !== spaceId);

  if (!space) return null;

  // Role hierarchy (permissions.md): the viewer moderates members ranked below
  // them and hands out roles below their own top role. Ids are the viewer's
  // and the members' ids on the space's instance.
  const myUserId = myUserIdInSpace(space);
  const manageableRoleIds = new Set(
    assignableRoles.filter((r) => viewerCanManageRoleAt(space, members, r.position)).map((r) => r.id),
  );

  const getMemberRoleIds = (member: MemberWithUser): Set<string> => {
    const pending = pendingRoleChanges.get(member.userId);
    if (pending) return pending;
    return new Set(member.roles?.map((r) => r.id) ?? []);
  };

  const handleRoleToggle = (userId: string, roleId: string, currentRoleIds: Set<string>) => {
    const updated = new Set(currentRoleIds);
    if (updated.has(roleId)) {
      updated.delete(roleId);
    } else {
      updated.add(roleId);
    }
    setPendingRoleChanges((prev) => new Map(prev).set(userId, updated));
  };

  const handleSaveRoles = async (userId: string) => {
    const roleIds = pendingRoleChanges.get(userId);
    if (!roleIds) return;
    try {
      const updated = await spaceApi.spaces.updateMember(spaceId, userId, { roleIds: Array.from(roleIds) });
      // The row shows the saved roles at once; space_access_changed
      // refreshes the rest of the space for every member.
      setMembers(useSpaceStore.getState().members.map((m) => (m.userId === userId ? { ...m, roles: updated.roles } : m)));
      setPendingRoleChanges((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
      setExpandedMemberId(null);
    } catch (err) {
      setError(describeError(err));
    }
  };

  // The list narrowed to a role (or to members without one) and a name. A role
  // deleted while it is chosen stops filtering.
  const activeRoleFilter = roleFilter === NO_ROLE || assignableRoles.some((r) => r.id === roleFilter) ? roleFilter : '';
  const needle = query.trim().toLowerCase();
  const shownMembers = members.filter((member) => {
    const own = member.roles?.filter((r) => r.id !== spaceId) ?? [];
    if (activeRoleFilter === NO_ROLE ? own.length > 0 : activeRoleFilter !== '' && !own.some((r) => r.id === activeRoleFilter)) return false;
    if (!needle) return true;
    return [member.nickname, member.user.displayName, member.user.username]
      .some((name) => !!name && name.toLowerCase().includes(needle));
  });
  const filtering = activeRoleFilter !== '' || needle !== '';

  const handleCancelRoleChange = (userId: string) => {
    setPendingRoleChanges((prev) => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  };



  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">{t('common:labels.members')}</h2>
        <p className="mt-1 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.members.description')}</p>
      </div>
      {error && (
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>
      )}

      <div>
        <div className="label-mono mb-1.5">
          {filtering
            ? t('spaces:settings.members.listHeadingFiltered', { shown: f.formatNumber(shownMembers.length), total: f.formatNumber(members.length) })
            : t('spaces:settings.members.listHeading', { total: f.formatNumber(members.length) })}
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('spaces:settings.members.searchPlaceholder')}
            aria-label={t('spaces:settings.members.searchPlaceholder')}
            className="input-search h-8 min-w-0 flex-1 py-0 text-ui"
          />
          <select
            value={activeRoleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label={t('spaces:settings.members.filterRole')}
            className="input-search h-8 max-w-[45%] py-0 text-ui"
          >
            <option value="">{t('spaces:settings.members.filterAll')}</option>
            {[...assignableRoles].sort((a, b) => b.position - a.position).map((role) => (
              <option key={role.id} value={role.id}>{role.name}</option>
            ))}
            <option value={NO_ROLE}>{t('spaces:settings.members.noRoles')}</option>
          </select>
        </div>
        <div className="surface-card overflow-hidden rounded-lg">
          {shownMembers.length === 0 && (
            <div className="empty-state">
              <p className="empty-state-body">{t('spaces:settings.members.noMatch')}</p>
            </div>
          )}
          <div className="divide-y divide-border-hard">
            {shownMembers.map((member) => (
              <MembersPanelRow
                key={member.userId}
                member={member}
                spaceId={spaceId}
                ownerId={space.ownerId}
                isExpanded={expandedMemberId === member.userId}
                expandable={viewerCanEditMemberRoles(space, members, roles, myPerms, member)}
                canKick={canKick && viewerCanActOn(space, members, member)}
                canBan={canBan && viewerCanActOn(space, members, member)}
                isSelf={member.userId === myUserId}
                assignableRoles={assignableRoles}
                manageableRoleIds={manageableRoleIds}
                memberRoleIds={getMemberRoleIds(member)}
                savedRoleIds={new Set(member.roles?.map((r) => r.id) ?? [])}
                heldPermissions={heldPermissions}
                hasPendingChanges={pendingRoleChanges.has(member.userId)}
                onToggleExpand={(uid) => setExpandedMemberId(expandedMemberId === uid ? null : uid)}
                onRoleToggle={handleRoleToggle}
                onSaveRoles={handleSaveRoles}
                onCancelRoleChange={handleCancelRoleChange}
                onPendingAction={setPendingAction}
              />
            ))}
          </div>
        </div>
      </div>

      {pendingAction && (
        <MemberRemovalDialog
          target={{ origin: space._instanceOrigin ?? '', spaceId, userId: pendingAction.userId }}
          action={pendingAction.type}
          name={pendingAction.displayName}
          onClose={() => setPendingAction(null)}
          onDone={() => { void loadSpaceDetail(spaceId); }}
        />
      )}
    </div>
  );
}
