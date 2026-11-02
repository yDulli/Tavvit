import type { FastifyInstance } from 'fastify';
import { EVENTS, Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { verifyJwtAndUser, AuthError } from '../utils/auth.js';
import {
  parseUploadMetadata,
  buildTusMetadata,
  isOwnerOfUpload,
  type UploadMetadata,
} from '../utils/tusHooks.js';
import {
  finishedUploadExceedsLimit,
  releaseUpload,
  reserveUpload,
  uploadRefusal,
  type UploadRefusal,
} from '../utils/accountLimits.js';
import { errorBody } from '../utils/httpErrors.js';
import { finalizeUpload } from '../utils/uploadFinalize.js';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

// ─── Per-user rate limit for upload creation (30 creates / min) ─────────────
const UPLOAD_CREATE_LIMIT = 30;
const UPLOAD_CREATE_WINDOW_MS = 60_000;
const createCounts = new Map<string, { count: number; windowStart: number }>();

function checkCreateRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = createCounts.get(userId);
  if (!entry || now - entry.windowStart > UPLOAD_CREATE_WINDOW_MS) {
    createCounts.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= UPLOAD_CREATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

// ─── Per-user rate limit for PATCH (slowloris defense, ~1000 / min / user) ──
// Production runs behind Caddy, so req.socket.remoteAddress is always
// 127.0.0.1 — keying on userId is the only meaningful identifier.
const PATCH_PER_USER_LIMIT = 1000;
const PATCH_WINDOW_MS = 60_000;
const patchCounts = new Map<string, { count: number; windowStart: number }>();

function withinPatchLimit(userId: string): boolean {
  const now = Date.now();
  const entry = patchCounts.get(userId);
  if (!entry || now - entry.windowStart > PATCH_WINDOW_MS) {
    patchCounts.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= PATCH_PER_USER_LIMIT) return false;
  entry.count += 1;
  return true;
}

// ─── Periodic prune of stale rate-limit entries (every 60s) ─────────────────
let rateLimitPruneTimer: ReturnType<typeof setInterval> | null = null;
function startRateLimitPruner(): void {
  if (rateLimitPruneTimer) return;
  rateLimitPruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of createCounts) {
      if (now - v.windowStart > UPLOAD_CREATE_WINDOW_MS) createCounts.delete(k);
    }
    for (const [k, v] of patchCounts) {
      if (now - v.windowStart > PATCH_WINDOW_MS) patchCounts.delete(k);
    }
  }, 60_000);
  // Don't keep the event loop alive solely for this timer
  if (typeof rateLimitPruneTimer.unref === 'function') rateLimitPruneTimer.unref();
}

