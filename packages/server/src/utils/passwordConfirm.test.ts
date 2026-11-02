import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';

// A route that asks for the current password is held to what a sign-in is: each wrong answer counts
// as a failed sign-in of the account and the next waits, from any address, and at most a few are
// checked at once. What the route read before the check must still hold once it is done.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

const guessed = vi.hoisted(() => ({ right: 'the right one' }));
vi.mock('./auth.js', () => ({ verifyPassword: async (password: string) => password === guessed.right }));
vi.mock('./rateLimitSwitch.js', () => ({ rateLimitsDisabled: () => false }));
vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

const { checkPassword } = await import('./passwordConfirm.js');
const { loginThrottle, loginThrottleKey, loginWait } = await import('./loginThrottle.js');

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrationsDir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

/** An account as a route reads it, with an open session. */
function account(id: string): { user: typeof schema.users.$inferSelect; request: { ip: string; sessionId: string } } {
  const now = Date.now();
  testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: now }).run();
  testDb.insert(schema.sessions).values({ id: `session-${id}`, userId: id, createdAt: now, lastActiveAt: now, expiresAt: now + 60_000 }).run();
  const user = testDb.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
  return { user, request: { ip: '2001:db8::1', sessionId: `session-${id}` } };
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
});

afterEach(() => vi.restoreAllMocks());

describe('checking the current password', () => {
  it('makes the account wait after wrong answers, wherever they come from, and the right one forgives', async () => {
    const waits: number[] = [];
    vi.spyOn(loginWait, 'sleep').mockImplementation(async (ms: number) => { waits.push(ms); });
    const { user, request } = account('confirmer');
    for (let i = 0; i < 6; i += 1) {
      expect(await checkPassword(user, `guess ${i}`, { ...request, ip: `2001:db8::${i}` })).toBe('wrong');
    }
    expect(loginThrottle.waitFor(loginThrottleKey('confirmer'), '2001:db8::ff')).toBeGreaterThan(0);
    expect(waits.at(-1)).toBeGreaterThan(0);

    expect(await checkPassword(user, guessed.right, { ...request, ip: '2001:db8::ff' })).toBe('valid');
    expect(loginThrottle.waitFor(loginThrottleKey('confirmer'), '2001:db8::ff')).toBe(0);
  });

  it('checks no more at once than a sign-in would, and says so instead of calling a right password wrong', async () => {
    vi.spyOn(loginWait, 'sleep').mockImplementation(async () => {});
    const { user, request } = account('busy-one');
    const key = loginThrottleKey(user.username);
    let held = 0;
    while (loginThrottle.enter(key)) held += 1;
    try {
      expect(await checkPassword(user, guessed.right, request)).toBe('busy');
    } finally {
      for (let i = 0; i < held; i += 1) loginThrottle.leave(key);
    }
    expect(await checkPassword(user, guessed.right, request)).toBe('valid');
  });

  it('does not pass a right password for an account that changed while the check waited', async () => {
    const changes: Record<string, (id: string) => void> = {
      'a password reset by mail': (id) => { testDb.update(schema.users).set({ passwordHash: 'new' }).where(eq(schema.users.id, id)).run(); },
      'a second factor turned on': (id) => { testDb.update(schema.users).set({ twoFactorEnabledAt: Date.now() }).where(eq(schema.users.id, id)).run(); },
      'every session ended': (id) => { testDb.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run(); },
      'the account deleted': (id) => { testDb.update(schema.users).set({ isDeleted: 1 }).where(eq(schema.users.id, id)).run(); },
    };
    for (const [what, change] of Object.entries(changes)) {
      const { user, request } = account(`changed-${Object.keys(changes).indexOf(what)}`);
      vi.spyOn(loginWait, 'sleep').mockImplementation(async () => change(user.id));
      expect(await checkPassword(user, guessed.right, request), what).toBe('wrong');
      // Counted neither way: the wait it would have earned stays as it was.
      expect(loginThrottle.waitFor(loginThrottleKey(user.username), request.ip), what).toBe(0);
      vi.restoreAllMocks();
    }
  });
});
