import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { containsText, escapeLike, sameTextIgnoringCase } from './likePattern.js';

// Words someone typed are words: `%` and `_` in them match themselves. Before 1.41.4 the message
// search, its `from:` filter and the space search passed them to LIKE as its wildcards.

const notes = sqliteTable('notes', { body: text('body').notNull() });

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

const ROWS = ['discount 100% today', 'discount 100 percent', 'snake_case names', 'snakeXcase names', 'a\\b path', 'plain text', 'Mara'];

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec('CREATE TABLE notes (body TEXT NOT NULL)');
  const insert = sqlite.prepare('INSERT INTO notes (body) VALUES (?)');
  for (const row of ROWS) insert.run(row);
  db = drizzle(sqlite);
});

const containing = (words: string): string[] => db.select().from(notes).where(containsText(notes.body, words)).all().map((row) => row.body);
const being = (words: string): string[] => db.select().from(notes).where(sameTextIgnoringCase(notes.body, words)).all().map((row) => row.body);

describe('words inside a LIKE', () => {
  it('escapes LIKE\'s wildcards and the escape character itself', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(escapeLike('plain')).toBe('plain');
  });

  it('finds a percent sign as a percent sign', () => {
    expect(containing('100%')).toEqual(['discount 100% today']);
    // Alone it was "anything": every row.
    expect(containing('%')).toEqual(['discount 100% today']);
  });

  it('finds an underscore as an underscore', () => {
    expect(containing('snake_case')).toEqual(['snake_case names']);
    expect(containing('_')).toEqual(['snake_case names']);
  });

  it('finds a backslash as a backslash', () => {
    expect(containing('a\\b')).toEqual(['a\\b path']);
  });

  it('still ignores the case of letters and finds text inside text', () => {
    expect(containing('PLAIN')).toEqual(['plain text']);
    expect(containing('count 100')).toEqual(['discount 100% today', 'discount 100 percent']);
  });

  it('matches a whole value only for the whole value, never by a pattern', () => {
    expect(being('mara')).toEqual(['Mara']);
    expect(being('%')).toEqual([]);
    expect(being('M%')).toEqual([]);
    expect(being('M_ra')).toEqual([]);
  });
});
