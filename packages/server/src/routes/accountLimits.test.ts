import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { signJwt } from '../utils/auth.js';

setWorkerId(34);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let tmpDir: string;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/thumbnail.js', () => ({
  generateThumbnail: vi.fn().mockResolvedValue(null),
  isResizableImage: vi.fn().mockReturnValue(false),
  probeImageDimensions: vi.fn().mockResolvedValue(null),
  probeMediaMeta: vi.fn().mockResolvedValue(null),
  generateVideoThumbnail: vi.fn().mockResolvedValue(null),
  thumbFilename: (name: string) => `${name}_thumb.webp`,
}));

vi.mock('../config.js', async () => {
  const real = await import('../config.js');
  return {
    config: new Proxy(real.config, {
      get(target, prop: string) {
        if (prop === 'uploadDir') return tmpDir ?? target.uploadDir;
        if (prop === 'tusUploadDir') return tmpDir ? path.join(tmpDir, '.tus') : target.tusUploadDir;
        return (target as Record<string, unknown>)[prop];
      },
    }),
  };
});

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => () => {
      if (name === 'getUserSpaceEntries' || name === 'getAllOnlineUserIds') return [];
      if (name === 'getRoomParticipants' || name === 'getUserSpaces') return new Set();
      return undefined;
    },
  }),
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of fs.readFileSync(path.join(migrationsDir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (statement.trim()) db.exec(statement.trim());
    }
  }
}

function metadata(name: string): string {
  return `originalName ${Buffer.from(name).toString('base64')}`;
}

// What is under way is held in memory across tests, so each test has its own people.
let serial = 0;
let person: string;
let admin: string;

function addAccount(isAdmin: 0 | 1 = 0, accountKind: 'person' | 'webhook' = 'person'): string {
  serial += 1;
  const id = `account-${serial}`;
  testDb.insert(schema.users).values({ id, username: `account_${serial}`, passwordHash: 'x', isAdmin, accountKind, createdAt: Date.now() }).run();
  return id;
}

const tokenOf = (userId: string) => signJwt({ userId, username: `name_${userId}` });
const bearer = (userId: string) => ({ authorization: `Bearer ${tokenOf(userId)}` });

const start = (userId: string, size: number) => app.inject({
  method: 'POST',
  url: '/api/files',
  headers: {
    ...bearer(userId),
    'tus-resumable': '1.0.0',
    'upload-length': String(size),
    'upload-metadata': metadata('file.bin'),
    'content-length': '0',
  },
});

const send = (userId: string, location: string, bytes: number) => app.inject({
  method: 'PATCH',
  url: location,
  headers: {
    ...bearer(userId),
    'tus-resumable': '1.0.0',
    'upload-offset': '0',
    'content-type': 'application/offset+octet-stream',
    'content-length': String(bytes),
  },
  payload: Buffer.alloc(bytes, 7),
});

async function upload(userId: string, bytes: number): Promise<void> {
  const started = await start(userId, bytes);
  expect(started.statusCode).toBe(201);
  const finished = await send(userId, started.headers.location as string, bytes);
  expect(finished.statusCode).toBeLessThan(300);
}

const setInstanceLimits = (limits: { storagePerAccountBytes?: number; spacesPerAccount?: number }) =>
  testDb.update(schema.instanceSettings).set(limits).where(eq(schema.instanceSettings.id, 1)).run();

const usage = async (userId: string) => (await app.inject({ method: 'GET', url: '/api/users/@me/storage', headers: bearer(userId) })).json();

function addFileRow(values: { id: string; filename: string; size: number; uploaderId: string; sourceUrl?: string }): void {
  testDb.insert(schema.attachments).values({
    originalName: 'file.bin',
    mimetype: 'application/octet-stream',
    createdAt: Date.now(),
    ...values,
  }).run();
}

const createSpace = (userId: string) => app.inject({
  method: 'POST',
  url: '/api/spaces',
  headers: bearer(userId),
  payload: { name: `A space of ${userId}` },
});

let routeModules: Array<(instance: FastifyInstance) => Promise<void>> = [];

