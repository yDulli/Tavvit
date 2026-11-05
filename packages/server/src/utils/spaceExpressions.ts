import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { asc, count, eq } from 'drizzle-orm';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import { SPACE_EXPRESSION_LIMITS, type SpaceEmoji, type SpaceSticker } from '@backspace/shared/src/spaceExpressions.js';
import { MAX_STICKER_BYTES } from '@backspace/shared/src/stickers.js';
import { getDb, schema } from '../db/index.js';
import { releaseUpload, reserveUpload, uploadRefusal } from './accountLimits.js';
import { EmojiImageError, emojiDir, emojiFilePath, encodeEmoji } from './emojiImage.js';
import { hasPermission, PermissionBits } from './permissions.js';
import { generateSnowflake } from './snowflake.js';
import { memberActionRefusal } from './spaceModeration.js';
import { StickerImageError, encodeStickerImage, stickerTokenFor, storeStickerAsset } from './stickerImage.js';
import { MediaBusyError } from './thumbnail.js';

/**
 * Adding a space's emoji and stickers (docs/systems/emoji.md), one path for the routes
 * (routes/spaceExpressions.ts) and the Discord import (routes/discordExpressionImport.ts). Each add
 * checks the space's room and the name, re-encodes the picture, holds its size on the creator's
 * storage from before the file is written until its row is in (utils/accountLimits.ts), and checks
 * the creator's right, room and name again with nothing awaited before the insert: adds side by
 * side cannot all pass the first check, and someone who lost the right (banned, timed out, demoted,
 * deleted) while their picture was being encoded adds nothing. Whoever calls records the audit
 * entry and tells the space.
 */

export type SpaceEmojiRow = typeof schema.spaceEmojis.$inferSelect;
export type SpaceStickerRow = typeof schema.spaceStickers.$inferSelect;

export interface ExpressionRefusal {
  status: number;
  code: ErrorCode;
  details?: ErrorDetails;
  /** The Discord entry is in the space already: an import's race, not a fault. */
  alreadyHere?: boolean;
}

export type ExpressionResult<T> = { ok: true; value: T } | { ok: false; refusal: ExpressionRefusal };

const refuse = (status: number, code: ErrorCode, details?: ErrorDetails): { ok: false; refusal: ExpressionRefusal } =>
  ({ ok: false, refusal: { status, code, ...(details ? { details } : {}) } });

/**
 * Why `userId` may not change the space's emoji and stickers now, or null when they may: the right
 * (MANAGE_EMOJIS, which the owner and instance admins always hold and non-members never do), and
 * nothing holding their actions in the space (a timeout, an unconfirmed address, rules not yet
 * agreed to; utils/spaceModeration.ts). Every route and the import ask this, on the server.
 */
export function expressionManagerRefusal(spaceId: string, userId: string): ExpressionRefusal | null {
  if (!hasPermission(userId, spaceId, PermissionBits.MANAGE_EMOJIS)) {
    return { status: 403, code: 'missing_permission', details: { permission: 'MANAGE_EMOJIS' } };
  }
  const held = memberActionRefusal(spaceId, userId);
  return held ? { status: held.status, code: held.code, ...(held.details ? { details: held.details } : {}) } : null;
}

/** The refusal for picture work that cannot start now (utils/thumbnail.ts): this account's last one is under way, or too much waits. */
const busy = (): { ok: false; refusal: ExpressionRefusal } => refuse(429, 'rate_limited');

export function toSpaceEmoji(row: SpaceEmojiRow): SpaceEmoji {
  return { id: row.id, spaceId: row.spaceId, name: row.name, animated: row.animated === 1, createdBy: row.createdBy, createdAt: row.createdAt };
}

