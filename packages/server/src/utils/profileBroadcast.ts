import type { users } from '../db/schema.js';
import { connectionManager } from '../ws/handler.js';
import { sanitizeUser } from './sanitize.js';
import { collectProfileBroadcastTargetIds } from './userDeletion.js';

type UserRow = typeof users.$inferSelect;

/**
 * The new look of a profile for everyone who can see it, and for the person's
 * own windows. The account's own fields (when its status ends, its activity
 * switch, its federation state) are its owner's business: everyone else gets
 * the public view. Used by every route that changes what a profile shows
 * (routes/users.ts, utils/linkedAccounts.ts).
 */
export function announceProfileChange(user: UserRow): void {
  const own = { type: 'user_updated' as const, user: sanitizeUser(user, true) };
  const others = { type: 'user_updated' as const, user: sanitizeUser(user) };
  const targetUserIds = collectProfileBroadcastTargetIds(user.id);
  targetUserIds.add(user.id); // Include self (for other tabs/connections)
  for (const uid of targetUserIds) {
    connectionManager.sendToUser(uid, uid === user.id ? own : others);
  }
}
