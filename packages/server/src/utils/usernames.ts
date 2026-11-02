import { and, eq, gt } from 'drizzle-orm';
import { USERNAME_LIMITS } from '@backspace/shared/src/usernames.js';
import { getDb, schema } from '../db/index.js';

type Db = ReturnType<typeof getDb>;

export type UsernameShapeRefusal =
  | { code: 'username_length_invalid'; details: { min: number; max: number } }
  | { code: 'username_characters_invalid'; details?: undefined };

/** Why a name cannot be a local username, in the words registration and changing one share. */
export function usernameShapeRefusal(name: string): UsernameShapeRefusal | null {
  if (name.length < USERNAME_LIMITS.MIN_LENGTH || name.length > USERNAME_LIMITS.MAX_LENGTH) {
    return { code: 'username_length_invalid', details: { min: USERNAME_LIMITS.MIN_LENGTH, max: USERNAME_LIMITS.MAX_LENGTH } };
  }
  if (!/^[a-z0-9_]+$/.test(name)) return { code: 'username_characters_invalid' };
  return null;
}

/** Someone gave this name up a short while ago, so nobody can pose as them under it yet. */
export function usernameHeld(name: string, now: number = Date.now(), db: Db = getDb()): boolean {
  return db.select({ username: schema.retiredUsernames.username }).from(schema.retiredUsernames)
    .where(and(eq(schema.retiredUsernames.username, name), gt(schema.retiredUsernames.until, now)))
    .get() !== undefined;
}
