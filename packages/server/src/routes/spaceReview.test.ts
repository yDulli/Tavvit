import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExploreSpace, Space } from '@backspace/shared';
import type { SpaceReviewState } from '@backspace/shared/src/platform.js';
import * as schema from '../db/schema.js';
import { hasPermission, PermissionBits } from '../utils/permissions.js';
import { setWorkerId } from '../utils/snowflake.js';

// A space owner's side of the platform's reviews (routes/spaceReview.ts),
// with what the reviews reach: the Explore page lists only an approved space,
// an admin decides (routes/platformAdmin.ts), and an edit of the space
// (routes/spaces.ts PATCH) can send a review back (utils/spaceReview.ts).

setWorkerId(14);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
let currentUserId = 'owner';

const sendToUser = vi.fn();
const sendToAdmins = vi.fn();
const sendToSpace = vi.fn();
const announceSpaceAccessChange = vi.fn();

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

// The caller is whoever the case says; requireAdmin stays the real one, so an
// admin is an admin by `users.is_admin` alone.
vi.mock('../utils/auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/auth.js')>()),
  authenticate: async (req: { userId?: string }) => {
    req.userId = currentUserId;
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: (...args: unknown[]) => sendToUser(...args),
    sendToAdmins: (...args: unknown[]) => sendToAdmins(...args),
    sendToSpace: (...args: unknown[]) => sendToSpace(...args),
    announceSpaceAccessChange: (...args: unknown[]) => announceSpaceAccessChange(...args),
    addUserSpace: vi.fn(),
    getAllOnlineUserIds: () => [],
  },
}));

vi.mock('../ws/events.js', () => ({
  checkVoicePermissions: vi.fn(),
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

const OWNER = 'owner';
const MANAGER = 'manager';
const ADMIN = 'admin';
const OUTSIDER = 'outsider';
const SPACE_ID = 'space-1';
const REVIEW_URL = `/api/spaces/${SPACE_ID}/review`;
const DISCOVERY_URL = `/api/spaces/${SPACE_ID}/discovery`;
const VERIFICATION_URL = `/api/spaces/${SPACE_ID}/verification`;

const VERIFICATION_REQUEST = {
  category: 'community',
  reason: 'We are the official community of the Example chess league.',
  proof: 'The league website links to this space in its footer.',
};

async function buildApp(): Promise<FastifyInstance> {
  const { spaceRoutes } = await import('./spaces.js');
  const { exploreRoutes } = await import('./explore.js');
  const { spaceReviewRoutes, _resetReviewSubmitLimit } = await import('./spaceReview.js');
  const { platformAdminRoutes } = await import('./platformAdmin.js');
  _resetReviewSubmitLimit();
  const f = Fastify();
  await f.register(spaceRoutes);
  await f.register(exploreRoutes);
  await f.register(spaceReviewRoutes);
  await f.register(platformAdminRoutes);
  return f;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.clearAllMocks();
  currentUserId = OWNER;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });

  testDb.insert(schema.instanceSettings).values({ id: 1, discoveryEnabled: 1, updatedAt: T0 }).run();
  for (const id of [OWNER, MANAGER, ADMIN, OUTSIDER]) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', isAdmin: id === ADMIN ? 1 : 0, createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({
    id: SPACE_ID,
    name: 'Chess Club',
    ownerId: OWNER,
    inviteCode: 'inv-1',
    visibility: 'public',
    description: 'Weekly blitz and puzzles',
    createdAt: T0,
  }).run();
  for (const userId of [OWNER, MANAGER]) {
    testDb.insert(schema.spaceMembers).values({ spaceId: SPACE_ID, userId, joinedAt: T0 }).run();
  }
  testDb.insert(schema.roles).values([
    { id: SPACE_ID, spaceId: SPACE_ID, name: '@everyone', permissions: '0', position: 0, createdAt: 1 },
    { id: 'manager-role', spaceId: SPACE_ID, name: 'Manager', permissions: PermissionBits.MANAGE_SPACE.toString(), position: 1, createdAt: 1 },
  ]).run();
  testDb.insert(schema.memberRoles).values({ spaceId: SPACE_ID, userId: MANAGER, roleId: 'manager-role' }).run();

  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  vi.useRealTimers();
});

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A request as `userId`. Callers await each one before the next. */
function send(userId: string, method: Method, url: string, payload?: Record<string, unknown>): Promise<LightMyRequestResponse> {
  currentUserId = userId;
  return app.inject({ method, url, payload });
}

