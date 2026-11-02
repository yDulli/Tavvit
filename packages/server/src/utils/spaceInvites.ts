/**
 * Invite links: docs/systems/spaces.md, "Invite links".
 *
 * Every link is a row of `space_invites`. The one the Invite dialog hands out is the
 * one `spaces.invite_code` names; a space that predates the table, or a space made
 * by a path that only sets that column, gets its row the first time the code is used.
 * Revoking a link deletes its row (and clears the column for the standing one), so a
 * revoked link is exactly as unknown as one that never existed.
 */
import crypto from 'node:crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { SpaceInviteLink } from '@backspace/shared';
import { isVanityCodeShape, normalizeVanityCode, RESERVED_VANITY_CODES } from '@backspace/shared/src/vanityInvites.js';
import { getDb, schema } from '../db/index.js';

type Db = ReturnType<typeof getDb>;
type InviteRow = typeof schema.spaceInvites.$inferSelect;

/** Live links a space may hold, so a link cannot be made to fill the table. */
export const MAX_INVITES_PER_SPACE = 50;

/** 48 bits: too many to try, at any rate a server allows, and short enough to read out. */
export function generateInviteCode(): string {
  return crypto.randomBytes(6).toString('base64url');
}

function isUsable(row: InviteRow, now: number): boolean {
  if (row.expiresAt !== null && row.expiresAt <= now) return false;
  return row.maxUses === null || row.uses < row.maxUses;
}

/** The space's standing link as a row, made now if it has none yet. Returns null when `code` is not one. */
function standingInvite(code: string, db: Db): InviteRow | null {
  const space = db.select({ id: schema.spaces.id, ownerId: schema.spaces.ownerId, createdAt: schema.spaces.createdAt })
    .from(schema.spaces).where(eq(schema.spaces.inviteCode, code)).get();
  if (!space) return null;
  db.insert(schema.spaceInvites)
    .values({ code, spaceId: space.id, createdBy: space.ownerId, createdAt: space.createdAt })
    .onConflictDoNothing().run();
  return db.select().from(schema.spaceInvites).where(eq(schema.spaceInvites.code, code)).get() ?? null;
}

/** The invite `code` names, if it can still let someone in. A space's own address is in small letters, however it is typed. */
export function usableInvite(code: string, now: number = Date.now(), db: Db = getDb()): InviteRow | null {
  const byCode = (given: string): InviteRow | undefined => db.select().from(schema.spaceInvites).where(eq(schema.spaceInvites.code, given)).get();
  const row = byCode(code) ?? standingInvite(code, db) ?? byCode(normalizeVanityCode(code));
  return row && isUsable(row, now) ? row : null;
}

export type VanityRefusal = 'invalid' | 'reserved' | 'taken';

/**
 * Gives a space its own address, or takes it away with null. It is a row of `space_invites` like
 * any link, with no end and no limit, so joining, the preview and a link's card need nothing of
 * their own; `spaces.vanity_code` says which row it is.
 */
export function setVanityCode(spaceId: string, given: string | null, createdBy: string | null, now: number = Date.now(), db: Db = getDb()): VanityRefusal | null {
  const code = given === null ? null : normalizeVanityCode(given);
  const space = db.select({ vanityCode: schema.spaces.vanityCode }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!space) return 'invalid';
  if (code === space.vanityCode) return null;
  if (code !== null) {
    if (!isVanityCodeShape(code)) return 'invalid';
    const blocked = db.select({ code: schema.blockedVanityCodes.code }).from(schema.blockedVanityCodes).where(eq(schema.blockedVanityCodes.code, code)).get();
    if (RESERVED_VANITY_CODES.has(code) || blocked) return 'reserved';
    const inUse = db.select({ code: schema.spaceInvites.code }).from(schema.spaceInvites).where(eq(schema.spaceInvites.code, code)).get()
      ?? db.select({ code: schema.spaces.inviteCode }).from(schema.spaces).where(eq(schema.spaces.inviteCode, code)).get();
    if (inUse) return 'taken';
  }
  db.transaction((tx) => {
    if (space.vanityCode) tx.delete(schema.spaceInvites).where(eq(schema.spaceInvites.code, space.vanityCode)).run();
    tx.update(schema.spaces).set({ vanityCode: code }).where(eq(schema.spaces.id, spaceId)).run();
    if (code !== null) tx.insert(schema.spaceInvites).values({ code, spaceId, createdBy, createdAt: now }).run();
  });
  return null;
}

