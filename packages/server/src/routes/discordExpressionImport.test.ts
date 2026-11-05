import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import type { DiscordExpressionApplyResult, DiscordExpressionListing, DiscordExpressionPreview } from '@backspace/shared/src/discordExpressionImport.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// Bringing a Discord server's emoji and stickers into a space: refused before Discord is asked when
// the request may not go on, planned and imported in batches without the token, idempotent by
// Discord id, stopped by a full storage, and the bot token never kept anywhere: not in a response,
// a log line, a table, an audit entry or an event.

setWorkerId(34);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
let uploadDir: string;
let logLines: string[];

/** A token in Discord's shape that this test looks for everywhere afterwards. */
const SENTINEL_TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GsEnTi.SentinelBotTokenValue0123456789';
const GUILD = '987654321098765432';

const { sent, discord } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; args: unknown[] }>,
  discord: {
    calls: [] as Array<{ guildId: string; token: string }>,
    listing: { emojis: [], stickers: [] } as DiscordExpressionListing,
    failure: null as null | { ok: false; status: number; code: string; details?: Record<string, number> },
    assetCalls: [] as string[],
    brokenAssets: new Set<string>(),
    picture: Buffer.alloc(0),
    /** When set, every picture fetch waits for it. */
    gate: null as Promise<void> | null,
    /** Runs before the n-th picture fetch answers (1-based). */
    onFetch: null as null | ((n: number) => void),
  },
}));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../config.js', async () => {
  const real = await import('../config.js');
  return {
    config: new Proxy(real.config, {
      get(target, prop: string) {
        if (prop === 'uploadDir' || prop === 'tusUploadDir') return uploadDir;
        return (target as Record<string, unknown>)[prop];
      },
    }),
  };
});

vi.mock('../utils/federationAuth.js', () => ({ getOurOrigin: () => 'https://chat.test' }));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
      sent.push({ to: String(name), args });
      return undefined;
    },
  }),
}));

// Discord itself is not reached from a test: the two list requests and the pictures are answered
// here. Parsing the token stays the real code.
vi.mock('../utils/discordApi.js', async () => {
  const real = await vi.importActual<typeof import('../utils/discordApi.js')>('../utils/discordApi.js');
  return {
    ...real,
    listGuildExpressions: async (guildId: string, token: string) => {
      discord.calls.push({ guildId, token });
      return discord.failure ?? { ok: true, listing: discord.listing };
    },
    fetchDiscordAsset: async (url: string) => {
      discord.assetCalls.push(url);
      if (discord.gate) await discord.gate;
      discord.onFetch?.(discord.assetCalls.length);
      return discord.brokenAssets.has(url) ? null : discord.picture;
    },
  };
});

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const OWNER = 'user-owner';
const KEEPER = 'user-keeper';
const MEMBER = 'user-member';
const SPACE = 'space-1';

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { discordExpressionImportRoutes, _resetDiscordExpressionPreviewLimit } = await import('./discordExpressionImport.js');
const { _resetDiscordSessionsForTests } = await import('../utils/discordExpressionSessions.js');

const emoji = (n: number, name: string, extra: Partial<DiscordExpressionListing['emojis'][number]> = {}) => ({
  discordId: `1000000000000000${String(n).padStart(2, '0')}`, name, animated: false, managed: false, roleRestricted: false, ...extra,
});

const LISTING: DiscordExpressionListing = {
  emojis: [
    emoji(1, 'PartyParrot'),
    emoji(2, 'wave', { roleRestricted: true }),
    emoji(3, 'sub_hype', { managed: true }),
  ],
  stickers: [
    { discordId: '200000000000000001', name: 'Hello there', format: 'png' },
    { discordId: '200000000000000002', name: 'Dance', format: 'lottie' },
  ],
};

