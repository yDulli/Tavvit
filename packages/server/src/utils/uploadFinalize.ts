import fs from 'node:fs';
import path from 'node:path';
import { parseWaveform, VOICE_MESSAGE_LIMITS, waveformText } from '@backspace/shared/src/voiceMessages.js';
import type { Attachment } from '@backspace/shared';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { classifyVideoPlayable } from './mediaPlayable.js';
import {
  generateThumbnail,
  generateVideoThumbnail,
  isResizableImage,
  probeImageDimensions,
  probeMediaMeta,
  thumbFilename,
} from './thumbnail.js';
import { extractExtension } from './tusHooks.js';
import { storedUploadName } from './uploadNames.js';
import { mimetypeFromFilename } from './uploadTypes.js';


export interface FinishedUpload {
  /** The complete file, in the staging directory. */
  srcPath: string;
  snowflakeId: string;
  uploaderId: string;
  originalName: string;
  /** Its length if known; otherwise it is measured. */
  size?: number;
  /** What a recording in the browser said about itself; only audio takes it. */
  voiceWaveform?: string | null;
  voiceDuration?: string | null;
}

/**
 * A complete staged file becomes an upload: media-process FIRST, then rename as commit
 * point, then INSERT. Rename is the atomicity barrier: if anything before rename throws,
 * the file stays in staging, where the expiry sweep and cleanupStorage eventually reap it.
 * If INSERT throws after rename, we best-effort delete the renamed file (and the
 * unlinked-attachment janitor would catch any survivors).
 */
export async function finalizeUpload(upload: FinishedUpload): Promise<Attachment> {
  const { srcPath, snowflakeId, uploaderId, originalName } = upload;
  const ext = extractExtension(originalName);
  // Not the snowflake alone: the name is the only key to the file (utils/uploadNames.ts).
  const filename = storedUploadName(snowflakeId, ext);
  const dstPath = path.join(config.uploadDir, filename);

  // Ensure upload dir exists (may differ from tus staging dir) — needed
  // before media processing because thumbnails are written there.
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const mimetype = mimetypeFromFilename(originalName);

  // ── Media processing (on the still-staging file) ─────────────────────
  // Wrapped defensively: any failure here must not abort the upload —
  // we still want the file to land and get an attachments row, just
  // without thumb/dimensions/duration metadata.
  let stagedThumbName: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;
  // Tri-state web-playability for video (null = unknown/optimistic). Lets
  // the client render a download fallback for codecs the browser can't
  // decode (e.g. HEVC .mov) instead of a dead <video> stuck at 0:00.
  let playable: boolean | null = null;
  let voiceWaveform: string | null = null;
  try {
    if (isResizableImage(mimetype)) {
      stagedThumbName = await generateThumbnail(srcPath, mimetype, config.uploadDir);
      const dims = await probeImageDimensions(srcPath);
      if (dims) {
        width = dims.width;
        height = dims.height;
      }
    } else if (mimetype.startsWith('video/')) {
      const videoThumb = await generateVideoThumbnail(srcPath, config.uploadDir);
      if (videoThumb) {
        stagedThumbName = videoThumb.thumbnailFilename;
        width = videoThumb.width;
        height = videoThumb.height;
      }
      const mediaMeta = await probeMediaMeta(srcPath, mimetype);
      if (mediaMeta) {
        duration = mediaMeta.duration ?? null;
        if (width === null && mediaMeta.width) width = mediaMeta.width;
        if (height === null && mediaMeta.height) height = mediaMeta.height;
        playable = classifyVideoPlayable(mimetype, mediaMeta.codec);
      }
    } else if (mimetype.startsWith('audio/')) {
      const mediaMeta = await probeMediaMeta(srcPath, mimetype);
      if (mediaMeta?.duration) duration = mediaMeta.duration;
    }
    // A recording in the browser's own format often states no length. Its waveform and
    // the length measured while recording are all the uploader adds, and only for audio.
    if (mimetype.startsWith('audio/')) {
      voiceWaveform = waveformText(upload.voiceWaveform);
      const measured = Number(upload.voiceDuration);
      if (voiceWaveform && duration === null && Number.isFinite(measured) && measured > 0) {
        duration = Math.min(measured, VOICE_MESSAGE_LIMITS.MAX_SECONDS);
      }
    }
  } catch (err) {
    console.error('[files] Media processing failed (non-fatal):', err);
    // Reset to a clean baseline; if a partial thumb was written we
    // attempt to clean it up below.
    if (stagedThumbName) {
      try {
        fs.unlinkSync(path.join(config.uploadDir, stagedThumbName));
      } catch { /* ignore */ }
      stagedThumbName = null;
    }
    width = null; height = null; duration = null; playable = null; voiceWaveform = null;
  }

  // ── Commit point: rename staging → uploads/<snowflakeId>-<random><ext> ─
  // After this succeeds we own a permanent file. If anything below
  // throws we must delete it (or the unlinked-attachment janitor will).
  fs.renameSync(srcPath, dstPath);

  // The thumb generators name their output `<basename(srcPath)>_thumb.webp`
  // — i.e. `<uploadId>_thumb.webp`. Rename it to the canonical
  // `<name of the file>_thumb.webp` (thumbFilename), as unguessable as the
  // file, so storageJanitor's reference set matches.
  let thumbnailFilename: string | null = null;
  if (stagedThumbName) {
    const stagedThumbPath = path.join(config.uploadDir, stagedThumbName);
    const finalThumbName = thumbFilename(filename);
    const finalThumbPath = path.join(config.uploadDir, finalThumbName);
    try {
      fs.renameSync(stagedThumbPath, finalThumbPath);
      thumbnailFilename = finalThumbName;
    } catch (err) {
      console.error('[files] Thumbnail rename failed (non-fatal):', err);
      try { fs.unlinkSync(stagedThumbPath); } catch { /* ignore */ }
      thumbnailFilename = null;
    }
  }

  const size = upload.size ?? fs.statSync(dstPath).size;
  const now = Date.now();

  // ── Insert attachments row ───────────────────────────────────────────
  try {
    getDb().insert(schema.attachments).values({
      id: snowflakeId,
      uploaderId,
      messageId: null,
      dmMessageId: null,
      filename,
      originalName,
      mimetype,
      size,
      thumbnailFilename,
      width,
      height,
      duration,
      playable,
      voiceWaveform,
      createdAt: now,
    }).run();
  } catch (err) {
    // INSERT failed after the rename succeeded — best-effort delete the
    // committed file + thumbnail so we don't leak an orphan. The
    // storageJanitor unlinked-attachment sweep would also catch it
    // eventually, but this keeps the failure window small.
    try { fs.unlinkSync(dstPath); } catch { /* ignore */ }
    if (thumbnailFilename) {
      try { fs.unlinkSync(path.join(config.uploadDir, thumbnailFilename)); } catch { /* ignore */ }
    }
    throw err;
  }

  return {
    id: snowflakeId,
    messageId: '',
    filename,
    originalName,
    mimetype,
    size,
    thumbnailFilename: thumbnailFilename ?? undefined,
    width: width ?? undefined,
    height: height ?? undefined,
    duration: duration ?? undefined,
    playable,
    voiceWaveform: parseWaveform(voiceWaveform),
    createdAt: now,
  };
}
