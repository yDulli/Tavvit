import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { DEFAULT_EVERYONE_PERMISSIONS, PermissionBits, permissionsToString } from '@backspace/shared/src/permissions.js';
import { EVENT_KEPT_AFTER_MS, EVENT_LIMITS, EVENT_REMINDER_BEFORE_MS } from '@backspace/shared/src/events.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

// Who may announce an event, who may answer, what the space is told, and who hears before it starts.

setWorkerId(28);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

const { sent, pushed } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; args: unknown[] }>,
  pushed: [] as Array<{ eventId: string; userIds: readonly string[] }>,
}));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => (...args: unknown[]) => {
      sent.push({ to: String(name), args });
      return undefined;
    },
  }),
}));

vi.mock('../utils/pushDelivery.js', () => ({
  pushEventReminder: (event: { id: string }, userIds: readonly string[]) => {
    pushed.push({ eventId: event.id, userIds });
  },
}));

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
const PLANNER = 'user-planner';
const MEMBER = 'user-member';
const OUTSIDER = 'user-outsider';
const SPACE = 'space-1';
const OTHER_SPACE = 'space-2';
const CHANNEL = 'channel-1';
const SECRET = 'channel-secret';
const FOREIGN = 'channel-foreign';
const HOUR = 3_600_000;

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: userId })}` });

const { eventRoutes } = await import('./events.js');
const { sendDueEventReminders } = await import('../utils/eventReminders.js');

beforeEach(async () => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  sent.length = 0;
  pushed.length = 0;
  for (const id of [OWNER, PLANNER, MEMBER, OUTSIDER]) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', email: `${id}@example.test`, createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: OTHER_SPACE, name: 'Other', ownerId: OUTSIDER, createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: CHANNEL, spaceId: SPACE, name: 'general', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: SECRET, spaceId: SPACE, name: 'secret', type: 'text', createdAt: 1 }).run();
  testDb.insert(schema.channels).values({ id: FOREIGN, spaceId: OTHER_SPACE, name: 'theirs', type: 'text', createdAt: 1 }).run();
  for (const id of [OWNER, PLANNER, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: SPACE, spaceId: SPACE, name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'role-plan', spaceId: SPACE, name: 'Planner', position: 1, permissions: permissionsToString(PermissionBits.MANAGE_EVENTS), createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE, userId: PLANNER, roleId: 'role-plan' }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();
  app = Fastify();
  await app.register(eventRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const create = (userId: string, payload: Record<string, unknown> = {}) => app.inject({
  method: 'POST',
  url: `/api/spaces/${SPACE}/events`,
  headers: headers(userId),
  payload: { title: 'Game night', startsAt: Date.now() + 2 * HOUR, ...payload },
});

const told = (type: string) => sent
  .filter((entry) => entry.to === 'sendToSpace')
  .map((entry) => entry.args[1] as { type: string; event?: Record<string, unknown> })
  .filter((event) => event.type === type);

describe('announcing an event', () => {
  it('takes the right to manage events, not membership alone', async () => {
    expect((await create(MEMBER)).statusCode).toBe(403);
    expect((await create(OUTSIDER)).statusCode).toBe(403);
    const made = await create(PLANNER, { description: 'Bring snacks', location: 'The attic', channelId: CHANNEL });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ title: 'Game night', location: 'The attic', channelId: CHANNEL, going: 0, amGoing: false, createdBy: PLANNER });
    expect(told('event_updated')).toHaveLength(1);
    const audit = testDb.select().from(schema.spaceAuditLog).all();
    expect(audit.map((row) => row.action)).toEqual(['event_create']);
    expect((await create(OWNER)).statusCode).toBe(201);
  });

  it('refuses what is not an event', async () => {
    const now = Date.now();
    for (const payload of [
      { title: '   ' },
      { title: 'x'.repeat(EVENT_LIMITS.TITLE_MAX_LENGTH + 1) },
      { startsAt: now - 1000 },
      { startsAt: 'tomorrow' },
      { startsAt: now + HOUR, endsAt: now + HOUR },
      { description: 'x'.repeat(EVENT_LIMITS.DESCRIPTION_MAX_LENGTH + 1) },
      { location: 'x'.repeat(EVENT_LIMITS.LOCATION_MAX_LENGTH + 1) },
    ]) {
      const res = await create(PLANNER, payload);
      expect(res.statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
  });

  it('only points at a channel of this space the writer can see', async () => {
    expect((await create(PLANNER, { channelId: FOREIGN })).statusCode).toBe(400);
    expect((await create(PLANNER, { channelId: SECRET })).statusCode).toBe(400);
    expect((await create(OWNER, { channelId: SECRET })).statusCode).toBe(201);
  });

  it('holds a limited number coming up', async () => {
    const now = Date.now();
    for (let i = 0; i < EVENT_LIMITS.UPCOMING_MAX; i += 1) {
      testDb.insert(schema.spaceEvents).values({ id: `e${i}`, spaceId: SPACE, title: 'x', startsAt: now + HOUR + i, createdAt: now }).run();
    }
    const res = await create(PLANNER);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('event_limit_reached');
  });
});

describe('reading and answering', () => {
  it('lists what is coming and what ended within a day, only for those in the space', async () => {
    const now = Date.now();
    testDb.insert(schema.spaceEvents).values([
      { id: 'long-gone', spaceId: SPACE, title: 'old', startsAt: now - EVENT_KEPT_AFTER_MS - HOUR, createdAt: 1 },
      { id: 'just-ended', spaceId: SPACE, title: 'recent', startsAt: now - 2 * HOUR, endsAt: now - HOUR, createdAt: 1 },
      { id: 'later', spaceId: SPACE, title: 'later', startsAt: now + 5 * HOUR, createdAt: 1 },
      { id: 'soon', spaceId: SPACE, title: 'soon', startsAt: now + HOUR, createdAt: 1 },
      { id: 'elsewhere', spaceId: OTHER_SPACE, title: 'theirs', startsAt: now + HOUR, createdAt: 1 },
    ]).run();
    const res = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/events`, headers: headers(MEMBER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().events.map((event: { id: string }) => event.id)).toEqual(['just-ended', 'soon', 'later']);
    expect((await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/events`, headers: headers(OUTSIDER) })).statusCode).toBe(403);
  });

  it('counts someone going once, tells the space without saying who, and takes it back', async () => {
    const event = (await create(PLANNER)).json();
    sent.length = 0;
    const rsvp = () => app.inject({ method: 'PUT', url: `/api/events/${event.id}/rsvp`, headers: headers(MEMBER) });
    expect((await rsvp()).json()).toMatchObject({ going: 1, amGoing: true });
    expect((await rsvp()).json()).toMatchObject({ going: 1, amGoing: true });
    const broadcast = told('event_updated').at(-1)?.event;
    expect(broadcast).toMatchObject({ id: event.id, going: 1 });
    expect(broadcast).not.toHaveProperty('amGoing');

    const listed = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/events`, headers: headers(MEMBER) });
    expect(listed.json().events[0]).toMatchObject({ going: 1, amGoing: true });
    const another = await app.inject({ method: 'GET', url: `/api/spaces/${SPACE}/events`, headers: headers(OWNER) });
    expect(another.json().events[0]).toMatchObject({ going: 1, amGoing: false });

    const back = await app.inject({ method: 'DELETE', url: `/api/events/${event.id}/rsvp`, headers: headers(MEMBER) });
    expect(back.json()).toMatchObject({ going: 0, amGoing: false });
  });

  it('tells the space only of a change, and answers nobody outside it with the event', async () => {
    const event = (await create(PLANNER)).json();
    sent.length = 0;
    const going = () => app.inject({ method: 'PUT', url: `/api/events/${event.id}/rsvp`, headers: headers(MEMBER) });
    const notGoing = (userId = MEMBER) => app.inject({ method: 'DELETE', url: `/api/events/${event.id}/rsvp`, headers: headers(userId) });
    await going();
    await going();
    expect(told('event_updated')).toHaveLength(1);
    await notGoing();
    await notGoing();
    expect(told('event_updated')).toHaveLength(2);

    const outside = await notGoing(OUTSIDER);
    expect(outside.statusCode).toBe(403);
    expect(outside.json()).not.toHaveProperty('title');
    expect(told('event_updated')).toHaveLength(2);
  });

  it('is not given by a member who is timed out', async () => {
    const event = (await create(PLANNER)).json();
    testDb.update(schema.spaceMembers).set({ timedOutUntil: Date.now() + 60_000 })
      .where(and(eq(schema.spaceMembers.spaceId, SPACE), eq(schema.spaceMembers.userId, MEMBER))).run();
    const res = await app.inject({ method: 'PUT', url: `/api/events/${event.id}/rsvp`, headers: headers(MEMBER) });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('member_timed_out');
  });

  it('lets only members answer, and names those going only to the space, without private fields', async () => {
    const event = (await create(PLANNER)).json();
    expect((await app.inject({ method: 'PUT', url: `/api/events/${event.id}/rsvp`, headers: headers(OUTSIDER) })).statusCode).toBe(403);
    await app.inject({ method: 'PUT', url: `/api/events/${event.id}/rsvp`, headers: headers(MEMBER) });
    expect((await app.inject({ method: 'GET', url: `/api/events/${event.id}/attendees`, headers: headers(OUTSIDER) })).statusCode).toBe(403);
    const res = await app.inject({ method: 'GET', url: `/api/events/${event.id}/attendees`, headers: headers(OWNER) });
    expect(res.statusCode).toBe(200);
    const [attendee] = res.json().attendees;
    expect(attendee.id).toBe(MEMBER);
    expect(attendee).not.toHaveProperty('email');
    expect(attendee).not.toHaveProperty('passwordHash');
  });
});

