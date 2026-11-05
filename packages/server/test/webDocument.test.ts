import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isStaticAssetPath,
  createWebDocuments,
  escapeHtml,
  registerWebDocumentRoutes,
  renderIndexHtml,
  renderInviteHtml,
  renderManifest,
  renderSiteHtml,
} from '../src/utils/webDocument.js';
import { SITE_DOCUMENT_DIR, SITE_DOCUMENT_FILES, SITE_ORIGIN_TOKEN, SITE_PATHS } from '@backspace/shared/src/site.js';

// The page and manifest are the first thing a browser gets, before any script:
// they must wear the instance's name, and they must not let a name become markup.

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta name="apple-mobile-web-app-title" content="Tavvit" />
    <title>Tavvit</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const MANIFEST = JSON.stringify({ name: 'Tavvit', short_name: 'Tavvit', display: 'standalone', icons: [{ src: '/a.png' }] });

describe('isStaticAssetPath', () => {
  it('knows the folders of the built page', () => {
    for (const path of ['/assets/index-abc.js', '/_astro/index.abc.js', '/fonts/Geist-Latin.woff2', '/icons/mark.svg', '/sounds/join.ogg', '/assets/a.js?v=1']) {
      expect(isStaticAssetPath(path)).toBe(true);
    }
  });

  it('leaves everything else to the rate limit', () => {
    for (const path of ['/', '/api/auth/login', '/api/assets/x', '/uploads/a.png', '/assets', '/fontsomething', '/ws']) {
      expect(isStaticAssetPath(path)).toBe(false);
    }
  });
});