// Loading these takes longer than a test may, and only has to happen once.
beforeAll(async () => {
  routeModules = [
    (await import('./files.js')).filesRoutes,
    (await import('./accountStorage.js')).accountStorageRoutes,
    (await import('./spaces.js')).spaceRoutes,
    (await import('./settings.js')).settingsRoutes,
    (await import('./platformAdmin.js')).platformAdminRoutes,
    (await import('./discordImport.js')).discordImportRoutes,
  ];
}, 120_000);

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-limits-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.instanceSettings).values({ id: 1, updatedAt: Date.now(), maxUploadSizeBytes: 10 * 1024 * 1024 }).run();

  person = addAccount();
  admin = addAccount(1);

  app = Fastify();
  for (const routes of routeModules) await app.register(routes);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('storage per account', () => {
  it('starts at five gigabytes and twenty-five spaces', () => {
    const settings = testDb.select().from(schema.instanceSettings).get();
    expect(settings?.storagePerAccountBytes).toBe(5 * 1024 ** 3);
    expect(settings?.spacesPerAccount).toBe(25);
  });

  it('refuses a file that does not fit, in words the client can name', async () => {
    setInstanceLimits({ storagePerAccountBytes: 100 });
    const res = await start(person, 120);
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'storage_limit_reached' });
  });

  it('counts what the account already keeps', async () => {
    setInstanceLimits({ storagePerAccountBytes: 100 });
    await upload(person, 60);
    expect(await usage(person)).toEqual({ usedBytes: 60, limitBytes: 100 });
    expect((await start(person, 50)).statusCode).toBe(413);
    expect((await start(person, 40)).statusCode).toBe(201);
  });

  it('lets a file fit exactly', async () => {
    setInstanceLimits({ storagePerAccountBytes: 100 });
    expect((await start(person, 100)).statusCode).toBe(201);
  });

  it('holds uploads under way, so several started side by side cannot pass together', async () => {
    setInstanceLimits({ storagePerAccountBytes: 100 });
    const first = await start(person, 60);
    expect(first.statusCode).toBe(201);
    expect((await start(person, 60)).statusCode).toBe(413);

    // Someone else is not held back by it.
    expect((await start(addAccount(), 60)).statusCode).toBe(201);

    // Called off, it makes room again.
    const cancelled = await app.inject({
      method: 'DELETE',
      url: first.headers.location as string,
      headers: { ...bearer(person), 'tus-resumable': '1.0.0' },
    });
    expect(cancelled.statusCode).toBe(204);
    expect((await start(person, 60)).statusCode).toBe(201);
  });

  it('frees what was held once the upload has become a file', async () => {
    setInstanceLimits({ storagePerAccountBytes: 100 });
    await upload(person, 60);
    // Not counted twice: 60 kept and nothing held leaves 40.
    expect((await start(person, 40)).statusCode).toBe(201);
  });

  it('refuses an upload that does not say how long it is', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/files',
      headers: {
        ...bearer(person),
        'tus-resumable': '1.0.0',
        'upload-defer-length': '1',
        'upload-metadata': metadata('file.bin'),
        'content-length': '0',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('checks again at the end, and takes the file away', async () => {
    setInstanceLimits({ storagePerAccountBytes: 100 });
    const started = await start(person, 60);
    expect(started.statusCode).toBe(201);

    setInstanceLimits({ storagePerAccountBytes: 10 });
    const finished = await send(person, started.headers.location as string, 60);
    expect(finished.statusCode).toBe(413);
    expect(JSON.parse(finished.body)).toMatchObject({ code: 'storage_limit_reached' });

    expect(testDb.select().from(schema.attachments).all()).toEqual([]);
    expect(fs.readdirSync(path.join(tmpDir, '.tus'))).toEqual([]);
  });

  it('counts a file once, however many messages hold it', async () => {
    addFileRow({ id: 'f1', filename: 'f1.bin', size: 70, uploaderId: person });
    addFileRow({ id: 'f2', filename: 'f1.bin', size: 70, uploaderId: person });
    addFileRow({ id: 'f3', filename: 'f3.bin', size: 5, uploaderId: person });
    expect((await usage(person)).usedBytes).toBe(75);
  });

  it('is not emptied by forwarding a file and deleting the original', async () => {
    addFileRow({ id: 'original', filename: 'big.bin', size: 90, uploaderId: person });
    addFileRow({ id: 'copy', filename: 'big.bin', size: 90, uploaderId: person });
    testDb.delete(schema.attachments).where(eq(schema.attachments.id, 'original')).run();
    expect((await usage(person)).usedBytes).toBe(90);
  });

  it('counts a forwarded copy for who forwarded it as well', async () => {
    const other = addAccount();
    addFileRow({ id: 'original', filename: 'big.bin', size: 90, uploaderId: person });
    addFileRow({ id: 'copy', filename: 'big.bin', size: 90, uploaderId: other });
    expect((await usage(person)).usedBytes).toBe(90);
    expect((await usage(other)).usedBytes).toBe(90);
  });

  it('does not count a copy fetched from another instance', async () => {
    addFileRow({ id: 'fetched', filename: 'far.bin', size: 90, uploaderId: person, sourceUrl: 'https://peer.example/uploads/far.bin' });
    expect((await usage(person)).usedBytes).toBe(0);
  });

  it('frees the room when the file goes', async () => {
    setInstanceLimits({ storagePerAccountBytes: 100 });
    addFileRow({ id: 'gone', filename: 'gone.bin', size: 90, uploaderId: person });
    expect((await start(person, 50)).statusCode).toBe(413);
    testDb.delete(schema.attachments).where(eq(schema.attachments.id, 'gone')).run();
    expect((await start(person, 50)).statusCode).toBe(201);
  });

  it('has no limit for an admin, or when the instance sets 0', async () => {
    setInstanceLimits({ storagePerAccountBytes: 100 });
    expect((await start(admin, 1000)).statusCode).toBe(201);
    expect((await usage(admin)).limitBytes).toBeNull();

    setInstanceLimits({ storagePerAccountBytes: 0 });
    expect((await start(person, 1000)).statusCode).toBe(201);
    expect((await usage(person)).limitBytes).toBeNull();
  });

  it('takes an account\'s own limit over the instance\'s, and 0 as none', async () => {
    setInstanceLimits({ storagePerAccountBytes: 100 });
    testDb.update(schema.users).set({ storageLimitBytes: 500 }).where(eq(schema.users.id, person)).run();
    expect((await usage(person)).limitBytes).toBe(500);
    expect((await start(person, 400)).statusCode).toBe(201);

    const free = addAccount();
    testDb.update(schema.users).set({ storageLimitBytes: 0 }).where(eq(schema.users.id, free)).run();
    expect((await usage(free)).limitBytes).toBeNull();
    expect((await start(free, 5000)).statusCode).toBe(201);
  });

  it('shows nobody else\'s figures, and nothing without a sign-in', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/users/@me/storage' })).statusCode).toBe(401);
  });
});

