import fs from 'fs';
import path from 'path';
import sharp, { type Metadata } from 'sharp';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

// libvips keeps finished operations in a cache, and with them the files they read. Windows
// refuses to rename a file something holds open, and the file is renamed right after this.
sharp.cache(false);

const execFile = promisify(execFileCb);
const FFMPEG_TIMEOUT = 10_000; // 10 seconds

/**
 * What ffmpeg and ffprobe may open for an uploaded file, before its `-i`: the file itself, read as
 * one of the containers people send. ffmpeg picks a demuxer by content, not by name, so a "video"
 * holding an HLS or concat playlist would otherwise make the server fetch whatever address it
 * names, or read other files on its disk, and hand back what it found as a thumbnail.
 */
export const FFMPEG_INPUT_LIMITS: readonly string[] = [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,mpeg,flv,ogg,wav,mp3,flac,aac,asf,caf,aiff,w64,amr',
];

let ffmpegAvailable: boolean | null = null;

/** The most pixels an upload's thumbnail is made from: a phone's 108-megapixel photo, and no bomb. */
const UPLOAD_INPUT_PIXELS = 120_000_000;
/** The most pixels a picture field's image may have, every frame of an animation together. */
const PICTURE_INPUT_PIXELS = 64_000_000;

/**
 * Decoding and encoding media for uploads runs at most this many at once; the rest wait their
 * turn. Each holds a thread or a process for seconds, so uploads finishing side by side, crafted
 * or not, would otherwise take the whole machine, and with it every other request.
 */
const MEDIA_JOBS_AT_ONCE = 2;
let mediaJobsRunning = 0;
const mediaJobsWaiting: Array<() => void> = [];

async function mediaJob<T>(job: () => Promise<T>): Promise<T> {
  if (mediaJobsRunning < MEDIA_JOBS_AT_ONCE) mediaJobsRunning += 1;
  else await new Promise<void>((resolve) => { mediaJobsWaiting.push(resolve); });
  try {
    return await job();
  } finally {
    // A waiting job takes this one's place; only when none waits is the place free.
    const next = mediaJobsWaiting.shift();
    if (next) next();
    else mediaJobsRunning -= 1;
  }
}

/**
 * Picture work people send (emoji, stickers, the Discord import) waits for the same turns, with two
 * bounds on top. An account has at most one such job queued or running: a second is refused at
 * once instead of waiting with its picture in memory (an account's uploads go one after another
 * anyway). And while this many jobs of any kind wait, a new one is refused too, so many accounts
 * together cannot grow the queue and the memory it holds without end. An upload's own thumbnail is
 * never refused here.
 */
const PICTURE_JOBS_PER_ACCOUNT = 1;
const WAITING_BEFORE_REFUSAL = 24;
const pictureJobsByAccount = new Map<string, number>();

/** How long one encode of a picture people send may take before it is given up as too heavy. */
export const PICTURE_ENCODE_SECONDS = 30;

/** Picture work refused because its account has some under way already, or too much waits. Answered as 429. */
export class MediaBusyError extends Error {
  constructor() {
    super('Picture work is busy');
    this.name = 'MediaBusyError';
  }
}

/** Runs picture work for `account` in its turn, or rejects with MediaBusyError at once (see above). */
export function runMediaJob<T>(job: () => Promise<T>, account: string): Promise<T> {
  const held = pictureJobsByAccount.get(account) ?? 0;
  if (held >= PICTURE_JOBS_PER_ACCOUNT || mediaJobsWaiting.length >= WAITING_BEFORE_REFUSAL) {
    return Promise.reject(new MediaBusyError());
  }
  pictureJobsByAccount.set(account, held + 1);
  return mediaJob(job).finally(() => {
    const left = (pictureJobsByAccount.get(account) ?? 1) - 1;
    if (left > 0) pictureJobsByAccount.set(account, left);
    else pictureJobsByAccount.delete(account);
  });
}

const PROFILE_LIMITS = { avatar: 256, icon: 256, banner: 1280 } as const;

/** What a picture field keeps: formats every browser shows, each written back as itself. */
type PictureFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';
const PICTURE_FORMATS: readonly PictureFormat[] = ['jpeg', 'png', 'webp', 'gif', 'avif'];

