import { getRawDb } from '../db/index.js';

/**
 * The roles of a space anyone may @mention (`Role.mentionable`): a message
 * that mentions only these needs no MENTION_EVERYONE (permissions.md,
 * "Mass mentions"). Read per message, from the space's few role rows.
 */
export function mentionableRoleIds(spaceId: string | null | undefined): Set<string> {
  if (!spaceId) return new Set();
  const rows = getRawDb()
    .prepare('SELECT id FROM roles WHERE space_id = ? AND mentionable = 1 AND id != space_id')
    .all(spaceId) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}