describe('escapeHtml', () => {
  it('escapes everything that can end an attribute or open a tag', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('renderIndexHtml', () => {
  it('sets the title and the iOS home-screen title', () => {
    const html = renderIndexHtml(TEMPLATE, 'Friend Club');
    expect(html).toContain('<title>Friend Club</title>');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Friend Club" />');
    expect(html).not.toContain('>Tavvit<');
  });

  it('cannot be turned into markup by a name', () => {
    const html = renderIndexHtml(TEMPLATE, '</title><script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>');
  });

  it('cannot break out of the meta attribute', () => {
    const html = renderIndexHtml(TEMPLATE, '" onload="alert(1)');
    expect(html).toContain('content="&quot; onload=&quot;alert(1)"');
    expect(html).not.toMatch(/content="" onload=/);
  });

  it('takes a name containing replacement patterns literally', () => {
    expect(renderIndexHtml(TEMPLATE, "Fun $& $1 $' Games")).toContain("<title>Fun $&amp; $1 $&#39; Games</title>");
  });

  it('leaves the rest of the page alone', () => {
    const html = renderIndexHtml(TEMPLATE, 'X');
    expect(html).toContain('<div id="root"></div>');
    expect(html.replace('X', 'Tavvit').replace('X', 'Tavvit')).toBe(TEMPLATE);
  });
});

describe('renderIndexHtml and the preview picture', () => {
  const page = `<head>
<meta property="og:image" content="/social-card.jpg" />
<meta name="twitter:image" content="/social-card.jpg" />
<title>Tavvit</title>
</head>`;

  it('gives both preview pictures a whole address', () => {
    const html = renderIndexHtml(page, 'Tavvit', 'https://chat.example');
    expect(html).toContain('<meta property="og:image" content="https://chat.example/social-card.jpg" />');
    expect(html).toContain('<meta name="twitter:image" content="https://chat.example/social-card.jpg" />');
  });

  it('leaves them as paths when the server does not know its address', () => {
    expect(renderIndexHtml(page, 'Tavvit')).toContain('<meta name="twitter:image" content="/social-card.jpg" />');
  });
});

describe('renderSiteHtml', () => {
  const page = `<html data-origin="${SITE_ORIGIN_TOKEN}"><head><link rel="canonical" href="${SITE_ORIGIN_TOKEN}/" />`
    + `<meta property="og:image" content="${SITE_ORIGIN_TOKEN}/social-card.jpg" /></head>`
    + `<body><pre>curl ${SITE_ORIGIN_TOKEN}/api/bots</pre></body></html>`;

  it('puts the server\'s origin wherever the build left the token', () => {
    const html = renderSiteHtml(page, 'https://tavvit.com');
    expect(html).not.toContain(SITE_ORIGIN_TOKEN);
    expect(html).toContain('data-origin="https://tavvit.com"');
    expect(html).toContain('<link rel="canonical" href="https://tavvit.com/" />');
    expect(html).toContain('content="https://tavvit.com/social-card.jpg"');
    expect(html).toContain('curl https://tavvit.com/api/bots');
  });

  it('leaves paths when the origin is not known, and an origin cannot become markup', () => {
    expect(renderSiteHtml(page)).toContain('<link rel="canonical" href="/" />');
    expect(renderSiteHtml(page, 'https://x"><script>')).not.toContain('<script>');
  });
});

describe('renderManifest', () => {
  it('sets the name and a short name', () => {
    const manifest = JSON.parse(renderManifest(MANIFEST, 'Friend Club'));
    expect(manifest.name).toBe('Friend Club');
    expect(manifest.short_name).toBe('Friend Club');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toEqual([{ src: '/a.png' }]);
  });

  it('shortens a long name to what a home screen can show', () => {
    const manifest = JSON.parse(renderManifest(MANIFEST, 'The Very Long Name Club'));
    expect(manifest.name).toBe('The Very Long Name Club');
    expect(manifest.short_name).toBe('The Very Lon');
  });

  it('does not cut an emoji in half', () => {
    const manifest = JSON.parse(renderManifest(MANIFEST, '🚀'.repeat(20)));
    expect(manifest.short_name).toBe('🚀'.repeat(12));
  });
});

describe('createWebDocuments', () => {
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

  function dist(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-dist-'));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    return dir;
  }

  it('renders both documents from a build', () => {
    const docs = createWebDocuments(dist({ 'index.html': TEMPLATE, 'manifest.webmanifest': MANIFEST }));
    expect(docs.index('A')).toContain('<title>A</title>');
    expect(JSON.parse(docs.manifest('A')!).name).toBe('A');
  });

  it('says so, with null, when the build lacks a file', () => {
    const docs = createWebDocuments(dist({}));
    expect(docs.index('A')).toBeNull();
    expect(docs.manifest('A')).toBeNull();
    for (const sitePath of SITE_PATHS) expect(docs.site(sitePath)).toBeNull();
  });

  it('reads the website\'s pages from the hidden folder and fills in the origin', () => {
    const dir = dist({ 'index.html': TEMPLATE });
    fs.mkdirSync(path.join(dir, SITE_DOCUMENT_DIR));
    fs.writeFileSync(path.join(dir, SITE_DOCUMENT_DIR, SITE_DOCUMENT_FILES['/']), `<link rel="canonical" href="${SITE_ORIGIN_TOKEN}/" />`);
    fs.writeFileSync(path.join(dir, SITE_DOCUMENT_DIR, SITE_DOCUMENT_FILES['/help']), 'Help');
    const docs = createWebDocuments(dir, 'https://tavvit.com');
    expect(docs.site('/')).toBe('<link rel="canonical" href="https://tavvit.com/" />');
    expect(docs.site('/help')).toBe('Help');
    expect(docs.site('/status')).toBeNull();
    // The app's page is still the app's.
    expect(docs.index('A')).toContain('<title>A</title>');
  });

  it('serves a manifest that does not parse as built, and says so', () => {
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      const docs = createWebDocuments(dist({ 'manifest.webmanifest': '{ not json' }));
      expect(docs.manifest('A')).toBe('{ not json');
    } finally {
      console.warn = original;
    }
    expect(String(warnings[0]?.[0])).toContain('could not be parsed');
  });
});

const INVITE_TEMPLATE = `<!DOCTYPE html>
<html><head>
<meta name="description" content="The product." />
<meta name="apple-mobile-web-app-title" content="Tavvit" />
<meta property="og:title" content="Tavvit" />
<meta property="og:description" content="The product." />
<meta property="og:image" content="/social-card.jpg" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="The product." />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Tavvit" />
<meta name="twitter:description" content="The product." />
<meta name="twitter:image" content="/social-card.jpg" />
<meta name="twitter:image:alt" content="The product." />
<title>Tavvit</title>
</head><body></body></html>`;

const CARD = { spaceName: 'Night Shift', description: 'Co-op games and bad movies.', memberCount: 8, iconPath: '/api/uploads/icon.webp' };

describe('renderInviteHtml', () => {
  it('names the space, its description and its members, and shows its icon at a whole address', () => {
    const page = renderInviteHtml(INVITE_TEMPLATE, 'Tavvit', CARD, 'https://tavvit.com');
    expect(page).toContain('<title>Night Shift · Tavvit</title>');
    expect(page).toContain('<meta property="og:title" content="Night Shift" />');
    expect(page).toContain('<meta property="og:description" content="Co-op games and bad movies. · 8 members" />');
    expect(page).toContain('<meta name="description" content="Co-op games and bad movies. · 8 members" />');
    expect(page).toContain('<meta property="og:image" content="https://tavvit.com/api/uploads/icon.webp" />');
    expect(page).toContain('<meta name="twitter:card" content="summary" />');
    expect(page).toContain('<meta name="apple-mobile-web-app-title" content="Tavvit" />');
    // X reads its own tags first: they say the same, and the icon's size is not the product picture's.
    expect(page).toContain('<meta name="twitter:title" content="Night Shift" />');
    expect(page).toContain('<meta name="twitter:image" content="https://tavvit.com/api/uploads/icon.webp" />');
    expect(page).toContain('<meta property="og:image:alt" content="Night Shift" />');
    expect(page).not.toContain('og:image:width');
    expect(page).not.toContain('og:image:height');
    expect(page).not.toContain('og:image:type');
  });

  it('keeps the product picture for a space without an icon, and says how many are in one without a description', () => {
    const page = renderInviteHtml(INVITE_TEMPLATE, 'Tavvit', { ...CARD, description: null, memberCount: 1, iconPath: null }, 'https://tavvit.com');
    expect(page).toContain('<meta property="og:description" content="1 member on Tavvit" />');
    expect(page).toContain('<meta property="og:image" content="https://tavvit.com/social-card.jpg" />');
    expect(page).toContain('<meta name="twitter:image" content="https://tavvit.com/social-card.jpg" />');
    expect(page).toContain('<meta property="og:image:width" content="1200" />');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it('does not let a space name or description become markup', () => {
    const hostile = '"><script>alert(1)</script>';
    const page = renderInviteHtml(INVITE_TEMPLATE, 'Tavvit', { ...CARD, spaceName: hostile, description: hostile }, 'https://tavvit.com');
    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;');
  });

  it('cuts a long description and folds its lines', () => {
    const page = renderInviteHtml(INVITE_TEMPLATE, 'Tavvit', { ...CARD, description: `line one\n\n${'x'.repeat(400)}` }, 'https://tavvit.com');
    const description = /og:description" content="([^"]*)"/.exec(page)?.[1] ?? '';
    expect(description.startsWith('line one x')).toBe(true);
    expect(description).toContain('…');
    expect(Array.from(description).length).toBeLessThan(200);
  });
});

describe('registerWebDocumentRoutes', () => {
  async function app(name: () => string) {
    const instance = Fastify();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-dist-'));
    fs.writeFileSync(path.join(dir, 'index.html'), TEMPLATE);
    fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), MANIFEST);
    registerWebDocumentRoutes(instance, createWebDocuments(dir), name, (code) => (code === 'good1234' ? CARD : null));
    instance.get('/api/ping', async () => ({ ok: true }));
    await instance.ready();
    return { instance, dir };
  }

  it('answers / and /index.html with the instance name, as a document to revalidate', async () => {
    const { instance, dir } = await app(() => 'Friend Club');
    try {
      for (const url of ['/', '/index.html', '/?utm=x']) {
        const res = await instance.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.body, url).toContain('<title>Friend Club</title>');
      }
    } finally {
      await instance.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers an invite link as a page for the app, and asks search engines to leave it out', async () => {
    const { instance, dir } = await app(() => 'Friend Club');
    try {
      for (const url of ['/join/good1234', '/join/nosuchcode']) {
        const res = await instance.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.headers['x-robots-tag']).toBe('noindex');
      }
      expect((await instance.inject({ method: 'GET', url: '/join/good1234' })).body).toContain('<title>Night Shift · Friend Club</title>');
      expect((await instance.inject({ method: 'GET', url: '/join/nosuchcode' })).body).toContain('<title>Friend Club</title>');
    } finally {
      await instance.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers /manifest.webmanifest with the instance name', async () => {
    const { instance, dir } = await app(() => 'Friend Club');
    try {
      const res = await instance.inject({ method: 'GET', url: '/manifest.webmanifest' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/manifest+json');
      expect(JSON.parse(res.body).name).toBe('Friend Club');
    } finally {
      await instance.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads the name on every request, so a rename shows without a restart', async () => {
    let name = 'First';
    const { instance, dir } = await app(() => name);
    try {
      expect((await instance.inject({ method: 'GET', url: '/' })).body).toContain('<title>First</title>');
      name = 'Second';
      expect((await instance.inject({ method: 'GET', url: '/' })).body).toContain('<title>Second</title>');
    } finally {
      await instance.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves other paths and other methods alone', async () => {
    const { instance, dir } = await app(() => 'Friend Club');
    try {
      expect((await instance.inject({ method: 'GET', url: '/api/ping' })).json()).toEqual({ ok: true });
      expect((await instance.inject({ method: 'POST', url: '/' })).statusCode).toBe(404);
      expect((await instance.inject({ method: 'GET', url: '/index.html.bak' })).statusCode).toBe(404);
    } finally {
      await instance.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers HEAD with the same headers', async () => {
    const { instance, dir } = await app(() => 'Friend Club');
    try {
      const res = await instance.inject({ method: 'HEAD', url: '/' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
    } finally {
      await instance.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers the website\'s pages as the build rendered them, and keeps /index.html the app\'s', async () => {
    const { instance, dir } = await app(() => 'Friend Club');
    fs.mkdirSync(path.join(dir, SITE_DOCUMENT_DIR));
    for (const sitePath of SITE_PATHS) {
      fs.writeFileSync(path.join(dir, SITE_DOCUMENT_DIR, SITE_DOCUMENT_FILES[sitePath]), `<p>page ${sitePath}</p><a href="${SITE_ORIGIN_TOKEN}${sitePath}">`);
    }
    // The documents are read when the server starts.
    const site = Fastify();
    registerWebDocumentRoutes(site, createWebDocuments(dir, 'https://tavvit.com'), () => 'Friend Club', () => null);
    await site.ready();
    try {
      for (const [url, sitePath] of [['/', '/'], ['/?ref=x', '/'], ['/status', '/status'], ['/help/', '/help'], ['/changelog?x=1', '/changelog'], ['/roadmap', '/roadmap']] as const) {
        const res = await site.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        expect(res.headers['content-type'], url).toContain('text/html');
        expect(res.headers['cache-control'], url).toBe('no-cache');
        expect(res.body, url).toBe(`<p>page ${sitePath}</p><a href="https://tavvit.com${sitePath}">`);
      }
      // The service worker keeps /index.html as the app's shell: it must stay the app's page.
      const shell = await site.inject({ method: 'GET', url: '/index.html' });
      expect(shell.body).toContain('<title>Friend Club</title>');
      // Only the pages themselves: a path below one is the app's to answer.
      expect((await site.inject({ method: 'GET', url: '/status/x' })).statusCode).toBe(404);
    } finally {
      await site.close();
      await instance.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers / with the app\'s page and leaves the public pages to the app when the build has no website', async () => {
    const { instance, dir } = await app(() => 'Friend Club');
    try {
      expect((await instance.inject({ method: 'GET', url: '/' })).body).toContain('<title>Friend Club</title>');
      expect((await instance.inject({ method: 'GET', url: '/status' })).statusCode).toBe(404);
    } finally {
      await instance.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
