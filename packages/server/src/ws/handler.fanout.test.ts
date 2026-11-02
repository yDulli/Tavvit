import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import type { MessageWithUser, ServerEvent } from '@backspace/shared';
import { PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(37);

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, schema }));

const { connectionManager } = await import('./handler.js');
const { collectProfileBroadcastTargetIds } = await import('../utils/userDeletion.js');

const SPACE = 'space-1';
const CHAT = 'chat-1';
const BASE = 360000000000000000n;

interface Frame { type: string; [key: string]: unknown }
type FakeSocket = { readyState: number; send: ReturnType<typeof vi.fn> };

const sockets = new Map<string, FakeSocket>();

function connect(userId: string, { batches = false, spaces = [SPACE] }: { batches?: boolean; spaces?: string[] } = {}): FakeSocket {
  const socket: FakeSocket = { readyState: 1, send: vi.fn() };
  connectionManager.addConnection(userId, socket as unknown as WebSocket, { sessionId: null, batches });
  connectionManager.setUserSpaces(userId, spaces);
  sockets.set(userId, socket);
  return socket;
}

const framesOf = (socket: FakeSocket): Frame[] => socket.send.mock.calls.map(([raw]) => JSON.parse(String(raw)) as Frame);

function addMessage(n: number, userId: string): string {
  const id = String(BASE + BigInt(n));
  sqlite.prepare('INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, 1)').run(id, CHAT, userId, 'x');
  return id;
}

const presence = (userId: string, status: string): ServerEvent => ({ type: 'presence_update', userId, status } as ServerEvent);

beforeEach(() => {
  // Removing the last socket starts the offline grace timer.
  vi.useFakeTimers();
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) sqlite.exec(stmt);
    }
  }
  testDb = drizzle(sqlite, { schema });
  const everyone = permissionsToString(PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY | PermissionBits.SEND_MESSAGES);
  sqlite.exec(`
    INSERT INTO users (id, username, password_hash, created_at) VALUES ('owner', 'owner', 'x', 1), ('alice', 'alice', 'x', 1), ('bob', 'bob', 'x', 1), ('carol', 'carol', 'x', 1), ('dmfriend', 'dmfriend', 'x', 1), ('pal', 'pal', 'x', 1), ('stranger', 'stranger', 'x', 1), ('away', 'away', 'x', 1);
    INSERT INTO spaces (id, name, owner_id, created_at) VALUES ('${SPACE}', 'Space', 'owner', 1);
    INSERT INTO space_members (space_id, user_id, joined_at) VALUES ('${SPACE}', 'owner', 1), ('${SPACE}', 'alice', 1), ('${SPACE}', 'bob', 1), ('${SPACE}', 'carol', 1), ('${SPACE}', 'away', 1);
    INSERT INTO roles (id, space_id, name, permissions, created_at) VALUES ('${SPACE}', '${SPACE}', '@everyone', '${everyone}', 1);
    INSERT INTO channels (id, space_id, name, type, created_at) VALUES ('${CHAT}', '${SPACE}', 'chat', 'text', 1);
    INSERT INTO dm_channels (id, created_at) VALUES ('dm-1', 1);
    INSERT INTO dm_members (dm_channel_id, user_id, closed) VALUES ('dm-1', 'alice', 0), ('dm-1', 'dmfriend', 0);
    INSERT INTO friends (user_id, friend_id, created_at) VALUES ('alice', 'pal', 1);
  `);
  sockets.clear();
});

afterEach(() => {
  for (const socket of sockets.values()) connectionManager.removeConnection(socket as unknown as WebSocket);
  sockets.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  sqlite.close();
});

