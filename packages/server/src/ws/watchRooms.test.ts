import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWatchUrl } from '@backspace/shared/src/watch.js';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { PermissionBits, permissionsToString } from '../utils/permissions.js';

// A session lives with its call's room: who steers it when its starter leaves, that it ends with
// the call, and what the channel list is told (docs/systems/watch-together.md).

setWorkerId(35);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, schema }));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt.trim());
    }
  }
}

const SPACE = 'sp-watch';
const VOICE = 'vc-watch';
const HIDDEN = 'vc-hidden';

const { connectionManager: cm } = await import('./handler.js');
const { addToSession, applyWatchAction } = await import('../utils/watchSessions.js');

const youtube = parseWatchUrl('https://youtu.be/dQw4w9WgXcQ')!;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  for (const id of ['owner', 'alice', 'bob', 'carol', 'dave', 'viewer']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: 'owner', createdAt: 1 }).run();
  for (const id of ['alice', 'bob', 'carol', 'dave', 'viewer']) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(PermissionBits.VIEW_CHANNEL), createdAt: 1 }).run();
  for (const id of [VOICE, HIDDEN]) {
    testDb.insert(schema.channels).values({ id, spaceId: SPACE, name: id, type: 'voice', position: 0, createdAt: 1 }).run();
  }
  testDb.insert(schema.channelOverrides).values({
    channelId: HIDDEN, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();
});

afterEach(() => {
  for (const roomId of [VOICE, HIDDEN]) cm.destroyRoom(roomId);
  vi.restoreAllMocks();
});

/** A call in `roomId` that watches something, started by the first of `people` (each sits in one room only). */
function callWatching(roomId: string, people: [string, string] = ['alice', 'bob']): void {
  cm.createRoom(roomId, 'space', { type: 'space', spaceId: SPACE });
  for (const userId of people) cm.joinRoom(roomId, userId);
  addToSession(cm.getRoom(roomId)!, youtube, 'A film', people[0], 1_000);
}

describe('a session in its room', () => {
  it('goes to everyone once its starter, the only one who steered it, leaves', () => {
    callWatching(VOICE);
    const room = cm.getRoom(VOICE)!;
    applyWatchAction(room, { action: 'control', control: 'starter' }, 'alice');
    const told = vi.spyOn(cm, 'sendToUsers');
    cm.leaveRoom(VOICE, 'alice');
    expect(room.watch?.control).toBe('everyone');
    expect(told).toHaveBeenCalledWith(room.participants, expect.objectContaining({ type: 'watch_state', channelId: VOICE }));
  });

  it('ends with the call, and the channel list hears that nothing plays there', () => {
    callWatching(VOICE);
    const listed = vi.spyOn(cm, 'sendToChannel');
    cm.leaveRoom(VOICE, 'alice');
    cm.leaveRoom(VOICE, 'bob');
    expect(cm.getRoom(VOICE)).toBeUndefined();
    expect(listed).toHaveBeenCalledWith(SPACE, VOICE, { type: 'watch_presence', spaceId: SPACE, channelId: VOICE, presence: null });
    // A new call in the channel starts without it.
    cm.createRoom(VOICE, 'space', { type: 'space', spaceId: SPACE });
    expect(cm.getRoom(VOICE)?.watch).toBeUndefined();
  });

  it('is named in the voice snapshot only for a channel the viewer can see', () => {
    callWatching(VOICE);
    callWatching(HIDDEN, ['carol', 'dave']);
    const snap = cm.buildSpaceVoiceState(SPACE, 'viewer');
    expect(snap.watching).toEqual({ [VOICE]: { title: 'A film', provider: 'youtube' } });
    expect(cm.buildSpaceVoiceState(SPACE, 'owner').watching[HIDDEN]).toEqual({ title: 'A film', provider: 'youtube' });
  });
});
