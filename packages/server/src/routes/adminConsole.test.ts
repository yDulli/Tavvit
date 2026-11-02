import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { USUAL_RESERVED_USERNAMES } from '@backspace/shared/src/adminConsole.js';
import * as schema from '../db/schema.js';
import { signJwt } from '../utils/auth.js';
import { generateSnowflake, setWorkerId } from '../utils/snowflake.js';

// The console's routes: nothing without an admin, and what each one does and refuses.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
let adminToken: string;
let memberToken: string;
let adminId: string;
let memberId: string;

const closeSessionSockets = vi.fn();
let onlineNow: string[] = [];
const snapshots: Array<{ path: string; reason: string; bytes: number; mtimeMs: number }> = [];

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToAdmins: vi.fn(),
    sendToSpace: vi.fn(),
    addUserSpace: vi.fn(),
    closeSessionSockets: (...args: unknown[]) => closeSessionSockets(...args),
    getAllOnlineUserIds: () => onlineNow,
    socketCounts: () => ({ open: 0, people: 0 }),
  },
}));

// A real backup would land in the project's data folder.
vi.mock('../utils/backup.js', () => ({
  createSnapshot: (_db: unknown, reason: string) => {
    const file = `/data/backups/backspace-${snapshots.length}-${reason}.db`;
    snapshots.push({ path: file, reason, bytes: 1024, mtimeMs: Date.now() });
    return file;
  },
  listSnapshots: () => [...snapshots],
  pruneSnapshots: () => {},
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    for (const stmt of sqlText.split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

function addUser(username: string, isAdmin = false): string {
  const id = generateSnowflake();
  testDb.insert(schema.users).values({ id, username, passwordHash: 'x', isAdmin: isAdmin ? 1 : 0, createdAt: Date.now() }).run();
  return id;
}

function addSpace(name: string, visibility: string, ownerId: string): string {
  const id = generateSnowflake();
  testDb.insert(schema.spaces).values({ id, name, ownerId, visibility, createdAt: Date.now() }).run();
  return id;
}

const asAdmin = () => ({ authorization: `Bearer ${adminToken}` });
const asMember = () => ({ authorization: `Bearer ${memberToken}` });
const getDb = () => testDb;

function auditActions(): string[] {
  return testDb.select({ action: schema.platformAuditLog.action }).from(schema.platformAuditLog).all().map((row) => row.action);
}

// Loaded after the mocks are in place.
const { adminConsoleRoutes, csvCell, resetDashboardCache } = await import('./adminConsole.js');
const { emailDomainBlocked, normalizeRuleValue, usernameReserved } = await import('../utils/signupRules.js');
const { joinStarterSpaces } = await import('../utils/spaceJoin.js');

beforeEach(async () => {
  setWorkerId(1);
  vi.clearAllMocks();
  onlineNow = [];
  snapshots.length = 0;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.instanceSettings).values({ id: 1, updatedAt: Date.now() }).run();
  resetDashboardCache();
  adminId = addUser('admin_one', true);
  memberId = addUser('member_one');
  adminToken = signJwt({ userId: adminId, username: 'admin_one' });
  memberToken = signJwt({ userId: memberId, username: 'member_one' });
  app = Fastify();
  await app.register(adminConsoleRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe('who gets in', () => {
  const ADMIN_ROUTES: Array<[('GET' | 'POST' | 'PUT' | 'DELETE'), string]> = [
    ['GET', '/api/admin/dashboard'],
    ['GET', '/api/admin/system'],
    ['POST', '/api/admin/system/backup'],
    ['GET', '/api/admin/announcements'],
    ['POST', '/api/admin/announcements'],
    ['POST', '/api/admin/announcements/1/end'],
    ['GET', '/api/admin/search?q=abc'],
    ['GET', '/api/admin/users.csv'],
    ['GET', '/api/admin/audit.csv'],
    ['GET', '/api/admin/users/1/sessions'],
    ['DELETE', '/api/admin/users/1/sessions/1'],
    ['POST', '/api/admin/users/1/sessions/end-all'],
    ['GET', '/api/admin/users/1/security'],
    ['GET', '/api/admin/users/1/notes'],
    ['POST', '/api/admin/users/1/notes'],
    ['DELETE', '/api/admin/users/1/notes/1'],
    ['POST', '/api/admin/users/1/warn'],
    ['GET', '/api/admin/signup-rules'],
    ['POST', '/api/admin/signup-rules'],
    ['DELETE', '/api/admin/signup-rules/username/x'],
    ['GET', '/api/admin/starter-spaces'],
    ['PUT', '/api/admin/starter-spaces'],
  ];

  it.each(ADMIN_ROUTES)('%s %s refuses someone who is not signed in, and a member', async (method, url) => {
    expect((await app.inject({ method, url })).statusCode).toBe(401);
    expect((await app.inject({ method, url, headers: asMember() })).statusCode).toBe(403);
  });

  it('does not let a space owner in: only the instance says who is an admin', async () => {
    addSpace('Mine', 'public', memberId);
    expect((await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: asMember() })).statusCode).toBe(403);
  });
});

describe('the dashboard', () => {
  it('counts by day, and says nothing about anyone', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.series.signups).toHaveLength(30);
    expect(body.series.signups[29]).toBe(2);
    expect(body.series.messages).toHaveLength(30);
    expect(body.accounts.total).toBe(2);
    expect(body.accounts.admins).toBe(1);
    expect(JSON.stringify(body)).not.toContain('member_one');
  });
});

describe('the dashboard, a moment later', () => {
  it('keeps the counts of the day, and asks who is here each time', async () => {
    const first = (await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: asAdmin() })).json();
    expect(first.accounts.online).toBe(0);
    onlineNow = [adminId];
    addUser('came_later');
    const second = (await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: asAdmin() })).json();
    expect(second.accounts.online).toBe(1);
    expect(second.accounts.total).toBe(first.accounts.total);
  });
});

