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
import { issueSessionToken, verifyAccessToken } from '../utils/auth.js';

setWorkerId(36);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
const flags = vi.hoisted(() => ({ allowed: true }));

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../config.js', async () => {
  const real = await import('../config.js');
  return {
    config: new Proxy(real.config, {
      get(target, prop: string) {
        if (prop === 'loadtestAllowed') return flags.allowed;
        return (target as Record<string, unknown>)[prop];
      },
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

let loadtestRoutes: (app: FastifyInstance) => Promise<void>;

beforeAll(async () => {
  ({ loadtestRoutes } = await import('./loadtest.js'));
}, 120_000);

async function openApp(allowed: boolean): Promise<void> {
  flags.allowed = allowed;
  app = Fastify();
  await app.register(loadtestRoutes);
  await app.ready();
}

function account(id: string, username: string, isAdmin: number): string {
  testDb.insert(schema.users).values({ id, username, passwordHash: 'x', isAdmin, createdAt: 1 }).run();
  return issueSessionToken({ id, username }, { headers: {}, ip: '127.0.0.1' }).token;
}

let admin: string;
let member: string;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  admin = account('1000', 'boss', 1);
  member = account('1001', 'someone', 0);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const ask = (token: string | null, method: 'GET' | 'POST', url: string, payload?: object) => app.inject({
  method,
  url,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  ...(payload ? { payload } : {}),
});

describe('the load test\'s routes', () => {
  it('are not there at all without the switch, whoever asks', async () => {
    await openApp(false);
    for (const token of [admin, member, null]) {
      expect((await ask(token, 'GET', '/api/loadtest')).statusCode).toBe(404);
      expect((await ask(token, 'POST', '/api/loadtest/people', { count: 1 })).statusCode).toBe(404);
    }
    expect(testDb.select().from(schema.users).all()).toHaveLength(2);
  });

  it('are for administrators, with the switch on', async () => {
    await openApp(true);
    expect((await ask(null, 'GET', '/api/loadtest')).statusCode).toBe(401);
    expect((await ask(member, 'GET', '/api/loadtest')).statusCode).toBe(403);
    expect((await ask(member, 'POST', '/api/loadtest/people', { count: 1 })).statusCode).toBe(403);
    expect(testDb.select().from(schema.users).all()).toHaveLength(2);
    const said = await ask(admin, 'GET', '/api/loadtest');
    expect(said.statusCode).toBe(200);
    expect(said.json().allowed).toBe(true);
  });

  it('make people who are members of one new space, with sessions that work', async () => {
    await openApp(true);
    const res = await ask(admin, 'POST', '/api/loadtest/people', { count: 12, channels: 3, rolesPerPerson: 2, messages: 30 });
    expect(res.statusCode).toBe(201);
    const made = res.json() as { spaceId: string; channelIds: string[]; people: Array<{ id: string; token: string }> };
    expect(made.people).toHaveLength(12);
    expect(made.channelIds).toHaveLength(3);

    const access = verifyAccessToken(made.people[0]?.token ?? '');
    expect(access.user.id).toBe(made.people[0]?.id);
    expect(access.user.accountKind).toBe('person');
    expect(access.user.isAdmin).toBe(0);

    const members = testDb.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.spaceId, made.spaceId)).all();
    expect(members).toHaveLength(13);
    expect(testDb.select().from(schema.memberRoles).where(eq(schema.memberRoles.spaceId, made.spaceId)).all()).toHaveLength(24);
    expect(testDb.select().from(schema.messages).all()).toHaveLength(30);
    expect(testDb.select().from(schema.spaces).where(eq(schema.spaces.id, made.spaceId)).get()?.ownerId).toBe('1000');
  });

  it('give no way to sign in as one of them', async () => {
    await openApp(true);
    const res = await ask(admin, 'POST', '/api/loadtest/people', { count: 1 });
    const { people } = res.json() as { people: Array<{ id: string }> };
    const row = testDb.select().from(schema.users).where(eq(schema.users.id, people[0]?.id ?? '')).get();
    expect(row?.passwordHash).toBe('!');
  });

  it('refuse what is no number, and too many', async () => {
    await openApp(true);
    for (const body of [{}, { count: 0 }, { count: 'many' }, { count: -1 }, { count: 1.5 }, { count: 20_001 }, { count: 1, channels: 0 }, { count: 1, channels: 51 }, { count: 1, messages: 200_001 }]) {
      expect((await ask(admin, 'POST', '/api/loadtest/people', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });
});
