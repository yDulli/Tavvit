import { rm } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { EMOJI_ID_PATTERN } from '@backspace/shared/src/customEmoji.js';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { recordAudit } from './auditLog.js';
import { emojiFilePath } from './emojiImage.js';
import { soundFilePath } from './soundFiles.js';
import type { SpaceEmojiRow, SpaceStickerRow } from './spaceExpressions.js';

/**
 * Taking one of a space's emoji, stickers or sounds away, the same way whoever does it: one who
 * manages them in the space (routes/spaceExpressions.ts, routes/soundboard.ts) or an instance
 * administrator (routes/adminRemoval.ts). Its row goes, and its file where it has one of its own
 * (a sticker's picture is shared by content and left to the storage cleanup); the space's own audit
 * log names who did it, and the members' copy is told to reload.
 */

export type SpaceSoundRow = typeof schema.spaceSounds.$inferSelect;

export function spaceEmojiRow(id: string): SpaceEmojiRow | undefined {
  return EMOJI_ID_PATTERN.test(id) ? getDb().select().from(schema.spaceEmojis).where(eq(schema.spaceEmojis.id, id)).get() : undefined;
}

export function spaceStickerRow(id: string): SpaceStickerRow | undefined {
  return EMOJI_ID_PATTERN.test(id) ? getDb().select().from(schema.spaceStickers).where(eq(schema.spaceStickers.id, id)).get() : undefined;
}

export function spaceSoundRow(id: string): SpaceSoundRow | undefined {
  return getDb().select().from(schema.spaceSounds).where(eq(schema.spaceSounds.id, id)).get();
}

export async function removeSpaceEmoji(row: SpaceEmojiRow, actorId: string): Promise<void> {
  getDb().delete(schema.spaceEmojis).where(eq(schema.spaceEmojis.id, row.id)).run();
  await rm(emojiFilePath(row.id), { force: true });
  recordAudit({ spaceId: row.spaceId, actorId, action: 'emoji_delete', targetType: 'space', targetId: row.id, targetLabel: row.name });
  connectionManager.sendToSpace(row.spaceId, { type: 'space_emojis_changed', spaceId: row.spaceId });
}

export function removeSpaceSticker(row: SpaceStickerRow, actorId: string): void {
  getDb().delete(schema.spaceStickers).where(eq(schema.spaceStickers.id, row.id)).run();
  recordAudit({ spaceId: row.spaceId, actorId, action: 'sticker_delete', targetType: 'space', targetId: row.id, targetLabel: row.name });
  connectionManager.sendToSpace(row.spaceId, { type: 'space_stickers_changed', spaceId: row.spaceId });
}

export async function removeSpaceSound(row: SpaceSoundRow, actorId: string): Promise<void> {
  getDb().delete(schema.spaceSounds).where(eq(schema.spaceSounds.id, row.id)).run();
  await rm(soundFilePath(row.id), { force: true });
  recordAudit({ spaceId: row.spaceId, actorId, action: 'sound_delete', targetType: 'space', targetId: row.id, targetLabel: row.name });
  connectionManager.sendToSpace(row.spaceId, { type: 'space_sounds_changed', spaceId: row.spaceId });
}
