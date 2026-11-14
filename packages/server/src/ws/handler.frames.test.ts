import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

// Nothing a client sends over the socket may end the process. Before 1.41.4 the JSON text `null`
// did, from anyone and before any token: `JSON.parse` answers null, and reading its `type` threw
// out of the socket's listener, which ends a Node process. Every call and every connection of
// the instance went with it.

setWorkerId(39);

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

let registerWebSocket: (app: FastifyInstance) => Promise<void>;
let isSocketFrame: (value: unknown) => boolean;
let app: FastifyInstance;
let address = '';
/** What would have ended the process, had the test runner not been listening. */
let escaped: unknown[] = [];
const onEscaped = (error: unknown): void => { escaped.push(error); };

beforeAll(async () => {
  ({ registerWebSocket, isSocketFrame } = await import('./handler.js'));
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
  escaped = [];
  process.on('uncaughtException', onEscaped);
});

afterEach(async () => {
  process.off('uncaughtException', onEscaped);
  await app.close();
  sqlite.close();
});

function person(name: string): string {
  sqlite.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, 1)').run(name, name, 'x');
  return issueSessionToken({ id: name, username: name }, { headers: {}, ip: '127.0.0.1' }).token;
}

interface Heard { type: string; code?: string; message?: string }

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

/** Signed in, with its `ready` heard. */
async function signedIn(name: string): Promise<{ socket: WebSocket; heard: Heard[]; closed: Promise<number> }> {
  const opened = await open();
  opened.socket.send(JSON.stringify({ type: 'auth', token: person(name) }));
  await until(() => opened.heard.some((event) => event.type === 'ready'), `${name}'s ready`);
  return opened;
}

/** JSON that parses and is no object: none of it is a frame. */
const NOT_FRAMES = ['null', '[]', '[null]', '5', '"auth"', 'true'];

describe('a frame', () => {
  it('is a JSON object and nothing else', () => {
    expect(isSocketFrame({ type: 'ping' })).toBe(true);
    expect(isSocketFrame({})).toBe(true);
    for (const text of NOT_FRAMES) expect(isSocketFrame(JSON.parse(text))).toBe(false);
  });
});

describe('JSON that is no frame', () => {
  it('from someone who has not signed in ends their socket, and nothing else', async () => {
    for (const text of NOT_FRAMES) {
      const { socket, heard, closed } = await open();
      socket.send(text);
      await closed;
      expect(heard[0]).toEqual(expect.objectContaining({ type: 'error', message: 'First message must be auth' }));
    }
    // The server is still there for the next person.
    const next = await signedIn('anna');
    next.socket.close();
    expect(escaped).toEqual([]);
  });

  it('from someone signed in is refused, and their socket goes on', async () => {
    const { socket, heard } = await signedIn('anna');
    for (const text of NOT_FRAMES) socket.send(text);
    socket.send(JSON.stringify({ type: 'ping' }));
    await until(() => heard.some((event) => event.type === 'pong'), 'the pong after them');
    expect(heard.filter((event) => event.type === 'error').map((event) => event.message)).toEqual(NOT_FRAMES.map(() => 'Invalid JSON'));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
    expect(escaped).toEqual([]);
  });

  it('sent while waiting for `ready` is refused too, and `ready` still comes', async () => {
    const { socket, heard } = await open();
    socket.send(JSON.stringify({ type: 'auth', token: person('anna') }));
    socket.send('null');
    socket.send(JSON.stringify({ type: 'ping' }));
    await until(() => heard.some((event) => event.type === 'ready') && heard.some((event) => event.type === 'pong'), 'ready and pong');
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
    expect(escaped).toEqual([]);
  });

  it('with fields of every wrong kind in a real event ends nothing either', async () => {
    const { socket, heard } = await signedIn('anna');
    const wrong = { channelId: {}, messageId: [], content: { a: 1 }, emoji: [], dmChannelId: null, userId: 5, status: {}, activities: 'x', spaceId: [], targetUserId: {}, threadId: {} };
    for (const type of ['message_create', 'message_edit', 'reaction_add', 'channel_ack', 'mark_unread', 'voice_join', 'voice_status', 'dm_message_create', 'activity_update', 'presence_update', 'thread_watch', 'typing_start']) {
      socket.send(JSON.stringify({ type, ...wrong }));
    }
    socket.send(JSON.stringify({ type: 'ping' }));
    await until(() => heard.some((event) => event.type === 'pong'), 'the pong after them');
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
    expect(escaped).toEqual([]);
  });
});

