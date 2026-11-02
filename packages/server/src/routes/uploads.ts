import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { sendError } from '../utils/httpErrors.js';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

const EXT_MIMETYPES: Record<string, string> = {
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.tiff': 'image/tiff', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.opus': 'audio/opus',
  '.weba': 'audio/webm', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
};

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

    if (!fs.existsSync(filepath)) {
      return sendError(reply, 404, 'file_not_found');
    }

    // Get mimetype from DB, falling back to extension-based lookup for thumbnails/orphans
    const db = getDb();
    const attachment = db.select().from(schema.attachments).where(eq(schema.attachments.filename, safeName)).get();
    const originalName = attachment?.originalName ?? safeName;
    const mimetype = attachment?.mimetype
      ?? EXT_MIMETYPES[path.extname(safeName).toLowerCase()]
      ?? 'application/octet-stream';

    // Set caching and security headers
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Content-Type', mimetype);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'");
    reply.header('X-Frame-Options', 'DENY');

    // For non-media files and SVGs, force download instead of inline rendering
    const isSvg = mimetype === 'image/svg+xml';
    if (isSvg || (!mimetype.startsWith('image/') && !mimetype.startsWith('video/') && !mimetype.startsWith('audio/'))) {
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
    }

    // Support Range requests for audio/video seeking
    const stat = fs.statSync(filepath);
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
