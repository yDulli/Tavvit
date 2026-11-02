import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { AVATAR_COLORS } from '@backspace/shared';
import { getDb, schema, type DBHandle } from '../db/index.js';
import { AuthError } from './auth.js';
import { activeSuspension, suspensionDetails } from './suspension.js';

type UserRow = typeof schema.users.$inferSelect;

/** How often `last_used_at` is written, at most: a busy bot asks many times a second. */
const LAST_USED_EVERY_MS = 60_000;
const NO_PASSWORD = '!';

export function botsEnabled(): boolean {
  return getDb().select({ enabled: schema.instanceSettings.botsEnabled }).from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1)).get()?.enabled === 1;
}

const hashOf = (token: string): Buffer => createHash('sha256').update(token).digest();

/** A token names its bot, so finding it takes no search over secrets. The secret is 32 random bytes. */
export function newBotToken(botId: string): { token: string; hash: string } {
  const token = `${botId}.${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashOf(token).toString('hex') };
}

/**
 * Whether this bot may act at all, read fresh each time: the instance's switch, the bot's own
 * account, and the person who runs it. A suspended or deleted owner stops their bots at once.
 */
export function checkBotAccess(botId: string): UserRow {
  if (!botsEnabled()) throw new AuthError('This instance does not allow bots', 403, 'bots_disabled');
  const db = getDb();
  const bot = db.select().from(schema.bots).where(eq(schema.bots.id, botId)).get();
  const user = bot ? db.select().from(schema.users).where(eq(schema.users.id, botId)).get() : undefined;
  if (!bot || !user || user.isDeleted === 1 || user.accountKind !== 'bot') {
    throw new AuthError('Invalid bot token', 401, 'bot_token_invalid');
  }
  const suspended = activeSuspension(user);
  if (suspended) throw new AuthError('This bot is suspended', 401, 'account_suspended', suspensionDetails(suspended));
  const owner = db.select().from(schema.users).where(eq(schema.users.id, bot.ownerId)).get();
  if (!owner || owner.isDeleted === 1 || activeSuspension(owner)) {
    throw new AuthError('The account that runs this bot cannot act', 403, 'bot_owner_suspended');
  }
  return user;
}

/** The bot a token belongs to, or an `AuthError`. A wrong secret and an unknown bot look the same. */
export function verifyBotToken(token: string, now: number = Date.now()): UserRow {
  const botId = token.split('.', 1)[0] ?? '';
  const db = getDb();
  const row = db.select().from(schema.bots).where(eq(schema.bots.id, botId)).get();
  const given = hashOf(token);
  // Compared even for a bot that does not exist, so its absence takes no less time.
  const stored = row ? Buffer.from(row.tokenHash, 'hex') : hashOf('');
  const same = given.length === stored.length && timingSafeEqual(given, stored);
  if (!row || !same) throw new AuthError('Invalid bot token', 401, 'bot_token_invalid');
  const user = checkBotAccess(botId);
  if (row.lastUsedAt === null || now - row.lastUsedAt > LAST_USED_EVERY_MS) {
    db.update(schema.bots).set({ lastUsedAt: now }).where(eq(schema.bots.id, botId)).run();
  }
  return user;
}

/**
 * A bot's account. It signs in by token only (no password, and `verifyAccessToken` refuses
 * its kind), is never an admin, and takes no messages or friend requests. A `-` is what no
 * person's username can hold, so the name can never be taken.
 */
export function createBotAccount(handle: DBHandle, botId: string, name: string, now: number): void {
  handle.insert(schema.users).values({
    id: botId,
    username: `bot-${botId}`,
    displayName: name,
    passwordHash: NO_PASSWORD,
    accountKind: 'bot',
    status: 'offline',
    dmPolicy: 'nobody',
    friendRequestPolicy: 'nobody',
    avatarColor: AVATAR_COLORS[Number(BigInt(botId) % BigInt(AVATAR_COLORS.length))],
    createdAt: now,
  }).run();
}
