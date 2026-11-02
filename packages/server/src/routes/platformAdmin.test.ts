import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdminUser } from '@backspace/shared';
import type {
  AdminSpaceDetail,
  AdminSpaceListResponse,
  AdminUserDetail,
  PlatformAuditResponse,
  PlatformOverview,
  ReviewQueueResponse,
  SpaceReviewState,
} from '@backspace/shared/src/platform.js';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { signJwt } from '../utils/auth.js';

// The platform admin area (routes/platformAdmin.ts) with the owner's side of
// the reviews (routes/spaceReview.ts) mounted beside it, so a review runs
// from the owner's request to the admin's decision. Authentication is the
// real one: a suspension shows as the token being refused.

setWorkerId(13);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;

const sendToUser = vi.fn();
const sendToAdmins = vi.fn();
const sendToSpace = vi.fn();
const forceDisconnectUser = vi.fn();

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: (...args: unknown[]) => sendToUser(...args),
    sendToAdmins: (...args: unknown[]) => sendToAdmins(...args),
    sendToSpace: (...args: unknown[]) => sendToSpace(...args),
    forceDisconnectUser: (...args: unknown[]) => forceDisconnectUser(...args),
    getAllOnlineUserIds: () => [],
  },
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    for (const stmt of sqlText.split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const ADMIN_ID = 'admin';
const OTHER_ADMIN_ID = 'admin-two';
const OWNER_ID = 'owner';
const MEMBER_ID = 'member';
const SPACE_ID = 'space-1';
const REVIEW_URL = `/api/spaces/${SPACE_ID}/review`;

const VERIFICATION_REQUEST = {
  category: 'community',
  website: 'https://chess.example',
  reason: 'We are the official community of the Example chess league.',
  proof: 'The league website links to this space in its footer.',
};

function seedUser(id: string, extra: Partial<typeof schema.users.$inferInsert> = {}): void {
  testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1, ...extra }).run();
}

async function buildApp(): Promise<FastifyInstance> {
  const { platformAdminRoutes } = await import('./platformAdmin.js');
  const { spaceReviewRoutes, _resetReviewSubmitLimit } = await import('./spaceReview.js');
  _resetReviewSubmitLimit();
  const f = Fastify();
  await f.register(platformAdminRoutes);
  await f.register(spaceReviewRoutes);
  return f;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.clearAllMocks();
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });

  testDb.insert(schema.instanceSettings).values({ id: 1, updatedAt: T0 }).run();
  seedUser(ADMIN_ID, { isAdmin: 1 });
  seedUser(OTHER_ADMIN_ID, { isAdmin: 1 });
  seedUser(OWNER_ID);
  seedUser(MEMBER_ID);
  testDb.insert(schema.spaces).values({
    id: SPACE_ID,
    name: 'Chess Club',
    ownerId: OWNER_ID,
    inviteCode: 'inv-1',
    visibility: 'public',
    description: 'Weekly blitz and puzzles',
    createdAt: T0,
  }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId: SPACE_ID, userId: OWNER_ID, joinedAt: T0 }).run();

  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  vi.useRealTimers();
});

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** A request signed in as `userId`, with a token issued now. */
function call(userId: string, method: Method, url: string, payload?: Record<string, unknown>): Promise<LightMyRequestResponse> {
  const token = signJwt({ userId, username: userId });
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
}

function storedUser(id: string): typeof schema.users.$inferSelect {
  const row = testDb.select().from(schema.users).where(eq(schema.users.id, id)).get();
  if (!row) throw new Error(`no user ${id}`);
  return row;
}

function storedSpace(): typeof schema.spaces.$inferSelect {
  const row = testDb.select().from(schema.spaces).where(eq(schema.spaces.id, SPACE_ID)).get();
  if (!row) throw new Error('space missing');
  return row;
}

interface StoredAuditRow {
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  details: string | null;
}

