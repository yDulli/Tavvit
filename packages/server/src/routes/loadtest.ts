import type { FastifyInstance } from 'fastify';
import { DEFAULT_EVERYONE_PERMISSIONS, permissionsToString } from '@backspace/shared/src/permissions.js';
import { AVATAR_COLORS } from '@backspace/shared';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { authenticate, issueSessionToken, requireAdmin } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { rateLimitsDisabled } from '../utils/rateLimitSwitch.js';

/**
 * What `scripts/loadtest/run.mjs` needs of an instance (docs/systems/operations.md, "Load test").
 * It exists only on an instance started with LOADTEST_ALLOWED=1, and then for its administrators
 * alone: without the switch the routes are not there at all, which is what the script asks first,
 * so that a typing mistake in an address can never aim it at real people.
 */

const ADMIN = { preHandler: [authenticate, requireAdmin] };
const LIMITS = { PEOPLE: 20_000, CHANNELS: 50, ROLES: 20, MESSAGES: 200_000 } as const;
/** SQLite takes this many rows to one statement, and leaves room for the other columns. */
const ROWS_PER_INSERT = 500;
const SPARE_ROLES = 5;
/** Accounts nobody can sign in to: they exist through the token made here. */
const NO_PASSWORD = '!';

interface PeopleRequest {
  count?: unknown;
  channels?: unknown;
  rolesPerPerson?: unknown;
  messages?: unknown;
}

const whole = (value: unknown, fallback: number, highest: number): number | null => {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= highest ? (value as number) : null;
};

function inChunks<T>(rows: readonly T[], write: (chunk: T[]) => void): void {
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) write(rows.slice(start, start + ROWS_PER_INSERT));
}

export async function loadtestRoutes(app: FastifyInstance): Promise<void> {
  if (!config.loadtestAllowed) return;

  app.get('/api/loadtest', ADMIN, async (_request, reply) => {
    return reply.code(200).send({ allowed: true, rateLimitsOff: rateLimitsDisabled() });
  });

  // People in one new space, each with a session of their own, and what they wrote before.
  app.post<{ Body: PeopleRequest }>('/api/loadtest/people', ADMIN, async (request, reply) => {
    const count = whole(request.body?.count, 0, LIMITS.PEOPLE);
    const channelCount = whole(request.body?.channels, 1, LIMITS.CHANNELS);
    const rolesPerPerson = whole(request.body?.rolesPerPerson, 0, LIMITS.ROLES);
    const messageCount = whole(request.body?.messages, 0, LIMITS.MESSAGES);
    if (!count || !channelCount || rolesPerPerson === null || messageCount === null) {
      return sendError(reply, 400, 'validation_failed', { field: 'count' });
    }

    const db = getDb();
    const now = Date.now();
    const spaceId = generateSnowflake();
    const people = Array.from({ length: count }, (_unused, at) => ({ id: generateSnowflake(), username: `load_${now.toString(36)}_${at}` }));
    const channelIds = Array.from({ length: channelCount }, () => generateSnowflake());
    const roleIds = Array.from({ length: Math.max(rolesPerPerson, SPARE_ROLES) }, () => generateSnowflake());

    db.transaction((tx) => {
      tx.insert(schema.spaces).values({
        id: spaceId,
        name: `Load test ${new Date(now).toISOString()}`,
        ownerId: request.userId,
        inviteCode: `load${now.toString(36)}`,
        visibility: 'private',
        createdAt: now,
      }).run();
      tx.insert(schema.spaceMembers).values({ spaceId, userId: request.userId, joinedAt: now, rulesAcceptedAt: now }).run();
      tx.insert(schema.roles).values({
        id: spaceId,
        spaceId,
        name: '@everyone',
        color: '#b9bbbe',
        position: 0,
        permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS),
        createdAt: now,
      }).run();
      tx.insert(schema.roles).values(roleIds.map((id, at) => ({
        id,
        spaceId,
        name: `Role ${at + 1}`,
        color: '#7466e8',
        position: at + 1,
        permissions: '0',
        createdAt: now,
      }))).run();
      tx.insert(schema.channels).values(channelIds.map((id, at) => ({
        id,
        spaceId,
        name: `load-${at + 1}`,
        type: 'text' as const,
        position: at,
        createdAt: now,
      }))).run();

      inChunks(people, (chunk) => {
        tx.insert(schema.users).values(chunk.map((person, at) => ({
          id: person.id,
          username: person.username,
          displayName: person.username,
          passwordHash: NO_PASSWORD,
          avatarColor: AVATAR_COLORS[at % AVATAR_COLORS.length],
          createdAt: now,
        }))).run();
        tx.insert(schema.spaceMembers).values(chunk.map((person) => ({ spaceId, userId: person.id, joinedAt: now, rulesAcceptedAt: now }))).run();
      });

      if (rolesPerPerson > 0) {
        const held = people.flatMap((person, at) => Array.from({ length: rolesPerPerson }, (_unused, nth) => ({
          spaceId,
          userId: person.id,
          roleId: roleIds[(at + nth) % roleIds.length] as string,
        })));
        inChunks(held, (chunk) => tx.insert(schema.memberRoles).values(chunk).run());
      }

      const written = Array.from({ length: messageCount }, (_unused, at) => ({
        id: generateSnowflake(),
        channelId: channelIds[at % channelIds.length] as string,
        userId: (people[at % people.length] as { id: string }).id,
        content: `Message ${at} from before the test`,
        createdAt: now,
      }));
      inChunks(written, (chunk) => tx.insert(schema.messages).values(chunk).run());
    });

    return reply.code(201).send({
      spaceId,
      channelIds,
      people: people.map((person) => ({ id: person.id, token: issueSessionToken(person, request).token })),
    });
  });
}
