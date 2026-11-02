import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';

/** The most people a group conversation has, its owner among them. */
export const GROUP_DM_MAX_MEMBERS = 10;

/**
 * The most group conversations one account is in at a time. A group's icon is a file nobody's
 * storage counts (utils/profileImageRefs.ts), so without a number of groups there would be no
 * bound on those files; a person in this many has no use for more.
 */
export const GROUP_DMS_PER_ACCOUNT = 100;

/** How many group conversations `userId` is in, hidden ones too: a hidden group still keeps its icon. */
export function groupDmCountOf(userId: string): number {
  const row = getDb().get<{ n: number }>(sql`
    SELECT count(*) AS n FROM dm_members m
    JOIN dm_channels c ON c.id = m.dm_channel_id
    WHERE m.user_id = ${userId} AND c.owner_id IS NOT NULL AND c.deleted_at IS NULL
  `);
  return row?.n ?? 0;
}

/** Whether `userId` is in as many group conversations as an account may be. */
export function groupDmLimitReached(userId: string): boolean {
  return groupDmCountOf(userId) >= GROUP_DMS_PER_ACCOUNT;
}
