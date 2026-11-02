import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { PUSH_LIMITS } from '@backspace/shared/src/push.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(26);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

const { pushRoutes } = await import('./push.js');
const { _resetVapidKeys } = await import('../utils/pushDelivery.js');

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const USER = 'user-1';
const OTHER = 'user-2';
const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });
const P256DH = `B${'A'.repeat(86)}`;
const AUTH = 'A'.repeat(22);
const body = (endpoint: string, extra: Record<string, unknown> = {}) => ({ endpoint, keys: { p256dh: P256DH, auth: AUTH }, ...extra });
const subscribe = (userId: string, payload: unknown) => app.inject({ method: 'POST', url: '/api/push/subscriptions', headers: headers(userId), payload: payload as Record<string, unknown> });
const devices = () => testDb.select().from(schema.pushSubscriptions).all();

beforeEach(async () => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  _resetVapidKeys();
  for (const id of [USER, OTHER]) testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  app = Fastify();
  await app.register(pushRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe('a device registering', () => {
  it('needs an account, for the key and for the rest', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/push/key' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/push/subscriptions', payload: body('https://fcm.googleapis.com/x') })).statusCode).toBe(401);
    const key = await app.inject({ method: 'GET', url: '/api/push/key', headers: headers(USER) });
    expect(key.json().publicKey).toMatch(/^[\w-]{80,}$/);
    expect(key.body).not.toContain('private');
  });

  it('takes only an address at a push service, whatever else it says', async () => {
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.example/x']) {
      const res = await subscribe(USER, body(endpoint));
      expect(res.statusCode, endpoint).toBe(400);
      expect(res.json().details).toEqual({ field: 'endpoint' });
    }
    expect(devices()).toEqual([]);
  });

  it('takes only keys it can encrypt for', async () => {
    const bad = await subscribe(USER, { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'short', auth: AUTH } });
    expect(bad.json().details).toEqual({ field: 'keys' });
    expect((await subscribe(USER, { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: P256DH, auth: 'short' } })).statusCode).toBe(400);
    expect((await subscribe(USER, { endpoint: 'https://fcm.googleapis.com/x' })).statusCode).toBe(400);
  });

  it('keeps the device\'s own choices', async () => {
    expect((await subscribe(USER, body('https://fcm.googleapis.com/x', { showText: false, directMessages: false, locale: 'de' }))).statusCode).toBe(201);
    expect(devices()[0]).toMatchObject({ userId: USER, showText: false, directMessages: false, locale: 'de' });
    await subscribe(USER, body('https://fcm.googleapis.com/x', { showText: true, locale: 'klingon' }));
    expect(devices()).toHaveLength(1);
    expect(devices()[0]).toMatchObject({ showText: true, locale: null });
  });

  it('gives one browser to whoever signed in on it last', async () => {
    await subscribe(USER, body('https://fcm.googleapis.com/shared'));
    await subscribe(OTHER, body('https://fcm.googleapis.com/shared'));
    expect(devices()).toHaveLength(1);
    expect(devices()[0]?.userId).toBe(OTHER);
  });

  it('keeps as many devices as allowed, the newest ones', async () => {
    for (let i = 0; i <= PUSH_LIMITS.DEVICES_MAX; i += 1) {
      await subscribe(USER, body(`https://fcm.googleapis.com/device-${i}`));
      await new Promise((resolve) => { setTimeout(resolve, 2); });
    }
    const left = devices().map((row) => row.endpoint);
    expect(left).toHaveLength(PUSH_LIMITS.DEVICES_MAX);
    expect(left).not.toContain('https://fcm.googleapis.com/device-0');
  });

  it('is refused for an account of another instance, whose home holds its devices', async () => {
    testDb.update(schema.users).set({ homeInstance: 'https://peer.example' }).where(eq(schema.users.id, USER)).run();
    expect((await subscribe(USER, body('https://fcm.googleapis.com/x'))).statusCode).toBe(403);
  });
});

describe('a device leaving', () => {
  it('goes by its address, and only an account\'s own', async () => {
    await subscribe(USER, body('https://fcm.googleapis.com/x'));
    const remove = (userId: string) => app.inject({ method: 'DELETE', url: '/api/push/subscriptions', headers: headers(userId), payload: { endpoint: 'https://fcm.googleapis.com/x' } });
    await remove(OTHER);
    expect(devices()).toHaveLength(1);
    expect((await remove(USER)).statusCode).toBe(200);
    expect(devices()).toEqual([]);
  });

  it('goes with the session it was made in', async () => {
    testDb.insert(schema.sessions).values({ id: 'session-1', userId: USER, createdAt: 1, lastActiveAt: 1, expiresAt: Date.now() + 86_400_000 }).run();
    const token = signJwt({ userId: USER, username: USER, sid: 'session-1' });
    const res = await app.inject({ method: 'POST', url: '/api/push/subscriptions', headers: { authorization: `Bearer ${token}` }, payload: body('https://fcm.googleapis.com/s') });
    expect(res.statusCode).toBe(201);
    expect(devices()[0]?.sessionId).toBe('session-1');
    sqlite.pragma('foreign_keys = ON');
    testDb.delete(schema.sessions).where(eq(schema.sessions.id, 'session-1')).run();
    expect(devices()).toEqual([]);
  });
});
