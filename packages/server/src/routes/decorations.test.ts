import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { User } from '@backspace/shared';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

// Profile decorations (docs/systems/decorations.md) through the real route and a real database:
// what is stored, what is refused, what everyone else is shown, and what an update tells them.

setWorkerId(6);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'alice';

const sent = vi.hoisted(() => [] as Array<{ to: string; event: { type: string; user?: User } }>);

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = currentUserId;
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn((to: string, event: { type: string; user?: User }) => {
      sent.push({ to, event });
    }),
    sendToDmMembers: vi.fn(),
    sendToAdmins: vi.fn(),
    getAllOnlineUserIds: () => [],
    getRoom: () => undefined,
    getUserRoom: () => undefined,
    leaveCurrentRoom: vi.fn(() => false),
    destroyRoom: vi.fn(),
    clearVoiceUserStatus: vi.fn(),
    forceDisconnectUser: vi.fn(),
  },
}));

vi.mock('../utils/federationOutbox.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/federationOutbox.js')>('../utils/federationOutbox.js');
  return {
    ...actual,
    isFederationRelayEnabled: () => false,
    appendMutationLog: vi.fn(),
    queueOutboxEvent: vi.fn(),
  };
});

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
}

let app: FastifyInstance;

const update = (payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url: '/api/users/@me', payload });
const stored = () => testDb.select().from(schema.users).where(eq(schema.users.id, 'alice')).get();

beforeEach(async () => {
  sent.length = 0;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  for (const id of ['alice', 'bob']) {
    testDb.insert(schema.users).values({ id, username: id, displayName: id, passwordHash: 'x', homeUserId: id, createdAt: Date.now() }).run();
  }
  // Bob sees Alice's profile: they are friends.
  testDb.insert(schema.friends).values({ userId: 'alice', friendId: 'bob', createdAt: 1 }).run();
  testDb.insert(schema.friends).values({ userId: 'bob', friendId: 'alice', createdAt: 1 }).run();
  currentUserId = 'alice';
  app = Fastify({ logger: false });
  const { userRoutes } = await import('./users.js');
  await app.register(userRoutes);
  await app.ready();
});

describe('choosing decorations', () => {
  it('stores each design by its name and shows it in the reply', async () => {
    const res = await update({ avatarFrame: 'catears', profileEffect: 'snow', nameplate: 'skyline', nameFont: 'serif', nameEffect: 'glitch' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ avatarFrame: 'catears', profileEffect: 'snow', nameplate: 'skyline', nameFont: 'serif', nameEffect: 'glitch' });
    expect(stored()).toMatchObject({ avatarFrame: 'catears', profileEffect: 'snow', nameplate: 'skyline', nameFont: 'serif', nameEffect: 'glitch' });
  });

  it('stores a retired design, sent by a client older than the change, as its successor', async () => {
    const res = await update({ avatarFrame: 'aurora', profileEffect: 'fireflies', nameplate: 'circuit' });
    expect(res.statusCode).toBe(200);
    expect(stored()).toMatchObject({ avatarFrame: 'stardust', profileEffect: 'lanterns', nameplate: 'skyline' });
  });

  it('changes only the fields an update names, and clears one with null', async () => {
    await update({ avatarFrame: 'crown', nameEffect: 'prism' });
    const res = await update({ avatarFrame: null });
    expect(res.statusCode).toBe(200);
    expect(stored()).toMatchObject({ avatarFrame: null, nameEffect: 'prism' });
  });

  it('keeps the interface typeface as none', async () => {
    await update({ nameFont: 'pixel' });
    await update({ nameFont: 'classic' });
    expect(stored()?.nameFont).toBeNull();
  });

  it.each([
    ['avatarFrame', 'golden-crown'],
    ['profileEffect', 42],
    ['nameplate', ''],
    ['nameFont', 'Comic Sans'],
    ['nameEffect', { name: 'gold' }],
    ['nameEffect', 'constructor'],
  ])('refuses %s %j and stores nothing of the update', async (field, value) => {
    const res = await update({ avatarFrame: 'crown', [field]: value });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'profile_decoration_invalid', details: { field } });
    expect(stored()?.avatarFrame).toBeNull();
  });
});

describe('what others see', () => {
  it('tells everyone who sees the profile, with null for what was taken off', async () => {
    await update({ nameplate: 'sakura', avatarFrame: 'frost' });
    sent.length = 0;
    await update({ avatarFrame: null });
    const toBob = sent.find((entry) => entry.to === 'bob')?.event;
    expect(toBob?.type).toBe('user_updated');
    expect(toBob?.user).toMatchObject({ nameplate: 'sakura', avatarFrame: null, profileEffect: null, nameFont: null, nameEffect: null });
  });

  it('shows a name the server does not know (written before, or by hand) as none', async () => {
    testDb.update(schema.users).set({ avatarFrame: 'retired-frame', nameEffect: 'gold' }).where(eq(schema.users.id, 'alice')).run();
    const { publicUserOf } = await import('../utils/sanitize.js');
    const row = stored();
    expect(row).toBeDefined();
    expect(publicUserOf(row!)).toMatchObject({ avatarFrame: null, nameEffect: 'gold' });
  });

  it('shows a retired design stored before the change as its successor, without rewriting it', async () => {
    testDb.update(schema.users).set({ avatarFrame: 'obsidian', profileEffect: 'sparkles', nameplate: 'tide' }).where(eq(schema.users.id, 'alice')).run();
    const { publicUserOf } = await import('../utils/sanitize.js');
    expect(publicUserOf(stored()!)).toMatchObject({ avatarFrame: 'horns', profileEffect: 'stars', nameplate: 'waves' });
    expect(stored()).toMatchObject({ avatarFrame: 'obsidian', profileEffect: 'sparkles', nameplate: 'tide' });
  });

  it('takes the decorations off an account that is deleted', async () => {
    await update({ avatarFrame: 'hearts', profileEffect: 'hearts', nameplate: 'sakura', nameFont: 'hand', nameEffect: 'candy' });
    const { tombstoneUser } = await import('../utils/userDeletion.js');
    tombstoneUser('alice', { purgeContent: false });
    expect(stored()).toMatchObject({ avatarFrame: null, profileEffect: null, nameplate: null, nameFont: null, nameEffect: null });
    const { publicUserOf } = await import('../utils/sanitize.js');
    expect(publicUserOf(stored()!)).toMatchObject({ avatarFrame: null, profileEffect: null, nameplate: null, nameFont: null, nameEffect: null });
  });
});
