import { BOT_LIMITS } from '@backspace/shared/src/bots.js';
import { verifyBotToken } from './botAccess.js';
import { createFixedWindowLimit } from './fixedWindowLimit.js';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors';
import { openSession, useSession } from './sessions.js';
import { activeSuspension, suspensionDetails } from './suspension.js';

export { hashPassword, passwordNeedsRehash, verifyPassword } from './passwordHash.js';

export interface JwtPayload {
  userId: string;
  username: string;
  /** The session this token belongs to. A token with none opens nothing (`verifyAccessToken`). */
  sid?: string;
  iat?: number;
  exp?: number;
}

export function signJwt(payload: JwtPayload): string {
  const options: jwt.SignOptions = {
    expiresIn: config.jwtExpiresIn as unknown as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, config.jwtSecret, options);
}

export function verifyJwt(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
  return decoded;
}

/**
 * AuthError carries an HTTP status code so raw-IncomingMessage paths
 * (e.g. tus hooks) can re-throw with a status the caller maps onto
 * its own response object.
 */
declare module 'fastify' {
  interface FastifyContextConfig {
    /** This route takes a bot's token. Without it, one is refused (`authenticateBot`). */
    botAllowed?: boolean;
  }
}

/** Requests per bot, across everything open to it, on top of a route's own limit per address. */
const botRequestLimit = createFixedWindowLimit({ max: BOT_LIMITS.REQUESTS_PER_MINUTE, windowMs: 60_000 });

export class AuthError extends Error {
  statusCode: number;
  /** Stable code for the client; the message stays the English log text. */
  code: ErrorCode;
  /** What the client shows with the code (a suspension's reason and end). */
  details?: ErrorDetails;
  constructor(message: string, statusCode: number, code: ErrorCode = 'unauthorized', details?: ErrorDetails) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Who a valid token speaks for, and how. */
export interface VerifiedAccess {
  payload: JwtPayload;
  user: typeof schema.users.$inferSelect;
  sessionId: string | null;
}

/**
 * Most tests sign a token without opening a session for it. `test/setup-env.ts` sets this, and
 * nothing else can: it is neither an environment variable nor anything a request can reach.
 */
const sessionlessInTests = (): boolean => (globalThis as { __tavvitTestsTakeSessionlessTokens?: boolean }).__tavvitTestsTakeSessionlessTokens === true;

/**
 * Whether a token still opens this account: signed by this server and not expired,
 * the account there and not suspended, the session live. The one check, for REST and
 * for the socket, so they cannot disagree. Throws AuthError (401) with a code; a 401
 * is what makes the web client drop the token, and the socket sends the same code.
 */
export function verifyAccessToken(token: string): VerifiedAccess {
  let payload: JwtPayload;
  try {
    payload = verifyJwt(token);
  } catch {
    throw new AuthError('Invalid or expired token', 401);
  }

  const user = getDb().select().from(schema.users).where(eq(schema.users.id, payload.userId)).get();
  if (!user || user.isDeleted === 1) {
    throw new AuthError('This account has been deleted', 401, 'account_deleted');
  }
  // Nothing signs a token for an account that is not a person; this says so once more.
  if (user.accountKind !== 'person') {
    throw new AuthError('Invalid or expired token', 401);
  }

  // A token from before sessions could not be signed out of, so it no longer opens anything:
  // whoever still holds one signs in once more. Nothing has issued one for a long time.
  const sessionId = payload.sid ?? null;
  if (sessionId === null ? !sessionlessInTests() : !useSession(sessionId, user.id)) {
    throw new AuthError('This session has ended', 401, 'session_ended');
  }

  const suspension = activeSuspension(user);
  if (suspension) {
    throw new AuthError('This account is suspended', 401, 'account_suspended', suspensionDetails(suspension));
  }

  return { payload, user, sessionId };
}

/** A new session on this device and the token for it. */
export function issueSessionToken(
  user: { id: string; username: string },
  request: { headers: { 'user-agent'?: string }; ip?: string },
): { token: string; sessionId: string } {
  return openSession(user, request, signJwt);
}

/**
 * `verifyAccessToken` for Fastify's `authenticate` preHandler and for
 * raw-IncomingMessage paths (tus hooks) that can't go through the preHandler pipeline.
 */
export async function verifyJwtAndUser(token: string): Promise<{
  userId: string;
  username: string;
  homeInstance: string | null;
  sessionId: string | null;
}> {
  const { payload, user, sessionId } = verifyAccessToken(token);
  return {
    userId: payload.userId,
    username: user.username,
    homeInstance: user.homeInstance ?? null,
    sessionId,
  };
}

/**
 * A bot's token, on a route. **Deny by default:** only a route with `config: { botAllowed: true }`
 * takes one, so a route added tomorrow is closed to bots until someone decides otherwise.
 * routes/bots.test.ts holds the whole list. Sends the answer itself when it refuses.
 */
function authenticateBot(request: FastifyRequest, reply: FastifyReply, token: string): void {
  if (request.routeOptions.config.botAllowed !== true) {
    reply.code(403).send({ error: 'This is not open to bots', code: 'bot_route_forbidden', statusCode: 403 });
    return;
  }
  try {
    const bot = verifyBotToken(token);
    const withinLimit = botRequestLimit.consume(bot.id);
    const window = botRequestLimit.state(bot.id);
    reply.header('x-ratelimit-limit', BOT_LIMITS.REQUESTS_PER_MINUTE);
    reply.header('x-ratelimit-remaining', window.remaining);
    reply.header('x-ratelimit-reset', window.resetInSeconds);
    if (!withinLimit) {
      reply.header('retry-after', window.resetInSeconds);
      reply.code(429).send({ error: 'Too many requests', code: 'rate_limited', statusCode: 429 });
      return;
    }
    const identified = request as FastifyRequest & { userId: string; username: string };
    identified.userId = bot.id;
    identified.username = bot.username;
    identified.homeInstance = null;
    request.sessionId = null;
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    reply.code(err.statusCode).send({ error: err.message, code: err.code, statusCode: err.statusCode, ...(err.details ? { details: err.details } : {}) });
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bot ')) {
    authenticateBot(request, reply, authHeader.slice(4));
    return;
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header', code: 'unauthorized', statusCode: 401 });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const identity = await verifyJwtAndUser(token);
    (request as FastifyRequest & { userId: string; username: string }).userId = identity.userId;
    (request as FastifyRequest & { userId: string; username: string }).username = identity.username;
    (request as FastifyRequest & { userId: string; username: string }).homeInstance = identity.homeInstance;
    request.sessionId = identity.sessionId;
  } catch (err) {
    if (err instanceof AuthError) {
      return reply.code(err.statusCode).send({
        error: err.message,
        code: err.code,
        statusCode: err.statusCode,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    return reply.code(401).send({ error: 'Invalid or expired token', code: 'unauthorized', statusCode: 401 });
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const db = getDb();
  const caller = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
  if (!caller || caller.isAdmin !== 1) {
    return reply.code(403).send({ error: 'Only instance admins can perform this action', code: 'forbidden', statusCode: 403 });
  }
}

export async function requireLocalUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (request.homeInstance) {
    return reply.code(403).send({
      error: 'Federated users must use their home instance for DM operations',
      code: 'forbidden',
      statusCode: 403,
    });
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    username: string;
    homeInstance: string | null;
    /** The session of the token this request came with; null for a token from before sessions. */
    sessionId: string | null;
  }
}