function storedSpace(): typeof schema.spaces.$inferSelect {
  const row = testDb.select().from(schema.spaces).where(eq(schema.spaces.id, SPACE_ID)).get();
  if (!row) throw new Error('space missing');
  return row;
}

function setSpace(values: Partial<typeof schema.spaces.$inferInsert>): void {
  testDb.update(schema.spaces).set(values).where(eq(schema.spaces.id, SPACE_ID)).run();
}

/** The Explore page as someone who belongs to no space. */
async function explore(): Promise<{ spaces: ExploreSpace[]; total: number }> {
  const res = await send(OUTSIDER, 'GET', '/api/spaces/explore');
  expect(res.statusCode).toBe(200);
  return res.json<{ spaces: ExploreSpace[]; total: number }>();
}

async function reviewState(): Promise<SpaceReviewState> {
  const res = await send(OWNER, 'GET', REVIEW_URL);
  expect(res.statusCode).toBe(200);
  return res.json<SpaceReviewState>();
}

/** The owner asks for a listing and an admin approves it. */
async function approveListing(): Promise<void> {
  expect((await send(OWNER, 'PUT', DISCOVERY_URL, { category: 'gaming' })).statusCode).toBe(200);
  expect((await send(ADMIN, 'POST', `/api/admin/spaces/${SPACE_ID}/discovery/approve`, {})).statusCode).toBe(200);
  expect(storedSpace().discoveryStatus).toBe('approved');
}

/** The owner asks for verification and an admin grants it. */
async function verify(): Promise<void> {
  expect((await send(OWNER, 'PUT', VERIFICATION_URL, VERIFICATION_REQUEST)).statusCode).toBe(200);
  expect((await send(ADMIN, 'POST', `/api/admin/spaces/${SPACE_ID}/verification/approve`, {})).statusCode).toBe(200);
  expect(storedSpace().verificationStatus).toBe('verified');
}

function refusal(res: LightMyRequestResponse): [number, unknown] {
  return [res.statusCode, res.json().code];
}

