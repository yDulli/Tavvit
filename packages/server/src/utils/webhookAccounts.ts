import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AVATAR_COLORS } from '@backspace/shared';
import { eq } from 'drizzle-orm';
import { getDb, getRawDb, schema, type DBHandle } from '../db/index.js';

type WebhookRow = typeof schema.webhooks.$inferSelect;

/** A password hash nothing verifies against: `verifyPassword` refuses what it does not know. */
const NO_PASSWORD = '!';

export function newWebhookToken(): string {
  return randomBytes(32).toString('base64url');
}

export function webhookTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The webhook this address names, or undefined. A wrong id and a wrong token look the same. */
export function webhookForToken(id: string, token: string): WebhookRow | undefined {
  const row = getDb().select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).get();
  const given = Buffer.from(webhookTokenHash(token), 'hex');
  // Compared even for an id that does not exist, so its absence takes no less time.
  const stored = Buffer.from(row?.tokenHash ?? webhookTokenHash(''), 'hex');
  const same = given.length === stored.length && timingSafeEqual(given, stored);
  return row && same ? row : undefined;
}

/**
 * The account a webhook's messages are written under, since a message needs an author.
 * It cannot sign in (no password, and `verifyAccessToken` refuses its kind), is in no
 * member list, and takes no messages or friend requests. A `-` is what no person's
 * username can hold (`routes/auth.ts`), so the name can never be taken.
 */
export function createWebhookAccount(handle: DBHandle, webhookId: string, name: string, now: number): string {
  return createChannelAccount(handle, webhookId, 'webhook', name, now);
}

/** The same for the copies of a followed announcement channel's posts (routes/channelFollows.ts). */
export function createFollowAccount(handle: DBHandle, followId: string, name: string, now: number): string {
  return createChannelAccount(handle, followId, 'follow', name, now);
}

function createChannelAccount(handle: DBHandle, id: string, kind: 'webhook' | 'follow', name: string, now: number): string {
  handle.insert(schema.users).values({
    id,
    username: `${kind}-${id}`,
    displayName: name,
    passwordHash: NO_PASSWORD,
    accountKind: kind,
    status: 'offline',
    dmPolicy: 'nobody',
    friendRequestPolicy: 'nobody',
    avatarColor: AVATAR_COLORS[Number(BigInt(id) % BigInt(AVATAR_COLORS.length))],
    createdAt: now,
  }).run();
  return id;
}

/**
 * Removes the accounts of webhooks and follows that are gone and left no message behind:
 * deleting a channel or a space takes both with it, and an account with messages stays for them.
 */
export function removeUnusedWebhookAccounts(): number {
  return getRawDb().prepare(`
    DELETE FROM users
    WHERE account_kind IN ('webhook', 'follow')
      AND id NOT IN (SELECT user_id FROM webhooks)
      AND id NOT IN (SELECT account_id FROM channel_follows)
      AND id NOT IN (SELECT user_id FROM messages)
  `).run().changes;
}

const SECRET_PATH = /^(\/api\/webhooks\/[^/]+)\/(?!rotate$)[^/]+$/;
/** The voice overlay's page and what it asks (docs/systems/voice-overlay.md): its address is its secret. */
const OVERLAY_PATH = /^((?:\/api)?\/overlay\/voice)\/[^/]+$/;

/** A request's path as the log may see it: a webhook's address holds its secret, and so does a voice overlay's. */
export function pathForLog(url: string): string {
  const path = url.split('?')[0] ?? '';
  return path.replace(SECRET_PATH, '$1/[token]').replace(OVERLAY_PATH, '$1/[secret]');
}
