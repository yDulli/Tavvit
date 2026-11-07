import { eq } from 'drizzle-orm';
import { parseStoredSpaceTag } from '@backspace/shared/src/spaceTags.js';
import { getDb, getRawDb, schema } from '../db/index.js';
import { isMember } from './permissions.js';
import { announceProfileChange } from './profileBroadcast.js';

/**
 * Space tags (docs/systems/space-tags.md): what a person wears is a copy of the space's tag in
 * `users.space_tag`, so every list of people reads it with the rest of the profile. The copy
 * follows the space: it changes with the space's tag, and goes when the tag goes, when the person
 * leaves or is removed, and when the space is deleted. Each change is announced like any other
 * change of a profile.
 */

/** The people whose copy names this space. A copy that is not JSON names nothing. */
const WEARERS_SQL = `SELECT id FROM users WHERE CASE WHEN json_valid(space_tag) THEN json_extract(space_tag, '$.spaceId') END = ?`;

/** What `users.space_tag` holds for wearing a space's tag, or null when the space has none or the person is not in it. */
export function wornSpaceTagFor(userId: string, spaceId: string): string | null {
  const space = getDb().select({ tag: schema.spaces.tag }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  const tag = parseStoredSpaceTag(space?.tag);
  if (!tag || !isMember(spaceId, userId)) return null;
  return JSON.stringify({ spaceId, ...tag });
}

/** After a space's tag changed or went: every wearer's copy follows. Answers whose copy changed. */
export function refreshSpaceTagWearers(spaceId: string): string[] {
  const raw = getRawDb();
  const wearers = (raw.prepare(WEARERS_SQL).all(spaceId) as { id: string }[]).map((row) => row.id);
  if (wearers.length === 0) return [];
  const space = getDb().select({ tag: schema.spaces.tag }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  const tag = parseStoredSpaceTag(space?.tag);
  const copy = tag ? JSON.stringify({ spaceId, ...tag }) : null;
  const write = raw.prepare('UPDATE users SET space_tag = ? WHERE id = ?');
  raw.transaction(() => {
    for (const id of wearers) write.run(copy, id);
  })();
  return wearers;
}

/** Someone who is no longer in a space no longer wears its tag. Answers whether they did. */
export function releaseSpaceTag(userId: string, spaceId: string): boolean {
  const result = getRawDb()
    .prepare(`UPDATE users SET space_tag = NULL WHERE id = ? AND CASE WHEN json_valid(space_tag) THEN json_extract(space_tag, '$.spaceId') END = ?`)
    .run(userId, spaceId);
  return result.changes > 0;
}

/** A space that goes takes its tag off everyone wearing it. Answers who did. */
export function releaseSpaceTagsOf(spaceId: string): string[] {
  const raw = getRawDb();
  const wearers = (raw.prepare(WEARERS_SQL).all(spaceId) as { id: string }[]).map((row) => row.id);
  if (wearers.length === 0) return [];
  const clear = raw.prepare('UPDATE users SET space_tag = NULL WHERE id = ?');
  raw.transaction(() => {
    for (const id of wearers) clear.run(id);
  })();
  return wearers;
}

/** Everyone who sees these people hears of their new tag (or of it being gone). */
export function announceSpaceTagChange(userIds: readonly string[]): void {
  const db = getDb();
  for (const id of userIds) {
    const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (row) announceProfileChange(row);
  }
}