describe('a disk that is nearly full', () => {
  const disk = (freeBytes: number, totalBytes: number) => {
    vi.spyOn(fs, 'statfsSync').mockReturnValue({
      bsize: 1,
      blocks: totalBytes,
      bavail: freeBytes,
      bfree: freeBytes,
      files: 0,
      ffree: 0,
      type: 0,
    } as ReturnType<typeof fs.statfsSync>);
  };

  it('takes no uploads, from anyone', async () => {
    disk(1024 ** 3, 1024 ** 4);
    for (const who of [person, admin]) {
      const res = await start(who, 100);
      expect(res.statusCode).toBe(507);
      expect(JSON.parse(res.body)).toMatchObject({ code: 'disk_full' });
    }
  });

  it('keeps 5% of a small disk free rather than 2 GB', async () => {
    disk(600 * 1024 ** 2, 10 * 1024 ** 3);
    expect((await start(person, 100)).statusCode).toBe(201);
    disk(400 * 1024 ** 2, 10 * 1024 ** 3);
    expect((await start(person, 100)).statusCode).toBe(507);
  });

  it('counts what is under way against the room left', async () => {
    disk(3 * 1024 ** 3, 1024 ** 4);
    testDb.update(schema.instanceSettings).set({ maxUploadSizeBytes: 2 * 1024 ** 3 }).run();
    expect((await start(person, 700 * 1024 ** 2)).statusCode).toBe(201);
    expect((await start(admin, 700 * 1024 ** 2)).statusCode).toBe(507);
  });

  it('is no reason to refuse when the disk cannot be asked', async () => {
    vi.spyOn(fs, 'statfsSync').mockImplementation(() => {
      throw new Error('not supported here');
    });
    expect((await start(person, 100)).statusCode).toBe(201);
  });
});

