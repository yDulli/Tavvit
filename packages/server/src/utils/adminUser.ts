import type { AdminUser } from '@backspace/shared';
import type { schema } from '../db/index.js';
import { grantedUserBadgesOf } from './badges.js';
import { activeSuspension } from './suspension.js';

type UserRow = typeof schema.users.$inferSelect;

/**
 * A copy of someone whose home instance still answers for their profile: it shows what that
 * instance sends, and the next update from there writes over anything changed here. A copy whose
 * home is gone (`federation_home_orphaned`) is this instance's to keep, as its own accounts are.
 */
export function profileKeptByHome(row: Pick<UserRow, 'homeInstance' | 'federationHomeOrphaned'>): boolean {
  return !!row.homeInstance && row.federationHomeOrphaned !== 1;
}

/** An account as the admin area lists it: with the suspension standing now and the badges an admin gave it. */
export function toAdminUser(row: UserRow, now: number = Date.now()): AdminUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatar: row.avatar,
    avatarColor: row.avatarColor,
    status: row.status ?? 'offline',
    isAdmin: row.isAdmin === 1,
    isDeleted: row.isDeleted === 1,
    homeInstance: row.homeInstance,
    profileKeptByHome: profileKeptByHome(row),
    createdAt: row.createdAt,
    suspension: activeSuspension(row, now),
    grantedBadges: grantedUserBadgesOf(row.badges),
  };
}
