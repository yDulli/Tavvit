import { useMemo, type CSSProperties } from 'react';
import type { MemberWithUser, Role, User } from '@backspace/shared';
import { orderedBadges, type BadgeId } from '@backspace/shared/src/badges';
import { memberBadgeIds } from '../badges/BadgeList';
import { useSpaceStore } from '../stores/spaceStore';
import type { ProfileMemberContext } from '../stores/uiStore';
import { resolveAssetUrl } from '../utils/assetUrls';
import { memberNameStyle, ownerGroupTitle } from '../utils/memberGroups';

/**
 * The space member a profile was opened for, read from the loaded space.
 *
 * `member.userId` is the id on the space's own instance, which is also the id
 * the loaded member list carries, so the match is exact for local and
 * federated members alike. The member list only ever holds the current space,
 * so a context naming any other space resolves to nothing rather than to a
 * look-alike from the wrong space.
 */
export function useProfileMember(member: ProfileMemberContext | null | undefined): MemberWithUser | undefined {
  return useSpaceStore((s) =>
    member && s.currentSpaceId === member.spaceId
      ? s.members.find((m) => m.userId === member.userId)
      : undefined,
  );
}

/**
 * Non-reactive read of the same member and the origin of the space it belongs
 * to, for code that runs once when a profile opens.
 */
export function getProfileMember(
  member: ProfileMemberContext,
): { row: MemberWithUser; origin: string } | undefined {
  const state = useSpaceStore.getState();
  if (state.currentSpaceId !== member.spaceId) return undefined;
  const row = state.members.find((m) => m.userId === member.userId);
  if (!row) return undefined;
  const origin = state.spaces.find((sp) => sp.id === member.spaceId)?._instanceOrigin ?? '';
  return { row, origin };
}

/**
 * The roles a profile shows for a space member: every assigned role except
 * @everyone (whose id is the space id), highest position first. Presence plays
 * no part; the roles are the member's whether they are connected or not.
 */
export function useProfileMemberRoles(member: ProfileMemberContext | null | undefined): Role[] {
  const row = useProfileMember(member);
  return useMemo(
    () => (row?.roles ?? [])
      .filter((r) => r.id !== row?.spaceId)
      .sort((a, b) => b.position - a.position),
    [row],
  );
}

/**
 * The badges a profile shows (docs/systems/badges.md). Opened for a space
 * member: their own badges, the staff badges their roles give them there and
 * the owner's crown, from the space's owner id, named with the owner title.
 * Opened anywhere else: the person's own badges.
 */
export function useProfileBadges(
  user: Pick<User, 'badges'>,
  member: ProfileMemberContext | null | undefined,
): { badges: BadgeId[]; ownerTitle: string | null } {
  const row = useProfileMember(member);
  const space = useSpaceStore((s) => (member ? s.spaces.find((sp) => sp.id === member.spaceId) : undefined));
  return useMemo(() => {
    if (row && space) return { badges: memberBadgeIds(row, space), ownerTitle: ownerGroupTitle(space) };
    return { badges: orderedBadges(user.badges ?? []), ownerTitle: null };
  }, [row, space, user.badges]);
}

/**
 * How a space member's name looks on their profile: the colour or gradient
 * of their top role, as the member list and the chat draw it
 * (utils/memberGroups.ts, `memberNameStyle`), the owner's rose without one.
 * Undefined outside a space and for anyone else without a role, so the
 * profile's own text colour stays.
 */
export function useProfileNameStyle(member: ProfileMemberContext | null | undefined): CSSProperties | undefined {
  const row = useProfileMember(member);
  const ownerId = useSpaceStore((s) => (member ? s.spaces.find((sp) => sp.id === member.spaceId)?.ownerId : undefined));
  return useMemo(() => (row ? memberNameStyle(row, ownerId) : undefined), [row, ownerId]);
}

/** What a member set for one space in place of their account's profile. */
export interface SpaceProfileView {
  /** The space's picture, as an address the page can load; null shows the account's. */
  avatar: string | null;
  banner: string | null;
  bio: string | null;
}

/**
 * The space profile of the member a profile was opened for (spaces.md, "Space
 * profiles"). Its pictures are files on the space's instance, resolved here
 * against that instance; every field left empty falls back to the account.
 */
export function useSpaceProfile(member: ProfileMemberContext | null | undefined): SpaceProfileView {
  const row = useProfileMember(member);
  const origin = useSpaceStore((s) => (member ? s.spaces.find((sp) => sp.id === member.spaceId)?._instanceOrigin ?? '' : ''));
  const avatar = row?.avatar ?? null;
  const banner = row?.banner ?? null;
  const bio = row?.bio ?? null;
  return useMemo(() => ({
    avatar: avatar ? resolveAssetUrl(avatar, origin) ?? null : null,
    banner: banner ? resolveAssetUrl(banner, origin) ?? null : null,
    bio,
  }), [avatar, banner, bio, origin]);
}
