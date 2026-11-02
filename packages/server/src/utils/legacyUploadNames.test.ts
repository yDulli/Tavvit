import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;
const state = { uploadDir: '' };

vi.mock('../db/index.js', () => ({ getDb: () => testDb, schema }));
vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return { config: new Proxy(actual.config, {
    get: (target, key) => (key === 'uploadDir' ? state.uploadDir : key === 'jwtSecret' ? 'a-test-secret-that-is-long-enough-1234' : Reflect.get(target, key)),
  }) };
});

const { renameLegacyUploads, renamedUploadName, LEGACY_RENAME_MIN_AGE_MS } = await import('./legacyUploadNames.js');

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt.trim());
    }
  }
}

const NOW = 1_800_000_000_000;
const OLD = NOW - LEGACY_RENAME_MIN_AGE_MS - 1;
const file = (name: string) => path.join(state.uploadDir, name);

function attach(id: string, filename: string, opts: { thumb?: string; createdAt?: number; dm?: boolean; linked?: boolean } = {}): void {
  fs.writeFileSync(file(filename), `bytes of ${filename}`);
  if (opts.thumb) fs.writeFileSync(file(opts.thumb), `thumb of ${filename}`);
  const linked = opts.linked ?? true;
  testDb.insert(schema.attachments).values({
    id, uploaderId: 'u1', filename, originalName: 'photo.png', mimetype: 'image/png', size: 10,
    messageId: linked && !opts.dm ? 'm1' : null, dmMessageId: linked && opts.dm ? 'dm-m1' : null,
    thumbnailFilename: opts.thumb ?? null, createdAt: opts.createdAt ?? OLD,
  }).run();
}

beforeEach(() => {
  state.uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-renames-'));
  const sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sqlite.pragma('foreign_keys = OFF');
  testDb.insert(schema.users).values({ id: 'u1', username: 'u1', passwordHash: 'x', createdAt: 1 }).run();
});

afterEach(() => {
  fs.rmSync(state.uploadDir, { recursive: true, force: true });
});

describe('older uploads named by their snowflake alone', () => {
  it('get a name nobody can guess, with their thumbnail, and the old names are gone', () => {
    attach('1', '375355738666467328.png', { thumb: '375355738666467328_thumb.webp' });
    attach('2', '375355738666467329.mp4', { dm: true });
    const result = renameLegacyUploads(NOW);
    expect(result).toEqual({ renamed: 2, missing: 0, left: false });

    const png = renamedUploadName('375355738666467328.png');
    expect(png).toMatch(/^375355738666467328-[0-9a-f]{32}\.png$/);
    const rows = testDb.select().from(schema.attachments).all();
    expect(rows.find((r) => r.id === '1')).toMatchObject({ filename: png, thumbnailFilename: `${png.slice(0, -4)}_thumb.webp` });
    expect(fs.readFileSync(file(png), 'utf8')).toBe('bytes of 375355738666467328.png');
    expect(fs.existsSync(file('375355738666467328.png'))).toBe(false);
    expect(fs.existsSync(file('375355738666467328_thumb.webp'))).toBe(false);
    expect(fs.existsSync(file(rows.find((r) => r.id === '2')!.filename))).toBe(true);
  });

  it('finishes a run cut off after the new name was made: the same name, no second copy', () => {
    attach('1', '375355738666467328.png');
    fs.linkSync(file('375355738666467328.png'), file(renamedUploadName('375355738666467328.png')));
    expect(renameLegacyUploads(NOW).renamed).toBe(1);
    expect(fs.readdirSync(state.uploadDir)).toEqual([renamedUploadName('375355738666467328.png')]);
    expect(renameLegacyUploads(NOW).renamed).toBe(0);
  });

  it('leaves alone what is newer than a day, not in a message, already renamed, or shown as a picture', () => {
    attach('1', '375355738666467330.png', { createdAt: NOW - 1000 });
    attach('2', '375355738666467331.png', { linked: false });
    attach('3', '375355738666467332-0123456789abcdef0123456789abcdef.png');
    attach('4', '375355738666467333.png');
    testDb.update(schema.users).set({ avatar: '375355738666467333.png' }).run();
    expect(renameLegacyUploads(NOW)).toEqual({ renamed: 0, missing: 0, left: false });
    expect(fs.readdirSync(state.uploadDir).sort()).toEqual([
      '375355738666467330.png', '375355738666467331.png', '375355738666467332-0123456789abcdef0123456789abcdef.png', '375355738666467333.png',
    ]);
  });

  it('counts a row whose file is not on disk, and changes nothing about it', () => {
    attach('1', '375355738666467334.png');
    fs.unlinkSync(file('375355738666467334.png'));
    expect(renameLegacyUploads(NOW)).toEqual({ renamed: 0, missing: 1, left: false });
    expect(testDb.select().from(schema.attachments).all()[0]?.filename).toBe('375355738666467334.png');
  });
});
