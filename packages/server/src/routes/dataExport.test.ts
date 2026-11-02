import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(7);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'alice';

const dirs = vi.hoisted(() => ({ exportDir: '', uploadDir: '' }));

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js');
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get: (target, key) => (key === 'exportDir' ? dirs.exportDir : key === 'uploadDir' ? dirs.uploadDir : target[key as keyof typeof target]),
    }),
  };
});

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => { req.userId = currentUserId; },
  verifyPassword: async (password: string, hash: string) => password === hash,
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
}

let app: FastifyInstance;

async function ask(password = 'right') {
  return app.inject({ method: 'POST', url: '/api/users/@me/data-export', payload: { password } });
}

/** Waits for the build the last request started. */
async function built() {
  const { dataExportStatus } = await import('../utils/dataExport.js');
  await vi.waitFor(() => expect(dataExportStatus(currentUserId).status).not.toBe('pending'), { timeout: 5000 });
}

async function download(): Promise<Buffer> {
  const res = await app.inject({ method: 'GET', url: '/api/users/@me/data-export/download' });
  expect(res.statusCode).toBe(200);
  return res.rawPayload;
}

/** The entries of a ZIP, read from its central directory, as a reader of the format would. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.set(name, zip.subarray(dataStart, dataStart + size));
    at += 46 + nameLength;
  }
  return entries;
}

beforeEach(async () => {
  dirs.exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-export-'));
  dirs.uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-export-up-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  const now = Date.now();
  testDb.insert(schema.users).values([
    { id: 'alice', username: 'alice', displayName: 'Alice', bio: 'hello', passwordHash: 'right', createdAt: now },
    { id: 'bob', username: 'bob', passwordHash: 'bobs', createdAt: now },
  ]).run();
  testDb.insert(schema.spaces).values({ id: 's1', name: 'Space', ownerId: 'alice', createdAt: now }).run();
  testDb.insert(schema.spaceMembers).values([{ spaceId: 's1', userId: 'alice', joinedAt: now }, { spaceId: 's1', userId: 'bob', joinedAt: now }]).run();
  testDb.insert(schema.channels).values({ id: 'c1', spaceId: 's1', name: 'general', type: 'text', position: 0, createdAt: now }).run();
  testDb.insert(schema.messages).values([
    { id: 'm1', channelId: 'c1', userId: 'alice', content: 'mine', createdAt: now },
    { id: 'm2', channelId: 'c1', userId: 'bob', content: 'bobs secret words', createdAt: now },
  ]).run();
  fs.writeFileSync(path.join(dirs.uploadDir, 'photo.png'), 'picture bytes');
  fs.writeFileSync(path.join(dirs.uploadDir, 'bobs.png'), 'bobs picture');
  testDb.insert(schema.attachments).values([
    { id: 'a1', messageId: 'm1', uploaderId: 'alice', filename: 'photo.png', originalName: '../../evil name.png', mimetype: 'image/png', size: 13, createdAt: now },
    { id: 'a2', messageId: 'm2', uploaderId: 'bob', filename: 'bobs.png', originalName: 'bobs.png', mimetype: 'image/png', size: 12, createdAt: now },
  ]).run();
  currentUserId = 'alice';
  app = Fastify({ logger: false });
  const { dataExportRoutes } = await import('./dataExport.js');
  await app.register(dataExportRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  fs.rmSync(dirs.exportDir, { recursive: true, force: true });
  fs.rmSync(dirs.uploadDir, { recursive: true, force: true });
});

describe('asking for a copy', () => {
  it('needs the password, and starts nothing without it', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/users/@me/data-export', payload: {} })).statusCode).toBe(400);
    const wrong = await ask('wrong');
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().code).toBe('current_password_incorrect');
    expect(testDb.select().from(schema.dataExports).all()).toEqual([]);
  });

  it('says it is being prepared, then that it is ready', async () => {
    const res = await ask();
    expect(res.statusCode).toBe(202);
    await built();
    const status = await app.inject({ method: 'GET', url: '/api/users/@me/data-export' });
    expect(status.json()).toMatchObject({ status: 'ready' });
    expect(status.json().expiresAt).toBeGreaterThan(Date.now());
  });

  it('is limited to once a day, and says how long is left', async () => {
    await ask();
    await built();
    const res = await ask();
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('data_export_too_soon');
    expect(res.json().details.hours).toBe(24);
  });

  it('lets someone try again an hour after the last one failed, not at once', async () => {
    await ask();
    await built();
    testDb.update(schema.dataExports).set({ status: 'failed' }).run();
    // Failing one on purpose must not make for a new archive on the disk as often as asked.
    expect((await ask()).statusCode).toBe(429);
    testDb.update(schema.dataExports).set({ createdAt: Date.now() - 61 * 60 * 1000 }).run();
    expect((await ask()).statusCode).toBe(202);
    await built();
  });
});

describe('the file', () => {
  it('is a real ZIP with what the person wrote and their files, and nobody else\'s', async () => {
    await ask();
    await built();
    const zip = await download();
    const entries = readZip(zip);
    expect([...entries.keys()]).toEqual(expect.arrayContaining(['README.txt', 'account.json', 'messages.jsonl', 'people.json', 'spaces.json']));

    const messages = entries.get('messages.jsonl')!.toString('utf8');
    expect(messages).toContain('"mine"');
    expect(messages).not.toContain('bobs secret words');
    const files = [...entries.keys()].filter((name) => name.startsWith('files/'));
    expect(files).toHaveLength(1);
    expect(entries.get(files[0]!)!.toString()).toBe('picture bytes');
  });

  it('holds no credential: nothing in it opens the account', async () => {
    await ask();
    await built();
    const account = JSON.parse(readZip(await download()).get('account.json')!.toString('utf8')) as Record<string, unknown>;
    expect(account.username).toBe('alice');
    expect(account).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(account)).not.toContain('right');
  });

  it('keeps a file name inside its folder, whatever it was called', async () => {
    await ask();
    await built();
    const names = [...readZip(await download()).keys()];
    expect(names.some((name) => name.includes('..'))).toBe(false);
    expect(names.some((name) => /^files\/attachments\/a1-evil name\.png$/.test(name))).toBe(true);
  });

  it('opens with the tools people have', async () => {
    const hasUnzip = spawnSync('unzip', ['-v']).status === 0;
    await ask();
    await built();
    const zipPath = path.join(dirs.exportDir, 'check.zip');
    fs.writeFileSync(zipPath, await download());
    if (hasUnzip) {
      expect(execFileSync('unzip', ['-tq', zipPath]).toString()).toContain('No errors');
    } else {
      expect(readZip(fs.readFileSync(zipPath)).size).toBeGreaterThan(3);
    }
  });

  it('is served to the person alone', async () => {
    await ask();
    await built();
    currentUserId = 'bob';
    const res = await app.inject({ method: 'GET', url: '/api/users/@me/data-export/download' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('data_export_not_ready');
  });

  it('is gone after its week, and so is one of a deleted account', async () => {
    const { sweepDataExports, dataExportFile } = await import('../utils/dataExport.js');
    await ask();
    await built();
    const [row] = testDb.select().from(schema.dataExports).all();
    expect(fs.existsSync(path.join(dirs.exportDir, `${row!.id}.zip`))).toBe(true);
    await sweepDataExports(row!.expiresAt + 1);
    expect(testDb.select().from(schema.dataExports).all()).toEqual([]);
    expect(fs.existsSync(path.join(dirs.exportDir, `${row!.id}.zip`))).toBe(false);

    expect((await ask()).statusCode).toBe(202);
    await built();
    testDb.update(schema.users).set({ isDeleted: 1 }).where(eq(schema.users.id, 'alice')).run();
    await sweepDataExports();
    expect(dataExportFile('alice')).toBeNull();
  });

  it('does not survive a build a restart cut off', async () => {
    const { sweepDataExports } = await import('../utils/dataExport.js');
    testDb.insert(schema.dataExports).values({ id: 'stale', userId: 'alice', status: 'pending', createdAt: Date.now() - 2 * 3600_000, expiresAt: Date.now() + 1000 }).run();
    await sweepDataExports();
    expect(testDb.select().from(schema.dataExports).all()[0]!.status).toBe('failed');
  });
});
