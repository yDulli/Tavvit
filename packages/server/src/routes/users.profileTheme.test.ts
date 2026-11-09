import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { signJwt } from '../utils/auth.js';

setWorkerId(27);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
const sent: Array<[string, Record<string, unknown>]> = [];

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: (userId: string, event: Record<string, unknown>) => { sent.push([userId, event]); },
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
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const ME = 'me-1';
const FRIEND = 'friend-1';
const auth = () => ({ Authorization: `Bearer ${signJwt({ userId: ME, username: 'me' })}` });
const patch = (payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: '/api/users/@me', headers: auth(), payload });
const row = () => testDb.select().from(schema.users).where(eq(schema.users.id, ME)).get()!;

beforeEach(async () => {
  sent.length = 0;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.users).values([
    { id: ME, username: 'me', passwordHash: 'x', createdAt: 1 },
    { id: FRIEND, username: 'friend', passwordHash: 'x', createdAt: 1 },
  ]).run();
  testDb.insert(schema.dmChannels).values({ id: 'dm', ownerId: null, createdAt: 1 }).run();
  testDb.insert(schema.dmMembers).values([{ dmChannelId: 'dm', userId: ME }, { dmChannelId: 'dm', userId: FRIEND }]).run();
  const { userRoutes } = await import('./users.js');
  app = Fastify({ logger: false });
  await app.register(userRoutes);
  await app.ready();
});

describe('PATCH /api/users/@me: the profile theme\'s two colours', () => {
  it('stores both and answers with both', async () => {
    const res = await patch({ accentColor: '#7443fc', accentColorSecondary: '#45affd' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accentColor: '#7443fc', accentColorSecondary: '#45affd' });
    expect(row()).toMatchObject({ accentColor: '#7443fc', accentColorSecondary: '#45affd' });
  });

  it('accepts the second colour on its own and trims it', async () => {
    await patch({ accentColor: '#7443fc' });
    const res = await patch({ accentColorSecondary: '  #45AFFD ' });
    expect(res.statusCode).toBe(200);
    expect(row()).toMatchObject({ accentColor: '#7443fc', accentColorSecondary: '#45AFFD' });
  });

  it.each(['red', '#fff', '#12345g', '45affd', '#7443fc80', 12])('refuses %j as the second colour, with a code', async (value) => {
    const res = await patch({ accentColor: '#7443fc', accentColorSecondary: value });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('accent_color_invalid');
    // Nothing of the request was applied.
    expect(row().accentColor).toBeNull();
    expect(row().accentColorSecondary).toBeNull();
  });

  it('clears the second colour with an empty string while keeping the first', async () => {
    await patch({ accentColor: '#7443fc', accentColorSecondary: '#45affd' });
    await patch({ accentColorSecondary: '' });
    expect(row()).toMatchObject({ accentColor: '#7443fc', accentColorSecondary: null });
  });

  it('drops the second colour when the first is cleared, since it means nothing alone', async () => {
    await patch({ accentColor: '#7443fc', accentColorSecondary: '#45affd' });
    await patch({ accentColor: '' });
    expect(row()).toMatchObject({ accentColor: null, accentColorSecondary: null });
  });

  it('lets a request that clears the first and sets a new second colour keep the new one', async () => {
    await patch({ accentColor: '#7443fc', accentColorSecondary: '#45affd' });
    await patch({ accentColor: '', accentColorSecondary: '#e8743b' });
    expect(row()).toMatchObject({ accentColor: null, accentColorSecondary: '#e8743b' });
  });

  it('leaves the second colour alone when only something else changes', async () => {
    await patch({ accentColor: '#7443fc', accentColorSecondary: '#45affd' });
    await patch({ bio: 'hello' });
    expect(row().accentColorSecondary).toBe('#45affd');
  });

  it('tells the profile audience, so their cards change at once', async () => {
    await patch({ accentColor: '#7443fc', accentColorSecondary: '#45affd' });
    const updates = sent.filter(([, event]) => event.type === 'user_updated');
    for (const who of [ME, FRIEND]) {
      const user = updates.find(([to]) => to === who)![1].user as Record<string, unknown>;
      expect(user.accentColorSecondary).toBe('#45affd');
    }
  });

  it('shows the second colour on the profile that anyone can read', async () => {
    await patch({ accentColor: '#7443fc', accentColorSecondary: '#45affd' });
    const res = await app.inject({ method: 'GET', url: `/api/users/${ME}`, headers: auth() });
    expect(res.json().accentColorSecondary).toBe('#45affd');
  });
});

describe('PATCH /api/users/@me: how strongly the theme colours the card', () => {
  it('stores each strength, shows it to anyone, and tells the profile audience', async () => {
    for (const style of ['strong', 'full', 'soft']) {
      expect((await patch({ profileThemeStyle: style })).statusCode).toBe(200);
      expect(row().profileThemeStyle).toBe(style);
    }
    await patch({ profileThemeStyle: 'full' });
    const res = await app.inject({ method: 'GET', url: `/api/users/${ME}`, headers: auth() });
    expect(res.json().profileThemeStyle).toBe('full');
    const toFriend = sent.filter(([to, event]) => to === FRIEND && event.type === 'user_updated');
    expect(toFriend.at(-1)![1].user).toMatchObject({ profileThemeStyle: 'full' });
  });

  it('goes back to the soft look with null, and refuses anything else', async () => {
    await patch({ profileThemeStyle: 'strong' });
    expect((await patch({ profileThemeStyle: null })).statusCode).toBe(200);
    expect(row().profileThemeStyle).toBeNull();
    for (const wrong of ['loud', 3, { style: 'full' }]) {
      const res = await patch({ profileThemeStyle: wrong });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'validation_failed', details: { field: 'profileThemeStyle' } });
    }
    expect(row().profileThemeStyle).toBeNull();
  });
});
