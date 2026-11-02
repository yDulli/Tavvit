import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import * as schema from '../db/schema.js';

// A socket is let in once, and then has to keep being allowed: when its session ends it
// closes, with a code the client signs out on. These use the real ConnectionManager.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
}

const { connectionManager } = await import('./handler.js');

function fakeSocket() {
  const socket = { readyState: 1, sent: [] as Array<Record<string, unknown>>, closedWith: null as number | null };
  return Object.assign(socket, {
    send: (data: string) => { socket.sent.push(JSON.parse(data) as Record<string, unknown>); },
    close: (code: number) => { socket.closedWith = code; socket.readyState = 3; },
    ping: () => {},
    terminate: () => {},
  });
}

const added: Array<ReturnType<typeof fakeSocket>> = [];
function open(userId: string, access: { sessionId: string | null; issuedAt?: number; expiresAt?: number }) {
  const ws = fakeSocket();
  added.push(ws);
  connectionManager.addConnection(userId, ws as unknown as WebSocket, access);
  return ws;
}

function session(id: string, userId: string, expiresAt = Date.now() + 60_000): void {
  testDb.insert(schema.sessions).values({ id, userId, createdAt: 1, lastActiveAt: 1, expiresAt }).run();
}

beforeEach(() => {
  for (const ws of added.splice(0)) connectionManager.removeConnection(ws as unknown as WebSocket);
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  for (const id of ['alice', 'bob']) testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
});

describe('ending a session', () => {
  it('closes its sockets with the code the client signs out on', () => {
    const ws = open('alice', { sessionId: 's1' });
    connectionManager.closeSessionSockets(new Set(['s1']));
    expect(ws.sent).toEqual([expect.objectContaining({ type: 'error', code: 'session_ended' })]);
    expect(ws.closedWith).toBe(4001);
  });

  it('leaves the same person on another device alone, so a call there goes on', () => {
    const here = open('alice', { sessionId: 's1' });
    const there = open('alice', { sessionId: 's2' });
    connectionManager.closeSessionSockets(new Set(['s1']));
    expect(here.closedWith).toBe(4001);
    expect(there.closedWith).toBeNull();
    expect(there.sent).toEqual([]);
  });

  it('touches no socket from before sessions', () => {
    const ws = open('alice', { sessionId: null });
    connectionManager.closeSessionSockets(new Set(['s1']));
    expect(ws.closedWith).toBeNull();
  });
});

describe('checking open sockets again', () => {
  it('keeps what is still allowed', () => {
    session('s1', 'alice');
    const ws = open('alice', { sessionId: 's1' });
    connectionManager.revalidateSockets();
    expect(ws.closedWith).toBeNull();
  });

  it('closes a socket whose session ended outside the routes: tavvit-admin runs in its own process', () => {
    session('s1', 'alice');
    const ws = open('alice', { sessionId: 's1' });
    testDb.delete(schema.sessions).where(eq(schema.sessions.id, 's1')).run();
    connectionManager.revalidateSockets();
    expect(ws.sent[0]).toMatchObject({ code: 'session_ended' });
    expect(ws.closedWith).toBe(4001);
  });

  it('closes a socket whose session ran out', () => {
    session('s1', 'alice', Date.now() - 1);
    const ws = open('alice', { sessionId: 's1' });
    connectionManager.revalidateSockets();
    expect(ws.closedWith).toBe(4001);
  });

  it('closes a person\'s socket with no session: there is no way to end it', () => {
    const ws = open('alice', { sessionId: null });
    connectionManager.revalidateSockets(Date.now());
    expect(ws.closedWith).toBe(4001);
    expect(ws.sent[0]).toMatchObject({ code: 'session_ended' });
  });

  it('closes the sockets of a deleted account, with that code', () => {
    session('s1', 'alice');
    const ws = open('alice', { sessionId: 's1' });
    testDb.update(schema.users).set({ isDeleted: 1 }).where(eq(schema.users.id, 'alice')).run();
    connectionManager.revalidateSockets();
    expect(ws.sent[0]).toMatchObject({ code: 'account_deleted' });
  });
});