describe('the system page', () => {
  it('names files, not where they lie', async () => {
    await app.inject({ method: 'POST', url: '/api/admin/system/backup', headers: asAdmin() });
    const body = (await app.inject({ method: 'GET', url: '/api/admin/system', headers: asAdmin() })).json();
    expect(body.version).toEqual(expect.any(String));
    expect(body.backups).toHaveLength(1);
    for (const backup of body.backups) expect(backup.name).not.toMatch(/[\\/]/);
    expect(JSON.stringify(body)).not.toContain('/data/backups');
  });

  it('takes one backup at a time, and writes it in the log', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/admin/system/backup', headers: asAdmin() });
    expect(first.statusCode).toBe(201);
    expect(first.json().name).not.toMatch(/[\\/]/);
    const second = await app.inject({ method: 'POST', url: '/api/admin/system/backup', headers: asAdmin() });
    expect(second.statusCode).toBe(429);
    expect(second.json().code).toBe('backup_too_soon');
    expect(auditActions().filter((action) => action === 'backup_create')).toHaveLength(1);
  });
});

describe('announcements', () => {
  const post = (payload: object) => app.inject({ method: 'POST', url: '/api/admin/announcements', headers: asAdmin(), payload });

  it('run until they are ended, and everyone signed in can read them', async () => {
    const created = await post({ body: 'Maintenance tonight at nine.', tone: 'warning' });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();
    const running = await app.inject({ method: 'GET', url: '/api/announcements', headers: asMember() });
    expect(running.json().announcements.map((a: { id: string }) => a.id)).toEqual([id]);

    expect((await app.inject({ method: 'POST', url: `/api/admin/announcements/${id}/end`, headers: asAdmin() })).statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/announcements', headers: asMember() });
    expect(after.json().announcements).toEqual([]);
    expect(auditActions()).toEqual(expect.arrayContaining(['announcement_create', 'announcement_end']));
  });

  it('end by themselves when told to', async () => {
    const created = await post({ body: 'Short one.', tone: 'info', durationHours: 2 });
    const { id, endsAt } = created.json();
    expect(endsAt).toBeGreaterThan(Date.now());
    getDb().update(schema.announcements).set({ endsAt: Date.now() - 1 }).where(eq(schema.announcements.id, id)).run();
    const running = await app.inject({ method: 'GET', url: '/api/announcements', headers: asMember() });
    expect(running.json().announcements).toEqual([]);
  });

  it('are only something an admin writes, and need words and a tone', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/announcements' })).statusCode).toBe(401);
    expect((await post({ body: 'x', tone: 'info' })).statusCode).toBe(400);
    expect((await post({ body: 'Fine words.', tone: 'neon' })).statusCode).toBe(400);
    expect((await post({ body: 'Fine words.', tone: 'info', durationHours: 0 })).statusCode).toBe(400);
  });

  it('cannot pile up', async () => {
    for (let i = 0; i < 3; i += 1) expect((await post({ body: `Number ${i}`, tone: 'info' })).statusCode).toBe(201);
    const fourth = await post({ body: 'One too many', tone: 'info' });
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().code).toBe('announcement_limit');
  });
});