describe('changing an event', () => {
  it('is for its author while a member, and for those who manage events', async () => {
    testDb.update(schema.roles).set({ permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS | PermissionBits.MANAGE_EVENTS) }).where(eq(schema.roles.id, SPACE)).run();
    const event = (await create(MEMBER)).json();
    testDb.update(schema.roles).set({ permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS) }).where(eq(schema.roles.id, SPACE)).run();
    const patch = (userId: string) => app.inject({
      method: 'PATCH', url: `/api/events/${event.id}`, headers: headers(userId), payload: { title: 'Renamed', startsAt: Date.now() + HOUR },
    });
    expect((await patch(OUTSIDER)).statusCode).toBe(403);
    expect((await patch(MEMBER)).statusCode).toBe(200);
    expect((await patch(PLANNER)).statusCode).toBe(200);
    testDb.delete(schema.spaceMembers).where(eq(schema.spaceMembers.userId, MEMBER)).run();
    expect((await patch(MEMBER)).statusCode).toBe(403);
  });

  it('calling it off removes those going with it and tells the space', async () => {
    const event = (await create(PLANNER)).json();
    await app.inject({ method: 'PUT', url: `/api/events/${event.id}/rsvp`, headers: headers(MEMBER) });
    expect((await app.inject({ method: 'DELETE', url: `/api/events/${event.id}`, headers: headers(MEMBER) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/events/${event.id}`, headers: headers(PLANNER) })).statusCode).toBe(200);
    expect(testDb.select().from(schema.spaceEventRsvps).all()).toEqual([]);
    expect(told('event_deleted')[0]).toMatchObject({ eventId: event.id, spaceId: SPACE });
    expect((await app.inject({ method: 'PUT', url: `/api/events/${event.id}/rsvp`, headers: headers(MEMBER) })).statusCode).toBe(404);
  });
});

describe('reminders', () => {
  const now = 1_700_000_000_000;
  const addEvent = (id: string, startsAt: number) => testDb.insert(schema.spaceEvents).values({ id, spaceId: SPACE, title: id, startsAt, createdAt: 1 }).run();
  const going = (eventId: string, userId: string) => testDb.insert(schema.spaceEventRsvps).values({ eventId, userId, createdAt: 1 }).run();
  const socketReminders = () => sent.filter((entry) => entry.to === 'sendToUser').map((entry) => entry.args);

  it('reach only those going, once, within the last minutes before the start', () => {
    addEvent('due', now + EVENT_REMINDER_BEFORE_MS - 1000);
    addEvent('too-early', now + EVENT_REMINDER_BEFORE_MS + 60_000);
    addEvent('started', now - 1000);
    going('due', MEMBER);
    going('too-early', MEMBER);
    going('started', MEMBER);

    expect(sendDueEventReminders(now)).toBe(1);
    expect(socketReminders()).toEqual([[MEMBER, expect.objectContaining({ type: 'event_reminder', eventId: 'due', title: 'due' })]]);
    expect(pushed).toEqual([{ eventId: 'due', userIds: [MEMBER] }]);

    expect(sendDueEventReminders(now + 1000)).toBe(0);
    expect(pushed).toHaveLength(1);
  });

  it('come again when the time moved, not when only the words did', async () => {
    const event = (await create(PLANNER, { startsAt: Date.now() + 10 * 60_000 })).json();
    going(event.id, MEMBER);
    expect(sendDueEventReminders()).toBe(1);

    await app.inject({ method: 'PATCH', url: `/api/events/${event.id}`, headers: headers(PLANNER), payload: { title: 'New name', startsAt: event.startsAt } });
    expect(sendDueEventReminders()).toBe(0);

    await app.inject({ method: 'PATCH', url: `/api/events/${event.id}`, headers: headers(PLANNER), payload: { title: 'New name', startsAt: event.startsAt + 60_000 } });
    expect(sendDueEventReminders()).toBe(1);
  });
});
