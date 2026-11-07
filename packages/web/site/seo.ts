import { PRODUCT_NAME } from '@backspace/shared/src/constants.js';
import { SITE_ORIGIN_TOKEN, SOCIAL_CARD, type SitePath, type SitePublicPath } from '@backspace/shared/src/site.js';
import changelog from '../src/locales/en/changelog.json';
import creators from '../src/locales/en/creators.json';
import help from '../src/locales/en/help.json';
import landing from '../src/locales/en/landing.json';
import roadmap from '../src/locales/en/roadmap.json';
import status from '../src/locales/en/status.json';

/**
 * What the website's pages say about themselves in their <head>: for a tab, a search engine and the
 * card a chat app shows when someone shares the link (docs/systems/landing.md, "Search and previews").
 *
 * Every word comes from the English catalogs the pages themselves use, so a preview never promises
 * what the page does not say; the page puts the visitor's own language in the tab once it runs.
 * What may be said is the page's rule: no price, nothing about hosting it yourself or open source, no
 * other app by name (landing.md, "What it may say").
 */
export interface SiteMeta {
  path: SitePath;
  /** The tab's title, and the preview's. */
  title: string;
  description: string;
  /** The page's own whole address, with the server's origin as `SITE_ORIGIN_TOKEN`. */
  url: string;
}

const PUBLIC_PAGES: Record<SitePublicPath, { title: string; lead: string }> = {
  '/status': status,
  '/help': help,
  '/changelog': changelog,
  '/roadmap': roadmap,
  '/creators': creators,
};

/** A whole address on this server, for a page or a file of the build. */
export function siteUrl(path: string): string {
  return `${SITE_ORIGIN_TOKEN}${path}`;
}

export function siteMeta(path: SitePath): SiteMeta {
  if (path === '/') {
    return { path, title: landing.meta.title, description: landing.meta.description, url: siteUrl('/') };
  }
  const page = PUBLIC_PAGES[path];
  // As the page writes it into the tab once it runs (publicPages/PublicPages.tsx, PageFrame).
  return { path, title: `${page.title} · ${PRODUCT_NAME}`, description: page.lead, url: siteUrl(path) };
}

/** The preview picture, at a whole address: a service fetching it from outside has no page to resolve a path against. */
export const SOCIAL_IMAGE = { ...SOCIAL_CARD, url: siteUrl(SOCIAL_CARD.path) };

/**
 * What a search engine reads as the site's name (schema.org `WebSite`). Only the product page
 * carries it: it describes the site, not a page. No price, rating or offer, since none is decided.
 */
export function websiteStructuredData(): string {
  // Written inside a <script> element: no `<` may close it early.
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: PRODUCT_NAME,
    url: siteUrl('/'),
    description: landing.meta.description,
    inLanguage: 'en',
  }).replace(/</g, '\\u003c');
}
