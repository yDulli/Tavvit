/**
 * The public website's pages are rendered once, at build time (docs/systems/landing.md, "How it is
 * built"), long before anyone knows the address a server will answer at. Wherever such a page needs
 * that address (its canonical link, the whole address of its preview picture, the example a bot
 * would send) the build writes this token, and the server puts its own public origin in its place
 * on the way out (`utils/webDocument.ts`).
 */
export const SITE_ORIGIN_TOKEN = '%%TAVVIT_ORIGIN%%';

/** The public pages the website renders ahead of time, besides the product page at `/`. */
export const SITE_PUBLIC_PATHS = ['/status', '/help', '/changelog', '/roadmap'] as const;
export type SitePublicPath = (typeof SITE_PUBLIC_PATHS)[number];

/** Every page of the website, as the address it answers at. */
export const SITE_PATHS = ['/', ...SITE_PUBLIC_PATHS] as const;
export type SitePath = (typeof SITE_PATHS)[number];

/**
 * The page at a request path, or null. A trailing slash names the same page; the query plays no
 * part. Anything else (`/index.html`, `/status/x`) is not a page of the website.
 */
export function sitePathOf(pathname: string): SitePath | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return SITE_PATHS.find((candidate) => candidate === path) ?? null;
}

/**
 * The file the build writes for each page, inside the web build's hidden `.site` folder, which the
 * static file handler does not serve: the page only ever leaves through the server, with the origin
 * filled in.
 */
export const SITE_DOCUMENT_FILES: Readonly<Record<SitePath, string>> = {
  '/': 'index.html',
  '/status': 'status.html',
  '/help': 'help.html',
  '/changelog': 'changelog.html',
  '/roadmap': 'roadmap.html',
};

/** The folder of the web build that holds those files. */
export const SITE_DOCUMENT_DIR = '.site';

/** The picture a link to the website previews with: its path, size and what it shows. */
export const SOCIAL_CARD = {
  path: '/social-card.jpg',
  type: 'image/jpeg',
  width: 1200,
  height: 630,
  alt: 'Tavvit: make room for your people. Channels, voice, screen sharing and direct messages in one app.',
} as const;
