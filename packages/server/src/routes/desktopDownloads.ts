import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopReleaseResponse } from '@backspace/shared';
import { config } from '../config.js';
import { DESKTOP_DOWNLOAD_PREFIX, SAFE_FILE_NAME, readDesktopRelease } from '../utils/desktopRelease.js';

/**
 * The desktop app's downloads: the release description the download page
 * reads, and the files themselves, which the browser downloads and every
 * installed app's updater fetches (electron-builder.yml, `publish: generic`).
 * Both are public: a visitor who has no account yet is exactly who needs the
 * installer. See docs/systems/desktop.md, "Releases".
 */
export async function desktopDownloadRoutes(app: FastifyInstance): Promise<void> {
  const root = path.join(config.downloadsDir, 'desktop');
  fs.mkdirSync(root, { recursive: true });

  app.get('/api/desktop/release', async (_request, reply) => {
    // Read per request: publishing a release is copying files in, and the page
    // has to see it without a server restart.
    const response: DesktopReleaseResponse = { release: readDesktopRelease(config.downloadsDir) };
    reply.header('Cache-Control', 'no-cache');
    return response;
  });

  await app.register(fastifyStatic, {
    root,
    prefix: DESKTOP_DOWNLOAD_PREFIX,
    decorateReply: false,
    index: false,
    list: false,
    serveDotFiles: false,
    // The updater asks for latest.yml on every check and every starting app for
    // games.json (ETag), so neither may be stale; an installer's name carries
    // its version, so it may be cached.
    setHeaders(reply, filePath) {
      const name = path.basename(filePath);
      if (!SAFE_FILE_NAME.test(name)) return;
      reply.header('X-Content-Type-Options', 'nosniff');
      if (name.endsWith('.yml')) {
        reply.header('Cache-Control', 'no-cache');
        reply.header('Content-Type', 'text/yaml; charset=utf-8');
      } else if (name.endsWith('.json')) {
        reply.header('Cache-Control', 'no-cache');
        reply.header('Content-Type', 'application/json; charset=utf-8');
      } else {
        reply.header('Cache-Control', 'public, max-age=3600');
        reply.header('Content-Type', 'application/octet-stream');
        if (name.endsWith('.exe')) reply.header('Content-Disposition', `attachment; filename="${name}"`);
      }
    },
  });
}