beforeEach(async () => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-discord-expressions-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  discord.calls.length = 0;
  discord.assetCalls.length = 0;
  discord.brokenAssets.clear();
  discord.gate = null;
  discord.onFetch = null;
  discord.failure = null;
  discord.listing = LISTING;
  discord.picture = await sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 120, g: 90, b: 230, alpha: 1 } } }).png().toBuffer();
  _resetDiscordExpressionPreviewLimit();
  _resetDiscordSessionsForTests();
  for (const id of [OWNER, KEEPER, MEMBER]) testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  for (const id of [OWNER, KEEPER, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-keeper', spaceId: SPACE, name: 'Keepers', position: 1, permissions: permissionsToString(PermissionBits.MANAGE_EMOJIS), createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: KEEPER, roleId: 'role-keeper' }).run();
  logLines = [];
  const stream = new Writable({ write(chunk, _encoding, done) { logLines.push(String(chunk)); done(); } });
  // Every level, so a log line anywhere on the way would be seen.
  app = Fastify({ logger: { level: 'trace', stream } });
  await app.register(discordExpressionImportRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

const preview = (userId = KEEPER, payload: Record<string, unknown> = {}) => app.inject({
  method: 'POST', url: '/api/import/discord/expressions/preview', headers: headers(userId),
  payload: { spaceId: SPACE, guildId: GUILD, token: SENTINEL_TOKEN, ...payload },
});
const apply = (importId: string, userId = KEEPER, selection?: string[], after?: number) => app.inject({
  method: 'POST', url: '/api/import/discord/expressions/apply', headers: headers(userId),
  payload: { importId, ...(selection ? { selection } : {}), ...(after !== undefined ? { after } : {}) },
});

/** Calls apply as the page does, with its cursor, until the import says it is through or stopped. */
async function runToEnd(importId: string, userId = KEEPER, selection?: string[]): Promise<DiscordExpressionApplyResult[]> {
  const batches: DiscordExpressionApplyResult[] = [];
  let after = 0;
  for (let first = true; batches.length < 50; first = false) {
    const response = await apply(importId, userId, first ? selection : undefined, after);
    expect(response.statusCode).toBe(200);
    const batch = response.json() as DiscordExpressionApplyResult;
    after += batch.results.length;
    batches.push(batch);
    if (batch.finished || batch.stopped) break;
  }
  return batches;
}

describe('before Discord is asked', () => {
  it('refuses a member without the right, a server id that is none and a token that is none', async () => {
    const member = await preview(MEMBER);
    expect(member.statusCode).toBe(403);
    expect(member.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'MANAGE_EMOJIS' } });
    const badGuild = await preview(KEEPER, { guildId: '12ab' });
    expect(badGuild.json().code).toBe('discord_server_id_invalid');
    const badToken = await preview(KEEPER, { token: 'not a token' });
    expect(badToken.statusCode).toBe(400);
    expect(badToken.json().code).toBe('discord_bot_token_invalid');
    expect(discord.calls).toHaveLength(0);
  });

  it('passes a refusal from Discord on, never as a 401 that would end the session in the app', async () => {
    discord.failure = { ok: false, status: 400, code: 'discord_bot_token_invalid' };
    const response = await preview(KEEPER);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('discord_bot_token_invalid');
  });

  it('counts look-ups per account', async () => {
    for (let index = 0; index < 5; index += 1) expect((await preview(KEEPER)).statusCode).toBe(200);
    const sixth = await preview(KEEPER);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().code).toBe('rate_limited');
    expect(discord.calls).toHaveLength(5);
  });
});

