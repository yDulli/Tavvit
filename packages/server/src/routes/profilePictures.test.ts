import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

// The pictures of accounts, spaces and space profiles (utils/profileImageRefs.ts,
// docs/systems/uploads.md "Profile pictures"): a field takes only the
// person's own upload that no message holds (or the picture it shows), and a
// replaced picture goes only once nothing else shows it.

setWorkerId(31);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let uploadDir: string;
let currentUserId = 'alice';

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../config.js', async () => {
  const real = await import('../config.js');
  return {
    config: new Proxy(real.config, {
      get(target, prop: string) {
        if (prop === 'uploadDir') return uploadDir;
        return (target as Record<string, unknown>)[prop];
      },
    }),
  };
});
vi.mock('../utils/auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/auth.js')>()),
  authenticate: async (req: { userId?: string }) => { req.userId = currentUserId; },
}));
vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToSpace: vi.fn(),
    sendToDmMembers: vi.fn(),
    setUserShowActivity: vi.fn(),
    clearUserActivities: vi.fn(),
    getUserStatus: vi.fn(() => 'online'),
    forceDisconnectUser: vi.fn(),
    announceSpaceAccessChange: vi.fn(),
    addUserSpace: vi.fn(),
  },
}));
vi.mock('../ws/events.js', () => ({ checkVoicePermissions: vi.fn() }));
// The pictures here are placeholders, not images: fitting them is not under test.
vi.mock('../utils/thumbnail.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/thumbnail.js')>()),
  resizeProfileImage: vi.fn(async () => undefined),
}));

function file(name: string): string {
  fs.writeFileSync(path.join(uploadDir, name), 'picture');
  return name;
}
const exists = (name: string) => fs.existsSync(path.join(uploadDir, name));

function upload(id: string, filename: string, uploaderId: string, messageId: string | null = null): void {
  file(filename);
  testDb.insert(schema.attachments).values({
    id, messageId, dmMessageId: null, uploaderId, filename, originalName: filename, mimetype: 'image/webp', size: 7,
    thumbnailFilename: null, width: null, height: null, duration: null, sourceUrl: null, federationStatus: null, createdAt: 1,
  } as typeof schema.attachments.$inferInsert).run();
}

