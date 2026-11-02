import {
  isGrantedSpaceBadge,
  isGrantedUserBadge,
  orderedBadges,
  type GrantedSpaceBadgeId,
  type GrantedUserBadgeId,
  type SpaceBadgeId,
  type UserBadgeId,
} from '@backspace/shared/src/badges.js';

// Reading a stored badge list (docs/systems/badges.md). Granted badges are a
// JSON array on the user or space row; anything in it the badge list does not
// know as a granted badge of that kind is left out, so a hand-edited row can
// never hand out staff or verified.

function storedIds(stored: string | null | undefined): unknown[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function grantedUserBadgesOf(stored: string | null | undefined): GrantedUserBadgeId[] {
  return orderedBadges(storedIds(stored).filter(isGrantedUserBadge));
}

export function grantedSpaceBadgesOf(stored: string | null | undefined): GrantedSpaceBadgeId[] {
  return orderedBadges(storedIds(stored).filter(isGrantedSpaceBadge));
}

/** A person's badges: staff for an instance admin, then those an admin gave. */
export function userBadgesOf(row: { isAdmin: number | null; badges: string | null; accountKind?: string | null }): UserBadgeId[] {
  const ids: UserBadgeId[] = [...grantedUserBadgesOf(row.badges)];
  if (row.isAdmin === 1) ids.push('staff');
  if (row.accountKind === 'bot') ids.push('bot');
  return orderedBadges(ids);
}

/** A space's badges: verified while the platform's verification stands, then those an admin gave. */
export function spaceBadgesOf(row: { verificationStatus: string | null; badges: string | null }): SpaceBadgeId[] {
  const ids: SpaceBadgeId[] = [...grantedSpaceBadgesOf(row.badges)];
  if (row.verificationStatus === 'verified') ids.push('verified');
  return orderedBadges(ids);
}
