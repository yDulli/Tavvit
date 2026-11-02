import type { CSSProperties } from 'react';
import type { MemberWithUser, Role, Space } from '@backspace/shared';
import { roleTextStyle } from './roleStyle';

// How a space's member list groups and colours its members, in one place for
// every surface that shows them: the desktop member list, the phone members
// screen and the author name on a space message.
//
// A member's top role is their role with the highest position (their rank,
// docs/systems/permissions.md, "Role hierarchy"). Their name takes its colour;
// the owner without a role is rose; anyone else without a role has no colour
// of their own and the surface's text colour applies.

/** The colour of the owner's name when they hold no role. */
export const OWNER_NAME_COLOR = 'rgb(var(--accent-rose))';

/** The member's top role, or undefined without one. @everyone is never among a member's roles. */
export function memberTopRole(member: Pick<MemberWithUser, 'roles'>): Role | undefined {
  let top: Role | undefined;
  for (const role of member.roles ?? []) {
    if (!top || role.position > top.position) top = role;
  }
  return top;
}

/** The colour of the member's name, or undefined for the surface's own text colour. */
export function memberNameColor(member: Pick<MemberWithUser, 'userId' | 'roles'>, ownerId: string | undefined): string | undefined {
  const top = memberTopRole(member);
  if (top) return top.color;
  return ownerId !== undefined && member.userId === ownerId ? OWNER_NAME_COLOR : undefined;
}

/**
 * The style of the member's name: their top role's colour or gradient
 * (`roleTextStyle`), the owner's rose without a role, else undefined for
 * the surface's own text colour.
 */
export function memberNameStyle(member: Pick<MemberWithUser, 'userId' | 'roles'>, ownerId: string | undefined): CSSProperties | undefined {
  const top = memberTopRole(member);
  if (top) return roleTextStyle(top);
  return ownerId !== undefined && member.userId === ownerId ? { color: OWNER_NAME_COLOR } : undefined;
}

/** The member's top role that has an icon, for beside their name: the icon wears that role's colour. */
export function memberIconRole(member: Pick<MemberWithUser, 'roles'>): Role | null {
  let top: Role | undefined;
  for (const role of member.roles ?? []) {
    if (role.icon && (!top || role.position > top.position)) top = role;
  }
  return top ?? null;
}

/**
 * Whether the member list shows the owner in a group of their own
 * (`Space.ownerGroup`). A host that predates the choice always did.
 */
export function ownerHasOwnGroup(space: Pick<Space, 'ownerGroup'> | undefined): boolean {
  return space?.ownerGroup !== false;
}

/**
 * The owner group's heading as the space's host stores it: the owner title,
 * or null for the translated default ("Owner"). It labels the group, never the
 * owner's name: the owner's row, messages and profile show their nickname or
 * account name like anyone else's (`spaceMemberName`). Every surface that
 * shows the heading reads it here.
 */
export function ownerGroupTitle(space: { ownerTitle?: string | null }): string | null {
  return typeof space.ownerTitle === 'string' ? space.ownerTitle : null;
}

/**
 * Whether the space's host keeps owner titles. A host on 1.10.0 or older does
 * not send `ownerTitle` and ignores it in a PATCH, so a title written there
 * would be dropped without an error.
 */
export function hostKeepsOwnerTitle(space: { ownerTitle?: string | null }): boolean {
  return space.ownerTitle !== undefined;
}

/**
 * Which heading a member is listed under: the owner first (when the space
 * lists them apart), then one group per top shown role (`Role.hoist`),
 * highest first, then everyone online without one.
 */
export type MemberGroupKind = 'owner' | 'role' | 'online';

export interface MemberGroup {
  key: string;
  kind: MemberGroupKind;
  /** The role name for `kind: 'role'`; null for the translated headings. */
  label: string | null;
  /** Orders the groups: higher first. */
  position: number;
}

/** The member's highest role that is shown apart in the member list (`Role.hoist`, on by default). */
export function memberTopShownRole(member: Pick<MemberWithUser, 'roles'>): Role | undefined {
  let top: Role | undefined;
  for (const role of member.roles ?? []) {
    if (role.hoist === false) continue;
    if (!top || role.position > top.position) top = role;
  }
  return top;
}

/** The group `member` is listed under; `ownerGroup` is `ownerHasOwnGroup` of the space. */
export function memberGroup(member: MemberWithUser, ownerId: string | undefined, ownerGroup = true): MemberGroup {
  if (ownerGroup && ownerId !== undefined && member.userId === ownerId) {
    return { key: '__owner__', kind: 'owner', label: null, position: Infinity };
  }
  const top = memberTopShownRole(member);
  if (top) return { key: top.id, kind: 'role', label: top.name.toUpperCase(), position: top.position };
  return { key: '__online__', kind: 'online', label: null, position: -1 };
}

/**
 * The online members grouped by `memberGroup`, groups highest first, and the
 * offline members as one list (roles do not group them).
 */
export function groupMembers(
  members: readonly MemberWithUser[],
  ownerId: string | undefined,
  ownerGroup = true,
): { groups: (MemberGroup & { members: MemberWithUser[] })[]; offline: MemberWithUser[] } {
  const byKey = new Map<string, MemberGroup & { members: MemberWithUser[] }>();
  const offline: MemberWithUser[] = [];
  for (const member of members) {
    if (member.user.status === 'offline') {
      offline.push(member);
      continue;
    }
    const group = memberGroup(member, ownerId, ownerGroup);
    const entry = byKey.get(group.key) ?? { ...group, members: [] };
    entry.members.push(member);
    byKey.set(group.key, entry);
  }
  return { groups: [...byKey.values()].sort((a, b) => b.position - a.position), offline };
}