export function toSpaceSticker(row: SpaceStickerRow): SpaceSticker {
  return {
    id: row.id,
    spaceId: row.spaceId,
    stickerId: row.stickerId,
    name: row.name,
    description: row.description,
    animated: row.animated === 1,
    token: stickerTokenFor(row.stickerId),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function listSpaceEmojis(spaceId: string): SpaceEmojiRow[] {
  return getDb().select().from(schema.spaceEmojis).where(eq(schema.spaceEmojis.spaceId, spaceId))
    .orderBy(asc(schema.spaceEmojis.name)).all();
}

export function listSpaceStickers(spaceId: string): SpaceStickerRow[] {
  return getDb().select().from(schema.spaceStickers).where(eq(schema.spaceStickers.spaceId, spaceId))
    .orderBy(asc(schema.spaceStickers.createdAt)).all();
}

export function spaceEmojiCount(spaceId: string): number {
  return getDb().select({ n: count() }).from(schema.spaceEmojis).where(eq(schema.spaceEmojis.spaceId, spaceId)).get()?.n ?? 0;
}

export function spaceStickerCount(spaceId: string): number {
  return getDb().select({ n: count() }).from(schema.spaceStickers).where(eq(schema.spaceStickers.spaceId, spaceId)).get()?.n ?? 0;
}

/** Whether the space has an emoji of that name (names are stored in lower case). */
export function spaceEmojiNameTaken(spaceId: string, name: string, exceptId?: string): boolean {
  return listSpaceEmojis(spaceId).some((row) => row.name === name && row.id !== exceptId);
}

/** Whether the space has a sticker of that name, compared without regard to case. */
export function spaceStickerNameTaken(spaceId: string, name: string, exceptId?: string): boolean {
  const wanted = name.toLowerCase();
  return getDb().select({ id: schema.spaceStickers.id, name: schema.spaceStickers.name }).from(schema.spaceStickers)
    .where(eq(schema.spaceStickers.spaceId, spaceId)).all()
    .some((row) => row.name.toLowerCase() === wanted && row.id !== exceptId);
}

/** The Discord ids an import already brought into the space, emoji and stickers. */
export function importedDiscordIds(spaceId: string): Set<string> {
  const db = getDb();
  const ids = new Set<string>();
  for (const row of db.select({ id: schema.spaceEmojis.discordId }).from(schema.spaceEmojis).where(eq(schema.spaceEmojis.spaceId, spaceId)).all()) {
    if (row.id) ids.add(row.id);
  }
  for (const row of db.select({ id: schema.spaceStickers.discordId }).from(schema.spaceStickers).where(eq(schema.spaceStickers.spaceId, spaceId)).all()) {
    if (row.id) ids.add(row.id);
  }
  return ids;
}

function uniqueFailure(err: unknown, table: 'space_emojis' | 'space_stickers'): 'name' | 'discord' | null {
  if (!(err instanceof Error) || !err.message.includes('UNIQUE constraint failed') || !err.message.includes(table)) return null;
  return err.message.includes('discord_id') ? 'discord' : 'name';
}

function storageRefusal(actorId: string, size: number): { ok: false; refusal: ExpressionRefusal } | null {
  const refusal = uploadRefusal(actorId, size);
  if (!refusal) return null;
  return refuse(refusal === 'disk_full' ? 507 : 413, refusal);
}

/** Adds an emoji to a space. `name` is already in its stored form (normalizeEmojiName). */
export async function addSpaceEmoji(input: {
  spaceId: string;
  actorId: string;
  name: string;
  source: Buffer;
  discordId?: string | null;
}): Promise<ExpressionResult<SpaceEmojiRow>> {
  const max = SPACE_EXPRESSION_LIMITS.EMOJI_PER_SPACE;
  if (spaceEmojiCount(input.spaceId) >= max) return refuse(409, 'space_emoji_limit_reached', { max });
  if (spaceEmojiNameTaken(input.spaceId, input.name)) return refuse(409, 'space_emoji_name_taken');

  let encoded: Awaited<ReturnType<typeof encodeEmoji>>;
  try {
    encoded = await encodeEmoji(input.source, input.actorId);
  } catch (err) {
    // Only what is wrong with the picture is the client's to hear; anything else stays a server error.
    if (err instanceof EmojiImageError) return refuse(err.code === 'emoji_image_too_large' ? 413 : 400, err.code);
    if (err instanceof MediaBusyError) return busy();
    throw err;
  }

  const held = storageRefusal(input.actorId, encoded.data.length);
  if (held) return held;
  const id = generateSnowflake();
  reserveUpload(id, input.actorId, encoded.data.length);
  const file = emojiFilePath(id);
  try {
    await mkdir(emojiDir(), { recursive: true });
    // Published atomically, so a request for the picture never reads a half-written file.
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, encoded.data);
    await rename(temporary, file);

    // From here to the insert nothing is awaited.
    let outcome: ExpressionResult<SpaceEmojiRow>;
    const refusal = expressionManagerRefusal(input.spaceId, input.actorId);
    if (refusal) outcome = { ok: false, refusal };
    else if (spaceEmojiCount(input.spaceId) >= max) outcome = refuse(409, 'space_emoji_limit_reached', { max });
    else if (spaceEmojiNameTaken(input.spaceId, input.name)) outcome = refuse(409, 'space_emoji_name_taken');
    else {
      try {
        const row = getDb().insert(schema.spaceEmojis).values({
          id,
          spaceId: input.spaceId,
          name: input.name,
          animated: encoded.animated ? 1 : 0,
          size: encoded.data.length,
          discordId: input.discordId ?? null,
          createdBy: input.actorId,
          createdAt: Date.now(),
        }).returning().get();
        outcome = { ok: true, value: row };
      } catch (err) {
        const failed = uniqueFailure(err, 'space_emojis');
        if (!failed) throw err;
        outcome = failed === 'discord'
          ? { ok: false, refusal: { status: 409, code: 'space_emoji_name_taken', alreadyHere: true } }
          : refuse(409, 'space_emoji_name_taken');
      }
    }
    // No row, no way to find the file again: take it back.
    if (!outcome.ok) await rm(file, { force: true });
    return outcome;
  } catch (err) {
    await rm(file, { force: true });
    throw err;
  } finally {
    releaseUpload(id);
  }
}

/** Adds a sticker to a space. `name` and `description` are already in their stored form. */
export async function addSpaceSticker(input: {
  spaceId: string;
  actorId: string;
  name: string;
  description: string | null;
  source: Buffer;
  discordId?: string | null;
}): Promise<ExpressionResult<SpaceStickerRow>> {
  const max = SPACE_EXPRESSION_LIMITS.STICKERS_PER_SPACE;
  if (spaceStickerCount(input.spaceId) >= max) return refuse(409, 'space_sticker_limit_reached', { max });
  if (spaceStickerNameTaken(input.spaceId, input.name)) return refuse(409, 'space_sticker_name_taken');

  let encoded: Awaited<ReturnType<typeof encodeStickerImage>>;
  try {
    encoded = await encodeStickerImage(input.source, input.actorId);
  } catch (err) {
    if (err instanceof StickerImageError) return refuse(400, 'sticker_invalid_image', { max: MAX_STICKER_BYTES / (1024 * 1024) });
    if (err instanceof MediaBusyError) return busy();
    throw err;
  }

  const held = storageRefusal(input.actorId, encoded.data.length);
  if (held) return held;
  const id = generateSnowflake();
  reserveUpload(id, input.actorId, encoded.data.length);
  try {
    // The asset is shared and content-addressed: a refused entry leaves it to the janitor's grace.
    const stickerId = await storeStickerAsset(encoded.data);
    // From here to the insert nothing is awaited.
    const refusal = expressionManagerRefusal(input.spaceId, input.actorId);
    if (refusal) return { ok: false, refusal };
    if (spaceStickerCount(input.spaceId) >= max) return refuse(409, 'space_sticker_limit_reached', { max });
    if (spaceStickerNameTaken(input.spaceId, input.name)) return refuse(409, 'space_sticker_name_taken');
    try {
      const row = getDb().insert(schema.spaceStickers).values({
        id,
        spaceId: input.spaceId,
        stickerId,
        name: input.name,
        description: input.description,
        animated: encoded.animated ? 1 : 0,
        size: encoded.data.length,
        discordId: input.discordId ?? null,
        createdBy: input.actorId,
        createdAt: Date.now(),
      }).returning().get();
      return { ok: true, value: row };
    } catch (err) {
      const failed = uniqueFailure(err, 'space_stickers');
      if (!failed) throw err;
      return failed === 'discord'
        ? { ok: false, refusal: { status: 409, code: 'space_sticker_name_taken', alreadyHere: true } }
        : refuse(409, 'space_sticker_name_taken');
    }
  } finally {
    releaseUpload(id);
  }
}

/** The pictures of emoji whose rows are gone, as deleting a space leaves them. */
export function removeEmojiFiles(ids: readonly string[]): void {
  for (const id of ids) {
    try {
      fs.rmSync(emojiFilePath(id), { force: true });
    } catch (err) {
      console.warn('[emoji] Could not remove a file:', err);
    }
  }
}

/**
 * Pictures in the emoji directory that no emoji names any more, of the instance or of a space: from
 * a deletion that stopped between the row and the file, or an add that stopped between the file and
 * the row. At the start every such file goes; the hourly sweep leaves those younger than `minAgeMs`,
 * whose row may still be on its way in.
 */
export function removeUnusedEmojiFiles(minAgeMs = 0, now: number = Date.now()): number {
  let names: string[];
  try {
    names = fs.readdirSync(emojiDir());
  } catch {
    return 0;
  }
  const db = getDb();
  const known = new Set<string>();
  for (const row of db.select({ id: schema.customEmojis.id }).from(schema.customEmojis).all()) known.add(row.id);
  for (const row of db.select({ id: schema.spaceEmojis.id }).from(schema.spaceEmojis).all()) known.add(row.id);
  let removed = 0;
  for (const name of names) {
    const id = /^(\d+)\.webp$/.exec(name)?.[1];
    if (id && known.has(id)) continue;
    const file = path.join(emojiDir(), name);
    try {
      if (minAgeMs > 0 && now - fs.statSync(file).mtimeMs < minAgeMs) continue;
      fs.unlinkSync(file);
      removed += 1;
    } catch (err) {
      console.warn('[emoji] Could not remove an unused file:', err);
    }
  }
  return removed;
}
