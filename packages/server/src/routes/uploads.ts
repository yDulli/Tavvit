import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { sendError } from '../utils/httpErrors.js';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { mimetypeFromFilename, servedUploadType } from '../utils/uploadTypes.js';


/**
 * The one range of bytes a `Range` header asks for, clamped to the file (RFC 9110 §14.1.2):
 * `start-end`, `start-` or the last `-n` bytes. Null when the header is not a single byte range,
 * which is answered with the whole file; `unsatisfiable` when the range starts past its end.
 */
export function byteRange(header: string, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const last = Number(match[2]);
    if (last === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  return start <= end ? { start, end } : null;
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  // Ensure upload directory exists
  if (!fs.existsSync(config.uploadDir)) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
  }

  // GET /api/uploads/:filename - Serve uploaded file
  app.get<{ Params: { filename: string } }>('/api/uploads/:filename', async (request, reply) => {
    const { filename } = request.params;

    // Prevent directory traversal
    const safeName = path.basename(filename);
    const filepath = path.join(config.uploadDir, safeName);

    // A file, and nothing else: the staging folder inside the upload directory (`.tus`) and the
    // directory itself (`..`, which the join above leaves in it) have a name too, and reading one
    // as a file was a server error with a line in the log for every request, signed in or not.
    const stat = fs.statSync(filepath, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      return sendError(reply, 404, 'file_not_found');
    }

    // Get mimetype from DB, falling back to extension-based lookup for thumbnails/orphans. What is
    // stored is not sent as it is (utils/uploadTypes.ts): a peer names the type of what it relays.
    const db = getDb();
    const attachment = db.select().from(schema.attachments).where(eq(schema.attachments.filename, safeName)).get();
    const originalName = attachment?.originalName ?? safeName;
    const served = servedUploadType(attachment?.mimetype ?? mimetypeFromFilename(safeName));
    const mimetype = served.type;

    // Set caching and security headers
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Content-Type', mimetype);
    reply.header('X-Content-Type-Options', 'nosniff');
    // `sandbox`: opened on its own in a tab, a file is no page of this origin, whatever it holds.
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; sandbox");
    reply.header('X-Frame-Options', 'DENY');

    // Anything but a picture, a video or a sound (an SVG included) is downloaded, not shown.
    if (!served.inline) {
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
    }

    // Support Range requests for audio/video seeking
    const fileSize = stat.size;
    const rangeHeader = request.headers.range;

    const range = rangeHeader ? byteRange(rangeHeader, fileSize) : null;
    if (range === 'unsatisfiable') {
      reply.header('Content-Range', `bytes */${fileSize}`);
      return reply.code(416).send();
    }
    if (range) {
      const { start, end } = range;
      reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', end - start + 1);
      reply.code(206);

      const stream = fs.createReadStream(filepath, { start, end });
      return reply.send(stream);
    }

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', fileSize);
    const stream = fs.createReadStream(filepath);
    return reply.send(stream);
  });
}
