import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { buildFederationHeaders } from '../utils/federationAuth.js';

setWorkerId(39);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => () => {
      if (name === 'getUserSpaceEntries' || name === 'getAllOnlineUserIds') return [];
      if (name === 'getRoomParticipants' || name === 'getUserSpaces') return new Set();
      return undefined;
    },
  }),
}));

/** What the home instance answers, signed with the secret the two share: the real check runs on it. */
const home = vi.hoisted(() => ({
  calls: [] as string[],
  answer: { valid: false } as Record<string, unknown>,
  secret: 'shared-secret',
  signWith: null as string | null,
}));

vi.mock('../utils/federationFetch.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/federationFetch.js')>();
  return {
    ...real,
    federationFetch: vi.fn(async (origin: string) => {
      home.calls.push(origin);
      const body = JSON.stringify(home.answer);
      return new Response(body, { status: 200, headers: buildFederationHeaders(body, home.signWith ?? home.secret, origin) });
    }),
  };
});

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) db.exec(statement);
    }
  }
}

let authRoutes: (app: FastifyInstance) => Promise<void>;

beforeAll(async () => {
  ({ authRoutes } = await import('./auth.js'));
}, 120_000);

const PROOF = 'a'.repeat(64);
const HOME = 'home.example';

function peer(status: string): void {
  testDb.insert(schema.federationPeers).values({
    id: 'peer-1',
    origin: `https://${HOME}`,
    hmacSecret: home.secret,
    status,
    createdAt: 1,
    updatedAt: 1,
  } as typeof schema.federationPeers.$inferInsert).run();
}

const register = (overrides: Record<string, unknown> = {}) => app.inject({
  method: 'POST',
  url: '/api/auth/register',
  payload: {
    username: `anna@${HOME}`,
    password: 'a-secret-the-home-made-up',
    homeInstance: HOME,
    homeUserId: 'home-1',
    attachProof: PROOF,
    ...overrides,
  },
});

const account = () => testDb.select().from(schema.users).where(eq(schema.users.username, `anna@${HOME}`)).get();

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.instanceSettings).values({ id: 1, federatedRegistrationOpen: 1, updatedAt: 1 } as typeof schema.instanceSettings.$inferInsert).run();
  home.calls = [];
  home.answer = { valid: true, homeUserId: 'home-1', username: 'anna' };
  home.signWith = null;
  app = Fastify();
  await app.register(authRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe('registering as someone from another instance', () => {
  it('works when their home vouches for exactly this person', async () => {
    peer('active');
    const res = await register();
    expect(res.statusCode).toBe(201);
    expect(account()?.homeInstance).toBe(HOME);
    expect(account()?.homeUserId).toBe('home-1');
    expect(account()?.isAdmin).toBe(0);
    expect(home.calls).toEqual([`https://${HOME}`]);
  });

  it('is refused with no proof, and nobody is asked', async () => {
    peer('active');
    const res = await register({ attachProof: undefined });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('home_instance_unproven');
    expect(account()).toBeUndefined();
    expect(home.calls).toEqual([]);
  });

  it('is refused for a home this instance does not know, and nothing calls that address', async () => {
    const res = await register({ homeInstance: 'internal-service.local', username: 'anna@internal-service.local' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('home_instance_unproven');
    expect(home.calls).toEqual([]);
  });

  for (const status of ['pending', 'awaiting_approval', 'revoked', 'rejected', 'needs_attention', 'unreachable']) {
    it(`is refused while the home is ${status}, and nothing is asked of it`, async () => {
      peer(status);
      const res = await register();
      expect(res.statusCode).toBe(403);
      expect(home.calls).toEqual([]);
      expect(account()).toBeUndefined();
    });
  }

  it('is refused when the home says no', async () => {
    peer('active');
    home.answer = { valid: false };
    const res = await register();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('home_instance_unproven');
    expect(account()).toBeUndefined();
  });

  it('is refused when the answer is not signed with the secret the two share', async () => {
    peer('active');
    home.signWith = 'someone-elses-secret';
    const res = await register();
    expect(res.statusCode).toBe(403);
    expect(account()).toBeUndefined();
  });

  it('is refused when the proof belongs to someone else', async () => {
    peer('active');
    home.answer = { valid: true, homeUserId: 'home-2', username: 'anna' };
    expect((await register()).statusCode).toBe(403);
    expect(account()).toBeUndefined();
  });

  it('is refused under a name that is not theirs at home', async () => {
    peer('active');
    home.answer = { valid: true, homeUserId: 'home-1', username: 'someone_else' };
    expect((await register()).statusCode).toBe(403);
    expect(account()).toBeUndefined();
  });

  it('is refused with a name under another domain than the home it names', async () => {
    peer('active');
    const res = await register({ username: 'anna@elsewhere.example' });
    expect(res.statusCode).toBe(403);
    expect(testDb.select().from(schema.users).all()).toEqual([]);
  });

  it('is refused with something that cannot be a proof, and nobody is asked', async () => {
    peer('active');
    const res = await register({ attachProof: 'not-a-proof' });
    expect(res.statusCode).toBe(403);
    expect(home.calls).toEqual([]);
  });

  it('does not spend the proof on a name already taken', async () => {
    peer('active');
    testDb.insert(schema.users).values({ id: '1', username: `anna@${HOME}`, passwordHash: 'x', createdAt: 1 }).run();
    const res = await register();
    expect(res.statusCode).toBe(409);
    expect(home.calls).toEqual([]);
  });
});

describe('the first person to register', () => {
  it('is an ordinary account, even on an empty instance with registration open', async () => {
    testDb.update(schema.instanceSettings).set({ registrationOpen: 1 }).run();
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'first_comer', password: 'a-long-enough-password-1' } });
    expect(res.statusCode).toBe(201);
    expect(testDb.select().from(schema.users).where(eq(schema.users.username, 'first_comer')).get()?.isAdmin).toBe(0);
  });
});
