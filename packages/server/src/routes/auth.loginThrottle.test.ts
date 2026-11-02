import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { loginThrottle } from '../utils/loginThrottle.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(6);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

// The real verifyPassword, wrapped so a test can see whether a comparison ran.
vi.mock('../utils/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/auth.js')>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrationsDir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const PASSWORD = 'correct horse battery';
let counter = 0;
/** What each attempt was told to wait, instead of sitting through it. */
const waits: number[] = [];

/** A fresh account name per test: the throttle is process-wide state, as in production. */
async function newAccount(): Promise<string> {
  counter += 1;
  const username = `friend_${counter}`;
  const { hashPassword } = await import('../utils/auth.js');
  testDb.insert(schema.users).values({
    id: `user-${counter}`,
    username,
    passwordHash: await hashPassword(PASSWORD),
    createdAt: Date.now(),
  }).run();
  return username;
}

const login = (username: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });

async function failTimes(username: string, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const res = await login(username, 'wrong password');
    expect(res.statusCode).toBe(401);
  }
}

beforeEach(async () => {
  waits.length = 0;
  const { loginWait } = await import('../utils/loginThrottle.js');
  vi.spyOn(loginWait, 'sleep').mockImplementation(async (ms: number) => { waits.push(ms); });
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  const { authRoutes } = await import('./auth.js');
  app = Fastify();
  await app.register(authRoutes);
});

describe('POST /api/auth/login: per-account throttle', () => {
  it('signs in with the right password and answers a wrong one with invalid_credentials', async () => {
    const username = await newAccount();
    const bad = await login(username, 'nope');
    expect(bad.statusCode).toBe(401);
    expect(bad.json().code).toBe('invalid_credentials');
    const ok = await login(username, PASSWORD);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toEqual(expect.any(String));
  });

  it('never refuses the right password, however many failures there were: it only waits', async () => {
    const username = await newAccount();
    await failTimes(username, 12);
    const res = await login(username, PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toEqual(expect.any(String));
    expect(waits.at(-1)).toBeGreaterThan(0);
  });

  it('makes each wrong guess wait longer, before the password is looked at', async () => {
    const username = await newAccount();
    await failTimes(username, 7);
    expect(waits.slice(-7)).toEqual([0, 0, 0, 0, 1000, 2000, 4000]);
  });

  it('forgets the failures once the right password came', async () => {
    const username = await newAccount();
    await failTimes(username, 6);
    expect((await login(username, PASSWORD)).statusCode).toBe(200);
    waits.length = 0;
    await login(username, 'wrong password');
    expect(waits).toEqual([0]);
  });

  it('does not slow another account', async () => {
    const victim = await newAccount();
    const other = await newAccount();
    await failTimes(victim, 8);
    waits.length = 0;
    expect((await login(other, PASSWORD)).statusCode).toBe(200);
    expect(waits).toEqual([0]);
  });

  it('counts a name the same however it is written', async () => {
    const username = await newAccount();
    await failTimes(username.toUpperCase(), 6);
    waits.length = 0;
    await login(username, 'wrong password');
    expect(waits[0]).toBeGreaterThan(0);
  });

  it('turns away what is more than a few at once on a name, and says when to come back', async () => {
    const username = await newAccount();
    const places = Array.from({ length: 4 }, () => loginThrottle.enter(username));
    expect(places.every(Boolean)).toBe(true);
    const res = await login(username, PASSWORD);
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('login_throttled');
    expect(res.headers['retry-after']).toBe('5');
    for (let i = 0; i < 4; i += 1) loginThrottle.leave(username);
    expect((await login(username, PASSWORD)).statusCode).toBe(200);
  });

  it('lets the owner in while guesses on the name are made to wait: a wait holds no place', async () => {
    const username = await newAccount();
    await failTimes(username, 8);
    const { loginWait } = await import('../utils/loginThrottle.js');
    // The guesses that follow sleep and do not wake up within this test.
    const asleep: Array<() => void> = [];
    vi.mocked(loginWait.sleep).mockImplementation((ms: number) => {
      waits.push(ms);
      return ms > 0 ? new Promise<void>((resolve) => { asleep.push(resolve); }) : Promise.resolve();
    });
    const guesses = Array.from({ length: 8 }, () => login(username, 'wrong password'));
    await vi.waitFor(() => expect(asleep).toHaveLength(8));
    // The owner's own attempt waits as long, and is then checked, not turned away.
    const owner = login(username, PASSWORD);
    await vi.waitFor(() => expect(asleep).toHaveLength(9));
    asleep.pop()!();
    expect((await owner).statusCode).toBe(200);
    for (const wake of asleep) wake();
    await Promise.all(guesses);
  });

  it('refuses a password longer than any can be without hashing it', async () => {
    const username = await newAccount();
    const res = await login(username, 'x'.repeat(257));
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_credentials');
  });

  it('replaces an old hash at the next login, and starts no one over', async () => {
    const username = await newAccount();
    const bcrypt = (await import('bcryptjs')).default;
    const old = await bcrypt.hash(PASSWORD, 4);
    testDb.update(schema.users).set({ passwordHash: old }).where(eq(schema.users.username, username)).run();
    expect((await login(username, PASSWORD)).statusCode).toBe(200);
    const row = testDb.select().from(schema.users).where(eq(schema.users.username, username)).get()!;
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.passwordChangedAt).toBeNull();
    expect((await login(username, PASSWORD)).statusCode).toBe(200);
  });

  it('answers an unknown username exactly like a wrong password', async () => {
    const known = await newAccount();
    const wrongPassword = await login(known, 'nope');
    const unknown = await login('nobody_by_that_name', 'nope');
    expect(unknown.statusCode).toBe(wrongPassword.statusCode);
    expect(unknown.json()).toEqual(wrongPassword.json());
  });

  it('slows an unknown username the same way, so the wait does not reveal which names exist', async () => {
    await failTimes('nobody_at_all', 6);
    waits.length = 0;
    await login('nobody_at_all', 'wrong password');
    expect(waits[0]).toBeGreaterThan(0);
  });

  it('still performs a password comparison for an unknown username, so the response time is the same', async () => {
    const { verifyPassword } = await import('../utils/auth.js');
    const spy = vi.mocked(verifyPassword);
    spy.mockClear();
    const res = await login('someone_who_is_not_here', 'whatever it is');
    expect(res.statusCode).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
