import fs from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { ACCOUNT_LIMITS, type StorageUsage } from '@backspace/shared/src/accountLimits.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';

/**
 * What one account may take up (docs/systems/uploads.md, "Limits per account"), so that
 * no single account can fill the server's disk or crowd it with spaces. Instance admins
 * have no limit; 0 in a setting means none.
 */

/** Room the disk keeps whatever happens: the database must always be able to write. */
const DISK_RESERVE_BYTES = 2 * 1024 ** 3;
const DISK_RESERVE_SHARE = 0.05;

export type UploadRefusal = 'storage_limit_reached' | 'disk_full';

/**
 * Uploads that started and did not finish. Their bytes are on the disk and in no table
 * yet, so they count as soon as an upload starts: otherwise uploads started side by side
 * would all pass, and uploads never finished would take room that nothing counts. Lost
 * on a restart, where the check at the end of an upload still holds.
 */
const underWay = new Map<string, { account: string; size: number; expiresAt: number }>();

/**
 * Whose room an upload takes: a bot's files count on the person who runs it, who could otherwise
 * multiply theirs, and the copies a follow brings into a channel on the person who set it up
 * (routes/channelFollows.ts): otherwise posting a file, letting a follow of one's own copy it and
 * deleting the original would free the room while the file stays, over and over.
 */
function storageAccountOf(userId: string): string {
  const db = getDb();
  const bot = db.select({ ownerId: schema.bots.ownerId }).from(schema.bots).where(eq(schema.bots.id, userId)).get();
  if (bot) return bot.ownerId;
  const follow = db.select({ createdBy: schema.channelFollows.createdBy }).from(schema.channelFollows)
    .where(eq(schema.channelFollows.accountId, userId)).get();
  return follow?.createdBy ?? userId;
}

/**
 * What the account keeps in files, with those of its bots and of the follows it set up. A file it
 * holds through several messages counts once, and a copy it forwarded counts too: otherwise
 * forwarding a file and deleting the original would free the room while the file stays. Copies
 * fetched from another instance (`source_url`) are not this account's upload here. The clips it
 * added to a soundboard, and the emoji and stickers it added to a space (by hand or by importing
 * them from Discord), count as well, for as long as their space keeps them, and so do the pictures
 * of the decorations it made (utils/customDecorations.ts).
 */
function storageUsedByAccount(account: string): number {
  const row = getDb().get<{ used: number }>(sql`
    SELECT
      (SELECT COALESCE(SUM(size), 0) FROM (
        SELECT MAX(size) AS size FROM attachments
        WHERE (
            uploader_id = ${account}
            OR uploader_id IN (SELECT id FROM bots WHERE owner_id = ${account})
            OR uploader_id IN (SELECT account_id FROM channel_follows WHERE created_by = ${account})
          )
          AND source_url IS NULL
        GROUP BY filename
      ))
      + (SELECT COALESCE(SUM(size), 0) FROM space_sounds WHERE created_by = ${account})
      + (SELECT COALESCE(SUM(size), 0) FROM space_emojis WHERE created_by = ${account})
      + (SELECT COALESCE(SUM(size), 0) FROM space_stickers WHERE created_by = ${account})
      + (SELECT COALESCE(SUM(size), 0) FROM custom_decorations WHERE creator_id = ${account}) AS used
  `);
  return row?.used ?? 0;
}

/** The most this account may keep, or null when no limit applies to it. */
function storageLimitOfAccount(account: string): number | null {
  const db = getDb();
  const user = db.select({ isAdmin: schema.users.isAdmin, own: schema.users.storageLimitBytes })
    .from(schema.users).where(eq(schema.users.id, account)).get();
  if (user?.isAdmin === 1) return null;
  if (user && user.own !== null) return user.own === 0 ? null : user.own;
  const settings = db.select({ limit: schema.instanceSettings.storagePerAccountBytes })
    .from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
  const limit = settings?.limit ?? ACCOUNT_LIMITS.DEFAULT_STORAGE_BYTES;
  return limit === 0 ? null : limit;
}

