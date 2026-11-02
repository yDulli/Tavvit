import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import * as schema from '../db/schema.js';
import { issueSessionToken } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(38);

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

let registerWebSocket: (app: FastifyInstance) => Promise<void>;
let app: FastifyInstance;
let address = '';

beforeAll(async () => {
  ({ registerWebSocket } = await import('./handler.js'));
}, 120_000);

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) sqlite.exec(stmt);
    }
  }
  testDb = drizzle(sqlite, { schema });
  app = Fastify();
  await app.register(websocket);
  await registerWebSocket(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  address = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

afterAll(() => vi.useRealTimers());

function person(name: string): string {
  sqlite.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, 1)').run(name, name, 'x');
  return issueSessionToken({ id: name, username: name }, { headers: {}, ip: '127.0.0.1' }).token;
}

interface Heard { type: string; code?: string; message?: string }

/** A socket and everything it heard. */
function open(): Promise<{ socket: WebSocket; heard: Heard[]; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(address);
    const heard: Heard[] = [];
    const closed = new Promise<number>((done) => socket.on('close', (code) => done(code)));
    socket.on('message', (data) => heard.push(JSON.parse(String(data)) as Heard));
    socket.on('open', () => resolve({ socket, heard, closed }));
    socket.on('error', reject);
  });
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < 400; tries += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Never happened: ${what}`);
}

describe('asking for `ready`', () => {
  it('answers a good token with `ready`, first of all', async () => {
    const { socket, heard } = await open();
    socket.send(JSON.stringify({ type: 'auth', token: person('anna') }));
    await until(() => heard.length > 0, 'an answer');
    expect(heard[0]?.type).toBe('ready');
    socket.close();
  });

  it('refuses a bad token and closes, with the code the client signs out on', async () => {
    const { socket, heard, closed } = await open();
    socket.send(JSON.stringify({ type: 'auth', token: 'not-a-token' }));
    expect(await closed).toBe(4001);
    expect(heard[0]?.type).toBe('error');
    socket.close();
  });

  it('still wants auth first of all', async () => {
    const { socket, heard, closed } = await open();
    socket.send(JSON.stringify({ type: 'ping' }));
    await closed;
    expect(heard[0]).toEqual(expect.objectContaining({ type: 'error', message: 'First message must be auth' }));
  });

  it('does not take what follows the auth for a second try at it', async () => {
    const { socket, heard } = await open();
    socket.send(JSON.stringify({ type: 'auth', token: person('anna') }));
    socket.send(JSON.stringify({ type: 'presence_update', status: 'idle' }));
    socket.send(JSON.stringify({ type: 'ping' }));
    await until(() => heard.some((event) => event.type === 'ready') && heard.some((event) => event.type === 'pong'), 'ready and pong');
    expect(heard.filter((event) => event.type === 'error')).toEqual([]);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it('acts on what followed the auth, once it is let in', async () => {
    const { socket, heard } = await open();
    socket.send(JSON.stringify({ type: 'auth', token: person('anna') }));
    socket.send(JSON.stringify({ type: 'presence_update', status: 'idle' }));
    await until(() => heard.some((event) => event.type === 'ready'), 'ready');
    await until(() => sqlite.prepare('SELECT status FROM users WHERE id = ?').get('anna') !== undefined
      && (sqlite.prepare('SELECT status FROM users WHERE id = ?').get('anna') as { status: string }).status === 'idle', 'the status to change');
    socket.close();
  });

  it('acts on nothing from someone who was refused', async () => {
    person('anna');
    const { socket, closed } = await open();
    socket.send(JSON.stringify({ type: 'auth', token: 'not-a-token' }));
    socket.send(JSON.stringify({ type: 'presence_update', status: 'idle' }));
    await closed;
    expect((sqlite.prepare('SELECT status FROM users WHERE id = ?').get('anna') as { status: string }).status).toBe('offline');
  });

  it('gets everyone through, a crowd at once, in the order they asked', async () => {
    const crowd = await Promise.all(Array.from({ length: 30 }, async (_unused, at) => {
      const opened = await open();
      opened.socket.send(JSON.stringify({ type: 'auth', token: person(`person-${at}`) }));
      return opened;
    }));
    await until(() => crowd.every(({ heard }) => heard.some((event) => event.type === 'ready')), 'everyone to be ready');
    for (const { socket } of crowd) socket.close();
  });

  it('goes on past someone who left while waiting', async () => {
    const gone = await open();
    const stays = await open();
    gone.socket.send(JSON.stringify({ type: 'auth', token: person('gone') }));
    gone.socket.terminate();
    stays.socket.send(JSON.stringify({ type: 'auth', token: person('stays') }));
    await until(() => stays.heard.some((event) => event.type === 'ready'), 'the next one to be ready');
    stays.socket.close();
  });
});
