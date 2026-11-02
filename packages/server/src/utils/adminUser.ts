import type { AdminUser } from '@backspace/shared';
import type { schema } from '../db/index.js';
import { grantedUserBadgesOf } from './badges.js';
import { activeSuspension } from './suspension.js';

/** An account as the admin area lists it: with the suspension standing now and the badges an admin gave it. */
export function toAdminUser(row: typeof schema.users.$inferSelect, now: number = Date.now()): AdminUser {
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
    createdAt: row.createdAt,
    suspension: activeSuspension(row, now),
    grantedBadges: grantedUserBadgesOf(row.badges),
  };
}
