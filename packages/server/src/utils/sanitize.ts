import { DEFAULT_DM_POLICY, DEFAULT_FRIEND_REQUEST_POLICY } from '@backspace/shared';
import { isDmPolicy, isFriendRequestPolicy } from './contactPolicy.js';
import { isAvatarColor, isProfileLayout, type User } from '@backspace/shared';
import { parseStoredProfileLinks, withoutUnsafeCharacters } from '@backspace/shared/src/profileFields.js';
import { users } from '../db/schema.js';
import { userBadgesOf } from './badges.js';
import { needsVerifiedEmail } from '../email/gate.js';
import { shownAccountPicture } from './remoteMedia.js';
import { storedReplicatedInstances } from './replicatedInstances.js';

/**
 * What anyone may see of an account comes from these columns and no others. A query that lists many
 * people reads only these: in a large space that is most of what `ready` costs, and a password hash
 * has no business being read for it.
 */
export const PUBLIC_USER_COLUMNS = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatar: users.avatar,
  banner: users.banner,
  accentColor: users.accentColor,
  accentColorSecondary: users.accentColorSecondary,
  avatarColor: users.avatarColor,
  bio: users.bio,
  pronouns: users.pronouns,
  profileLinks: users.profileLinks,
  profileLayout: users.profileLayout,
  badges: users.badges,
  status: users.status,
  customStatus: users.customStatus,
  isAdmin: users.isAdmin,
  isDeleted: users.isDeleted,
  profileUpdatedAt: users.profileUpdatedAt,
  createdAt: users.createdAt,
  homeInstance: users.homeInstance,
  homeUserId: users.homeUserId,
  accountKind: users.accountKind,
  /** Not shown: it decides which home's pictures are trusted (`shownAccountPicture`). */
  federationHomeOrphaned: users.federationHomeOrphaned,
} as const;

export type PublicUserRow = Pick<typeof users.$inferSelect, keyof typeof PUBLIC_USER_COLUMNS>;

/** An account as anyone else sees it. */
export function publicUserOf(row: PublicUserRow): User {
  // Tombstoned (deleted) users — return anonymized profile
  if (row.isDeleted === 1) {
    return {
      id: row.id,
      username: 'Deleted User',
      displayName: null,
      avatar: null,
      banner: null,
      accentColor: null,
      accentColorSecondary: null,
      avatarColor: null,
      bio: null,
      pronouns: null,
      profileLinks: [],
      profileLayout: null,
      badges: [],
      status: 'offline',
      customStatus: null,
      isAdmin: false,
      isDeleted: true,
      profileUpdatedAt: 0,
      createdAt: row.createdAt,
      homeInstance: null,
      homeUserId: null,
    };
  }

  // Everyone who sees the account fetches its pictures by themselves: an address stored before
  // that was checked, on a server neither this one nor the account's home, is shown as none. A
  // detached account has no home any more: its former domain may belong to someone else now.
  const pictureHome = row.federationHomeOrphaned === 1 ? null : row.homeInstance;
  return {
    id: row.id,
    username: row.username,
    // Shown as the characters they are: a name or status stored before such characters were
    // refused, or sent by another instance, loses the ones that would disguise it.
    displayName: row.displayName === null ? null : withoutUnsafeCharacters(row.displayName),
    avatar: shownAccountPicture(row.avatar, pictureHome),
    banner: shownAccountPicture(row.banner, pictureHome),
    accentColor: row.accentColor ?? null,
    accentColorSecondary: row.accentColorSecondary ?? null,
    avatarColor: isAvatarColor(row.avatarColor) ? row.avatarColor : null,
    bio: row.bio ?? null,
    pronouns: row.pronouns ?? null,
    profileLinks: parseStoredProfileLinks(row.profileLinks),
    profileLayout: isProfileLayout(row.profileLayout) ? row.profileLayout : null,
    badges: userBadgesOf(row),
    status: (row.status ?? 'offline') as User['status'],
    customStatus: row.customStatus === null ? null : withoutUnsafeCharacters(row.customStatus),
    isAdmin: row.isAdmin === 1,
    profileUpdatedAt: row.profileUpdatedAt ?? 0,
    createdAt: row.createdAt,
    homeInstance: row.homeInstance ?? null,
    homeUserId: row.homeUserId ?? null,
    ...(row.accountKind !== 'person' ? { accountKind: row.accountKind } : {}),
  };
}

export function sanitizeUser(row: typeof users.$inferSelect, isSelf = false): User {
  const user = publicUserOf(row);
  if (!isSelf) return user;
  if (row.isDeleted === 1) return { ...user, showActivity: false };
  return {
    ...user,
    showActivity: row.showActivity !== 0,
    dmPolicy: isDmPolicy(row.dmPolicy) ? row.dmPolicy : DEFAULT_DM_POLICY,
    friendRequestPolicy: isFriendRequestPolicy(row.friendRequestPolicy) ? row.friendRequestPolicy : DEFAULT_FRIEND_REQUEST_POLICY,
    termsVersion: row.termsVersion ?? null,
    customStatusExpiresAt: row.customStatusExpiresAt ?? null,
    email: row.email ?? null,
    emailVerified: row.emailVerifiedAt != null,
    twoFactorEnabled: row.twoFactorEnabledAt != null,
    usernameChangedAt: row.usernameChangedAt ?? null,
    pendingEmail: row.pendingEmail ?? null,
    emailVerificationRequired: needsVerifiedEmail(row),
    locale: row.locale ?? null,
    federationHomeOrphaned: row.federationHomeOrphaned === 1,
    detachedHomeInstance: row.detachedHomeInstance ?? null,
    replicatedInstances: storedReplicatedInstances(row.replicatedInstances),
  };
}