describe('searching the instance', () => {
  const search = (q: string) => app.inject({ method: 'GET', url: `/api/admin/search?q=${encodeURIComponent(q)}`, headers: asAdmin() }).then((res) => res.json());

  it('finds accounts and spaces by name, the closest first', async () => {
    addUser('zz_memberish');
    addSpace('Member Lounge', 'public', adminId);
    const body = await search('member');
    expect(body.users.map((u: { username: string }) => u.username)).toEqual(['member_one', 'zz_memberish']);
    expect(body.spaces.map((s: { name: string }) => s.name)).toEqual(['Member Lounge']);
    expect(body.users[0]).not.toHaveProperty('email');
    expect(body.users[0]).not.toHaveProperty('passwordHash');
  });

  it('takes its wildcards as plain characters: it finds, it does not list', async () => {
    expect((await search('%%')).users).toEqual([]);
    expect((await search('__')).users).toEqual([]);
    expect((await search('m')).users).toEqual([]);
  });

  it('finds an account by its whole address, and not by part of one', async () => {
    getDb().update(schema.users).set({ email: 'member@example.org', emailVerifiedAt: Date.now() }).where(eq(schema.users.id, memberId)).run();
    expect((await search('member@example.org')).users.map((u: { id: string }) => u.id)).toEqual([memberId]);
    expect((await search('example.org')).users).toEqual([]);
  });

  it('finds nothing by an address nobody confirmed, which anyone could have typed', async () => {
    getDb().update(schema.users).set({ email: 'member@example.org' }).where(eq(schema.users.id, memberId)).run();
    expect((await search('member@example.org')).users).toEqual([]);
  });
});

describe('exports', () => {
  it('list the accounts without addresses, and are in the log', async () => {
    getDb().update(schema.users).set({ email: 'member@example.org' }).where(eq(schema.users.id, memberId)).run();
    const res = await app.inject({ method: 'GET', url: '/api/admin/users.csv', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body).toContain('member_one');
    expect(res.body).not.toContain('member@example.org');
    expect(auditActions()).toContain('accounts_export');
  });

  it('call an account suspended only while it is', async () => {
    const now = Date.now();
    getDb().update(schema.users).set({ suspendedAt: now - 2000, suspendedUntil: now - 1000 }).where(eq(schema.users.id, memberId)).run();
    const ended = await app.inject({ method: 'GET', url: '/api/admin/users.csv', headers: asAdmin() });
    expect(ended.body.split('\r\n').find((line) => line.includes('member_one'))).toContain(',false,false,false');
    getDb().update(schema.users).set({ suspendedUntil: null }).where(eq(schema.users.id, memberId)).run();
    const running = await app.inject({ method: 'GET', url: '/api/admin/users.csv', headers: asAdmin() });
    expect(running.body.split('\r\n').find((line) => line.includes('member_one'))).toContain(',true,false,false');
  });

  it('list the audit log', async () => {
    await app.inject({ method: 'POST', url: '/api/admin/announcements', headers: asAdmin(), payload: { body: 'For the log.', tone: 'info' } });
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit.csv', headers: asAdmin() });
    expect(res.body).toContain('announcement_create');
    expect(res.body).toContain('admin_one');
    expect(auditActions()).toContain('audit_export');
  });

  it('keep a name from running as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@me')).toBe("'@me");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    // German regional settings split on the semicolon, and a new line starts a row anywhere.
    expect(csvCell('x;=1+1;y')).toBe('"x;=1+1;y"');
    expect(csvCell('a\n=1+1')).toBe('"a\n=1+1"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
  });
});