describe('the import', () => {
  it('plans what comes over under which name and why the rest stays', async () => {
    const response = await preview(KEEPER);
    expect(response.statusCode).toBe(200);
    const body = response.json() as DiscordExpressionPreview;
    expect(discord.calls).toEqual([{ guildId: GUILD, token: SENTINEL_TOKEN }]);
    expect(body.room).toEqual({ emoji: 200, stickers: 60 });
    const byName = Object.fromEntries(body.items.map((item) => [item.sourceName, item]));
    expect(byName.PartyParrot).toMatchObject({ action: 'import', name: 'partyparrot', notes: ['renamed'] });
    expect(byName.wave).toMatchObject({ action: 'import', name: 'wave', notes: ['role_restriction_dropped'] });
    expect(byName.sub_hype).toMatchObject({ action: 'skip', skip: 'managed' });
    expect(byName['Hello there']).toMatchObject({ action: 'import', name: 'Hello there' });
    expect(byName.Dance).toMatchObject({ action: 'skip', skip: 'lottie' });
  });

  it('brings everything that fits, records it once, and finds it already here the next time', async () => {
    const { importId } = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    const batches = await runToEnd(importId);
    const last = batches.at(-1)!;
    expect(last).toMatchObject({ finished: true, stopped: null, done: 5, total: 5 });
    const outcomes = Object.fromEntries(batches.flatMap((batch) => batch.results).map((result) => [result.discordId, result.outcome]));
    expect(outcomes).toEqual({
      '100000000000000001': 'imported',
      '100000000000000002': 'imported',
      '100000000000000003': 'managed',
      '200000000000000001': 'imported',
      '200000000000000002': 'lottie',
    });

    const emojis = testDb.select().from(schema.spaceEmojis).all();
    expect(emojis.map((row) => [row.name, row.discordId, row.createdBy]).sort()).toEqual([
      ['partyparrot', '100000000000000001', KEEPER],
      ['wave', '100000000000000002', KEEPER],
    ]);
    expect(testDb.select().from(schema.spaceStickers).all()).toMatchObject([{ name: 'Hello there', discordId: '200000000000000001' }]);
    // Only Discord's content servers, never with the token.
    expect(discord.assetCalls.every((url) => url.startsWith('https://cdn.discordapp.com/') || url.startsWith('https://media.discordapp.net/'))).toBe(true);
    expect(testDb.select({ at: schema.spaces.discordImportedAt }).from(schema.spaces).where(eq(schema.spaces.id, SPACE)).get()!.at).not.toBeNull();
    const audit = testDb.select().from(schema.spaceAuditLog).where(eq(schema.spaceAuditLog.action, 'discord_expressions_import')).all();
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.changes!)).toEqual([{ key: 'emoji', to: 2 }, { key: 'stickers', to: 1 }]);
    expect(sent.some((entry) => (entry.args[1] as { type?: string })?.type === 'space_emojis_changed')).toBe(true);
    expect(sent.some((entry) => (entry.args[1] as { type?: string })?.type === 'space_stickers_changed')).toBe(true);
    // Over: asking again brings the outcome again, with everything after the cursor.
    const late = (await apply(importId, KEEPER, undefined, 0)).json() as DiscordExpressionApplyResult;
    expect(late).toMatchObject({ finished: true, done: 5, total: 5, stopped: null });
    expect(late.results).toHaveLength(5);
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(2);

    const again = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    expect(again.items.filter((item) => item.action === 'import')).toHaveLength(0);
    expect(again.items.filter((item) => item.skip === 'already_here')).toHaveLength(3);
  });

  it('works in batches small enough for one request each', async () => {
    discord.listing = { emojis: Array.from({ length: 10 }, (_, index) => emoji(index + 10, `e${index}`)), stickers: [] };
    const { importId } = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    const batches = await runToEnd(importId);
    expect(batches.map((batch) => [batch.done, batch.total, batch.finished])).toEqual([[8, 10, false], [10, 10, true]]);
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(10);
  });

  it('brings only what was picked, and a pick must come from the listing', async () => {
    const { importId } = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    const stranger = await apply(importId, KEEPER, ['emoji:111111111111111111']);
    expect(stranger.statusCode).toBe(400);
    expect(stranger.json()).toMatchObject({ code: 'validation_failed', details: { field: 'selection' } });
    const batches = await runToEnd(importId, KEEPER, ['emoji:100000000000000002']);
    expect(batches.at(-1)).toMatchObject({ finished: true, done: 1, total: 1 });
    expect(batches.flatMap((batch) => batch.results)).toEqual([
      expect.objectContaining({ discordId: '100000000000000002', outcome: 'imported', name: 'wave' }),
    ]);
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(1);
  });

  it('reports a picture that could not be had and brings the rest', async () => {
    discord.brokenAssets.add('https://cdn.discordapp.com/emojis/100000000000000001.png');
    const { importId } = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    const results = (await runToEnd(importId)).flatMap((batch) => batch.results);
    expect(results.find((result) => result.discordId === '100000000000000001')?.outcome).toBe('download_failed');
    expect(results.find((result) => result.discordId === '100000000000000002')?.outcome).toBe('imported');
  });

  it('stops when the importer\'s storage is full, and says why', async () => {
    testDb.update(schema.users).set({ storageLimitBytes: 1 }).where(eq(schema.users.id, KEEPER)).run();
    const { importId } = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    const last = (await runToEnd(importId)).at(-1)!;
    expect(last).toMatchObject({ finished: false, stopped: 'storage_limit_reached' });
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(0);
  });

  it('belongs to the account that looked it up, and asks for the right on every batch', async () => {
    const { importId } = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    expect((await apply(importId, OWNER)).json().code).toBe('discord_import_expired');
    testDb.delete(schema.memberRoles).where(eq(schema.memberRoles.userId, KEEPER)).run();
    const refused = await apply(importId, KEEPER);
    expect(refused.statusCode).toBe(403);
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(0);
  });

  it('lets an account run one import at a time, and a new look-up waits for the running one', async () => {
    discord.listing = { emojis: [emoji(10, 'one')], stickers: [] };
    const { importId } = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    let open!: () => void;
    discord.gate = new Promise<void>((resolve) => { open = resolve; });
    const running = apply(importId);
    // Let the batch reach the fetch.
    await vi.waitFor(() => expect(discord.assetCalls).toHaveLength(1));
    const second = await preview(KEEPER);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('discord_import_running');
    const parallel = await apply(importId);
    expect(parallel.json().code).toBe('discord_import_running');
    open();
    expect((await running).json()).toMatchObject({ finished: true, done: 1 });
    expect(discord.calls).toHaveLength(1);
  });

  it('adds nothing more the moment the importer loses the right, mid-batch', async () => {
    discord.listing = { emojis: [emoji(10, 'one'), emoji(11, 'two'), emoji(12, 'three')], stickers: [] };
    const { importId } = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    // The owner takes the role away while the second picture is on its way.
    discord.onFetch = (n) => {
      if (n === 2) testDb.delete(schema.memberRoles).where(eq(schema.memberRoles.userId, KEEPER)).run();
    };
    const first = await apply(importId);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ finished: false, done: 1 });
    expect(testDb.select().from(schema.spaceEmojis).all().map((row) => row.name)).toEqual(['one']);
    expect((await apply(importId)).statusCode).toBe(403);
  });

  it('can be stopped: what came over stays, recorded once', async () => {
    discord.listing = { emojis: Array.from({ length: 10 }, (_, index) => emoji(index + 10, `e${index}`)), stickers: [] };
    const { importId } = (await preview(KEEPER)).json() as DiscordExpressionPreview;
    expect((await apply(importId)).json()).toMatchObject({ done: 8, finished: false });
    const stop = await app.inject({ method: 'DELETE', url: `/api/import/discord/expressions/${importId}`, headers: headers(KEEPER) });
    expect(stop.statusCode).toBe(200);
    expect((await apply(importId)).json().code).toBe('discord_import_expired');
    expect(testDb.select().from(schema.spaceEmojis).all()).toHaveLength(8);
    const audit = testDb.select().from(schema.spaceAuditLog).where(eq(schema.spaceAuditLog.action, 'discord_expressions_import')).all();
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.changes!)).toEqual([{ key: 'emoji', to: 8 }, { key: 'stickers', to: 0 }]);
  });
});

