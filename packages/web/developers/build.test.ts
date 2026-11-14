// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOT_ROUTES, BOT_SOCKET_EVENTS } from '@backspace/shared/src/bots';
import { CARD_LIMITS } from '@backspace/shared/src/cards';
import { ERROR_CODES } from '@backspace/shared/src/errors';
import { PermissionBits } from '@backspace/shared/src/permissions';
import { buildSite, slugify } from './build.mjs';
import { APP_LINKS, PAGES } from './pages.mjs';

// The docs are made from the code where they can be, and held to it here where they cannot.

const CONTENT = fileURLToPath(new URL('./content', import.meta.url));
let site: string;

const read = (file: string) => fs.readFileSync(path.join(site, file), 'utf8');
const pageFile = (slug: string) => path.join('docs', `${slug}.html`);
const everyFile = () => ['home.html', ...PAGES.map((page) => pageFile(page.slug))];
/** Decoded words of a page. */
const words = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

beforeAll(() => {
  site = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-docs-')), 'developers');
  buildSite(site);
});

afterAll(() => {
  fs.rmSync(path.dirname(site), { recursive: true, force: true });
});

describe('the pages', () => {
  it('are one file for each entry, and no file without one', () => {
    const files = fs.readdirSync(CONTENT).map((file) => file.replace(/\.md$/, '')).sort();
    expect(files).toEqual(PAGES.map((page) => page.slug).sort());
  });

  it('each have a title and a description for search engines', () => {
    for (const page of PAGES) {
      const html = read(pageFile(page.slug));
      expect(html, page.slug).toContain(`<title>${page.title} · Tavvit developers</title>`);
      expect(html, page.slug).toContain('<meta name="description"');
      expect(html, page.slug).toContain(`<h1 class="docs-title">${page.title}</h1>`);
    }
    expect(read('home.html')).toContain('<title>Tavvit developers</title>');
  });

  it('are all in the side navigation of each', () => {
    const html = read(pageFile('overview'));
    for (const page of PAGES) expect(html).toContain(`href="/developers/docs/${page.slug}"`);
  });

  it('leave no placeholder behind', () => {
    for (const file of everyFile()) expect(read(file), file).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe('what the pages say', () => {
  it('covers every route open to a token, with what it takes', () => {
    const html = words(read(pageFile('rest')));
    for (const route of BOT_ROUTES) {
      expect(html, route.path).toContain(`${route.method} ${route.path}`);
      expect(html, route.path).toContain(route.summary);
      if (route.permission) expect(html, route.path).toContain(route.permission);
    }
  });

  it('covers everything a bot may say on the socket', () => {
    const html = words(read(pageFile('socket')));
    for (const event of BOT_SOCKET_EVENTS) expect(html).toContain(event);
  });

  it('lists every right with its number', () => {
    const html = words(read(pageFile('permissions')));
    for (const [name, bit] of Object.entries(PermissionBits)) {
      expect(html, name).toContain(name);
      expect(html, name).toContain(bit.toString());
    }
  });

  it('never offers administrator in the calculator', () => {
    const html = read(pageFile('permissions'));
    const calculator = html.slice(html.indexOf('id="calculator"'));
    expect(calculator).not.toContain(`value="${PermissionBits.ADMINISTRATOR}"`);
    expect(calculator).toContain(`value="${PermissionBits.SEND_MESSAGES}"`);
  });

  it('states the limits of cards as the code has them', () => {
    const html = words(read(pageFile('cards')));
    for (const limit of Object.values(CARD_LIMITS)) expect(html).toContain(String(limit));
  });

  it('lists every error code', () => {
    const html = read(pageFile('errors'));
    for (const code of ERROR_CODES) expect(html, code).toContain(`<code>${code}</code>`);
  });

  it('names no code the server does not have', () => {
    const known = new Set<string>(ERROR_CODES);
    for (const page of PAGES) {
      const markdown = fs.readFileSync(path.join(CONTENT, `${page.slug}.md`), 'utf8');
      for (const match of markdown.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
        const name = match[1] ?? '';
        if (/_(reached|invalid|forbidden|disabled|suspended|found|limited|offline|owned|full|large|active)$/.test(name)) {
          expect(known.has(name), `${page.slug}: ${name}`).toBe(true);
        }
      }
    }
  });
});

describe('the links', () => {
  it('all lead somewhere', () => {
    for (const file of everyFile()) {
      const html = read(file);
      for (const match of html.matchAll(/<a[^>]* href="([^"]+)"/g)) {
        const href = (match[1] ?? '').replace(/&amp;/g, '&');
        if (/^https?:/.test(href)) continue;
        const [address = '', anchor] = href.split('#');
        const docs = /^\/developers\/docs\/([\w-]+)$/.exec(address);
        if (docs) {
          expect(PAGES.some((page) => page.slug === docs[1]), `${file}: ${href}`).toBe(true);
          if (anchor) expect(read(pageFile(docs[1] ?? '')), `${file}: ${href}`).toContain(`id="${anchor}"`);
        } else if (address === '') {
          expect(html, `${file}: ${href}`).toContain(`id="${anchor}"`);
        } else {
          expect(APP_LINKS, `${file}: ${href}`).toContain(address);
        }
      }
    }
  });

  it('elsewhere tell that site nothing', () => {
    for (const file of everyFile()) {
      for (const match of read(file).matchAll(/<a[^>]* href="https?:[^"]+"[^>]*>/g)) {
        expect(match[0], file).toContain('rel="noopener noreferrer"');
      }
    }
  });
});

describe('what a visitor loads', () => {
  it('is only this server\'s own, with no inline script or style', () => {
    for (const file of everyFile()) {
      const html = read(file);
      for (const match of html.matchAll(/<script[^>]*>/g)) expect(match[0], file).toContain('src="/developers/assets/docs.js"');
      expect(html, file).not.toMatch(/<script[^>]*>[^<]+<\/script>/);
      expect(html, file).not.toMatch(/\son\w+="/);
      expect(html, file).not.toMatch(/\sstyle="/);
      expect(html, file).not.toMatch(/<(?:img|link|script)[^>]+(?:src|href)="https?:/);
    }
  });

  it('holds its assets beside it', () => {
    for (const asset of ['docs.css', 'docs.js', 'grain.svg', 'example-bot.mjs', 'search-index.json']) {
      expect(fs.existsSync(path.join(site, 'assets', asset)), asset).toBe(true);
    }
  });

  it('can be searched, by page and by heading', () => {
    const index = JSON.parse(read('assets/search-index.json')) as Array<{ slug: string; headings: Array<{ text: string; id: string }> }>;
    expect(index.map((page) => page.slug)).toEqual(PAGES.map((page) => page.slug));
    const commands = index.find((page) => page.slug === 'commands');
    expect(commands?.headings.map((heading) => heading.text)).toContain('Options');
    for (const page of index) {
      for (const heading of page.headings) {
        expect(read(pageFile(page.slug)), `${page.slug}#${heading.id}`).toContain(`id="${heading.id}"`);
      }
    }
  });
});

describe('a heading\'s address', () => {
  it('is plain', () => {
    expect(slugify('GET /api/bots/@me')).toBe('get-api-bots-me');
    expect(slugify('What `type` means')).toBe('what-type-means');
  });
});