/** A refusal as the rest of the API words it, so the client can say it in the person's language. */
function refusedUpload(code: UploadRefusal): { status_code: number; body: string } {
  const status = code === 'disk_full' ? 507 : 413;
  return { status_code: status, body: JSON.stringify(errorBody(status, code)) };
}

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  // Ensure tus staging directory exists
  fs.mkdirSync(config.tusUploadDir, { recursive: true });
  startRateLimitPruner();

  const tusServer = new TusServer({
    path: '/api/files',
    datastore: new FileStore({
      directory: config.tusUploadDir,
      expirationPeriodInMilliseconds: config.tusExpirationMs,
    }),
    // The Location header is a path, never an absolute URL. An absolute one has
    // to be assembled from Host / X-Forwarded-Host, which is whatever the
    // fronting proxy chose to send: nginx's `$host` drops the port, so an
    // instance published on a custom port got a Location pointing at a port the
    // client never used (#44). tus-js-client resolves a relative Location
    // against the endpoint it uploaded to, which is the one origin guaranteed
    // to be right.
    relativeLocation: true,
    disableTerminationForFinishedUploads: true,

    // ── Auth: verify JWT on every incoming request ─────────────────────────
    async onIncomingRequest(req, _res, uploadId) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { status_code: 401, body: 'Missing or invalid authorization header' };
      }
      const token = authHeader.slice(7);
      let identity: { userId: string; username: string; homeInstance: string | null };
      try {
        identity = await verifyJwtAndUser(token);
      } catch (err) {
        if (err instanceof AuthError) {
          throw { status_code: err.statusCode, body: err.message };
        }
        throw { status_code: 401, body: 'Invalid or expired token' };
      }
      const userId = identity.userId;

      // Attach userId to the raw request so downstream hooks can read it.
      (req as NodeJS.Dict<unknown> & typeof req).userId = userId;

      // Ownership guard for any method that targets a specific upload by id.
      // PATCH/HEAD/DELETE/GET all leak or modify state otherwise:
      //  - DELETE: any authed user could cancel any upload
      //  - HEAD:   leaks Upload-Metadata (userId, snowflakeId, originalName)
      //  - GET:    streams partial file contents during the .tus staging window
      //  - PATCH:  writes bytes into someone else's upload
      const guarded = req.method === 'PATCH' || req.method === 'HEAD'
        || req.method === 'DELETE' || req.method === 'GET';
      if (guarded && uploadId) {
        // PATCH-specific slowloris/rate defense (per-user, see comment above).
        if (req.method === 'PATCH') {
          if (!withinPatchLimit(userId)) {
            throw { status_code: 429, body: 'PATCH rate limit exceeded' };
          }
        }

        let upload;
        try {
          upload = await tusServer.datastore.getUpload(uploadId);
        } catch (err: unknown) {
          // Let tus format 404 / 410 errors with status_code; let other
          // errors propagate so the caller sees the underlying failure.
          if (err !== null && typeof err === 'object' && 'status_code' in err) {
            throw err;
          }
          throw err;
        }
        if (!isOwnerOfUpload(upload.metadata as UploadMetadata, userId)) {
          throw { status_code: 403, body: 'Forbidden: you do not own this upload' };
        }
      }
    },

    // ── Upload create: assign snowflake + validate size + store userId ─────
    async onUploadCreate(req, res, upload) {
      const userId: string = (req as NodeJS.Dict<unknown> & typeof req).userId as string;

      // Per-user create rate limit
      if (!checkCreateRateLimit(userId)) {
        throw { status_code: 429, body: 'Upload creation rate limit exceeded' };
      }

      // Read dynamic upload limit from instance_settings, fall back to config
      const db = getDb();
      const settings = db
        .select({ maxUploadSizeBytes: schema.instanceSettings.maxUploadSizeBytes })
        .from(schema.instanceSettings)
        .where(eq(schema.instanceSettings.id, 1))
        .get();
      const maxSize = settings?.maxUploadSizeBytes ?? config.maxUploadSize;

      // A length given later would pass this limit and the account's unchecked.
      if (upload.size === undefined) {
        throw { status_code: 400, body: 'Upload-Length is required' };
      }
      if (upload.size > maxSize) {
        throw { status_code: 413, body: 'File too large' };
      }

      const refusal = uploadRefusal(userId, upload.size);
      if (refusal) throw refusedUpload(refusal);

      // Extract originalName from existing metadata (decoded by tus already)
      const rawMetaHeader = req.headers['upload-metadata'] as string | undefined;
      const parsedMeta = parseUploadMetadata(rawMetaHeader ?? null);
      const originalName = parsedMeta.originalName ?? parsedMeta.filename;
      if (!originalName || !originalName.trim()) {
        throw {
          status_code: 400,
          body: 'Upload-Metadata missing required field: filename',
        };
      }

      // Assign snowflake and embed userId into tus metadata
      const snowflakeId = generateSnowflake();
      const augmented = buildTusMetadata({ snowflakeId, userId, originalName });

      // tus's metadata type is Record<string, string | null>. buildTusMetadata
      // returns UploadMetadata with optional fields; we filter undefined to
      // satisfy that constraint (all three fields are guaranteed strings here
      // since we just constructed them above).
      const mergedMetadata: Record<string, string | null> = {};
      for (const [k, v] of Object.entries({ ...upload.metadata, ...augmented })) {
        if (v !== undefined) mergedMetadata[k] = v;
      }

      reserveUpload(upload.id, userId, upload.size);

      return { res, metadata: mergedMetadata };
    },

    // ── Upload finish: media-process FIRST, then rename as commit point,
    //    then INSERT. Rename is the atomicity barrier — if anything before
    //    rename throws, the file stays in .tus/ where the tus expiration
    //    sweep + cleanupStorage will eventually reap it. If INSERT throws
    //    after rename, we best-effort delete the renamed file (and the
    //    unlinked-attachment janitor would catch any survivors).
    async onUploadFinish(req, res, upload) {
      const requestUserId: string = (req as NodeJS.Dict<unknown> & typeof req).userId as string;
      const meta = upload.metadata ?? {};

      const snowflakeId = meta.snowflakeId ?? null;
      const storedUserId = meta.userId ?? null;
      const originalName = meta.originalName ?? 'upload';

      // Defense in depth: re-verify ownership
      if (!snowflakeId || !storedUserId || storedUserId !== requestUserId) {
        throw { status_code: 403, body: 'Forbidden: ownership mismatch' };
      }

      const srcPath = path.join(config.tusUploadDir, upload.id);

      // From here on it counts by its row, or not at all. What the start held for it is
      // gone after a restart, and the limit may have gone down since.
      releaseUpload(upload.id);
      if (finishedUploadExceedsLimit(storedUserId, upload.size ?? fs.statSync(srcPath).size)) {
        await tusServer.datastore.remove(upload.id);
        throw refusedUpload('storage_limit_reached');
      }

      const attachment = await finalizeUpload({
        srcPath,
        snowflakeId,
        uploaderId: storedUserId,
        originalName,
        ...(upload.size !== undefined ? { size: upload.size } : {}),
        voiceWaveform: meta.voiceWaveform,
        voiceDuration: meta.voiceDuration,
      });

      // Best-effort: delete tus .json sidecar
      const sidecarPath = `${srcPath}.json`;
      if (fs.existsSync(sidecarPath)) {
        try { fs.unlinkSync(sidecarPath); } catch { /* ignore */ }
      }

      return {
        res,
        status_code: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attachment),
      };
    },
  });

  tusServer.on(EVENTS.POST_TERMINATE, (_req, _res, id) => releaseUpload(id));

  // Register the content-type parser that tus requires
  app.addContentTypeParser(
    'application/offset+octet-stream',
    (_request, _payload, done) => done(null),
  );

  // Delegate all /api/files and /api/files/* requests to tus.
  // reply.hijack() tells Fastify the response is being managed externally —
  // prevents lifecycle races (double-send, reply timing) under load.
  app.all('/api/files', (request, reply) => {
    reply.hijack();
    tusServer.handle(request.raw, reply.raw);
  });
  app.all('/api/files/*', (request, reply) => {
    reply.hijack();
    tusServer.handle(request.raw, reply.raw);
  });
}