describe('spaces per account', () => {
  it('stops at the limit, and says what it is', async () => {
    setInstanceLimits({ spacesPerAccount: 2 });
    expect((await createSpace(person)).statusCode).toBe(201);
    expect((await createSpace(person)).statusCode).toBe(201);
    const third = await createSpace(person);
    expect(third.statusCode).toBe(409);
    expect(third.json()).toMatchObject({ code: 'space_limit_reached', details: { max: 2 } });
  });

  it('counts only what an account owns, and each on its own', async () => {
    setInstanceLimits({ spacesPerAccount: 1 });
    expect((await createSpace(person)).statusCode).toBe(201);
    expect((await createSpace(addAccount())).statusCode).toBe(201);
  });

  it('has no limit for an admin, or when the instance sets 0', async () => {
    setInstanceLimits({ spacesPerAccount: 1 });
    expect((await createSpace(admin)).statusCode).toBe(201);
    expect((await createSpace(admin)).statusCode).toBe(201);

    setInstanceLimits({ spacesPerAccount: 0 });
    expect((await createSpace(person)).statusCode).toBe(201);
    expect((await createSpace(person)).statusCode).toBe(201);
  });

  it('holds for a space made by a Discord import, before anything is fetched', async () => {
    setInstanceLimits({ spacesPerAccount: 1 });
    expect((await createSpace(person)).statusCode).toBe(201);
    const fetched = vi.spyOn(globalThis, 'fetch');
    const res = await app.inject({
      method: 'POST',
      url: '/api/import/discord/apply',
      headers: bearer(person),
      payload: { templateCode: 'abcdef', target: { kind: 'new' } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'space_limit_reached' });
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe('in the admin console', () => {
  const settings = (userId: string, payload: Record<string, unknown>) => app.inject({
    method: 'PATCH',
    url: '/api/settings/instance',
    headers: bearer(userId),
    payload,
  });

  it('are set by an admin only, and logged', async () => {
    expect((await settings(person, { storagePerAccountGb: 1 })).statusCode).toBe(403);

    const res = await settings(admin, { storagePerAccountGb: 2.5, spacesPerAccount: 3 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ storagePerAccountGb: 2.5, spacesPerAccount: 3 });

    const row = testDb.select().from(schema.instanceSettings).get();
    expect(row?.storagePerAccountBytes).toBe(2.5 * 1024 ** 3);
    expect(row?.spacesPerAccount).toBe(3);

    const logged = testDb.select().from(schema.platformAuditLog).where(eq(schema.platformAuditLog.action, 'settings_update')).all();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.details).toContain('storagePerAccountBytes');
  });

  it('take 0 for no limit and refuse what is no limit', async () => {
    expect((await settings(admin, { storagePerAccountGb: 0, spacesPerAccount: 0 })).statusCode).toBe(200);
    for (const payload of [
      { storagePerAccountGb: -1 },
      { storagePerAccountGb: 'much' },
      { spacesPerAccount: 1.5 },
      { spacesPerAccount: -1 },
      { spacesPerAccount: 1_000_000 },
    ]) {
      const res = await settings(admin, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'account_limit_out_of_range' });
    }
  });

  const ownLimit = (actor: string, target: string, limitGb: unknown) => app.inject({
    method: 'PUT',
    url: `/api/admin/users/${target}/storage-limit`,
    headers: bearer(actor),
    payload: { limitGb },
  });

  it('give one account its own limit, shown on its page and logged', async () => {
    addFileRow({ id: 'kept', filename: 'kept.bin', size: 40, uploaderId: person });
    expect((await ownLimit(admin, person, 2)).statusCode).toBe(200);

    const detail = (await app.inject({ method: 'GET', url: `/api/admin/users/${person}`, headers: bearer(admin) })).json();
    expect(detail.storage).toEqual({ usedBytes: 40, limitBytes: 2 * 1024 ** 3, ownLimitBytes: 2 * 1024 ** 3 });

    const logged = testDb.select().from(schema.platformAuditLog).where(eq(schema.platformAuditLog.action, 'user_storage_limit')).all();
    expect(logged).toHaveLength(1);
    expect(logged[0]?.targetId).toBe(person);
  });

  it('go back to the instance\'s limit with null, and to none with 0', async () => {
    await ownLimit(admin, person, 2);
    expect((await ownLimit(admin, person, null)).statusCode).toBe(200);
    expect(testDb.select().from(schema.users).where(eq(schema.users.id, person)).get()?.storageLimitBytes).toBeNull();

    expect((await ownLimit(admin, person, 0)).statusCode).toBe(200);
    expect((await usage(person)).limitBytes).toBeNull();
  });

  it('leave one account\'s limit to admins, and refuse what is no account or no figure', async () => {
    expect((await ownLimit(person, person, 100)).statusCode).toBe(403);
    expect((await ownLimit(admin, 'nobody', 1)).statusCode).toBe(404);
    expect((await ownLimit(admin, addAccount(0, 'webhook'), 1)).statusCode).toBe(404);
    expect((await ownLimit(admin, person, -1)).statusCode).toBe(400);
    expect((await ownLimit(admin, person, 'lots')).statusCode).toBe(400);

    const deleted = addAccount();
    testDb.update(schema.users).set({ isDeleted: 1 }).where(eq(schema.users.id, deleted)).run();
    expect((await ownLimit(admin, deleted, 1)).statusCode).toBe(400);
  });
});
