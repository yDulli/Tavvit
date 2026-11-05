import { randomUUID } from 'node:crypto';
import {
  DISCORD_EXPRESSION_LIMITS,
  type DiscordExpressionApplyResult,
  type DiscordExpressionListing,
  type DiscordExpressionResult,
} from '@backspace/shared/src/discordExpressionImport.js';

/**
 * Looked-up Discord listings and their imports (routes/discordExpressionImport.ts): what the two
 * requests with the bot token answered, kept in memory while the import is used. The token is not
 * here: this type has no place for it, so it is gone once the look-up has answered.
 *
 * A session is open until its import is through, stopped or ended; then it is closed and kept a few
 * minutes more, so an answer the browser never received (a batch that outlasted the request) can
 * be asked for again with everything it settled. An open session nobody used for the session time
 * ends. A session whose batch is running is never ended or replaced: an account has at most one
 * import running, and when the store is full a new look-up waits rather than push one out.
 * A restart forgets them all, and the import is looked up again.
 */
export interface DiscordExpressionSession {
  importId: string;
  userId: string;
  spaceId: string;
  listing: DiscordExpressionListing;
  createdAt: number;
  /** When the session was last asked for: its time runs from here. */
  lastUsedAt: number;
  /** The keys picked, set by the first import call. */
  selection: string[] | null;
  /** The keys settled so far. */
  settled: Set<string>;
  /** Everything settled, in order; an answer carries those after the cursor the browser sends. */
  results: DiscordExpressionResult[];
  running: boolean;
  /** Stopped by the person while a batch ran: that batch ends it. */
  cancelled: boolean;
  /** Whether its audit entry has been written. */
  audited: boolean;
  /** How it ended, once it has; null while it is open. */
  closed: { at: number; finished: boolean; stopped: DiscordExpressionApplyResult['stopped'] } | null;
}

const sessions = new Map<string, DiscordExpressionSession>();
const MAX_SESSIONS = 500;
/** How long a closed session's outcome can still be asked for. */
const CLOSED_KEPT_MS = 5 * 60 * 1000;

/** Told of an open session that ends before its import said it was through: expired, replaced or stopped. */
let onEnd: (session: DiscordExpressionSession) => void = () => {};

export function setDiscordSessionEndHandler(handler: (session: DiscordExpressionSession) => void): void {
  onEnd = handler;
}

/** Forgets a session; an open one tells the end handler first. Never called for a running one. */
function drop(session: DiscordExpressionSession): void {
  sessions.delete(session.importId);
  if (!session.closed) onEnd(session);
}

function sweep(now: number): void {
  for (const session of [...sessions.values()]) {
    if (session.running) continue;
    const gone = session.closed
      ? now - session.closed.at > CLOSED_KEPT_MS
      : now - session.lastUsedAt > DISCORD_EXPRESSION_LIMITS.SESSION_TTL_MS;
    if (gone) drop(session);
  }
}

/** Whether the account has an import whose batch is running now. */
export function accountHasRunningImport(userId: string): boolean {
  for (const session of sessions.values()) {
    if (session.userId === userId && session.running) return true;
  }
  return false;
}

/** Whether a new session would find room: below the cap, or with one that is not running to make way. */
export function discordSessionRoom(now: number = Date.now()): boolean {
  sweep(now);
  if (sessions.size < MAX_SESSIONS) return true;
  for (const session of sessions.values()) if (!session.running) return true;
  return false;
}

/**
 * A new session for the account, which replaces the account's others (none of them is running; the
 * route refuses a look-up while one is). Null when the store is full of running imports.
 */
export function createDiscordSession(
  input: { userId: string; spaceId: string; listing: DiscordExpressionListing },
  now: number = Date.now(),
): DiscordExpressionSession | null {
  sweep(now);
  for (const session of [...sessions.values()]) {
    if (session.userId === input.userId && !session.running) drop(session);
  }
  // Oldest first; a running one stays.
  for (const session of [...sessions.values()]) {
    if (sessions.size < MAX_SESSIONS) break;
    if (!session.running) drop(session);
  }
  if (sessions.size >= MAX_SESSIONS) return null;
  const session: DiscordExpressionSession = {
    importId: randomUUID(),
    userId: input.userId,
    spaceId: input.spaceId,
    listing: input.listing,
    createdAt: now,
    lastUsedAt: now,
    selection: null,
    settled: new Set(),
    results: [],
    running: false,
    cancelled: false,
    audited: false,
    closed: null,
  };
  sessions.set(session.importId, session);
  return session;
}

/** The account's session of that id, open or closed, or null when there is none (never made, another's, gone). */
export function discordSessionFor(importId: string, userId: string, now: number = Date.now()): DiscordExpressionSession | null {
  sweep(now);
  const session = sessions.get(importId);
  if (!session || session.userId !== userId) return null;
  session.lastUsedAt = now;
  return session;
}

/** Ends an open session, telling the end handler; forgets a closed one. A running one is left to its batch. */
export function endDiscordSession(importId: string): void {
  const session = sessions.get(importId);
  if (session && !session.running) drop(session);
}

/** Marks a session's import as over, keeping its outcome to be asked for a little longer. */
export function closeDiscordSession(
  session: DiscordExpressionSession,
  outcome: { finished: boolean; stopped: DiscordExpressionApplyResult['stopped'] },
  now: number = Date.now(),
): void {
  session.closed = { at: now, ...outcome };
}

/** When an open session runs out if nobody uses it again. */
export function discordSessionExpiry(session: DiscordExpressionSession): number {
  return session.lastUsedAt + DISCORD_EXPRESSION_LIMITS.SESSION_TTL_MS;
}

/** Tests only. */
export function _resetDiscordSessionsForTests(): void {
  sessions.clear();
}