describe('one account', () => {
  function addSession(userId: string): string {
    const id = generateSnowflake();
    const now = Date.now();
    getDb().insert(schema.sessions).values({ id, userId, createdAt: now, lastActiveAt: now, expiresAt: now + 60_000, clientLabel: 'Chrome', addressHint: '1.2.x.x' }).run();
    return id;
  }

  it('shows its sessions and can end them, one or all', async () => {
    const one = addSession(memberId);
    const two = addSession(memberId);
    const listed = await app.inject({ method: 'GET', url: `/api/admin/users/${memberId}/sessions`, headers: asAdmin() });
    expect(listed.json().sessions).toHaveLength(2);

    const ended = await app.inject({ method: 'DELETE', url: `/api/admin/users/${memberId}/sessions/${one}`, headers: asAdmin() });
    expect(ended.json().sessions.map((s: { id: string }) => s.id)).toEqual([two]);

    await app.inject({ method: 'POST', url: `/api/admin/users/${memberId}/sessions/end-all`, headers: asAdmin() });
    expect(getDb().select().from(schema.sessions).where(eq(schema.sessions.userId, memberId)).all()).toEqual([]);
    expect(auditActions().filter((action) => action === 'user_sessions_end')).toHaveLength(2);
  });

  it('tells the person in their security activity, without the admin\'s device or address', async () => {
    addSession(memberId);
    await app.inject({ method: 'POST', url: `/api/admin/users/${memberId}/sessions/end-all`, headers: { ...asAdmin(), 'user-agent': 'AdminBrowser/1.0' } });
    const events = getDb().select().from(schema.securityEvents).where(eq(schema.securityEvents.userId, memberId)).all();
    expect(events.map((event) => event.kind)).toEqual(['sessions_ended_by_admin']);
    expect(events[0]!.clientLabel).toBeNull();
    expect(events[0]!.addressHint).toBeNull();
  });

  it('cannot end a session of someone else through the wrong account', async () => {
    const other = addUser('someone_else');
    const session = addSession(other);
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/users/${memberId}/sessions/${session}`, headers: asAdmin() });
    expect(res.statusCode).toBe(404);
    expect(getDb().select().from(schema.sessions).where(eq(schema.sessions.id, session)).get()).toBeDefined();
  });

  it('will not sign an admin out of their own account here', async () => {
    const session = addSession(adminId);
    const one = await app.inject({ method: 'DELETE', url: `/api/admin/users/${adminId}/sessions/${session}`, headers: asAdmin() });
    expect(one.json().code).toBe('cannot_target_self');
    const all = await app.inject({ method: 'POST', url: `/api/admin/users/${adminId}/sessions/end-all`, headers: asAdmin() });
    expect(all.json().code).toBe('cannot_target_self');
  });

  it('keeps notes the admins can read, with who wrote them, and only says in the log that it happened', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/admin/users/${memberId}/notes`, headers: asAdmin(), payload: { body: 'Spoke to them on Friday.' } });
    expect(res.statusCode).toBe(201);
    const [note] = res.json().notes;
    expect(note.body).toBe('Spoke to them on Friday.');
    expect(note.author.username).toBe('admin_one');
    const entry = getDb().select().from(schema.platformAuditLog).where(eq(schema.platformAuditLog.action, 'user_note_add')).get();
    expect(entry?.reason).toBeNull();
    expect(JSON.stringify(entry)).not.toContain('Friday');

    const removed = await app.inject({ method: 'DELETE', url: `/api/admin/users/${memberId}/notes/${note.id}`, headers: asAdmin() });
    expect(removed.json().notes).toEqual([]);
  });

  it('warns with a reason, as a notice, and changes nothing else', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/admin/users/${memberId}/warn`, headers: asAdmin(), payload: { note: 'Please stop posting that link.', ground: 'terms' } });
    expect(res.statusCode).toBe(200);
    const [notice] = getDb().select().from(schema.userNotices).where(eq(schema.userNotices.userId, memberId)).all();
    expect(notice?.kind).toBe('warning');
    expect(notice?.note).toBe('Please stop posting that link.');
    const user = getDb().select().from(schema.users).where(eq(schema.users.id, memberId)).get();
    expect(user?.suspendedAt).toBeNull();
    // The notice holds the words; the log outlives the account and says only that it happened.
    const entry = getDb().select().from(schema.platformAuditLog).where(eq(schema.platformAuditLog.action, 'user_warn')).get();
    expect(entry?.reason).toBeNull();
    expect(JSON.stringify(entry)).not.toContain('that link');
    expect((await app.inject({ method: 'POST', url: `/api/admin/users/${memberId}/warn`, headers: asAdmin(), payload: { note: 'short', ground: 'terms' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/admin/users/${adminId}/warn`, headers: asAdmin(), payload: { note: 'A warning to myself.', ground: 'terms' } })).statusCode).toBe(400);
  });
});