describe('who may ask', () => {
  const OWNER_ROUTES: Array<[Method, string, Record<string, unknown> | undefined]> = [
    ['GET', REVIEW_URL, undefined],
    ['PUT', VERIFICATION_URL, VERIFICATION_REQUEST],
    ['DELETE', VERIFICATION_URL, undefined],
    ['PUT', DISCOVERY_URL, { category: 'gaming' }],
    ['DELETE', DISCOVERY_URL, undefined],
  ];

  it.each(OWNER_ROUTES)('%s %s refuses a member who holds MANAGE_SPACE but does not own the space', async (method, url, payload) => {
    expect(hasPermission(MANAGER, SPACE_ID, PermissionBits.MANAGE_SPACE)).toBe(true);
    const res = await send(MANAGER, method, url, payload);
    expect(refusal(res)).toEqual([403, 'space_owner_only']);
    expect(storedSpace()).toMatchObject({ verificationStatus: null, discoveryStatus: null });
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('lets the owner ask, and an instance admin read the review but not ask', async () => {
    const asked = await send(OWNER, 'PUT', DISCOVERY_URL, { category: 'gaming' });
    expect(asked.statusCode).toBe(200);
    expect(asked.json<SpaceReviewState>().discovery).toMatchObject({
      status: 'pending',
      request: { category: 'gaming', requestedAt: T0, requestedBy: { id: OWNER } },
    });

    const read = await send(ADMIN, 'GET', REVIEW_URL);
    expect(read.statusCode).toBe(200);
    expect(read.json<SpaceReviewState>().discovery.status).toBe('pending');

    expect(refusal(await send(ADMIN, 'PUT', VERIFICATION_URL, VERIFICATION_REQUEST))).toEqual([403, 'space_owner_only']);
    expect(refusal(await send(OUTSIDER, 'GET', REVIEW_URL))).toEqual([403, 'space_owner_only']);
    expect(storedSpace().verificationStatus).toBeNull();
  });
});

describe('asking for a Discovery listing', () => {
  it('needs a public or request-only space with a description and pictures this instance serves', async () => {
    const ask = () => send(OWNER, 'PUT', DISCOVERY_URL, { category: 'gaming' });

    setSpace({ visibility: 'private' });
    expect(refusal(await ask())).toEqual([409, 'discovery_requires_listable_visibility']);

    setSpace({ visibility: 'public', description: null });
    expect(refusal(await ask())).toEqual([409, 'discovery_requires_description']);
    setSpace({ description: '   ' });
    expect(refusal(await ask())).toEqual([409, 'discovery_requires_description']);

    setSpace({ description: 'Weekly blitz and puzzles', icon: 'https://cdn.example/icon.png' });
    expect(refusal(await ask())).toEqual([409, 'discovery_requires_uploaded_pictures']);
    setSpace({ icon: null, banner: 'http://cdn.example/banner.png' });
    expect(refusal(await ask())).toEqual([409, 'discovery_requires_uploaded_pictures']);

    setSpace({ banner: null, visibility: 'request' });
    expect(refusal(await send(OWNER, 'PUT', DISCOVERY_URL, { category: 'cooking' }))).toEqual([400, 'review_category_invalid']);
    expect(storedSpace().discoveryStatus).toBeNull();

    const asked = await ask();
    expect(asked.statusCode).toBe(200);
    expect(storedSpace().discoveryStatus).toBe('pending');
  });
});

describe('the Explore page', () => {
  it('lists an approved space and keeps one whose request waits off it', async () => {
    expect((await explore()).spaces).toEqual([]);

    expect((await send(OWNER, 'PUT', DISCOVERY_URL, { category: 'gaming' })).statusCode).toBe(200);
    expect(await explore()).toMatchObject({ spaces: [], total: 0 });

    expect((await send(ADMIN, 'POST', `/api/admin/spaces/${SPACE_ID}/discovery/approve`, {})).statusCode).toBe(200);
    const listed = await explore();
    expect(listed.total).toBe(1);
    expect(listed.spaces).toEqual([expect.objectContaining({
      id: SPACE_ID,
      name: 'Chess Club',
      category: 'gaming',
      badges: [],
      memberCount: 2,
      joined: false,
    })]);
  });
});

describe('edits of a reviewed space', () => {
  it('puts an approved space back to review when its name changes, as a new version of the request', async () => {
    await approveListing();
    vi.setSystemTime(T0 + MINUTE);

    const renamed = await send(OWNER, 'PATCH', `/api/spaces/${SPACE_ID}`, { name: 'Chess Club Berlin' });
    expect(renamed.statusCode).toBe(200);
    expect(storedSpace()).toMatchObject({ name: 'Chess Club Berlin', discoveryStatus: 'pending' });
    expect((await explore()).spaces).toEqual([]);

    const review = await reviewState();
    expect(review.discovery.request?.requestedAt).toBe(T0 + MINUTE);
    expect(review.discovery.history.map((event) => [event.action, event.status])).toEqual([
      ['submit', 'pending'],
      ['approve', 'approved'],
      ['changed', 'pending'],
    ]);
    expect(sendToUser).toHaveBeenCalledWith(OWNER, expect.objectContaining({
      type: 'space_review_updated',
      process: 'discovery',
      action: 'changed',
      status: 'pending',
    }));

    // An approval of what the admin saw before the edit does not list the new name unseen.
    const stale = await send(ADMIN, 'POST', `/api/admin/spaces/${SPACE_ID}/discovery/approve`, { requestedAt: T0 });
    expect(refusal(stale)).toEqual([409, 'review_status_conflict']);
    expect(storedSpace().discoveryStatus).toBe('pending');

    const seen = await send(ADMIN, 'POST', `/api/admin/spaces/${SPACE_ID}/discovery/approve`, { requestedAt: T0 + MINUTE });
    expect(seen.statusCode).toBe(200);
    expect((await explore()).spaces.map((space) => space.name)).toEqual(['Chess Club Berlin']);
  });

  it('leaves an approved listing alone when the edit changes nothing the listing shows', async () => {
    await approveListing();
    const res = await send(OWNER, 'PATCH', `/api/spaces/${SPACE_ID}`, { avatarColor: 'mint', defaultNotificationLevel: 'mentions' });
    expect(res.statusCode).toBe(200);
    expect(storedSpace().discoveryStatus).toBe('approved');
    expect((await explore()).spaces.map((space) => space.id)).toEqual([SPACE_ID]);
  });

  it('takes the listing back when the space goes private', async () => {
    await approveListing();
    const res = await send(OWNER, 'PATCH', `/api/spaces/${SPACE_ID}`, { visibility: 'private' });
    expect(res.statusCode).toBe(200);
    expect(storedSpace().discoveryStatus).toBe('withdrawn');
    expect((await reviewState()).discovery.history.at(-1)).toMatchObject({ action: 'changed', status: 'withdrawn' });
  });

  it('reviews a verified space again when it is renamed, and shows no badge until then', async () => {
    await verify();
    const renamed = await send(OWNER, 'PATCH', `/api/spaces/${SPACE_ID}`, { name: 'Chess Club Berlin' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<Space>().badges).toEqual([]);
    expect(storedSpace().verificationStatus).toBe('pending');
    // The request under review now names the space as it is called.
    const request = testDb.select().from(schema.spaceVerificationRequests)
      .where(eq(schema.spaceVerificationRequests.spaceId, SPACE_ID)).get();
    expect(request?.name).toBe('Chess Club Berlin');
  });

  it('reviews a verification again under a new owner, who answers it from then on', async () => {
    await verify();
    const moved = await send(OWNER, 'PATCH', `/api/spaces/${SPACE_ID}/transfer-ownership`, { newOwnerId: MANAGER });
    expect(moved.statusCode).toBe(200);
    expect(moved.json<Space>()).toMatchObject({ ownerId: MANAGER, badges: [] });
    expect(storedSpace().verificationStatus).toBe('pending');
    expect(sendToUser).toHaveBeenCalledWith(MANAGER, expect.objectContaining({
      type: 'space_review_updated',
      process: 'verification',
      action: 'changed',
      status: 'pending',
    }));
    expect(refusal(await send(OWNER, 'PUT', VERIFICATION_URL, VERIFICATION_REQUEST))).toEqual([403, 'space_owner_only']);
  });
});

describe('taking a request back', () => {
  it('withdraws an open or approved listing and an open verification, and refuses when nothing is open', async () => {
    expect(refusal(await send(OWNER, 'DELETE', DISCOVERY_URL))).toEqual([409, 'review_status_conflict']);
    expect(refusal(await send(OWNER, 'DELETE', VERIFICATION_URL))).toEqual([409, 'review_status_conflict']);

    await approveListing();
    const withdrawn = await send(OWNER, 'DELETE', DISCOVERY_URL);
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json<SpaceReviewState>().discovery.status).toBe('withdrawn');
    expect((await explore()).spaces).toEqual([]);

    expect((await send(OWNER, 'PUT', VERIFICATION_URL, VERIFICATION_REQUEST)).statusCode).toBe(200);
    const taken = await send(OWNER, 'DELETE', VERIFICATION_URL);
    expect(taken.statusCode).toBe(200);
    expect(taken.json<SpaceReviewState>().verification.status).toBeNull();
  });
});
