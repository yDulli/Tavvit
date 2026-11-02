import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { signJwt, hashPassword } from '../utils/auth.js';
import { PASSWORD_MIN_LENGTH } from '@backspace/shared/src/constants.js';

setWorkerId(25);
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

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    closeSessionSockets: vi.fn(),
    sendToUser: vi.fn(),
    sendToSpace: vi.fn(),
    sendToDmMembers: vi.fn(),
    setUserShowActivity: vi.fn(),
    clearUserActivities: vi.fn(),
    getUserStatus: vi.fn(() => 'online'),
    forceDisconnectUser: vi.fn(),
  },
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    const sqlText = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const stmt of sqlText.split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

async function buildApp(): Promise<FastifyInstance> {
  const { userRoutes } = await import('./users.js');
  const f = Fastify({ logger: false });
  await f.register(userRoutes);
  await f.ready();
  return f;
}

const LOCAL_ID = 'local-1';
const LOCAL_USERNAME = 'alice';
const LOCAL_PASSWORD = 'correct-horse-battery';

function auth(): Record<string, string> {
  return { Authorization: `Bearer ${signJwt({ userId: LOCAL_ID, username: LOCAL_USERNAME })}` };
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.users).values({
    id: LOCAL_ID,
    username: LOCAL_USERNAME,
    passwordHash: await hashPassword(LOCAL_PASSWORD),
    isAdmin: 0,
    isDeleted: 0,
    createdAt: Date.now(),
  }).run();
  app = await buildApp();
});

// The account panel and the delete-account dialog show these rejections; the
// codes let the client phrase them in the user's language.
describe('user routes send error codes', () => {
  it('DELETE @me without the username confirmation is username_confirmation_required', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/users/@me', headers: auth(), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('username_confirmation_required');
  });

  it('DELETE @me with the wrong username is username_confirmation_mismatch', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/api/users/@me', headers: auth(),
      payload: { username: 'someone-else', password: LOCAL_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('username_confirmation_mismatch');
  });

  it('DELETE @me while owning a space is account_deletion_blocked_owned_spaces and still lists the spaces', async () => {
    testDb.insert(schema.spaces).values({
      id: 'space-1', name: 'Mine', ownerId: LOCAL_ID, createdAt: Date.now(),
    }).run();
    const res = await app.inject({
      method: 'DELETE', url: '/api/users/@me', headers: auth(),
      payload: { username: LOCAL_USERNAME, password: LOCAL_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'account_deletion_blocked_owned_spaces',
      ownedSpaces: [{ id: 'space-1', name: 'Mine' }],
    });
  });

  describe('the last administrator who can act', () => {
    const leave = () => app.inject({
      method: 'DELETE', url: '/api/users/@me', headers: auth(),
      payload: { username: LOCAL_USERNAME, password: LOCAL_PASSWORD },
    });
    const addAdmin = (id: string, extra: Partial<typeof schema.users.$inferInsert> = {}) =>
      testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', isAdmin: 1, createdAt: 1, ...extra }).run();

    beforeEach(() => {
      testDb.update(schema.users).set({ isAdmin: 1 }).where(eq(schema.users.id, LOCAL_ID)).run();
    });

    it('cannot delete their account', async () => {
      const res = await leave();
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('last_admin_cannot_leave');
    });

    it('is not saved from that by one who is suspended or gone', async () => {
      addAdmin('admin-suspended', { suspendedAt: 1, suspensionReason: 'For a test' });
      addAdmin('admin-gone', { isDeleted: 1 });
      expect((await leave()).json().code).toBe('last_admin_cannot_leave');
    });

    it('can go once another can act', async () => {
      addAdmin('admin-other');
      expect((await leave()).statusCode).toBe(200);
    });
  });

  it('PATCH @me with nothing to change is no_fields_to_update', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/users/@me', headers: auth(), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('no_fields_to_update');
  });

  it('PATCH @me with an unknown status is status_invalid', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/users/@me', headers: auth(), payload: { status: 'asleep' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('status_invalid');
  });

  it('PATCH @me with a bad accent colour is accent_color_invalid', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/users/@me', headers: auth(), payload: { accentColor: 'red' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('accent_color_invalid');
  });

  it('PATCH @me with a malformed replicatedInstances entry is validation_failed and names the field', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/users/@me', headers: auth(),
      payload: { replicatedInstances: [{ username: 'alice', origin: 'ftp://orbit.test' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'validation_failed',
      details: { field: 'replicatedInstances.origin' },
    });
  });

  it('PATCH @me with a display name or status that would disguise itself is validation_failed', async () => {
    // A right-to-left override shows "\u202enimda" as "admin".
    for (const payload of [{ displayName: '\u202enimda' }, { customStatus: 'away \u2066x' }]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/users/@me', headers: auth(), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'validation_failed', details: { field: Object.keys(payload)[0] } });
    }
  });

  it('PUT federation-registry with a stale timestamp is registry_conflict', async () => {
    const first = await app.inject({
      method: 'PUT', url: '/api/users/@me/federation-registry', headers: auth(),
      payload: { registry: [], updatedAt: 2000 },
    });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({
      method: 'PUT', url: '/api/users/@me/federation-registry', headers: auth(),
      payload: { registry: [], updatedAt: 1000 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('registry_conflict');
  });

  it('POST federation-credential for our own origin is federation_credential_remote_only', async () => {
    const { getOurOrigin } = await import('../utils/federationAuth.js');
    const res = await app.inject({
      method: 'POST', url: '/api/users/@me/federation-credential', headers: auth(),
      payload: { origin: getOurOrigin() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('federation_credential_remote_only');
  });

  it('POST change-password under the shared minimum is password_too_short with the minimum', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/users/@me/change-password', headers: auth(),
      payload: { currentPassword: LOCAL_PASSWORD, newPassword: 'a'.repeat(PASSWORD_MIN_LENGTH - 1) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'password_too_short', details: { min: PASSWORD_MIN_LENGTH } });
  });

  it('POST change-password accepts a new password of exactly the shared minimum', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/users/@me/change-password', headers: auth(),
      payload: { currentPassword: LOCAL_PASSWORD, newPassword: 'xkqzjvwb-mnr'.slice(0, PASSWORD_MIN_LENGTH) },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().token).toBe('string');
  });

  it('PATCH @me with an avatar that is neither an upload nor a URL is avatar_url_invalid', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/users/@me', headers: auth(), payload: { avatar: '../../etc/passwd' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('avatar_url_invalid');
  });
});
