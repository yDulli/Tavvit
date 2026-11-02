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
} from '../src/utils/webDocument.js';

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
    for (const path of ['/assets/index-abc.js', '/fonts/Geist-Latin.woff2', '/icons/mark.svg', '/sounds/join.ogg', '/assets/a.js?v=1']) {
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
<meta property="og:image" content="/og-image.jpg" />
<meta name="twitter:card" content="summary_large_image" />
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
  });

  it('keeps the product picture for a space without an icon, and says how many are in one without a description', () => {
    const page = renderInviteHtml(INVITE_TEMPLATE, 'Tavvit', { ...CARD, description: null, memberCount: 1, iconPath: null }, 'https://tavvit.com');
    expect(page).toContain('<meta property="og:description" content="1 member on Tavvit" />');
    expect(page).toContain('<meta property="og:image" content="https://tavvit.com/og-image.jpg" />');
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
});