describe('a message with its count', () => {
  const send = (): void => {
    const id = addMessage(1, 'bob');
    connectionManager.sendToChannel(SPACE, CHAT, { type: 'message_created', message: { id, channelId: CHAT, userId: 'bob' } as MessageWithUser });
  };

  it('is one frame for a client that said it reads that', () => {
    const socket = connect('alice', { batches: true });
    send();
    expect(socket.send).toHaveBeenCalledTimes(1);
    const [frame] = framesOf(socket);
    expect(frame?.type).toBe('batch');
    expect((frame?.events as Frame[]).map((event) => event.type)).toEqual(['message_created', 'channel_unread_count']);
    expect((frame?.events as Frame[])[1]).toEqual({ type: 'channel_unread_count', counts: { [CHAT]: 1 } });
  });

  it('is two frames for a client from before that, or a bot', () => {
    const socket = connect('alice');
    send();
    expect(framesOf(socket).map((frame) => frame.type)).toEqual(['message_created', 'channel_unread_count']);
  });

  it('counts for each person, whichever way it reaches them', () => {
    const reads = connect('alice', { batches: true });
    const older = connect('carol');
    const author = connect('bob', { batches: true });
    addMessage(0, 'bob');
    send();
    expect((framesOf(reads)[0]?.events as Frame[])[1]).toEqual({ type: 'channel_unread_count', counts: { [CHAT]: 2 } });
    expect(framesOf(older)[1]).toEqual({ type: 'channel_unread_count', counts: { [CHAT]: 2 } });
    expect((framesOf(author)[0]?.events as Frame[])[1]).toEqual({ type: 'channel_unread_count', counts: { [CHAT]: 0 } });
  });

  it('goes to no socket that is closing', () => {
    const socket = connect('alice', { batches: true });
    socket.readyState = 2;
    send();
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('is sent as one encoded frame shared between people with the same count', () => {
    const one = connect('alice', { batches: true });
    const two = connect('carol', { batches: true });
    send();
    expect(one.send.mock.calls[0]?.[0]).toBe(two.send.mock.calls[0]?.[0]);
  });
});

describe('who hears of someone\'s presence', () => {
  it('is who the full list says, among those connected', () => {
    for (const person of ['bob', 'carol']) connect(person);
    connect('dmfriend', { spaces: [] });
    connect('pal', { spaces: [] });
    connect('stranger', { spaces: [] });
    connect('alice');

    const online = new Set(sockets.keys());
    const expected = [...collectProfileBroadcastTargetIds('alice')].filter((id) => online.has(id)).sort();
    expect(connectionManager.onlineProfileTargets('alice').sort()).toEqual(expected);
    expect(expected).toEqual(['bob', 'carol', 'dmfriend', 'pal']);
  });

  it('holds someone who just went: their spaces are read, not remembered', () => {
    connect('bob');
    expect(connectionManager.onlineProfileTargets('alice')).toEqual(['bob']);
  });

  it('does not reach someone who left the space', () => {
    connect('bob');
    connectionManager.setUserSpaces('bob', []);
    expect(connectionManager.onlineProfileTargets('alice')).toEqual([]);
  });
});

describe('presence going out', () => {
  it('goes at once while few are connected', () => {
    const socket = connect('bob');
    connectionManager.broadcastPresence('alice', presence('alice', 'online'));
    expect(framesOf(socket)).toEqual([expect.objectContaining({ type: 'presence_update', userId: 'alice' })]);
  });

  describe('with many connected', () => {
    beforeEach(() => {
      for (let at = 0; at < 100; at += 1) connect(`crowd-${at}`, { spaces: ['elsewhere'] });
    });

    it('waits a moment, and goes in one frame to a client that reads that', () => {
      const socket = connect('bob', { batches: true });
      connectionManager.broadcastPresence('alice', presence('alice', 'online'));
      connectionManager.broadcastPresence('carol', presence('carol', 'online'));
      expect(socket.send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(600);
      expect(socket.send).toHaveBeenCalledTimes(1);
      const [frame] = framesOf(socket);
      expect(frame?.type).toBe('batch');
      expect((frame?.events as Frame[]).map((event) => event.userId).sort()).toEqual(['alice', 'carol']);
    });

    it('goes one by one to a client from before that', () => {
      const socket = connect('bob');
      connectionManager.broadcastPresence('alice', presence('alice', 'online'));
      connectionManager.broadcastPresence('carol', presence('carol', 'online'));
      vi.advanceTimersByTime(600);
      expect(framesOf(socket).map((frame) => frame.type)).toEqual(['presence_update', 'presence_update']);
    });

    it('says only the newest of the same person', () => {
      const socket = connect('bob', { batches: true });
      connectionManager.broadcastPresence('alice', presence('alice', 'online'));
      connectionManager.broadcastPresence('alice', presence('alice', 'offline'));
      vi.advanceTimersByTime(600);
      expect(framesOf(socket)).toEqual([expect.objectContaining({ type: 'presence_update', userId: 'alice', status: 'offline' })]);
    });

    it('sends nothing to who has gone by then, and starts over afterwards', () => {
      const gone = connect('bob', { batches: true });
      const stays = connect('carol', { batches: true });
      connectionManager.broadcastPresence('alice', presence('alice', 'online'));
      connectionManager.removeConnection(gone as unknown as WebSocket);
      sockets.delete('bob');
      vi.advanceTimersByTime(600);
      expect(gone.send).not.toHaveBeenCalled();
      expect(stays.send).toHaveBeenCalledTimes(1);
      connectionManager.broadcastPresence('alice', presence('alice', 'idle'));
      vi.advanceTimersByTime(600);
      expect(stays.send).toHaveBeenCalledTimes(2);
    });

    it('reaches nobody outside the audience', () => {
      const other = sockets.get('crowd-1') as FakeSocket;
      connect('bob', { batches: true });
      connectionManager.broadcastPresence('alice', presence('alice', 'online'));
      vi.advanceTimersByTime(600);
      expect(other.send).not.toHaveBeenCalled();
    });
  });
});
