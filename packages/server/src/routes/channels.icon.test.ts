import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { PermissionBits, permissionsToString } from '../utils/permissions.js';
import { setWorkerId } from '../utils/snowflake.js';
import { signJwt } from '../utils/auth.js';

setWorkerId(28);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
const sent: Array<Record<string, unknown>> = [];

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: () => (...args: unknown[]) => {
      for (const arg of args) if (typeof arg === 'object' && arg !== null && 'type' in arg) sent.push(arg as Record<string, unknown>);
    },
  }),
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const SPACE = '5000';
const CHANNEL = '5001';
const OWNER = '5101';
const MEMBER = '5102';
const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: `user${userId}` })}` });
const patch = (userId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/channels/${CHANNEL}`, headers: headers(userId), payload });
const stored = () => testDb.select().from(schema.channels).where(eq(schema.channels.id, CHANNEL)).get()!.icon;

beforeEach(async () => {
  sent.length = 0;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  for (const id of [OWNER, MEMBER]) {
    testDb.insert(schema.users).values({ id, username: `user${id}`, displayName: `User ${id}`, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.roles).values({
    id: SPACE, spaceId: SPACE, name: '@everyone', position: 0,
    permissions: permissionsToString(PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES), createdAt: 1,
  }).run();
  for (const id of [OWNER, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  const { channelRoutes } = await import('./channels.js');
  app = Fastify();
  await app.register(channelRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe('a channel\'s icon', () => {
  it('takes one of the icons, and says so to the space with the channel', async () => {
    const res = await patch(OWNER, { icon: 'glyph:rocket' });
    expect(res.statusCode).toBe(200);
    expect(stored()).toBe('glyph:rocket');
    const update = sent.find((event) => event.type === 'channel_updated') as { channel?: { icon?: string } } | undefined;
    expect(update?.channel?.icon).toBe('glyph:rocket');
  });

  it('takes an emoji, one as a reader sees it however many code points it has', async () => {
    expect((await patch(OWNER, { icon: '🎮' })).statusCode).toBe(200);
    expect(stored()).toBe('🎮');
    for (const icon of ['🏳️‍🌈', '👋🏽', '🇩🇪', '👨‍👩‍👧']) {
      expect((await patch(OWNER, { icon })).statusCode, icon).toBe(200);
      expect(stored()).toBe(icon);
    }
  });

  it('goes back to the type icon with null or nothing', async () => {
    await patch(OWNER, { icon: 'glyph:rocket' });
    await patch(OWNER, { icon: null });
    expect(stored()).toBeNull();
    await patch(OWNER, { icon: 'glyph:rocket' });
    await patch(OWNER, { icon: '   ' });
    expect(stored()).toBeNull();
  });

  it('refuses anything else: words, an icon not in the set, more than an icon', async () => {
    for (const icon of ['news', 'glyph:nothing', 'a🎮', '🎮 🎮', '🎮🎮', '🇩🇪🇫🇷', '<:custom:12345>', 'x'.repeat(200), 42]) {
      const res = await patch(OWNER, { icon });
      expect(res.statusCode, String(icon)).toBe(400);
      expect(res.json().code, String(icon)).toBe('channel_icon_invalid');
    }
    expect(stored()).toBeNull();
  });

  it('is for who may manage the channel', async () => {
    const res = await patch(MEMBER, { icon: 'glyph:rocket' });
    expect(res.statusCode).toBe(403);
    expect(stored()).toBeNull();
  });

  it('is in the audit log, with what it was and what it became', async () => {
    await patch(OWNER, { icon: 'glyph:rocket' });
    const entry = testDb.select().from(schema.spaceAuditLog).all().find((row) => row.action === 'channel_update');
    expect(entry).toBeTruthy();
    expect(String(entry?.changes)).toContain('glyph:rocket');
  });

  it('comes with the channel in its listing', async () => {
    await patch(OWNER, { icon: '🎮' });
    const res = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/channels`, headers: headers(MEMBER) });
    const listed = (res.json() as Array<{ id: string; icon?: string | null }>).find((channel) => channel.id === CHANNEL);
    expect(listed?.icon).toBe('🎮');
  });
});
