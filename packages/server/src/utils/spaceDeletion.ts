import { eq, inArray } from 'drizzle-orm';
import { getDb, getRawDb, schema } from '../db/index.js';
import { markDirectoryDirty } from '../directory/state.js';
import { connectionManager } from '../ws/handler.js';
import { disconnectMemberFromSpaceVoice } from '../ws/events.js';
import { deleteAttachmentFiles, deleteUploadFile } from './fileCleanup.js';
import { pictureFileReleasable, releaseMemberPictures, uploadNameOf } from './profileImageRefs.js';
import { removeSoundFiles } from './soundFiles.js';
import { discoveryStatusOf, isOpenReview, verificationStatusOf } from './spaceReview.js';
import { announceReviewQueue } from './reviewNotify.js';

type SpaceRow = typeof schema.spaces.$inferSelect;

/**
 * Delete a space with everything in it: its channels and their messages, members, folder
 * entries, read states, the files only it showed, its clips, and everyone out of its voice. The
 * one way a space goes, whoever asks: its owner (`DELETE /api/spaces/:id`) or an administrator
 * deleting the owner's account with the spaces it owns (`DELETE /api/admin/users/:id`).
 */
export function deleteSpaceCompletely(space: SpaceRow): void {
  const db = getDb();
  const id = space.id;

  // Collect all attachment files before cascade-deleting DB records
  const channelIds = db.select({ id: schema.channels.id })
    .from(schema.channels).where(eq(schema.channels.spaceId, id)).all().map(c => c.id);

  let attachmentRows: { filename: string }[] = [];
  if (channelIds.length > 0) {
    const messageIds = db.select({ id: schema.messages.id })
      .from(schema.messages).where(inArray(schema.messages.channelId, channelIds)).all().map(m => m.id);
    if (messageIds.length > 0) {
      attachmentRows = db.select({ filename: schema.attachments.filename })
        .from(schema.attachments).where(inArray(schema.attachments.messageId, messageIds)).all();
    }
  }

  // Capture space icon/banner before deletion
  const spaceIcon = space.icon;
  const spaceBanner = space.banner;
  const hadOpenReview = isOpenReview(verificationStatusOf(space), discoveryStatusOf(space));

  const memberPictures = db.select({ userId: schema.spaceMembers.userId, avatar: schema.spaceMembers.avatar, banner: schema.spaceMembers.banner })
    .from(schema.spaceMembers).where(eq(schema.spaceMembers.spaceId, id)).all();
  // The soundboard's rows go with the space; their files are removed here, not left for a restart.
  const soundIds = db.select({ id: schema.spaceSounds.id }).from(schema.spaceSounds)
    .where(eq(schema.spaceSounds.spaceId, id)).all().map((sound) => sound.id);

  // Delete all channels (messages cascade), members, folder refs, read states, then space atomically
  db.transaction((tx) => {
    // Clean up read_states for all channels in this space (no FK cascade — channelId is plain text)
    if (channelIds.length > 0) {
      tx.delete(schema.readStates).where(inArray(schema.readStates.channelId, channelIds)).run();
    }
    tx.delete(schema.channels).where(eq(schema.channels.spaceId, id)).run();
    tx.delete(schema.spaceMembers).where(eq(schema.spaceMembers.spaceId, id)).run();
    tx.delete(schema.spaceFolderMembers).where(eq(schema.spaceFolderMembers.spaceId, id)).run();
    tx.delete(schema.spaces).where(eq(schema.spaces.id, id)).run();
  });

  // A listed space just left the served document.
  if (space.directoryListed === 1) {
    markDirectoryDirty(getRawDb());
  }
  if (hadOpenReview) announceReviewQueue();

  // Clean up all attachment files from disk
  deleteAttachmentFiles(attachmentRows);
  removeSoundFiles(soundIds);

  // Clean up space icon/banner files nothing else shows, and the members' own pictures.
  for (const picture of [uploadNameOf(spaceIcon), uploadNameOf(spaceBanner)]) {
    if (picture && pictureFileReleasable(picture)) deleteUploadFile(picture);
  }
  releaseMemberPictures(memberPictures);
  // Nobody is in its voice or told about it any more.
  for (const member of memberPictures) {
    disconnectMemberFromSpaceVoice(id, member.userId);
    connectionManager.removeUserSpace(member.userId, id);
  }
}
