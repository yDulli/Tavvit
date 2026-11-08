import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WatchSession } from '@backspace/shared/src/watch.js';
import { DEFAULT_EVERYONE_PERMISSIONS, permissionsToString } from '@backspace/shared/src/permissions.js';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { connectionManager, VOICE_RECONNECT_GRACE_MS } from './handler.js';
import { handleClientEvent } from './events.js';

// A socket that drops while LiveKit stays up (a tab in the background, a phone switching apps, a
// network blip): the server keeps the person in the call for a grace period, and the new socket
// takes the session over with voice_join (docs/systems/voice.md, "Transient reconnects"). The
// person stays in the call for everyone, and the new socket hears what the call watches now.

setWorkerId(34);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  schema,
}));

const SPACE = 'sp-takeover';
const LOUNGE = 'vc-takeover';

function fakeWs(): { readyState: number; send: ReturnType<typeof vi.fn> } {
  return { readyState: 1, send: vi.fn() };
}

function eventsOf(ws: { send: ReturnType<typeof vi.fn> }): Array<Record<string, unknown>> {
  return ws.send.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

beforeEach(() => {
  vi.useFakeTimers();
  const sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    for (const statement of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (statement.trim()) sqlite.exec(statement.trim());
    }
  }
  for (const id of ['owner', 'mara']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', homeUserId: id, homeInstance: null, createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Night Shift', ownerId: 'owner', createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  for (const id of ['owner', 'mara']) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: LOUNGE, spaceId: SPACE, name: 'lounge', type: 'voice', position: 0, createdAt: 1 }).run();
});

afterEach(() => {
  connectionManager.destroyRoom(LOUNGE);
  for (const id of ['owner', 'mara']) {
    connectionManager.clearVoiceWs(id);
    for (const ws of [...connectionManager.getUserConnections(id)]) connectionManager.removeConnection(ws);
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function connect(userId: string) {
  const ws = fakeWs();
  connectionManager.addConnection(userId, ws as never);
  connectionManager.addUserSpace(userId, SPACE);
  return ws;
}

describe('a voice session taken over by a new socket', () => {
  it('stays in the call for everyone past the grace period, without a leave or a join', () => {
    const owner = connect('owner');
    const first = connect('mara');
    handleClientEvent({ type: 'voice_join', channelId: LOUNGE }, 'mara', 'mara', first as never, false);
    owner.send.mockClear();

    connectionManager.removeConnection(first as never);
    const second = connect('mara');
    handleClientEvent({ type: 'voice_join', channelId: LOUNGE }, 'mara', 'mara', second as never, false);
    vi.advanceTimersByTime(VOICE_RECONNECT_GRACE_MS + 1);

    expect(connectionManager.getUserRoom('mara')?.roomId).toBe(LOUNGE);
    expect(connectionManager.getVoiceWs('mara')).toBe(second);
    expect(eventsOf(owner).filter((event) => event.type === 'voice_state_update')).toEqual([]);
  });

  it('tells the new socket where the call\'s watching stands, which it may have missed', () => {
    const first = connect('mara');
    handleClientEvent({ type: 'voice_join', channelId: LOUNGE }, 'mara', 'mara', first as never, false);
    // Started while the first socket was gone; only the room knows it.
    const session = { control: 'everyone', starterId: 'owner', playing: true, positionMs: 0, stateAt: 1, current: null, queue: [] } as unknown as WatchSession;
    connectionManager.getRoom(LOUNGE)!.watch = session;

    connectionManager.removeConnection(first as never);
    const second = connect('mara');
    handleClientEvent({ type: 'voice_join', channelId: LOUNGE }, 'mara', 'mara', second as never, false);

    expect(eventsOf(second)).toContainEqual(expect.objectContaining({ type: 'watch_state', channelId: LOUNGE, session }));
  });
});