/** The platform audit log in the order it was written. */
function auditRows(): Array<{ action: string; targetType: string; targetId: string; reason: string | null; details: unknown }> {
  const rows = sqlite.prepare('SELECT action, target_type, target_id, reason, details FROM platform_audit_log ORDER BY rowid').all() as StoredAuditRow[];
  return rows.map((row) => ({
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    details: row.details === null ? null : JSON.parse(row.details) as unknown,
  }));
}

describe('who may use the admin area', () => {
  const ROUTES: Array<[Method, string, Record<string, unknown> | undefined]> = [
    ['GET', '/api/admin/overview', undefined],
    ['GET', `/api/admin/users/${MEMBER_ID}`, undefined],
    ['POST', `/api/admin/users/${MEMBER_ID}/suspend`, { reason: 'Spamming the lobby', durationHours: null }],
    ['POST', `/api/admin/users/${MEMBER_ID}/unsuspend`, {}],
    ['PUT', `/api/admin/users/${MEMBER_ID}/badges`, { badges: ['founder'] }],
    ['GET', '/api/admin/spaces', undefined],
    ['GET', `/api/admin/spaces/${SPACE_ID}`, undefined],
    ['PUT', `/api/admin/spaces/${SPACE_ID}/badges`, { badges: ['partner'] }],
    ['GET', '/api/admin/reviews', undefined],
    ['POST', `/api/admin/spaces/${SPACE_ID}/verification/approve`, {}],
    ['POST', `/api/admin/spaces/${SPACE_ID}/discovery/approve`, {}],
    ['GET', '/api/admin/audit', undefined],
  ];

  // The space's owner is the caller: owning a space opens none of these.
  it.each(ROUTES)('%s %s answers 403 forbidden to an account that is no instance admin', async (method, url, payload) => {
    const res = await call(OWNER_ID, method, url, payload);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
    expect(auditRows()).toEqual([]);
    expect(storedUser(MEMBER_ID)).toMatchObject({ suspendedAt: null, badges: null });
    expect(storedSpace()).toMatchObject({ badges: null, verificationStatus: null, discoveryStatus: null });
  });

  it('asks for a token before anything else', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/overview' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });
});

describe('GET /api/admin/overview', () => {
  it('counts accounts, suspensions, admins, spaces and open reviews from the database', async () => {
    testDb.update(schema.users)
      .set({ suspendedAt: T0 - MINUTE, suspendedUntil: null, suspensionReason: 'Spam' })
      .where(eq(schema.users.id, MEMBER_ID)).run();
    expect((await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/discovery`, { category: 'gaming' })).statusCode).toBe(200);

    const res = await call(ADMIN_ID, 'GET', '/api/admin/overview');
    expect(res.statusCode).toBe(200);
    expect(res.json<PlatformOverview>()).toEqual({
      users: { total: 4, online: 0, new7d: 0, active7d: 0, suspended: 1, admins: 2 },
      activity: { messages7d: 0 },
      spaces: { total: 1, listed: 0, verified: 0, discoveryEnabled: true },
      reviews: { verificationOpen: 0, discoveryOpen: 1 },
    });
  });
});

describe('suspensions', () => {
  it('refuses to suspend yourself, an admin, or without a reason of at least three characters', async () => {
    const self = await call(ADMIN_ID, 'POST', `/api/admin/users/${ADMIN_ID}/suspend`, { reason: 'Testing myself', durationHours: null });
    expect(self.statusCode).toBe(400);
    expect(self.json().code).toBe('cannot_suspend_self');

    const admin = await call(ADMIN_ID, 'POST', `/api/admin/users/${OTHER_ADMIN_ID}/suspend`, { reason: 'Admin trouble', durationHours: null });
    expect(admin.statusCode).toBe(400);
    expect(admin.json().code).toBe('cannot_suspend_admin');

    const short = await call(ADMIN_ID, 'POST', `/api/admin/users/${MEMBER_ID}/suspend`, { reason: '  ab  ', durationHours: 24 });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({ code: 'suspension_reason_invalid', details: { min: 3, max: 500 } });

    const tooLong = await call(ADMIN_ID, 'POST', `/api/admin/users/${MEMBER_ID}/suspend`, { reason: 'Spamming the lobby', durationHours: 24 * 365 + 1 });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toMatchObject({ code: 'suspension_duration_invalid', details: { max: 24 * 365 } });

    expect(storedUser(MEMBER_ID).suspendedAt).toBeNull();
    expect(storedUser(OTHER_ADMIN_ID).suspendedAt).toBeNull();
    expect(forceDisconnectUser).not.toHaveBeenCalled();
    expect(auditRows()).toEqual([]);
  });

  it('ends the sessions of a suspended account, so an old token does not come back with it', async () => {
    testDb.insert(schema.sessions).values({ id: 'session-before', userId: OWNER_ID, createdAt: T0, lastActiveAt: T0, expiresAt: T0 + 86_400_000 }).run();
    const sessions = () => testDb.select().from(schema.sessions).where(eq(schema.sessions.userId, OWNER_ID)).all();
    expect(sessions()).toHaveLength(1);
    expect((await call(ADMIN_ID, 'POST', `/api/admin/users/${OWNER_ID}/suspend`, { reason: 'Spamming the lobby', durationHours: null })).statusCode).toBe(200);
    expect(sessions()).toEqual([]);
  });

  it('locks a suspended account out with 401 account_suspended, and lifting it restores access', async () => {
    expect((await call(OWNER_ID, 'GET', REVIEW_URL)).statusCode).toBe(200);

    const suspended = await call(ADMIN_ID, 'POST', `/api/admin/users/${OWNER_ID}/suspend`, { reason: '  Spamming the lobby  ', durationHours: null });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json<AdminUser>().suspension).toEqual({ since: T0, until: null, reason: 'Spamming the lobby' });
    expect(forceDisconnectUser).toHaveBeenCalledWith(OWNER_ID, { reason: 'Account suspended', endPresence: true });

    const refused = await call(OWNER_ID, 'GET', REVIEW_URL);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({
      error: 'This account is suspended',
      code: 'account_suspended',
      statusCode: 401,
      details: { reason: 'Spamming the lobby' },
    });

    const lifted = await call(ADMIN_ID, 'POST', `/api/admin/users/${OWNER_ID}/unsuspend`, { reason: 'Appeal accepted' });
    expect(lifted.statusCode).toBe(200);
    expect(lifted.json<AdminUser>().suspension).toBeNull();
    expect((await call(OWNER_ID, 'GET', REVIEW_URL)).statusCode).toBe(200);

    const again = await call(ADMIN_ID, 'POST', `/api/admin/users/${OWNER_ID}/unsuspend`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('user_not_suspended');

    expect(auditRows()).toEqual([
      {
        action: 'user_suspend', targetType: 'user', targetId: OWNER_ID, reason: 'Spamming the lobby',
        details: { until: null, durationHours: null },
      },
      {
        action: 'user_unsuspend', targetType: 'user', targetId: OWNER_ID, reason: 'Appeal accepted',
        details: { expired: false },
      },
    ]);
  });

  it('ends a time-limited suspension by itself once its time is up', async () => {
    const suspended = await call(ADMIN_ID, 'POST', `/api/admin/users/${OWNER_ID}/suspend`, { reason: 'Cool down', durationHours: 1 });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json<AdminUser>().suspension).toEqual({ since: T0, until: T0 + HOUR, reason: 'Cool down' });

    const refused = await call(OWNER_ID, 'GET', REVIEW_URL);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ code: 'account_suspended', details: { reason: 'Cool down', until: T0 + HOUR } });

    vi.setSystemTime(T0 + HOUR - 1);
    expect((await call(OWNER_ID, 'GET', REVIEW_URL)).statusCode).toBe(401);

    vi.setSystemTime(T0 + HOUR);
    expect((await call(OWNER_ID, 'GET', REVIEW_URL)).statusCode).toBe(200);
    const detail = await call(ADMIN_ID, 'GET', `/api/admin/users/${OWNER_ID}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json<AdminUserDetail>().user.suspension).toBeNull();
  });
});

describe('badges', () => {
  it('gives a person granted badges in display order, and refuses derived, unknown or space badges', async () => {
    for (const badges of [['staff'], ['verified'], ['no_such_badge'], 'founder']) {
      const res = await call(ADMIN_ID, 'PUT', `/api/admin/users/${MEMBER_ID}/badges`, { badges });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('badge_invalid');
    }
    expect(storedUser(MEMBER_ID).badges).toBeNull();

    const given = await call(ADMIN_ID, 'PUT', `/api/admin/users/${MEMBER_ID}/badges`, {
      badges: ['bug_hunter', 'founder', 'founder'],
      reason: 'Found the sign-in bug',
    });
    expect(given.statusCode).toBe(200);
    expect(given.json<AdminUser>().grantedBadges).toEqual(['founder', 'bug_hunter']);
    expect(storedUser(MEMBER_ID).badges).toBe(JSON.stringify(['founder', 'bug_hunter']));
    expect(sendToUser).toHaveBeenCalledWith(MEMBER_ID, expect.objectContaining({ type: 'user_updated' }));
    expect(auditRows()).toEqual([{
      action: 'user_badges', targetType: 'user', targetId: MEMBER_ID, reason: 'Found the sign-in bug',
      details: { added: ['founder', 'bug_hunter'], removed: [] },
    }]);
  });

  it('gives a space the partner badge, never verified, which only a verification gives', async () => {
    for (const badges of [['verified'], ['founder']]) {
      const res = await call(ADMIN_ID, 'PUT', `/api/admin/spaces/${SPACE_ID}/badges`, { badges });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('badge_invalid');
    }

    const partner = await call(ADMIN_ID, 'PUT', `/api/admin/spaces/${SPACE_ID}/badges`, { badges: ['partner'] });
    expect(partner.statusCode).toBe(200);
    expect(partner.json()).toMatchObject({ id: SPACE_ID, badges: ['partner'], grantedBadges: ['partner'] });
    expect(sendToSpace).toHaveBeenCalledWith(SPACE_ID, expect.objectContaining({
      type: 'space_updated',
      space: expect.objectContaining({ badges: ['partner'] }),
    }));
    expect(auditRows().map((row) => row.action)).toEqual(['space_badges']);
  });
});

describe('GET /api/admin/spaces', () => {
  it('finds spaces by name and filters the listed, the verified and those with an open review', async () => {
    testDb.insert(schema.spaces).values([
      { id: 'listed', name: 'Listed 100%', ownerId: OWNER_ID, visibility: 'public', discoveryStatus: 'approved', createdAt: T0 - 3000 },
      { id: 'verified', name: 'Verified', ownerId: OWNER_ID, visibility: 'private', verificationStatus: 'verified', createdAt: T0 - 2000 },
      { id: 'asking', name: 'Asking', ownerId: OWNER_ID, visibility: 'request', discoveryStatus: 'pending', createdAt: T0 - 1000 },
    ]).run();
    const list = async (query: string): Promise<AdminSpaceListResponse> => {
      const res = await call(ADMIN_ID, 'GET', `/api/admin/spaces${query}`);
      expect(res.statusCode).toBe(200);
      return res.json<AdminSpaceListResponse>();
    };

    expect((await list('')).spaces.map((space) => space.id)).toEqual([SPACE_ID, 'asking', 'verified', 'listed']);
    expect((await list('?filter=listed')).spaces.map((space) => space.id)).toEqual(['listed']);
    const verified = await list('?filter=verified');
    expect(verified.spaces.map((space) => [space.id, space.badges])).toEqual([['verified', ['verified']]]);
    expect((await list('?filter=open_review')).spaces.map((space) => space.id)).toEqual(['asking']);
    // A % in the query is a character, not a wildcard.
    expect((await list(`?q=${encodeURIComponent('100%')}`)).spaces.map((space) => space.id)).toEqual(['listed']);
  });
});

describe('verification decisions', () => {
  it('goes pending, needs_info, pending again when the owner answers, then verified, and the space shows the badge', async () => {
    const asked = await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/verification`, VERIFICATION_REQUEST);
    expect(asked.statusCode).toBe(200);
    expect(asked.json<SpaceReviewState>().verification.status).toBe('pending');

    const info = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/verification/request_info`, {
      note: 'Link the post that names this space.',
    });
    expect(info.statusCode).toBe(200);
    expect(info.json<SpaceReviewState>().verification).toMatchObject({
      status: 'needs_info',
      request: { decisionNote: 'Link the post that names this space.' },
    });
    // The owner reads the note as a status message.
    expect(sendToUser).toHaveBeenCalledWith(OWNER_ID, expect.objectContaining({
      type: 'space_review_updated',
      process: 'verification',
      action: 'request_info',
      status: 'needs_info',
      note: 'Link the post that names this space.',
    }));

    vi.setSystemTime(T0 + MINUTE);
    const answered = await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/verification`, {
      ...VERIFICATION_REQUEST,
      profiles: ['https://social.example/@chessleague/1'],
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json<SpaceReviewState>().verification).toMatchObject({
      status: 'pending',
      request: { requestedAt: T0 + MINUTE, decidedAt: null, decisionNote: null },
    });

    const approved = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/verification/approve`, { requestedAt: T0 + MINUTE });
    expect(approved.statusCode).toBe(200);
    const state = approved.json<SpaceReviewState>();
    expect(state.verification.status).toBe('verified');
    expect(state.verification.history.map((event) => [event.action, event.status])).toEqual([
      ['submit', 'pending'],
      ['request_info', 'needs_info'],
      ['submit', 'pending'],
      ['approve', 'verified'],
    ]);

    expect(storedSpace().verificationStatus).toBe('verified');
    const detail = await call(ADMIN_ID, 'GET', `/api/admin/spaces/${SPACE_ID}`);
    expect(detail.json<AdminSpaceDetail>().space.badges).toEqual(['verified']);
    // Members see the badge at once.
    expect(sendToSpace).toHaveBeenLastCalledWith(SPACE_ID, expect.objectContaining({
      type: 'space_updated',
      space: expect.objectContaining({ id: SPACE_ID, badges: ['verified'] }),
    }));
  });

  it('refuses a decision the status does not allow with 409 review_status_conflict', async () => {
    const never = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/verification/approve`, {});
    expect(never.statusCode).toBe(409);
    expect(never.json().code).toBe('review_status_conflict');

    expect((await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/verification`, VERIFICATION_REQUEST)).statusCode).toBe(200);
    const revoke = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/verification/revoke`, { note: 'Not verified yet.' });
    expect(revoke.statusCode).toBe(409);
    expect(revoke.json().code).toBe('review_status_conflict');

    expect((await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/verification/request_info`, { note: 'Which post?' })).statusCode).toBe(200);
    const askAgain = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/verification/request_info`, { note: 'Which post, again?' });
    expect(askAgain.statusCode).toBe(409);
    expect(askAgain.json().code).toBe('review_status_conflict');

    const noListing = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/discovery/approve`, {});
    expect(noListing.statusCode).toBe(409);
    expect(noListing.json().code).toBe('review_status_conflict');

    expect(storedSpace()).toMatchObject({ verificationStatus: 'needs_info', discoveryStatus: null });
    expect(auditRows().map((row) => row.action)).toEqual(['verification_request_info']);
  });

  it('refuses a decision that is no decision, or a refusal without a note for the owner', async () => {
    expect((await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/verification`, VERIFICATION_REQUEST)).statusCode).toBe(200);

    const unknown = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/verification/maybe`, {});
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe('review_decision_invalid');

    const silent = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/verification/reject`, { note: '   ' });
    expect(silent.statusCode).toBe(400);
    expect(silent.json().code).toBe('review_note_required');

    expect(storedSpace().verificationStatus).toBe('pending');
    expect(auditRows()).toEqual([]);
  });
});

describe('Discovery decisions', () => {
  it('refuses a decision on a request the owner has sent again since the admin read it', async () => {
    expect((await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/discovery`, { category: 'gaming' })).statusCode).toBe(200);
    const queue = await call(ADMIN_ID, 'GET', '/api/admin/reviews');
    expect(queue.statusCode).toBe(200);
    const seen = queue.json<ReviewQueueResponse>().discovery[0]?.request.requestedAt;
    expect(seen).toBe(T0);

    vi.setSystemTime(T0 + MINUTE);
    expect((await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/discovery`, { category: 'education' })).statusCode).toBe(200);

    const stale = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/discovery/approve`, { requestedAt: T0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('review_status_conflict');
    expect(storedSpace().discoveryStatus).toBe('pending');
    expect(auditRows()).toEqual([]);

    const current = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/discovery/approve`, { requestedAt: T0 + MINUTE });
    expect(current.statusCode).toBe(200);
    expect(current.json<SpaceReviewState>().discovery).toMatchObject({ status: 'approved', request: { category: 'education' } });
  });

  it('refuses to approve a listing while its icon or banner is another site\'s picture', async () => {
    expect((await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/discovery`, { category: 'gaming' })).statusCode).toBe(200);
    testDb.update(schema.spaces).set({ icon: 'https://cdn.example/icon.png' }).where(eq(schema.spaces.id, SPACE_ID)).run();

    const res = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/discovery/approve`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('discovery_requires_uploaded_pictures');
    expect(storedSpace().discoveryStatus).toBe('pending');
    expect(auditRows()).toEqual([]);
  });
});

describe('the platform audit log', () => {
  it('records every decision with its note and the status it left, newest first on GET /api/admin/audit', async () => {
    expect((await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/verification`, VERIFICATION_REQUEST)).statusCode).toBe(200);
    expect((await call(OWNER_ID, 'PUT', `/api/spaces/${SPACE_ID}/discovery`, { category: 'community' })).statusCode).toBe(200);

    const decisions: Array<[string, Record<string, unknown>]> = [
      ['verification/request_info', { note: 'Which post names the space?' }],
      ['verification/reject', { note: 'No proof found.' }],
      ['discovery/request_changes', { note: 'Say what the space is about.' }],
      ['discovery/approve', {}],
      ['discovery/withdraw', { note: 'The listing became spam.' }],
    ];
    for (const [decision, body] of decisions) {
      const res = await call(ADMIN_ID, 'POST', `/api/admin/spaces/${SPACE_ID}/${decision}`, body);
      expect(res.statusCode).toBe(200);
    }

    const space = { targetType: 'space', targetId: SPACE_ID };
    expect(auditRows()).toEqual([
      { ...space, action: 'verification_request_info', reason: 'Which post names the space?', details: { status: 'needs_info' } },
      { ...space, action: 'verification_reject', reason: 'No proof found.', details: { status: 'rejected' } },
      { ...space, action: 'discovery_request_changes', reason: 'Say what the space is about.', details: { status: 'changes_requested' } },
      { ...space, action: 'discovery_approve', reason: null, details: { status: 'approved' } },
      { ...space, action: 'discovery_withdraw', reason: 'The listing became spam.', details: { status: 'withdrawn' } },
    ]);

    const audit = await call(ADMIN_ID, 'GET', `/api/admin/audit?targetType=space&targetId=${SPACE_ID}`);
    expect(audit.statusCode).toBe(200);
    const page = audit.json<PlatformAuditResponse>();
    expect(page.hasMore).toBe(false);
    expect(page.entries.map((entry) => entry.action)).toEqual([
      'discovery_withdraw',
      'discovery_approve',
      'discovery_request_changes',
      'verification_reject',
      'verification_request_info',
    ]);
    expect(page.entries[0]).toMatchObject({ actor: { id: ADMIN_ID, username: ADMIN_ID }, targetLabel: 'Chess Club' });
  });

  it('refuses a filter it does not know', async () => {
    for (const query of ['?targetType=planet', '?action=launch', '?before=soon']) {
      const res = await call(ADMIN_ID, 'GET', `/api/admin/audit${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('validation_failed');
    }
  });
});
