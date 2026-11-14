import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';

// A token for a voice channel is handed out before the socket hears of a join, and LiveKit is not
// asked again while a client stays connected. So a client could sit in a call this server never
// saw it enter, heard by nobody as present and beyond every moderator, and stay after a kick, a
// ban or losing the right to be there (security audit, 2026-11-14).

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

const { reconcileVoiceRooms, _resetVoiceReconciler } = await import('./livekitReconcile.js');

const VOICE = '380000000000000001';
const TEXT = '380000000000000002';
const SPACE = 'space-1';
const LOOK_MS = 30_000;

class FakeLiveKit {
  rooms = new Map<string, string[]>();
  removed: string[] = [];
  async listRooms() { return [...this.rooms.keys()].map((name) => ({ name })); }
  async listParticipants(room: string) { return (this.rooms.get(room) ?? []).map((identity) => ({ identity })); }
  async removeParticipant(room: string, identity: string) {
    this.removed.push(`${room}/${identity}`);
    this.rooms.set(room, (this.rooms.get(room) ?? []).filter((other) => other !== identity));
  }
}

let livekit: FakeLiveKit;
let seated: Map<string, Set<string>>;
const seatedIn = (roomId: string): ReadonlySet<string> => seated.get(roomId) ?? new Set();
const look = (at: number) => reconcileVoiceRooms(livekit, seatedIn, at, LOOK_MS - 1000);

beforeEach(() => {
  sqlite = new Database(':memory:');
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()) {
    for (const statement of fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  testDb = drizzle(sqlite, { schema });
  for (const id of ['owner', 'anna', 'ben', 'ghost']) testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: 'owner', createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', position: 0, permissions: permissionsToString(PermissionBits.VIEW_CHANNEL | PermissionBits.CONNECT | PermissionBits.SPEAK), createdAt: 1 }).run();
  for (const userId of ['owner', 'anna', 'ben', 'ghost']) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId, joinedAt: 1 }).run();
  testDb.insert(schema.channels).values([
    { id: VOICE, spaceId: SPACE, name: 'lounge', type: 'voice', createdAt: 1 },
    { id: TEXT, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 },
  ]).run();
  livekit = new FakeLiveKit();
  seated = new Map([[VOICE, new Set(['anna', 'ben'])]]);
  _resetVoiceReconciler();
});

afterEach(() => {
  sqlite.close();
});

describe('who sits in a voice channel at LiveKit', () => {
  it('is put out at the second look when this server does not have them in the room', async () => {
    livekit.rooms.set(VOICE, ['anna:anna', 'ben:ben', 'ghost:ghost']);
    expect(await look(0)).toEqual([]);
    expect(livekit.removed).toEqual([]);
    expect(await look(LOOK_MS)).toEqual([`${VOICE}\nghost:ghost`]);
    expect(livekit.removed).toEqual([`${VOICE}/ghost:ghost`]);
    expect(livekit.rooms.get(VOICE)).toEqual(['anna:anna', 'ben:ben']);
  });

  it('stays when they were only between the token and the join', async () => {
    livekit.rooms.set(VOICE, ['anna:anna', 'ghost:ghost']);
    await look(0);
    // `voice_join` arrives before the next look.
    seated.get(VOICE)?.add('ghost');
    expect(await look(LOOK_MS)).toEqual([]);
    // And being out of place later starts the wait anew.
    seated.get(VOICE)?.delete('ghost');
    expect(await look(2 * LOOK_MS)).toEqual([]);
    expect(await look(3 * LOOK_MS)).toEqual([`${VOICE}\nghost:ghost`]);
  });

  it('goes with the right to be there, seated or not', async () => {
    livekit.rooms.set(VOICE, ['anna:anna', 'ben:ben']);
    // Ben was banned: no member row, so no permission, while a stale seat still names him.
    testDb.delete(schema.spaceMembers).where(and(eq(schema.spaceMembers.spaceId, SPACE), eq(schema.spaceMembers.userId, 'ben'))).run();
    await look(0);
    await look(LOOK_MS);
    expect(livekit.removed).toEqual([`${VOICE}/ben:ben`]);
  });

  it('leaves the overlay\'s participant, conversations\' calls and rooms that are no voice channel alone', async () => {
    livekit.rooms.set(VOICE, ['anna:anna', 'overlay:123']);
    livekit.rooms.set('dm-55', ['ghost:ghost']);
    livekit.rooms.set('fed:abc', ['999:someone']);
    livekit.rooms.set(TEXT, ['ghost:ghost']);
    livekit.rooms.set('380000000000000099', ['ghost:ghost']);
    await look(0);
    await look(LOOK_MS);
    await look(2 * LOOK_MS);
    expect(livekit.removed).toEqual([]);
  });
});