// Every refused frame was still unpacked, parsed and answered, for as long as a client liked, and a
// client that read none of the answers made the server keep them all (security audit, 2026-11-14).
describe('frames nobody should be sending', () => {
  it('that are not JSON end the socket of someone who has not signed in', async () => {
    const { socket, heard, closed } = await open();
    socket.send('x');
    socket.send('x');
    await closed;
    expect(heard).toEqual([expect.objectContaining({ type: 'error', message: 'Invalid JSON' })]);
    expect(escaped).toEqual([]);
  });

  it('are answered a while and then end the socket of someone signed in', async () => {
    const { socket, heard, closed } = await signedIn('anna');
    for (let sent = 0; sent < 260; sent += 1) socket.send('not json');
    const code = await closed;
    expect(code).toBe(1008);
    const refusals = heard.filter((event) => event.type === 'error').length;
    expect(refusals).toBe(200);
    // Others are not touched by it.
    const next = await signedIn('ben');
    next.socket.close();
    expect(escaped).toEqual([]);
  });

  it('do not count against someone whose frames are otherwise taken', async () => {
    const { socket, heard } = await signedIn('anna');
    for (let round = 0; round < 3; round += 1) {
      for (let sent = 0; sent < 150; sent += 1) socket.send('not json');
      // A frame that is taken starts the count again.
      socket.send(JSON.stringify({ type: 'client_focus', focused: true }));
    }
    socket.send(JSON.stringify({ type: 'ping' }));
    await until(() => heard.some((event) => event.type === 'pong'), 'the pong after them');
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });

  it('get no more pongs than a client has reason to ask for', async () => {
    const { socket, heard } = await signedIn('anna');
    for (let sent = 0; sent < 80; sent += 1) socket.send(JSON.stringify({ type: 'ping' }));
    socket.send(JSON.stringify({ type: 'client_focus', focused: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(heard.filter((event) => event.type === 'pong')).toHaveLength(20);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  });
});

describe('a timer\'s work', () => {
  it('that throws is written down, not thrown out of the timer', async () => {
    const { onTimer } = await import('./handler.js');
    const written = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const work = onTimer('finalizing a disconnect', () => { throw new Error('the database is busy'); });
    expect(work).not.toThrow();
    expect(written).toHaveBeenCalledWith('[ws] finalizing a disconnect failed:', expect.any(Error));
    written.mockRestore();
    // And work that does not throw is simply done.
    const done = vi.fn();
    onTimer('sending presence', done)();
    expect(done).toHaveBeenCalledOnce();
  });
});

describe('a read state', () => {
  it('points at a message id, never at a run of digits no id has', async () => {
    const { socket, heard } = await signedIn('anna');
    testDb.insert(schema.channels).values({ id: 'chat', spaceId: 'space', name: 'chat', type: 'text', position: 0, categoryId: null, createdAt: 1 }).run();
    testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId: 'anna', joinedAt: 1 }).run();
    const stored = (): string | undefined => (sqlite.prepare('SELECT last_read_message_id AS id FROM read_states WHERE user_id = ? AND channel_id = ?').get('anna', 'chat') as { id: string } | undefined)?.id;

    // Before 1.41.4 any run of digits was kept, as long as a frame may be.
    for (const type of ['channel_ack', 'mark_unread']) {
      socket.send(JSON.stringify({ type, channelId: 'chat', messageId: '9'.repeat(5000) }));
      socket.send(JSON.stringify({ type, channelId: 'chat', messageId: '9'.repeat(20) }));
      socket.send(JSON.stringify({ type, channelId: 'chat', messageId: 12 }));
      socket.send(JSON.stringify({ type, channelId: ['chat'], messageId: '12' }));
    }
    socket.send(JSON.stringify({ type: 'ping' }));
    await until(() => heard.some((event) => event.type === 'pong'), 'the pong after them');
    expect(stored()).toBeUndefined();

    socket.send(JSON.stringify({ type: 'channel_ack', channelId: 'chat', messageId: '378566639800381440' }));
    await until(() => stored() === '378566639800381440', 'the read state');
    socket.close();
    expect(escaped).toEqual([]);
  });
});

describe('a fault of the server\'s own while someone signs in', () => {
  it('closes their socket as a server fault, and does not tell their client to sign out', async () => {
    const token = person('anna');
    // Whatever `ready` reads first is gone: the token is good, the server is what fails.
    sqlite.exec('DROP TABLE space_members');
    const { socket, heard, closed } = await open();
    socket.send(JSON.stringify({ type: 'auth', token }));
    expect(await closed).toBe(1011);
    // 4001 with a code is what makes a client drop its token (useWebSocket.ts).
    expect(heard.filter((event) => event.type === 'error')).toEqual([]);
    socket.close();
    expect(escaped).toEqual([]);
  });
});