beforeEach(async () => {
  uploadDir = path.join(os.tmpdir(), `orbit-pictures-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(uploadDir, { recursive: true });
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const name of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, name), 'utf8'));
  }
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'alice';
  for (const id of ['alice', 'bob']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'not-a-real-hash', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: 'space', name: 'Space', ownerId: 'alice', createdAt: 1 }).run();
  for (const userId of ['alice', 'bob']) testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'space', spaceId: 'space', name: '@everyone', permissions: '0', position: 0, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: 'chan', spaceId: 'space', name: 'general', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.messages).values({ id: 'msg', channelId: 'chan', userId: 'alice', content: 'hi', createdAt: 1 } as typeof schema.messages.$inferInsert).run();

  const [{ userRoutes }, { spaceRoutes }] = await Promise.all([import('./users.js'), import('./spaces.js')]);
  app = Fastify({ logger: false });
  await app.register(userRoutes);
  await app.register(spaceRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

const patchMe = (payload: object) => app.inject({ method: 'PATCH', url: '/api/users/@me', payload });
const patchSpace = (payload: object) => app.inject({ method: 'PATCH', url: '/api/spaces/space', payload });
const patchSpaceProfile = (payload: object) => app.inject({ method: 'PATCH', url: '/api/spaces/space/members/@me/profile', payload });
const userRow = (id: string) => testDb.select().from(schema.users).where(eq(schema.users.id, id)).get()!;

describe('an account picture', () => {
  it('takes the person\'s own upload, in either form', async () => {
    upload('a1', 'alice-1.webp', 'alice');
    expect((await patchMe({ avatar: 'alice-1.webp' })).statusCode).toBe(200);
    expect(userRow('alice').avatar).toBe('alice-1.webp');
    upload('a2', 'alice-2.webp', 'alice');
    expect((await patchMe({ banner: '/api/uploads/alice-2.webp' })).statusCode).toBe(200);
    expect(userRow('alice').banner).toBe('alice-2.webp');
  });

  it('refuses someone else\'s upload, a file a message holds, and names that are not uploads', async () => {
    upload('b1', 'bob-1.webp', 'bob');
    upload('a3', 'alice-msg.webp', 'alice', 'msg');
    for (const avatar of ['bob-1.webp', '/api/uploads/bob-1.webp', 'alice-msg.webp', 'no-such-file.webp', 'name with spaces']) {
      const response = await patchMe({ avatar });
      expect(response.statusCode, avatar).toBe(400);
      expect(response.json().code).toBe('avatar_url_invalid');
    }
    const banner = await patchMe({ banner: 'bob-1.webp' });
    expect(banner.json().code).toBe('banner_url_invalid');
    expect(userRow('alice').avatar).toBeNull();
    expect(exists('bob-1.webp')).toBe(true);
  });

  it('keeps a replaced picture another field still shows, and deletes one nothing shows', async () => {
    upload('a4', 'alice-4.webp', 'alice');
    await patchMe({ avatar: 'alice-4.webp' });
    // The same file as the picture of Alice's space profile.
    testDb.update(schema.spaceMembers).set({ avatar: 'alice-4.webp' })
      .where(and(eq(schema.spaceMembers.spaceId, 'space'), eq(schema.spaceMembers.userId, 'alice'))).run();
    upload('a5', 'alice-5.webp', 'alice');
    expect((await patchMe({ avatar: 'alice-5.webp' })).statusCode).toBe(200);
    expect(exists('alice-4.webp')).toBe(true);
    upload('a6', 'alice-6.webp', 'alice');
    expect((await patchMe({ avatar: 'alice-6.webp' })).statusCode).toBe(200);
    expect(exists('alice-5.webp')).toBe(false);
  });
});

describe('a space picture', () => {
  it('takes the actor\'s own upload and keeps what it shows; refuses someone else\'s file', async () => {
    upload('b2', 'bob-2.webp', 'bob');
    const foreign = await patchSpace({ icon: 'bob-2.webp' });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().code).toBe('icon_url_invalid');
    expect((await patchSpace({ banner: 'bob-2.webp' })).json().code).toBe('banner_url_invalid');
    upload('a7', 'alice-7.webp', 'alice');
    expect((await patchSpace({ icon: 'alice-7.webp' })).statusCode).toBe(200);
    // Sending the picture it shows again is no change of file.
    expect((await patchSpace({ icon: 'alice-7.webp', name: 'Renamed' })).statusCode).toBe(200);
    expect(exists('alice-7.webp')).toBe(true);
  });

  it('refuses someone else\'s file for a new space as well', async () => {
    upload('b3', 'bob-3.webp', 'bob');
    const response = await app.inject({ method: 'POST', url: '/api/spaces', payload: { name: 'New', icon: 'bob-3.webp' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('icon_url_invalid');
  });
});

describe('a space profile picture', () => {
  it('takes the member\'s own upload and shows only in that space', async () => {
    currentUserId = 'bob';
    upload('b4', 'bob-4.webp', 'bob');
    const response = await patchSpaceProfile({ avatar: 'bob-4.webp' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ userId: 'bob', avatar: 'bob-4.webp' });
    expect(userRow('bob').avatar).toBeNull();
    // The member row holds it now; the upload's own row is gone.
    expect(testDb.select().from(schema.attachments).where(eq(schema.attachments.filename, 'bob-4.webp')).get()).toBeUndefined();
  });

  it('refuses someone else\'s upload', async () => {
    currentUserId = 'bob';
    upload('a8', 'alice-8.webp', 'alice');
    const response = await patchSpaceProfile({ avatar: 'alice-8.webp' });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('avatar_url_invalid');
  });

  it('deletes a replaced picture nothing else shows', async () => {
    currentUserId = 'bob';
    upload('b5', 'bob-5.webp', 'bob');
    await patchSpaceProfile({ banner: 'bob-5.webp' });
    expect((await patchSpaceProfile({ banner: null })).statusCode).toBe(200);
    expect(exists('bob-5.webp')).toBe(false);
  });
});
