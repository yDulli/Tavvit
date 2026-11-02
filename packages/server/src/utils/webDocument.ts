/**
 * The two documents a browser fetches before any script runs: the page itself
 * and the web app manifest. Both are built once by Vite with the product name
 * in them; the server rewrites that name to the instance's own on the way out,
 * so the tab title, the iOS home-screen label and the installed app's name are
 * the administrator's choice from the first byte, not after the app has loaded.
 *
 * Only the name changes, and on an invite link the preview a chat app shows.
 * Nothing here reads who is asking, so a response is the same for everyone and
 * can be cached by the browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const MAX_SHORT_NAME = 12;

/** The longest space description a link preview carries. */
const MAX_PREVIEW_DESCRIPTION = 160;

/** The folders of the built page: files from disk, the same for everyone. */
const STATIC_ASSET_PREFIXES = ['/assets/', '/fonts/', '/icons/', '/sounds/', '/developers/assets/'];

/** True for a request path (with or without a query) inside one of those folders. */
export function isStaticAssetPath(url: string): boolean {
  return STATIC_ASSET_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * `index.html` with the title and the iOS home-screen title set to `name`, and
 * the link preview's picture at a whole address: a service showing a preview
 * fetches it from outside, where a path means nothing. `origin` is omitted when
 * the instance does not know its own public address.
 */
export function renderIndexHtml(template: string, name: string, origin?: string): string {
  const safe = escapeHtml(name);
  const page = template
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${safe}</title>`)
    .replace(
      /(<meta\s+name="apple-mobile-web-app-title"\s+content=")[^"]*(")/,
      (_match, open: string, close: string) => `${open}${safe}${close}`,
    );
  if (!origin) return page;
  return page.replace(
    /(<meta\s+property="og:image"\s+content=")(\/[^"]*)(")/,
    (_match, open: string, path: string, close: string) => `${open}${escapeHtml(origin)}${path}${close}`,
  );
}

/** What a link preview says about the space behind an invite. */
export interface InviteCard {
  spaceName: string;
  description: string | null;
  memberCount: number;
  /** The space's icon on this server, as a path; null when it has none here. */
  iconPath: string | null;
}

/** Sets the content of one `<meta>` tag of the template. */
function withMeta(page: string, attribute: 'name' | 'property', key: string, value: string): string {
  const tag = new RegExp(`(<meta\\s+${attribute}="${key}"\\s+content=")[^"]*(")`);
  return page.replace(tag, (_match, open: string, close: string) => `${open}${escapeHtml(value)}${close}`);
}

/** One line for the preview: the space's own words when it has some, and how many people are in it. */
function inviteDescription(card: InviteCard, instanceName: string): string {
  const members = `${card.memberCount} ${card.memberCount === 1 ? 'member' : 'members'}`;
  const text = (card.description ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return `${members} on ${instanceName}`;
  const characters = Array.from(text);
  const short = characters.length > MAX_PREVIEW_DESCRIPTION ? `${characters.slice(0, MAX_PREVIEW_DESCRIPTION).join('').trimEnd()}…` : text;
  return `${short} · ${members}`;
}

/**
 * The page for an invite link: what a chat app shows when someone pastes the
 * link. The icon needs a whole address, like the page's own picture; without one
 * the preview keeps the product's picture.
 */
export function renderInviteHtml(template: string, instanceName: string, card: InviteCard, origin?: string): string {
  const description = inviteDescription(card, instanceName);
  let page = renderIndexHtml(template, instanceName, origin)
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(`${card.spaceName} · ${instanceName}`)}</title>`);
  page = withMeta(page, 'name', 'description', description);
  page = withMeta(page, 'property', 'og:title', card.spaceName);
  page = withMeta(page, 'property', 'og:description', description);
  if (origin && card.iconPath) {
    page = withMeta(page, 'property', 'og:image', `${origin}${card.iconPath}`);
    // A square icon: the large card would stretch it across the preview.
    page = withMeta(page, 'name', 'twitter:card', 'summary');
  }
  return page;
}

/** The manifest JSON with `name` and `short_name` set from the instance name. */
export function renderManifest(template: string, name: string): string {
  const manifest = JSON.parse(template) as Record<string, unknown>;
  manifest.name = name;
  manifest.short_name = Array.from(name).slice(0, MAX_SHORT_NAME).join('');
  return JSON.stringify(manifest);
}

export interface WebDocuments {
  /** The page for `name`, or null when the build has no index.html. */
  index(name: string): string | null;
  /** The page for an invite link, or null when the build has no index.html. */
  invite(name: string, card: InviteCard): string | null;
  /** The manifest for `name`, or null when the build produced none. */
  manifest(name: string): string | null;
}

/** Reads the build once; the files do not change while the server runs. */
export function createWebDocuments(distPath: string, origin?: string): WebDocuments {
  const read = (file: string): string | null => {
    const full = path.join(distPath, file);
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  };
  const indexTemplate = read('index.html');
  const manifestTemplate = read('manifest.webmanifest');
  return {
    index: (name) => (indexTemplate === null ? null : renderIndexHtml(indexTemplate, name, origin)),
    invite: (name, card) => (indexTemplate === null ? null : renderInviteHtml(indexTemplate, name, card, origin)),
    manifest: (name) => {
      if (manifestTemplate === null) return null;
      try {
        return renderManifest(manifestTemplate, name);
      } catch (error) {
        // A manifest that does not parse is served as built rather than not at
        // all, and the build is what needs fixing, so say so.
        console.warn('manifest.webmanifest could not be parsed; serving it as built:', error);
        return manifestTemplate;
      }
    },
  };
}

/** Sends the page as a document the browser must revalidate (the name can change). */
export function sendIndex(reply: FastifyReply, html: string): FastifyReply {
  return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(html);
}

/**
 * Answers `/`, `/index.html` and `/manifest.webmanifest` with the instance's
 * own name in them. Registered before the static handler, which would otherwise
 * send those files exactly as the build wrote them. Anything else, and any
 * method other than GET and HEAD, falls through untouched.
 *
 * `/join/:code` is a route and not part of the hook: it looks up whatever code it
 * is asked for, so it counts against the rate limit like the API route that answers
 * the same question (a hook on `onRequest` would run ahead of the limiter). The link
 * is a private thing to have, so search engines are told to leave it out, in a
 * header and not in robots.txt: a service that honours that file would not fetch
 * the preview either. Only codes on this instance are looked up.
 */
export function registerWebDocumentRoutes(
  app: FastifyInstance,
  documents: WebDocuments,
  instanceName: () => string,
  inviteCard: (code: string) => InviteCard | null,
): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return;
    const pathname = request.url.split('?')[0];
    if (pathname === '/' || pathname === '/index.html') {
      const html = documents.index(instanceName());
      if (html === null) return;
      return sendIndex(reply, html);
    }
    if (pathname === '/manifest.webmanifest') {
      const manifest = documents.manifest(instanceName());
      if (manifest === null) return;
      return reply
        .type('application/manifest+json; charset=utf-8')
        .header('cache-control', 'no-cache')
        .send(manifest);
    }
  });

  app.get<{ Params: { code: string } }>('/join/:code', async (request, reply) => {
    const card = inviteCard(request.params.code);
    const html = card ? documents.invite(instanceName(), card) : documents.index(instanceName());
    if (html === null) return reply.callNotFound();
    reply.header('x-robots-tag', 'noindex');
    return sendIndex(reply, html);
  });
}