/** The format sharp writes a picture back in, or null for one a picture field does not take. */
function pictureFormatOf(metadata: Metadata): PictureFormat | null {
  // sharp names an AVIF file by its container; any other HEIF is no picture browsers show.
  const format = metadata.format === 'heif' && metadata.compression === 'av1' ? 'avif' : metadata.format;
  return PICTURE_FORMATS.find((allowed) => allowed === format) ?? null;
}

/**
 * Re-encode a profile image (avatar, icon, or banner), down to the target max dimension when it is
 * larger. Preserves animated GIF frames. Always written anew, small or not: what a picture field
 * holds is then pixels of that size and nothing else, however much the upload carried
 * (utils/profileImageRefs.ts). Writes to a temp file then atomically renames to avoid corruption.
 * False when the file is no picture of those formats or could not be written anew: the field must
 * not take it then, since it would show the upload as it came.
 */
export async function resizeProfileImage(
  filepath: string,
  type: 'avatar' | 'icon' | 'banner',
): Promise<boolean> {
  const maxDim = PROFILE_LIMITS[type];
  return mediaJob(async () => {
    const tmpPath = filepath + '.tmp';
    try {
      const metadata = await sharp(filepath, { animated: true, limitInputPixels: PICTURE_INPUT_PIXELS }).metadata();
      const format = pictureFormatOf(metadata);
      if (!metadata.width || format === null) return false;

      await sharp(filepath, { animated: true, limitInputPixels: PICTURE_INPUT_PIXELS })
        .resize({ width: maxDim, withoutEnlargement: true })
        .toFormat(format)
        .toFile(tmpPath);
      fs.renameSync(tmpPath, filepath);
      return true;
    } catch (err) {
      console.error('Profile image could not be written anew for %s:', path.basename(filepath), err);
      // Clean up temp file if it was partially written
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      return false;
    }
  });
}

const RESIZABLE_MIMETYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
]);

const THUMBNAIL_MAX_WIDTH = 800;
const THUMBNAIL_QUALITY = 80;

/**
 * Derive a deterministic thumbnail filename from the original.
 * e.g. "123456789.png" → "123456789_thumb.webp"
 */
export function thumbFilename(original: string): string {
  const parsed = path.parse(original);
  return `${parsed.name}_thumb.webp`;
}

/** Check if the given mimetype is a resizable image format. */
export function isResizableImage(mimetype: string): boolean {
  return RESIZABLE_MIMETYPES.has(mimetype);
}

/**
 * Generate a WebP thumbnail for the given image file.
 * Returns the thumbnail filename on success, or null if:
 * - The image is already ≤ THUMBNAIL_MAX_WIDTH px wide
 * - An error occurs (upload still succeeds without thumbnail)
 */
export async function generateThumbnail(
  originalPath: string,
  mimetype: string,
  uploadDir: string,
): Promise<string | null> {
  if (!isResizableImage(mimetype)) return null;

  return mediaJob(async () => {
    try {
      const metadata = await sharp(originalPath, { limitInputPixels: UPLOAD_INPUT_PIXELS }).metadata();

      // Skip if the original is already small enough
      if (!metadata.width || metadata.width <= THUMBNAIL_MAX_WIDTH) {
        return null;
      }

      // Skip animated images — Sharp would flatten to a single static frame
      if (metadata.pages && metadata.pages > 1) {
        return null;
      }

      const originalFilename = path.basename(originalPath);
      const thumbName = thumbFilename(originalFilename);
      const thumbPath = path.join(uploadDir, thumbName);

      await sharp(originalPath, { limitInputPixels: UPLOAD_INPUT_PIXELS })
        .resize({ width: THUMBNAIL_MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: THUMBNAIL_QUALITY })
        .toFile(thumbPath);

      return thumbName;
    } catch (err) {
      console.error('Thumbnail generation failed (non-fatal):', err);
      return null;
    }
  });
}

/** Check if ffmpeg/ffprobe are available on the system PATH. Caches result. */
export async function checkFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await execFile('ffprobe', ['-version'], { timeout: 5000 });
    ffmpegAvailable = true;
  } catch {
    console.warn('ffmpeg/ffprobe not found — video thumbnails and metadata extraction disabled');
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

/** Extract width/height from an image file using sharp. Works for all formats including animated GIFs and small images. */
export async function probeImageDimensions(filepath: string): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(filepath).metadata();
    if (metadata.width && metadata.height) {
      return { width: metadata.width, height: metadata.height };
    }
    return null;
  } catch {
    return null;
  }
}

type MediaMeta = { width?: number; height?: number; duration?: number; codec?: string };

