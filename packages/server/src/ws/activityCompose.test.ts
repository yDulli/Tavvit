import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Activity } from '@backspace/shared';
import * as schema from '../db/schema.js';

// A person's activity set: what their client reports, and what their home
// derived itself (Live on Twitch), each replaced by its own writer only
// (docs/systems/activity-presence.md, "Live on Twitch").

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  schema,
}));

beforeAll(() => {
  const sqlite = new Database(':memory:');
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    for (const statement of fs.readFileSync(path.join(migrationsDir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = statement.trim();
      if (clean) sqlite.exec(clean);
    }
  }
  testDb = drizzle(sqlite, { schema });
});

const { connectionManager } = await import('./handler.js');

const game: Activity = { type: 'playing', name: 'Factorio' };
const live: Activity = { type: 'streaming', name: 'Speedruns', url: 'https://www.twitch.tv/mara', source: 'twitch' };

afterEach(() => {
  connectionManager.clearUserActivities('mara');
});

describe('ConnectionManager activity composition', () => {
  it('keeps what the home derived when the client reports', () => {
    connectionManager.setDerivedActivities('mara', [live]);
    expect(connectionManager.setReportedActivities('mara', [game])).toEqual([live, game]);
    expect(connectionManager.setReportedActivities('mara', [])).toEqual([live]);
  });

  it('keeps what the client reported when the derived part changes', () => {
    connectionManager.setReportedActivities('mara', [game]);
    expect(connectionManager.setDerivedActivities('mara', [live])).toEqual([live, game]);
    expect(connectionManager.setDerivedActivities('mara', [])).toEqual([game]);
    expect(connectionManager.getUserActivities('mara')).toEqual([game]);
  });

  it('never takes a marked activity from a client', () => {
    expect(connectionManager.setReportedActivities('mara', [live, game])).toEqual([game]);
    expect(connectionManager.getDerivedActivities('mara')).toEqual([]);
  });

  it('holds the set to the limit every receiver keeps, cutting what the client reported', () => {
    const five: Activity[] = Array.from({ length: 5 }, (_, index) => ({ type: 'playing', name: `Game ${index}` }));
    connectionManager.setReportedActivities('mara', five);
    const held = connectionManager.setDerivedActivities('mara', [live]);
    expect(held).toHaveLength(5);
    expect(held[0]).toEqual(live);
  });

  it('takes a relayed set whole, derived part included', () => {
    connectionManager.setDerivedActivities('mara', [live]);
    connectionManager.setUserActivities('mara', [game]);
    expect(connectionManager.getDerivedActivities('mara')).toEqual([]);
    connectionManager.setUserActivities('mara', [live, game]);
    expect(connectionManager.setReportedActivities('mara', [])).toEqual([live]);
  });
});