export function storageUsage(userId: string): StorageUsage {
  const account = storageAccountOf(userId);
  return { usedBytes: storageUsedByAccount(account), limitBytes: storageLimitOfAccount(account) };
}

/** True when `bytes` more would leave the disk without its reserve. A disk that cannot be asked is no reason to refuse. */
export function diskWouldFill(bytes: number): boolean {
  try {
    const stats = fs.statfsSync(config.tusUploadDir);
    const reserve = Math.min(DISK_RESERVE_BYTES, stats.blocks * stats.bsize * DISK_RESERVE_SHARE);
    return stats.bavail * stats.bsize - bytes < reserve;
  } catch {
    return false;
  }
}

/** Whether the disk is down to what uploads leave free, so that they are refused whatever their size. */
export function diskIsNearlyFull(): boolean {
  return diskWouldFill(0);
}

/** Why an upload of `size` may not start, or null when it may. Together with `reserveUpload`, with nothing awaited between them. */
export function uploadRefusal(userId: string, size: number, now: number = Date.now()): UploadRefusal | null {
  const account = storageAccountOf(userId);
  let heldByAll = 0;
  let heldByAccount = 0;
  for (const [id, upload] of underWay) {
    if (upload.expiresAt <= now) {
      underWay.delete(id);
      continue;
    }
    heldByAll += upload.size;
    if (upload.account === account) heldByAccount += upload.size;
  }
  if (diskWouldFill(heldByAll + size)) return 'disk_full';
  const limit = storageLimitOfAccount(account);
  if (limit !== null && storageUsedByAccount(account) + heldByAccount + size > limit) return 'storage_limit_reached';
  return null;
}

/**
 * How long an upload under way keeps its room without bytes arriving. Started and never sent, it
 * would otherwise hold its declared size for a day (TUS_EXPIRATION_HOURS), against the account and
 * against the disk everyone shares, so that a few such starts refused every upload on the
 * instance. A paused upload that comes back later is checked again when it finishes.
 */
const RESERVATION_IDLE_MS = 15 * 60 * 1000;

export function reserveUpload(uploadId: string, userId: string, size: number, now: number = Date.now()): void {
  underWay.set(uploadId, { account: storageAccountOf(userId), size, expiresAt: now + Math.min(RESERVATION_IDLE_MS, config.tusExpirationMs) });
}

/** Bytes arrived for `uploadId`: it keeps its room for another while. */
export function touchUpload(uploadId: string, now: number = Date.now()): void {
  const upload = underWay.get(uploadId);
  if (upload) upload.expiresAt = now + Math.min(RESERVATION_IDLE_MS, config.tusExpirationMs);
}

export function releaseUpload(uploadId: string): void {
  underWay.delete(uploadId);
}

/** True when a finished upload of `size` does not fit any more: a restart forgot what was under way, or the limit went down. */
export function finishedUploadExceedsLimit(userId: string, size: number): boolean {
  const account = storageAccountOf(userId);
  const limit = storageLimitOfAccount(account);
  return limit !== null && storageUsedByAccount(account) + size > limit;
}

/** The number of spaces this account has reached when it may own no more, or null when it may. */
export function spaceLimitReached(userId: string): number | null {
  const db = getDb();
  const user = db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, userId)).get();
  if (user?.isAdmin === 1) return null;
  const settings = db.select({ limit: schema.instanceSettings.spacesPerAccount })
    .from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
  const limit = settings?.limit ?? ACCOUNT_LIMITS.DEFAULT_SPACES;
  if (limit === 0) return null;
  const owned = db.select({ n: sql<number>`count(*)` }).from(schema.spaces).where(eq(schema.spaces.ownerId, userId)).get();
  return (owned?.n ?? 0) >= limit ? limit : null;
}
