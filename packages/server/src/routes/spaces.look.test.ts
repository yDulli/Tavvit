import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseStoredSpaceLook, spaceLookOf } from '@backspace/shared/src/looks.js';
import * as schema from '../db/schema.js';
import { PermissionBits } from '../utils/permissions.js';
import { setWorkerId } from '../utils/snowflake.js';

// A space's look (docs/systems/spaces.md, "A space's look"): the colours a space chooses for
// itself, set by whoever may manage the space, checked by one rule on the server and every client,
// and sent to its members with the space.

setWorkerId(1);
let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let currentUserId = 'owner';
const sendToSpace = vi.fn();
vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (req: { userId?: string }) => { req.userId = currentUserId; } }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { announceSpaceAccessChange: vi.fn(), sendToSpace: (...args: unknown[]) => sendToSpace(...args) } }));

const LOOK = { hue: 280, strength: 26, depth: 0.5, accent: '#0E8F7E' };

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';
  sendToSpace.mockClear();
  for (const id of ['owner', 'manager', 'member']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: 'space', name: 'Night Shift', ownerId: 'owner', createdAt: 1 }).run();
  for (const userId of ['owner', 'manager', 'member']) {
    testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId, joinedAt: 1 }).run();
  }
  testDb.insert(schema.roles).values({ id: 'manager-role', spaceId: 'space', name: 'Manager', permissions: PermissionBits.MANAGE_SPACE.toString(), position: 1, createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: 'space', userId: 'manager', roleId: 'manager-role' }).run();
  const { spaceRoutes } = await import('./spaces.js');
  app = Fastify();
  await app.register(spaceRoutes);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const update = (look: unknown) => app.inject({ method: 'PATCH', url: '/api/spaces/space', payload: { look } });
const stored = () => testDb.select().from(schema.spaces).where(eq(schema.spaces.id, 'space')).get()!;

describe('a space\'s look', () => {
  it('is set by whoever may manage the space, kept in lower case, and sent to its members', async () => {
    currentUserId = 'manager';
    const response = await update(LOOK);
    expect(response.statusCode).toBe(200);
    expect(response.json().look).toEqual({ ...LOOK, accent: '#0e8f7e' });
    expect(JSON.parse(stored().look!)).toEqual({ ...LOOK, accent: '#0e8f7e' });
    expect(sendToSpace).toHaveBeenCalledWith('space', { type: 'space_updated', space: expect.objectContaining({ look: { ...LOOK, accent: '#0e8f7e' } }) });
    currentUserId = 'member';
    expect((await app.inject('/api/spaces/space')).json().look).toEqual({ ...LOOK, accent: '#0e8f7e' });
  });

  it('is recorded in the space\'s audit log, by who changed it, from what to what', async () => {
    currentUserId = 'manager';
    await update(LOOK);
    await update(LOOK);
    await update(null);
    const entries = testDb.select().from(schema.spaceAuditLog).where(eq(schema.spaceAuditLog.spaceId, 'space')).all();
    const kept = JSON.stringify({ ...LOOK, accent: '#0e8f7e' });
    // The same look again changes nothing, so it records nothing.
    expect(entries.map((entry) => [entry.actorId, entry.action, JSON.parse(entry.changes!)])).toEqual([
      ['manager', 'space_update', [{ key: 'look', from: null, to: kept }]],
      ['manager', 'space_update', [{ key: 'look', from: kept, to: null }]],
    ]);
  });

  it('takes no accent of its own, and is taken away again', async () => {
    expect((await update({ ...LOOK, accent: null })).json().look).toEqual({ ...LOOK, accent: null });
    expect((await update(null)).json().look).toBeNull();
    expect(stored().look).toBeNull();
  });

  it('is not for a member who may not manage the space', async () => {
    currentUserId = 'member';
    const response = await update(LOOK);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('missing_permission');
    expect(stored().look).toBeNull();
  });

  it.each([
    ['a hue past its range', { ...LOOK, hue: 360 }],
    ['a strength in parts', { ...LOOK, strength: 2.5 }],
    ['a depth between the half steps', { ...LOOK, depth: 0.25 }],
    ['a depth past its range', { ...LOOK, depth: 5 }],
    ['an accent white text cannot be read on', { ...LOOK, accent: '#ffffff' }],
    ['an accent that is no colour', { ...LOOK, accent: 'red' }],
    ['a list', [LOOK]],
    ['a word', 'violet'],
  ])('refuses %s', async (_name, look) => {
    const response = await update(look);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('space_look_invalid');
    expect(stored().look).toBeNull();
  });

  it('reads a stored look that no longer holds as none', async () => {
    testDb.update(schema.spaces).set({ look: '{"hue":400}' }).where(eq(schema.spaces.id, 'space')).run();
    expect((await app.inject('/api/spaces/space')).json().look).toBeNull();
    expect(parseStoredSpaceLook('not json')).toBeNull();
    expect(parseStoredSpaceLook(null)).toBeNull();
  });
});

describe('the rule every side reads a look by', () => {
  it('keeps a look in range and nothing else', () => {
    expect(spaceLookOf({ hue: 0, strength: 0, depth: -3, accent: null })).toEqual({ hue: 0, strength: 0, depth: -3, accent: null });
    expect(spaceLookOf({ hue: 359, strength: 100, depth: 4, accent: '#7466E8' })).toEqual({ hue: 359, strength: 100, depth: 4, accent: '#7466e8' });
    expect(spaceLookOf({ hue: 10, strength: 10, depth: 0 })).toBeNull();
    expect(spaceLookOf(null)).toBeNull();
  });
});