describe('the bot token', () => {
  it('is kept nowhere: no response, log line, table, audit entry, event or console line carries it', async () => {
    const consoleLines: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method)
      .mockImplementation((...args: unknown[]) => { consoleLines.push(args.map(String).join(' ')); }));
    const bodies: string[] = [];
    try {
      // The way through: look-up, import, a second look-up.
      const first = await preview(KEEPER);
      bodies.push(first.body);
      const { importId } = first.json() as DiscordExpressionPreview;
      for (const batch of await runToEnd(importId)) bodies.push(JSON.stringify(batch));
      bodies.push((await preview(KEEPER)).body);
      // The ways out: Discord refuses, the server id is wrong, the right is missing, the body is malformed.
      discord.failure = { ok: false, status: 400, code: 'discord_bot_token_invalid' };
      bodies.push((await preview(KEEPER)).body);
      bodies.push((await preview(KEEPER, { guildId: 'nope' })).body);
      bodies.push((await preview(MEMBER)).body);
      bodies.push((await preview(KEEPER, { extra: 'field', token: `${SENTINEL_TOKEN}${'x'.repeat(300)}` })).body);
      bodies.push((await preview(KEEPER, { token: `Bot ${SENTINEL_TOKEN}` })).body);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    // Discord got it: that is what it is for.
    expect(discord.calls.length).toBeGreaterThan(0);
    expect(discord.calls.every((call) => call.token === SENTINEL_TOKEN)).toBe(true);

    const secretPart = SENTINEL_TOKEN.split('.')[2]!;
    for (const text of [...bodies, ...logLines, ...consoleLines, JSON.stringify(sent)]) {
      expect(text).not.toContain(secretPart);
    }
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const columns = sqlite.pragma(`table_info("${name}")`) as Array<{ name: string; type: string }>;
      for (const column of columns) {
        const hits = sqlite.prepare(`SELECT COUNT(*) AS n FROM "${name}" WHERE CAST("${column.name}" AS TEXT) LIKE ?`).get(`%${secretPart}%`) as { n: number };
        expect({ table: name, column: column.name, hits: hits.n }).toEqual({ table: name, column: column.name, hits: 0 });
      }
    }
  });
});
