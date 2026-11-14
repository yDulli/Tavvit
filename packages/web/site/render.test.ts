// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN_TOKEN, SITE_PATHS, SITE_PUBLIC_PATHS, SOCIAL_CARD } from '@backspace/shared/src/site.js';
import en from '../src/locales/en/landing.json';
import { renderLanding, renderPublicPage } from './render';
import { siteMeta, websiteStructuredData } from './seo';

/**
 * The website's pages are rendered while the web package is built, in Node, where there is no
 * window: whatever a page needs from a browser must wait until it runs there
 * (docs/systems/landing.md, "How it is built"). This renders them as the build does.
 */
const here = dirname(fileURLToPath(import.meta.url));

describe('the website, rendered while building', () => {
  it('renders the product page with no browser around', () => {
    expect(typeof window).toBe('undefined');
    const html = renderLanding();
    // The page moves until someone says otherwise: the footer's switch and the system's setting are read in a browser.
    expect(html).toContain('<div id="lp" data-motion="on">');
    // The opening's lines, as the catalog breaks them, and the last one in a tone of its own.
    for (const line of en.home.hero.title.split('\n')) expect(html).toContain(`<span class="lp-line">${line}</span>`);
    expect(html).toContain(`<span class="lp-line lp-hero-accent">${en.home.hero.accent}</span>`);
    expect(html).toMatch(/<h1 [^>]*id="landing-title"[^>]*><span class="lp-line">/);
    expect(html).toContain(en.questions.title);
    // Both of the choices by device are in it; the stylesheet shows one.
    for (const name of ['lp-for-windows', 'lp-not-windows']) expect(html).toContain(name);
    // What is inside can be chosen: its four parts are tabs, in the HTML before any script.
    expect(html.match(/ role="tab"/g) ?? []).toHaveLength(4);
    // The questions open without a script: each is a <details>.
    expect(html.match(/<details/g) ?? []).toHaveLength(Object.keys(en.questions.items).length);
    // The example a bot would send names this server, which fills in its own address.
    expect(html).toContain(`${SITE_ORIGIN_TOKEN}/api/`);
    // Nothing is hidden until a script runs: a reader without one sees every part.
    expect(html).not.toContain('data-arrivals');
    expect(html).not.toContain('data-in=');
  });

  it.each(SITE_PUBLIC_PATHS)('renders %s with no browser around', (path) => {
    const html = renderPublicPage(path);
    // The page's name as its heading, written as HTML writes text.
    const name = (siteMeta(path).title.split(' · ')[0] ?? '').replace(/&/g, '&amp;').replace(/'/g, '&#x27;');
    expect(html).toContain(`<h1 class="page-title display-title">${name}</h1>`);
    expect(html.length).toBeGreaterThan(500);
  });
});

describe('what the pages say about themselves', () => {
  it('describes each page with its own catalog\'s words, at its own address', () => {
    expect(siteMeta('/')).toMatchObject({ title: en.meta.title, description: en.meta.description, url: `${SITE_ORIGIN_TOKEN}/` });
    for (const path of SITE_PUBLIC_PATHS) {
      expect(siteMeta(path).url).toBe(`${SITE_ORIGIN_TOKEN}${path}`);
      expect(siteMeta(path).title).toMatch(/ · Tavvit$/);
    }
  });

  it('promises nothing the product page may not say', () => {
    // landing.md, "What it may say": no price, not self-hosted, not open source, no other app by name.
    const said = [
      ...SITE_PATHS.map((path) => `${siteMeta(path).title} ${siteMeta(path).description}`),
      SOCIAL_CARD.alt,
      websiteStructuredData(),
      readFileSync(join(here, '../../../scripts/landing-shots/social-card.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, ''),
    ].join('\n');
    for (const word of [/\bfree\b/i, /price/i, /self-host/i, /open.source/i, /discord/i]) expect(said).not.toMatch(word);
  });

  it('gives the app\'s page the same preview picture as the website\'s', () => {
    const index = readFileSync(join(here, '../index.html'), 'utf8');
    expect(index).toContain(`<meta property="og:image" content="${SOCIAL_CARD.path}" />`);
    expect(index).toContain(`<meta name="twitter:image" content="${SOCIAL_CARD.path}" />`);
    expect(index).toContain(`<meta property="og:image:width" content="${SOCIAL_CARD.width}" />`);
    expect(index).toContain(`<meta property="og:image:height" content="${SOCIAL_CARD.height}" />`);
    expect(index).toContain(`<meta property="og:image:alt" content="${SOCIAL_CARD.alt}" />`);
    expect(index).toContain(`<meta name="twitter:image:alt" content="${SOCIAL_CARD.alt}" />`);
    expect(index).toContain('<link rel="icon" href="/favicon.ico"');
  });

  it('writes no `<` into the structured data, which stands inside a <script>', () => {
    expect(websiteStructuredData()).not.toContain('<');
    expect(JSON.parse(websiteStructuredData())).toMatchObject({ '@type': 'WebSite', name: 'Tavvit', url: `${SITE_ORIGIN_TOKEN}/` });
  });
});
