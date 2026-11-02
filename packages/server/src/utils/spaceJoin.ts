import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { isBanned, isMember } from './permissions.js';
import { restoreHeldTimeout } from './spaceModeration.js';
import { memberToWire } from './spaceWire.js';

/**
 * Makes someone a member of a public space and tells the others: what joining a public
 * space is, whoever asks for it. The caller has checked that it may happen.
 */
export function addPublicMember(spaceId: string, userId: string, now: number = Date.now()): void {
  const db = getDb();
  db.insert(schema.spaceMembers).values({ spaceId, userId, joinedAt: now }).run();
  // A timeout they left the space under comes back with them.
  const timedOutUntil = restoreHeldTimeout(spaceId, userId, now);

  connectionManager.addUserSpace(userId, spaceId);

  const joiningUser = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (joiningUser) {
    connectionManager.sendToSpace(spaceId, {
      type: 'member_joined',
      spaceId,
      member: memberToWire(
        { spaceId, userId, nickname: null, joinedAt: now, timedOutUntil, avatar: null, banner: null, bio: null },
        joiningUser,
        [],
        now,
      ),
    });
  }
}

/**
 * Where a new account of this instance starts (docs/systems/admin.md, "Starter
 * spaces"). It never stands in the way of the account: a space that went private since
 * it was chosen is skipped, and anything that goes wrong is logged and the sign-up goes on.
 */
export function joinStarterSpaces(userId: string, now: number = Date.now()): void {
  try {
    const db = getDb();
    const rows = db.select({ id: schema.spaces.id, visibility: schema.spaces.visibility })
      .from(schema.starterSpaces)
      .innerJoin(schema.spaces, eq(schema.starterSpaces.spaceId, schema.spaces.id))
      .all();
    for (const space of rows) {
      if (space.visibility !== 'public' || isBanned(space.id, userId) || isMember(space.id, userId)) continue;
      addPublicMember(space.id, userId, now);
    }
  } catch (err) {
    console.error('[signup] Could not add a new account to the starter spaces:', err);
  }
}
