import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Words someone typed, inside a LIKE. `%` and `_` are LIKE's own wildcards and mean themselves
 * only when escaped: unescaped, a search for `100%` or `snake_case` matched what it does not
 * say, and `_` alone matched every message. The backslash is the escape character the queries
 * below name, so it is escaped as well.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

/** `column` contains `text`, as written (LIKE ignores the case of ASCII letters). */
export function containsText(column: SQLiteColumn, text: string): SQL {
  return sql`${column} LIKE ${`%${escapeLike(text)}%`} ESCAPE '\\'`;
}

/** `column` is `text`, whatever the case of its ASCII letters. */
export function sameTextIgnoringCase(column: SQLiteColumn, text: string): SQL {
  return sql`${column} LIKE ${escapeLike(text)} ESCAPE '\\'`;
}
