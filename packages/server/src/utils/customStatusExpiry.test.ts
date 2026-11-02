import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
const sent: Array<[string, Record<string, unknown>]> = [];

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: (userId: string, event: Record<string, unknown>) => { sent.push([userId, event]); },
  },
}));

import {
  MAX_CUSTOM_STATUS_MINUTES,
  clearExpiredCustomStatuses,
  isValidExpiryMinutes,
  startCustomStatusSweeper,
  stopCustomStatusSweeper,
  SWEEP_INTERVAL_MS,
} from './customStatusExpiry.js';

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrationsDir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

function seed(id: string, customStatus: string | null, expiresAt: number | null): void {
  testDb.insert(schema.users).values({
    id, username: id, passwordHash: 'x', createdAt: 1, customStatus, customStatusExpiresAt: expiresAt,
  }).run();
}

const row = (id: string) => testDb.select().from(schema.users).where(eq(schema.users.id, id)).get()!;

beforeEach(() => {
  sent.length = 0;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
});

afterEach(() => {
  stopCustomStatusSweeper();
  vi.useRealTimers();
});

describe('isValidExpiryMinutes', () => {
  it.each([1, 30, 60, 240, MAX_CUSTOM_STATUS_MINUTES])('accepts %i', (value) => {
    expect(isValidExpiryMinutes(value)).toBe(true);
  });

  it.each([0, -5, 1.5, MAX_CUSTOM_STATUS_MINUTES + 1, NaN, Infinity, '30', null, undefined, {}])('rejects %j', (value) => {
    expect(isValidExpiryMinutes(value)).toBe(false);
  });
});

describe('clearExpiredCustomStatuses', () => {
  it('clears a status whose time has come and leaves the others', () => {
    seed('ended', 'in a meeting', 1_000);
    seed('later', 'lunch', 9_000);
    seed('forever', 'hello', null);
    expect(clearExpiredCustomStatuses(5_000)).toEqual(['ended']);
    expect(row('ended').customStatus).toBeNull();
    expect(row('ended').customStatusExpiresAt).toBeNull();
    expect(row('later').customStatus).toBe('lunch');
    expect(row('forever').customStatus).toBe('hello');
  });

  it('clears a status exactly at its time', () => {
    seed('edge', 'now', 5_000);
    expect(clearExpiredCustomStatuses(5_000)).toEqual(['edge']);
  });

  it('tells the person and the people who can see them, not the others', () => {
    seed('ended', 'away', 1_000);
    seed('friend', null, null);
    seed('stranger', null, null);
    testDb.insert(schema.dmChannels).values({ id: 'dm', ownerId: null, createdAt: 1 }).run();
    testDb.insert(schema.dmMembers).values([{ dmChannelId: 'dm', userId: 'ended' }, { dmChannelId: 'dm', userId: 'friend' }]).run();

    clearExpiredCustomStatuses(5_000);
    const recipients = sent.filter(([, event]) => event.type === 'user_updated').map(([to]) => to).sort();
    expect(recipients).toEqual(['ended', 'friend']);
    const forFriend = sent.find(([to]) => to === 'friend')![1].user as Record<string, unknown>;
    expect(forFriend.customStatus).toBeNull();
    // When statuses end is the owner's business.
    expect('customStatusExpiresAt' in forFriend).toBe(false);
    const forSelf = sent.find(([to]) => to === 'ended')![1].user as Record<string, unknown>;
    expect(forSelf.customStatusExpiresAt).toBeNull();
  });

  it('does nothing, and says nothing, when no status has ended', () => {
    seed('later', 'lunch', 9_000);
    expect(clearExpiredCustomStatuses(5_000)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('keeps a status that was replaced after the sweep looked at it', () => {
    seed('replaced', 'old', 1_000);
    // The person saves a new status with a later end between the select and the update.
    testDb.update(schema.users).set({ customStatus: 'new', customStatusExpiresAt: 99_000 }).where(eq(schema.users.id, 'replaced')).run();
    expect(clearExpiredCustomStatuses(5_000)).toEqual([]);
    expect(row('replaced').customStatus).toBe('new');
  });
});

describe('the sweeper', () => {
  it('clears an ended status at once when started (it may have ended while the server was down)', () => {
    seed('ended', 'away', 1);
    startCustomStatusSweeper();
    expect(row('ended').customStatus).toBeNull();
  });

  it('keeps sweeping every minute and stops when asked', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    startCustomStatusSweeper();
    seed('soon', 'brb', 10_000 + SWEEP_INTERVAL_MS - 1);
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
    expect(row('soon').customStatus).toBeNull();

    stopCustomStatusSweeper();
    seed('after', 'brb', 1);
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS * 3);
    expect(row('after').customStatus).toBe('brb');
  });

  it('starting twice does not start two timers', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    startCustomStatusSweeper();
    startCustomStatusSweeper();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
