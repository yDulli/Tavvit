import { eq } from 'drizzle-orm';
import type { getDb } from '../db/index.js';
import { schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { newestDmMessagePreview } from './dmChannelWire.js';
import { deleteAttachmentFiles } from './fileCleanup.js';

type Db = ReturnType<typeof getDb>;

/**
 * Deletes a DM message on this instance (docs/systems/dm-system.md, "Deleting a message"): its
 * attachments, reactions and row in one transaction, then its files, and the conversation's
 * members hear `dm_message_deleted` with the preview the conversation shows now, so a list that
 * showed the deleted message as the last one shows the one before it, or nothing. Every path that
 * deletes one comes through here: its author over REST or the socket, a report decided against it,
 * and a peer relaying its author's delete. Checks and the relay to peers are the caller's.
 */
export function deleteDmMessageHere(db: Db, message: { id: string; dmChannelId: string }): void {
  const files = db.select({ filename: schema.attachments.filename })
    .from(schema.attachments)
    .where(eq(schema.attachments.dmMessageId, message.id))
    .all();

  db.transaction((tx) => {
    tx.delete(schema.attachments).where(eq(schema.attachments.dmMessageId, message.id)).run();
    tx.delete(schema.dmReactions).where(eq(schema.dmReactions.dmMessageId, message.id)).run();
    tx.delete(schema.dmMessages).where(eq(schema.dmMessages.id, message.id)).run();
  });

  // Files go once the rows are gone, so a failed transaction leaves nothing pointing at a missing file.
  deleteAttachmentFiles(files);

  connectionManager.sendToDmMembers(message.dmChannelId, {
    type: 'dm_message_deleted',
    messageId: message.id,
    dmChannelId: message.dmChannelId,
    lastMessage: newestDmMessagePreview(db, message.dmChannelId),
  });
}
