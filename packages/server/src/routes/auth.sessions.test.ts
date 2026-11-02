import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { hashPassword, signJwt } from '../utils/auth.js';

// Sessions through the real routes and the real token check, not a mocked `authenticate`.

setWorkerId(8);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

const closed = vi.hoisted(() => ({ sessions: [] as string[] }));

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    closeSessionSockets: (ids: ReadonlySet<string>) => { closed.sessions.push(...ids); },
    forceDisconnectUser: vi.fn(),
    sendToUser: vi.fn(),
    sendToSpace: vi.fn(),
    getRoom: () => undefined,
  },
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
}

const PASSWORD = 'correct horse battery';
let app: FastifyInstance;

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function signIn(userAgent = CHROME, username = 'alice'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'user-agent': userAgent }, payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const me = (token: string) => app.inject({ method: 'GET', url: '/api/users/@me', headers: as(token) });
const list = async (token: string) => (await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: as(token) })).json().sessions as Array<{ id: string; current: boolean; clientLabel: string | null; addressHint: string | null }>;

beforeEach(async () => {
  closed.sessions.length = 0;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  const passwordHash = await hashPassword(PASSWORD);
  for (const id of ['alice', 'bob']) testDb.insert(schema.users).values({ id, username: id, passwordHash, createdAt: 1 }).run();
  const { authRoutes } = await import('./auth.js');
  const { userRoutes } = await import('./users.js');
  app = Fastify();
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.ready();
});

describe('a session', () => {
  it('is made at sign-in, and says what device it is, with the address cut short', async () => {
    const token = await signIn();
    const [session] = await list(token);
    expect(session).toMatchObject({ current: true, clientLabel: 'Chrome · Windows' });
    const row = testDb.select().from(schema.sessions).all()[0]!;
    expect(row.addressHint).toBe('127.0.0.0');
    expect(JSON.stringify(row)).not.toContain('127.0.0.1');
  });

  it('is made at registration too', async () => {
    testDb.insert(schema.instanceSettings).values({ id: 1, registrationOpen: 1, updatedAt: 1 }).run();
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: PASSWORD } });
    expect(res.statusCode).toBe(201);
    expect((await list(res.json().token)).length).toBe(1);
  });

  it('ends at logout: "Log out" means the token no longer works, anywhere', async () => {
    const token = await signIn();
    expect((await me(token)).statusCode).toBe(200);
    const [session] = await list(token);
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: as(token) })).statusCode).toBe(200);
    const refused = await me(token);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().code).toBe('session_ended');
    expect(closed.sessions).toEqual([session!.id]);
  });

  it('can be ended from another device, which leaves that other device alone', async () => {
    const phone = await signIn('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/604.1');
    const desk = await signIn();
    const sessions = await list(desk);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.current).toBe(true);
    const phoneSession = sessions.find((s) => !s.current)!;
    const res = await app.inject({ method: 'DELETE', url: `/api/auth/sessions/${phoneSession.id}`, headers: as(desk) });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessions).toHaveLength(1);
    expect((await me(phone)).statusCode).toBe(401);
    expect((await me(desk)).statusCode).toBe(200);
    expect(closed.sessions).toEqual([phoneSession.id]);
  });

  it('cannot be ended, or seen, by anyone else', async () => {
    const alice = await signIn();
    const bob = await signIn(CHROME, 'bob');
    const [aliceSession] = await list(alice);
    expect((await list(bob)).map((s) => s.id)).not.toContain(aliceSession!.id);
    const res = await app.inject({ method: 'DELETE', url: `/api/auth/sessions/${aliceSession!.id}`, headers: as(bob) });
    expect(res.statusCode).toBe(404);
    expect((await me(alice)).statusCode).toBe(200);
  });

  it('every other one can be ended at once, this one going on', async () => {
    const first = await signIn();
    const second = await signIn();
    const third = await signIn();
    const res = await app.inject({ method: 'POST', url: '/api/auth/sessions/end-others', headers: as(third) });
    expect(res.json().sessions).toHaveLength(1);
    expect((await me(first)).statusCode).toBe(401);
    expect((await me(second)).statusCode).toBe(401);
    expect((await me(third)).statusCode).toBe(200);
    expect(closed.sessions).toHaveLength(2);
  });

  it('that ran out does not count, even with a token still in date', async () => {
    const token = await signIn();
    testDb.update(schema.sessions).set({ expiresAt: Date.now() - 1 }).run();
    expect((await me(token)).json().code).toBe('session_ended');
  });

  it('of someone else does not open this account', async () => {
    const bob = await signIn(CHROME, 'bob');
    const [bobSession] = await list(bob);
    const forged = signJwt({ userId: 'alice', username: 'alice', sid: bobSession!.id });
    expect((await me(forged)).json().code).toBe('session_ended');
  });

  it('notes its use, but not with every request', async () => {
    const token = await signIn();
    testDb.update(schema.sessions).set({ lastActiveAt: 1000 }).run();
    await me(token);
    const touched = testDb.select().from(schema.sessions).all()[0]!.lastActiveAt;
    expect(touched).toBeGreaterThan(1000);
    testDb.update(schema.sessions).set({ lastActiveAt: touched }).run();
    await me(token);
    expect(testDb.select().from(schema.sessions).all()[0]!.lastActiveAt).toBe(touched);
  });
});

describe('changing the password', () => {
  const change = (token: string, newPassword = 'a brand new passphrase') => app.inject({
    method: 'POST', url: '/api/users/@me/change-password', headers: as(token), payload: { currentPassword: PASSWORD, newPassword },
  });

  it('ends every other session at once, and their sockets', async () => {
    const other = await signIn();
    const [otherSession] = await list(other);
    const here = await signIn();
    const res = await change(here);
    expect(res.statusCode).toBe(200);
    expect((await me(other)).json().code).toBe('session_ended');
    expect(closed.sessions).toContain(otherSession!.id);
    expect((await me(res.json().token)).statusCode).toBe(200);
  });

  it('ends this token too: whoever has a copy of it is shut out, this device goes on with the new one', async () => {
    const here = await signIn();
    const res = await change(here);
    expect((await me(here)).json().code).toBe('session_ended');
    expect((await list(res.json().token))).toHaveLength(1);
  });

  it('refuses a password longer than any can be', async () => {
    const res = await change(await signIn(), 'x'.repeat(257));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('password_too_long');
  });
});

describe('a token from before sessions', () => {
  const legacy = () => signJwt({ userId: 'alice', username: 'alice' });
  const testsTake = (value: boolean) => {
    (globalThis as { __tavvitTestsTakeSessionlessTokens?: boolean }).__tavvitTestsTakeSessionlessTokens = value;
  };

  beforeEach(() => testsTake(false));
  afterEach(() => testsTake(true));

  it('opens nothing, since nothing could sign it out: whoever holds one signs in once more', async () => {
    const res = await me(legacy());
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('session_ended');
  });

  it('that was not signed by this server opens nothing', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const forged = jwt.sign({ userId: 'alice', username: 'alice' }, 'some other secret entirely, long enough');
    expect((await me(forged)).statusCode).toBe(401);
  });
});