/** An administrator takes a space's address away, and nobody can take it again. */
export function revokeVanityCode(spaceId: string, now: number = Date.now(), db: Db = getDb()): string | null {
  const code = db.select({ vanityCode: schema.spaces.vanityCode }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get()?.vanityCode ?? null;
  if (code === null) return null;
  db.insert(schema.blockedVanityCodes).values({ code, createdAt: now }).onConflictDoNothing().run();
  setVanityCode(spaceId, null, null, now, db);
  return code;
}

/**
 * Counts one person in. In one statement, so the last place of a limited link goes
 * to one person. False when the link stopped working since it was read.
 */
export function consumeInvite(code: string, now: number = Date.now(), db: Db = getDb()): boolean {
  const result = db.update(schema.spaceInvites)
    .set({ uses: sql`${schema.spaceInvites.uses} + 1` })
    .where(and(
      eq(schema.spaceInvites.code, code),
      or(isNull(schema.spaceInvites.expiresAt), sql`${schema.spaceInvites.expiresAt} > ${now}`),
      or(isNull(schema.spaceInvites.maxUses), lt(schema.spaceInvites.uses, schema.spaceInvites.maxUses)),
    )).run();
  return result.changes === 1;
}

/** Drops links that can no longer let anyone in. */
function pruneInvites(spaceId: string, now: number, db: Db): void {
  db.delete(schema.spaceInvites).where(and(
    eq(schema.spaceInvites.spaceId, spaceId),
    or(
      sql`${schema.spaceInvites.expiresAt} IS NOT NULL AND ${schema.spaceInvites.expiresAt} <= ${now}`,
      sql`${schema.spaceInvites.maxUses} IS NOT NULL AND ${schema.spaceInvites.uses} >= ${schema.spaceInvites.maxUses}`,
    ),
  )).run();
}

/** The live links of a space, the standing one first, then the newest. */
export function listInvites(spaceId: string, now: number = Date.now(), db: Db = getDb()): SpaceInviteLink[] {
  const space = db.select({ inviteCode: schema.spaces.inviteCode, vanityCode: schema.spaces.vanityCode }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!space) return [];
  if (space.inviteCode) standingInvite(space.inviteCode, db);
  pruneInvites(spaceId, now, db);
  const rows = db.select({
    invite: schema.spaceInvites,
    username: schema.users.username,
    displayName: schema.users.displayName,
  }).from(schema.spaceInvites)
    .leftJoin(schema.users, eq(schema.users.id, schema.spaceInvites.createdBy))
    .where(eq(schema.spaceInvites.spaceId, spaceId))
    .all();
  return rows
    // The space's own address has its own place in the settings, and its own way of going.
    .filter(({ invite }) => invite.code !== space.vanityCode)
    .map(({ invite, username, displayName }) => ({
      code: invite.code,
      standing: invite.code === space.inviteCode,
      createdBy: invite.createdBy && username !== null
        ? { id: invite.createdBy, name: displayName || username.split('@')[0]! }
        : null,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
      uses: invite.uses,
    }))
    .sort((a, b) => Number(b.standing) - Number(a.standing) || b.createdAt - a.createdAt);
}

/** A new link. Null when the space holds as many as it may. */
export function createInvite(
  spaceId: string,
  createdBy: string,
  options: { expiresAt: number | null; maxUses: number | null },
  now: number = Date.now(),
  db: Db = getDb(),
): InviteRow | null {
  pruneInvites(spaceId, now, db);
  const held = db.select({ held: sql<number>`count(*)` }).from(schema.spaceInvites)
    .where(eq(schema.spaceInvites.spaceId, spaceId)).get()?.held ?? 0;
  if (held >= MAX_INVITES_PER_SPACE) return null;
  const row: InviteRow = { code: generateInviteCode(), spaceId, createdBy, createdAt: now, expiresAt: options.expiresAt, maxUses: options.maxUses, uses: 0 };
  db.insert(schema.spaceInvites).values(row).run();
  return row;
}

/** Ends a link of this space. False when it has none by that code. */
export function revokeInvite(spaceId: string, code: string, db: Db = getDb()): boolean {
  return db.transaction((tx) => {
    const space = tx.select({ inviteCode: schema.spaces.inviteCode, vanityCode: schema.spaces.vanityCode }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
    if (space?.vanityCode === code) return false;
    const isStanding = space?.inviteCode === code;
    if (isStanding) tx.update(schema.spaces).set({ inviteCode: null }).where(eq(schema.spaces.id, spaceId)).run();
    const removed = tx.delete(schema.spaceInvites)
      .where(and(eq(schema.spaceInvites.spaceId, spaceId), eq(schema.spaceInvites.code, code))).run();
    return removed.changes === 1 || isStanding;
  });
}