describe('who may sign up', () => {
  const add = (payload: object) => app.inject({ method: 'POST', url: '/api/admin/signup-rules', headers: asAdmin(), payload });

  it('reads a domain however it is pasted, and refuses what is none', () => {
    expect(normalizeRuleValue('email_domain', 'Spam.Example ')).toBe('spam.example');
    expect(normalizeRuleValue('email_domain', 'someone@spam.example')).toBe('spam.example');
    expect(normalizeRuleValue('email_domain', 'localhost')).toBeNull();
    expect(normalizeRuleValue('email_domain', 'a b.example')).toBeNull();
    expect(normalizeRuleValue('username', 'Admin')).toBe('admin');
    expect(normalizeRuleValue('username', 'no spaces')).toBeNull();
    expect(normalizeRuleValue('username', 'ab')).toBeNull();
  });

  it('blocks a domain and everything under it, and nothing else', async () => {
    expect((await add({ kind: 'email_domain', value: 'spam.example' })).statusCode).toBe(201);
    expect(emailDomainBlocked('a@spam.example')).toBe(true);
    expect(emailDomainBlocked('a@mail.spam.example')).toBe(true);
    expect(emailDomainBlocked('a@notspam.example')).toBe(false);
    expect(emailDomainBlocked('a@example')).toBe(false);
  });

  it('takes a domain in either spelling as one', async () => {
    expect(normalizeRuleValue('email_domain', 'bücher.example')).toBe('xn--bcher-kva.example');
    expect(normalizeRuleValue('email_domain', 'xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
    expect(normalizeRuleValue('email_domain', 'shop.xn--p1ai')).toBe('shop.xn--p1ai');
    await add({ kind: 'email_domain', value: 'bücher.example' });
    expect(emailDomainBlocked('a@xn--bcher-kva.example')).toBe(true);
  });

  it('reserves a name whatever its case', async () => {
    await add({ kind: 'username', value: 'support' });
    expect(usernameReserved('Support')).toBe(true);
    expect(usernameReserved('supporter')).toBe(false);
  });

  it('adds the usual names in one go, once', async () => {
    const first = await add({ kind: 'username', usual: true });
    expect(first.json().rules).toHaveLength(USUAL_RESERVED_USERNAMES.length);
    const second = await add({ kind: 'username', usual: true });
    expect(second.json().rules).toHaveLength(USUAL_RESERVED_USERNAMES.length);
    expect(auditActions().filter((action) => action === 'signup_rule_add')).toHaveLength(USUAL_RESERVED_USERNAMES.length);
  });

  it('refuses what could not be a rule, and takes one away again', async () => {
    expect((await add({ kind: 'email_domain', value: 'nope' })).json().code).toBe('signup_rule_invalid');
    expect((await add({ kind: 'colour', value: 'red' })).statusCode).toBe(400);
    await add({ kind: 'username', value: 'support' });
    const removed = await app.inject({ method: 'DELETE', url: '/api/admin/signup-rules/username/support', headers: asAdmin() });
    expect(removed.json().rules).toEqual([]);
    expect(usernameReserved('support')).toBe(false);
  });

  it('leaves an account that has the name alone', async () => {
    await add({ kind: 'username', value: 'member_one' });
    expect(getDb().select().from(schema.users).where(eq(schema.users.id, memberId)).get()?.isDeleted).toBeFalsy();
  });
});

describe('starter spaces', () => {
  const put = (spaceIds: unknown) => app.inject({ method: 'PUT', url: '/api/admin/starter-spaces', headers: asAdmin(), payload: { spaceIds } });

  it('takes public spaces only', async () => {
    const open = addSpace('Open', 'public', adminId);
    const closed = addSpace('Closed', 'private', adminId);
    expect((await put([open])).json().spaces.map((s: { name: string }) => s.name)).toEqual(['Open']);
    expect((await put([closed])).json().code).toBe('space_not_public');
    expect((await put(['nothing'])).json().code).toBe('space_not_found');
    expect((await put('nonsense')).statusCode).toBe(400);
  });

  it('does not let one that went private since stand in the way of the rest', async () => {
    const open = addSpace('Open', 'public', adminId);
    const later = addSpace('Later', 'public', adminId);
    await put([later]);
    getDb().update(schema.spaces).set({ visibility: 'private' }).where(eq(schema.spaces.id, later)).run();
    const res = await put([later, open]);
    expect(res.statusCode).toBe(200);
    expect(res.json().spaces.map((s: { visibility: string }) => s.visibility).sort()).toEqual(['private', 'public']);
  });

  it('holds a few, not many', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => addSpace(`S${i}`, 'public', adminId));
    expect((await put(ids)).json().code).toBe('starter_spaces_limit');
  });

  it('puts a new account in them, and skips one that went private since', async () => {
    const open = addSpace('Open', 'public', adminId);
    const later = addSpace('Later private', 'public', adminId);
    await put([open, later]);
    getDb().update(schema.spaces).set({ visibility: 'private' }).where(eq(schema.spaces.id, later)).run();
    const fresh = addUser('newcomer');
    joinStarterSpaces(fresh);
    const memberships = getDb().select().from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, fresh)).all();
    expect(memberships.map((row) => row.spaceId)).toEqual([open]);
  });
});
