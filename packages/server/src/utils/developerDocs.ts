import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * The public developer docs (docs/systems/developers.md): plain pages the web client's build
 * writes to `dist/developers`. They answer here, ahead of the app's page, with a policy of their
 * own: they run one script of this server's and load nothing from anywhere else.
 */
const DOCS_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const PAGE_SLUG = /^[a-z0-9-]{1,64}$/;

export function registerDeveloperDocs(app: FastifyInstance, webDistPath: string): void {
  const root = path.join(webDistPath, 'developers');

  const send = async (reply: FastifyReply, file: string): Promise<FastifyReply> => {
    const html = await fs.promises.readFile(file, 'utf8').catch(() => null);
    if (html === null) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    return reply
      .header('Content-Security-Policy', DOCS_POLICY)
      .header('Cache-Control', 'no-cache')
      .type('text/html; charset=utf-8')
      .send(html);
  };

  app.get('/developers', (_request, reply) => send(reply, path.join(root, 'home.html')));
  app.get('/developers/docs', (_request, reply) => reply.redirect('/developers/docs/overview', 302));
  app.get<{ Params: { slug: string } }>('/developers/docs/:slug', (request, reply) => {
    const { slug } = request.params;
    // A page name and nothing else, so no request can reach outside the folder.
    if (!PAGE_SLUG.test(slug)) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    return send(reply, path.join(root, 'docs', `${slug}.html`));
  });

  // The same addresses with a slash at the end, as people type them. Without an answer here they
  // would fall through to the app, which has no such page and says there is nothing here.
  app.get('/developers/', (_request, reply) => reply.redirect('/developers', 301));
  app.get('/developers/docs/', (_request, reply) => reply.redirect('/developers/docs/overview', 302));
  app.get<{ Params: { slug: string } }>('/developers/docs/:slug/', (request, reply) => {
    const { slug } = request.params;
    if (!PAGE_SLUG.test(slug)) return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
    return reply.redirect(`/developers/docs/${slug}`, 301);
  });
}