/** Extract dimensions and/or duration from a video or audio file using ffprobe. */
export async function probeMediaMeta(filepath: string, mimetype: string): Promise<MediaMeta | null> {
  if (!(await checkFfmpeg())) return null;
  return mediaJob(() => probeMediaMetaNow(filepath, mimetype));
}

async function probeMediaMetaNow(filepath: string, mimetype: string): Promise<MediaMeta | null> {
  try {
    const result: MediaMeta = {};

    // Video dimensions + codec (stream-level). The codec drives web-playability
    // classification (see utils/mediaPlayable.ts) so the client can render a
    // download fallback for formats the browser can't decode (e.g. HEVC .mov).
    if (mimetype.startsWith('video/')) {
      try {
        const { stdout } = await execFile('ffprobe', [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height,codec_name',
          '-of', 'json',
          ...FFMPEG_INPUT_LIMITS,
          '-i', filepath,
        ], { timeout: FFMPEG_TIMEOUT });

        const data = JSON.parse(stdout);
        const stream = data?.streams?.[0];
        if (stream?.width && stream?.height) {
          result.width = stream.width;
          result.height = stream.height;
        }
        if (typeof stream?.codec_name === 'string' && stream.codec_name) {
          result.codec = stream.codec_name;
        }
      } catch { /* dimension/codec probe failed — continue for duration */ }
    }

    // Duration (format-level — works for video and audio)
    try {
      const { stdout } = await execFile('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'json',
        ...FFMPEG_INPUT_LIMITS,
        '-i', filepath,
      ], { timeout: FFMPEG_TIMEOUT });

      const data = JSON.parse(stdout);
      const dur = parseFloat(data?.format?.duration);
      if (Number.isFinite(dur)) {
        result.duration = Math.round(dur * 100) / 100; // 2 decimal places
      }
    } catch { /* duration probe failed */ }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Extract a single frame from a video and create a WebP thumbnail.
 * Returns thumbnail filename + rotation-corrected dimensions, or null on error.
 * Uses -ss before -i for fast keyframe seeking.
 * ffmpeg auto-rotation is on by default, so portrait mobile videos produce correctly oriented frames.
 */
type VideoThumbnail = { thumbnailFilename: string; width: number; height: number };

export async function generateVideoThumbnail(filepath: string, uploadDir: string): Promise<VideoThumbnail | null> {
  if (!(await checkFfmpeg())) return null;
  return mediaJob(() => generateVideoThumbnailNow(filepath, uploadDir));
}

async function generateVideoThumbnailNow(filepath: string, uploadDir: string): Promise<VideoThumbnail | null> {
  try {
    // Try extracting frame at 1 second, fall back to 0 for short videos
    let frameBuffer: Buffer | null = null;

    for (const seekTime of ['1', '0']) {
      try {
        const { stdout } = await execFile('ffmpeg', [
          '-ss', seekTime,
          ...FFMPEG_INPUT_LIMITS,
          '-i', filepath,
          '-frames:v', '1',
          '-f', 'image2pipe',
          '-vcodec', 'png',
          '-',
        ], { timeout: FFMPEG_TIMEOUT, encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 });

        if (stdout && stdout.length > 0) {
          frameBuffer = stdout as unknown as Buffer;
          break;
        }
      } catch (err) {
        if (seekTime === '1') continue; // Try 0 next
        throw err;
      }
    }

    if (!frameBuffer) return null;

    // Read the frame's actual dimensions (rotation-corrected by ffmpeg)
    const frameImage = sharp(frameBuffer, { limitInputPixels: UPLOAD_INPUT_PIXELS });
    const frameMeta = await frameImage.metadata();
    if (!frameMeta.width || !frameMeta.height) return null;

    const originalWidth = frameMeta.width;
    const originalHeight = frameMeta.height;

    // Generate WebP thumbnail (same settings as image thumbnails)
    const originalFilename = path.basename(filepath);
    const thumbName = thumbFilename(originalFilename);
    const thumbPath = path.join(uploadDir, thumbName);

    await sharp(frameBuffer, { limitInputPixels: UPLOAD_INPUT_PIXELS })
      .resize({ width: THUMBNAIL_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: THUMBNAIL_QUALITY })
      .toFile(thumbPath);

    return { thumbnailFilename: thumbName, width: originalWidth, height: originalHeight };
  } catch (err) {
    console.error('Video thumbnail generation failed (non-fatal):', err);
    return null;
  }
}
