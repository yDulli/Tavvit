#!/usr/bin/env node
/**
 * The browser half of checking a release, against a demo instance on a production
 * build. It prints only what failed. It is separate from scripts/release-check.mjs
 * because it needs that instance running.
 *
 *   node scripts/release-check-browser.mjs <seed.json>                 the doors, and the pictures
 *   node scripts/release-check-browser.mjs <seed.json> --doors-only    the doors alone
 *
 * The doors: who lands where on the way in (a visitor, someone signed in, the
 * desktop app, an installed web app), that signing in and signing up work from the
 * product page, what a visitor downloads, the headers of the page and of an invite
 * link, an address that leads nowhere, and changing language in place.
 *
 * The pictures: the app's main states are taken and compared with those of the last
 * run, in `dist/release-check/` (ignored by git). Only a picture that changed by more
 * than a few percent is named, so a person opens that picture and no others. The first
 * run has nothing to compare with and only leaves its pictures behind.
 *
 * The instance is the one scripts/landing-shots/README.md describes: a scratch database,
 * invented people, `seed.mjs`, `presence.mjs` for those who are online. Run
 * `npx vite build` in packages/web first and start the server after it: the server
 * reads the built page once, at its start.
 *
 * Environment: WEB_URL (http://localhost:3005), PLAYWRIGHT_PREFIX (where
 * playwright-core is installed, outside the project), CHROME_PATH.
 */
/* global document, localStorage, requestAnimationFrame, sessionStorage, window -- what `page.evaluate` and init scripts run in the browser */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(process.env.PLAYWRIGHT_PREFIX ?? process.cwd(), 'package.json'))('playwright-core');
const sharp = createRequire(path.join(ROOT, 'package.json'))('sharp');

const [seedFile, ...options] = process.argv.slice(2);
if (!seedFile) {
  console.error('Usage: node scripts/release-check-browser.mjs <seed.json> [--doors-only]');
  process.exit(2);
}
const WEB = process.env.WEB_URL ?? 'http://localhost:3005';
const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
const dist = path.join(ROOT, 'packages', 'web', 'dist');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
/** A picture is named when more than this share of its pixels changed, in percent. */
const PICTURE_CHANGED = 3;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const failures = [];
let passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failures.push(`FAIL ${name}${detail ? `  (${detail})` : ''}`);
};

async function visit(url, { token = null, init = null, wait = 1500, viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'en-US' });
  // Once per tab: on a later load the session is whatever the page left behind.
  await ctx.addInitScript(([t]) => {
    if (t && !sessionStorage.getItem('seeded')) {
      localStorage.setItem('backspace_token', t);
      sessionStorage.setItem('seeded', '1');
    }
    localStorage.setItem('backspace-language', 'en');
  }, [token]);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(WEB + url);
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(wait);
  return { ctx, page, errors, requests };
}

const landed = (page) => page.evaluate(() => document.documentElement.dataset.page === 'landing');
const at = (page) => new URL(page.url()).pathname;

// ── A visitor ────────────────────────────────────────────────────────────────
{
  const { ctx, page, errors, requests } = await visit('/');
  check('visitor on / sees the product page', await landed(page), at(page));
  check('no page errors', errors.length === 0, errors[0]);
  const foreign = requests.filter((u) => !u.startsWith(WEB) && !u.startsWith('data:'));
  check('nothing from other servers', foreign.length === 0, foreign[0]);
  const local = requests.filter((u) => u.startsWith(WEB)).map((u) => new URL(u).pathname);
  const js = local.filter((p) => p.endsWith('.js'));
  const gz = (p) => zlib.gzipSync(fs.readFileSync(path.join(dist, p))).length;
  const jsGz = js.reduce((sum, p) => sum + gz(p), 0);
  check('JS at most 150 KB gzipped', jsGz <= 150 * 1024, `${Math.round(jsGz / 1024)} KB`);
  check('no app chunk', !js.some((p) => /appBoot|authStore|native-/.test(p)));

  // Log in, from the page.
  await page.getByRole('link', { name: 'Log in' }).first().click();
  await page.waitForURL('**/login');
  await page.waitForTimeout(800);
  check('Log in leads to the sign-in form', at(page) === '/login' && !(await landed(page)));
  await page.locator('input[type="text"], input[autocomplete="username"]').first().fill('mara');
  await page.locator('input[type="password"]').first().fill(seed.password);
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).first().click();
  await page.waitForURL('**/channels/**', { timeout: 10000 }).catch(() => {});
  check('signing in reaches the app', at(page).startsWith('/channels'), at(page));
  await ctx.close();
}
{
  const { ctx, page } = await visit('/');
  await page.getByRole('link', { name: 'Get started' }).first().click();
  await page.waitForURL('**/register');
  await page.waitForTimeout(800);
  check('Get started leads to registration', at(page) === '/register');
  const name = `visitor${Date.now() % 100000}`;
  check('the registration form renders', (await page.locator('input').count()) >= 2);
  await page.locator('input[autocomplete="username"]').fill(name);
  await page.locator('input[type="password"]').nth(0).fill('a-long-demo-password-123');
  await page.locator('input[type="password"]').nth(1).fill('a-long-demo-password-123');
  await page.getByRole('button', { name: /continue/i }).first().click();
  await page.waitForTimeout(1500);
  const secondStep = await page.getByRole('button', { name: /skip|finish|done|get started|continue/i }).first();
  if (await secondStep.count()) { await secondStep.click().catch(() => {}); await page.waitForTimeout(1500); }
  await page.waitForURL('**/channels/**', { timeout: 8000 }).catch(() => {});
  check('registering from the page ends in the app', at(page).startsWith('/channels'), at(page));
  const token = await page.evaluate(() => localStorage.getItem('backspace_token'));
  check('and leaves a session behind', typeof token === 'string' && token.length > 10);
  await page.goto(WEB + '/');
  await page.waitForTimeout(1500);
  check('a new member on / now gets the app', !(await landed(page)) && at(page).startsWith('/channels'), at(page));
  await ctx.close();
}
for (const url of ['/channels/@me', '/friends']) {
  const { ctx, page } = await visit(url);
  check(`visitor on ${url} is sent to sign in`, at(page) === '/login', at(page));
  await ctx.close();
}
// A link from a mail works for anyone, signed in or not, and asks nothing of the session.
for (const url of ['/verify-email', '/reset-password', '/forgot-password']) {
  const { ctx, page } = await visit(url);
  check(`visitor on ${url} stays there`, at(page) === url, at(page));
  await ctx.close();
}

for (const url of ['/imprint', '/privacy', '/terms', '/report', '/download']) {
  const { ctx, page, errors } = await visit(url);
  check(`visitor can read ${url}`, at(page) === url && errors.length === 0, errors[0] ?? at(page));
  if (url === '/imprint') {
    await page.getByRole('button', { name: /back/i }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    check('Back on a legal page returns to the product page', await landed(page), at(page));
  }
  await ctx.close();
}
{
  const { ctx, page } = await visit('/join/doesnotexist');
  check('a visitor keeps an invite link', at(page).startsWith('/join/'), at(page));
  await ctx.close();
}

// ── A member ─────────────────────────────────────────────────────────────────
for (const url of ['/', '/login']) {
  const { ctx, page, errors } = await visit(url, { token: seed.users.mara.token });
  check(`signed in on ${url} goes to the app`, at(page).startsWith('/channels') && !(await landed(page)), at(page));
  check('  without page errors', errors.length === 0, errors[0]);
  await ctx.close();
}
{
  const { ctx, page } = await visit('/', { token: 'expired.or.wrong' });
  check('an expired session on / ends at sign-in', at(page) === '/login', at(page));
  await ctx.close();
}

// ── Not a browser tab ────────────────────────────────────────────────────────
{
  const { ctx, page } = await visit('/', { init: () => { window.backspace = { platform: 'win32', rendererReady: () => { window.__ready = true; } }; } });
  check('desktop app without a token: no product page', !(await landed(page)), at(page));
  check('desktop app: the app says it is ready', await page.evaluate(() => window.__ready === true));
  await ctx.close();
}
{
  const { ctx, page } = await visit('/', { token: seed.users.mara.token, init: () => { window.backspace = { platform: 'win32', rendererReady: () => { window.__ready = true; } }; } });
  check('desktop app with a token: the app', at(page).startsWith('/channels'), at(page));
  await ctx.close();
}
{
  const { ctx, page } = await visit('/', { init: () => { const real = window.matchMedia.bind(window); window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { matches: true, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q)); } });
  check('installed web app: no product page', !(await landed(page)), at(page));
  await ctx.close();
}

// ── Headers ──────────────────────────────────────────────────────────────────
{
  const html = await fetch(WEB + '/').then((r) => r.text());
  const script = html.match(/src="(\/(?:assets|_astro)\/[^"]+\.js)"/)?.[1];
  const res = await fetch(WEB + script);
  check('a hashed file is cached for a year', /max-age=31536000/.test(res.headers.get('cache-control') ?? ''), res.headers.get('cache-control'));
  const app = await fetch(WEB + '/index.html').then((r) => r.text());
  const appScript = app.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  check('  and the app\'s too', appScript !== undefined && /max-age=31536000/.test((await fetch(WEB + appScript)).headers.get('cache-control') ?? ''), appScript);
  const font = await fetch(WEB + '/fonts/Geist-Latin.woff2');
  check('a typeface is cached for a week', /max-age=604800/.test(font.headers.get('cache-control') ?? ''), font.headers.get('cache-control'));
  const doc = await fetch(WEB + '/');
  check('the page itself is revalidated', /no-cache/.test(doc.headers.get('cache-control') ?? ''), doc.headers.get('cache-control'));
  check('the preview picture has a whole address', /og:image" content="https?:\/\/[^"]+\/social-card\.jpg"/.test(html), html.match(/og:image" content="[^"]*"/)?.[0]);
  check('  and X is told the same', /twitter:image" content="https?:\/\/[^"]+\/social-card\.jpg"/.test(html) && /twitter:card" content="summary_large_image"/.test(html));
  check('  with its size and what it shows', /og:image:width" content="1200"/.test(html) && /og:image:height" content="630"/.test(html) && /og:image:alt" content="[^"]+"/.test(html));
  check('the page names its own whole address', /rel="canonical" href="https?:\/\/[^"]+\/"/.test(html) && /og:url" content="https?:\/\/[^"]+\/"/.test(html), html.match(/rel="canonical" href="[^"]*"/)?.[0]);
  check('  and the build\'s token is gone everywhere', !html.includes('%%TAVVIT_ORIGIN%%'));
  check('the page is in its HTML, for a preview, a search engine and a reader without a script', /<h1[^>]*>Where your group talks\.<\/h1>/.test(html) && html.includes('id="lp"'));
  check('  with the site\'s name for search engines', /"@type":"WebSite"/.test(html));
  for (const path of ['/status', '/help', '/changelog', '/roadmap']) {
    const page = await fetch(WEB + path).then((r) => r.text());
    check(`${path} is prerendered, with its own title and address`, page.includes('<div id="root"><div') && new RegExp(`rel="canonical" href="https?://[^"]+${path}"`).test(page) && / · Tavvit<\/title>/.test(page), page.match(/<title>[^<]*<\/title>/)?.[0]);
  }
  const hidden = await fetch(WEB + '/.site/index.html').then((r) => r.text());
  check('the build\'s own copy of a page is not served', !hidden.includes('%%TAVVIT_ORIGIN%%'));
  const robots = await fetch(WEB + '/robots.txt');
  check('robots.txt is served', robots.ok && (await robots.text()).includes('Disallow: /api/'));
  const og = await fetch(WEB + '/social-card.jpg');
  check('the preview picture is served', og.ok && og.headers.get('content-type') === 'image/jpeg' && Number(og.headers.get('content-length') ?? 0) < 300 * 1024, `${og.headers.get('content-type')} ${og.headers.get('content-length')}`);
  const icon = await fetch(WEB + '/favicon.ico');
  check('/favicon.ico is an icon, not a page', icon.ok && /image\/(x-icon|vnd\.microsoft\.icon)/.test(icon.headers.get('content-type') ?? ''), icon.headers.get('content-type'));
}


// ── The developer docs: pages of the server's, and the portal is the app's ──
{
  const { ctx, page, errors, requests } = await visit('/developers');
  check('visitor on /developers gets the docs', at(page) === '/developers' && (await page.locator('.home-hero').count()) === 1, at(page));
  check('  without page errors', errors.length === 0, errors[0]);
  const paths = requests.filter((u) => u.startsWith(WEB)).map((u) => new URL(u).pathname);
  check('  loading none of the app', !paths.some((p) => p.startsWith('/assets/')), paths.find((p) => p.startsWith('/assets/')));
  check('  and nothing from other servers', requests.every((u) => u.startsWith(WEB) || u.startsWith('data:')));
  await ctx.close();
}
{
  const { ctx, page, errors } = await visit('/developers/docs/quickstart');
  check('a docs page reads as itself', (await page.title()).startsWith('Quickstart'), await page.title());
  check('  without page errors', errors.length === 0, errors[0]);
  const code = await page.locator('pre code').allTextContents();
  check('  its examples name this instance', code.some((block) => block.includes(new URL(WEB).host)) && !code.some((block) => block.includes('your.instance')));
  await ctx.close();
  const docs = await fetch(`${WEB}/developers/docs/rest`);
  check('  under its own policy', /default-src 'none'/.test(docs.headers.get('content-security-policy') ?? ''), docs.headers.get('content-security-policy'));
  check('  and readable with no script at all', (await docs.text()).includes('GET /api/bots/@me'));
  const gone = await fetch(`${WEB}/developers/docs/nothing`);
  check('a page that does not exist is a 404, not the app', gone.status === 404, String(gone.status));
  const security = await fetch(`${WEB}/.well-known/security.txt`);
  const said = await security.text();
  check('security.txt names an address or is not there', security.status === 404 || said.startsWith('Contact: mailto:'), String(security.status));
}
{
  const { ctx, page } = await visit('/developers/bots');
  check('visitor on the developer portal is sent to sign in', at(page) === '/login', at(page));
  await ctx.close();
}
{
  const { ctx, page, errors } = await visit('/developers/bots', { token: seed.users.mara.token });
  check('a member gets the portal', at(page) === '/developers/bots' && errors.length === 0, errors[0] ?? at(page));
  await ctx.close();
}

// ── The developer docs, with a slash at the end of the address as well ──
{
  const toDocs = await fetch(`${WEB}/developers/`, { redirect: 'manual' });
  check('/developers/ leads to the docs and not to the app', toDocs.status >= 301 && toDocs.status <= 302 && toDocs.headers.get('location') === '/developers', `${toDocs.status} ${toDocs.headers.get('location')}`);
  const page = await fetch(`${WEB}/developers/docs/overview/`, { redirect: 'manual' });
  check('  and a page with one to that page', page.headers.get('location') === '/developers/docs/overview', `${page.status} ${page.headers.get('location')}`);
}

// ── The public pages: for anyone, with none of the app ──
for (const [url, heading] of [['/status', 'Status'], ['/help', 'Help'], ['/changelog', "What's new"], ['/roadmap', 'Roadmap']]) {
  const { ctx, page, errors, requests } = await visit(url);
  check(`visitor on ${url} gets the page`, at(page) === url && (await page.getByRole('heading', { level: 1, name: heading }).count()) === 1, at(page));
  check('  without page errors', errors.length === 0, errors[0]);
  const js = requests.filter((u) => u.startsWith(WEB) && new URL(u).pathname.endsWith('.js')).map((u) => new URL(u).pathname);
  check('  loading none of the app', !js.some((p) => /appBoot|authStore|native-/.test(p)), js.find((p) => /appBoot|authStore|native-/.test(p)));
  await ctx.close();
}
{
  const status = await fetch(`${WEB}/api/status`);
  const body = await status.json();
  check('the status says how each part is, to anyone', status.ok && body.services?.chat === 'ok', JSON.stringify(body.services));
  check('  and no more than that', Object.keys(body).sort().join() === 'checkedAt,notes,services', Object.keys(body).join());
  const test = await fetch(`${WEB}/api/loadtest`);
  check('the load test has no routes on an instance that has not asked for them', test.status === 404 || test.status === 401, String(test.status));
}

// ── An address that leads nowhere ─────────────────────
{
  const { ctx, page, errors } = await visit('/this/leads/nowhere');
  check('an unknown address says so and stays where it is', at(page) === '/this/leads/nowhere', at(page));
  check('  with a way out', (await page.getByRole('link', { name: 'To the home page' }).count()) === 1);
  check('  without page errors', errors.length === 0, errors[0]);
  await ctx.close();
}

// ── The admin console: for administrators, and the server is what says so ──
{
  const { ctx, page } = await visit('/admin');
  check('visitor on /admin is sent to sign in', at(page) === '/login', at(page));
  await ctx.close();
}
{
  const { ctx, page } = await visit('/admin', { token: seed.users.noor.token });
  check('a member on /admin is sent home', at(page).startsWith('/channels'), at(page));
  check('  and is offered no way there', (await page.getByRole('button', { name: 'Admin console' }).count()) === 0);
  await ctx.close();
}
{
  const { ctx, page, errors } = await visit('/admin/system', { token: seed.users.mara.token });
  check('an administrator reaches the console', at(page) === '/admin/system', at(page));
  check('  and the way there is in the top bar', (await page.getByRole('button', { name: 'Admin console' }).count()) === 1);
  check('  without page errors', errors.length === 0, errors[0]);
  await ctx.close();
}
for (const url of ['/api/admin/dashboard', '/api/admin/system', '/api/admin/announcements', '/api/admin/search?q=ma', '/api/admin/users.csv', '/api/admin/audit.csv', '/api/admin/signup-rules', '/api/admin/starter-spaces']) {
  const asked = (token) => fetch(WEB + url, token ? { headers: { authorization: `Bearer ${token}` } } : {}).then((r) => r.status);
  check(`${url} refuses a visitor`, (await asked(null)) === 401);
  check(`${url} refuses a member`, (await asked(seed.users.noor.token)) === 403);
  check(`${url} answers an administrator`, (await asked(seed.users.mara.token)) === 200);
}

// ── What 1.23.0 added ────────────
{
  const asked = (url, token, method = 'GET') => fetch(WEB + url, { method, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) }).then((r) => r.status);
  const { noor, mara } = seed.users;
  check('the sign-up task is open to anyone', (await asked('/api/auth/challenge', null)) === 200);
  check('the push key takes an account', (await asked('/api/push/key', null)) === 401);
  check('  and answers one', (await asked('/api/push/key', noor.token)) === 200);
  const channels = await fetch(`${WEB}/api/spaces/${seed.spaces.nightShift.id}/channels`, { headers: { authorization: `Bearer ${mara.token}` } }).then((r) => r.json());
  const channel = channels.find((entry) => entry.type === 'text');
  check('a channel\'s pins take an account', (await asked(`/api/channels/${channel.id}/pins`, null)) === 401);
  check('  and answer a member', (await asked(`/api/channels/${channel.id}/pins`, noor.token)) === 200);
  const challenge = await fetch(`${WEB}/api/admin/signup-rules/challenge`, {
    method: 'PUT', headers: { authorization: `Bearer ${noor.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ level: 'off' }),
  });
  check('a member cannot turn the sign-up task off', challenge.status === 403);
  const worker = await fetch(`${WEB}/sw-push.js`);
  check('the push worker is served as a script', worker.ok && (worker.headers.get('content-type') ?? '').includes('javascript'));
}

// ── What 1.24.0 added ────────────
{
  const asked = (url, token, method = 'GET') => fetch(WEB + url, { method, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) }).then((res) => res.status);
  const { noor, mara } = seed.users;
  const spaceId = seed.spaces.nightShift.id;
  check('a space\'s events take an account', (await asked(`/api/spaces/${spaceId}/events`, null)) === 401);
  check('  and answer a member', (await asked(`/api/spaces/${spaceId}/events`, noor.token)) === 200);
  check('a space\'s welcome takes an account', (await asked(`/api/spaces/${spaceId}/welcome`, null)) === 401);
  check('  and answers a member', (await asked(`/api/spaces/${spaceId}/welcome`, noor.token)) === 200);
  const channels = await fetch(`${WEB}/api/spaces/${spaceId}/channels`, { headers: { authorization: `Bearer ${mara.token}` } }).then((res) => res.json());
  const channel = channels.find((entry) => entry.type === 'text');
  check('a channel\'s webhooks take an account', (await asked(`/api/channels/${channel.id}/webhooks`, null)) === 401);
  check('  and are not for every member', (await asked(`/api/channels/${channel.id}/webhooks`, noor.token)) === 403);
  check('  but for who runs the space', (await asked(`/api/channels/${channel.id}/webhooks`, mara.token)) === 200);
  check('a forum\'s posts take an account', (await asked(`/api/channels/${channel.id}/posts`, null)) === 401);
  check('  and a text channel has none', (await asked(`/api/channels/${channel.id}/posts`, noor.token)) === 400);
  check('a forum\'s tags take an account', (await asked(`/api/channels/${channel.id}/forum-tags`, null)) === 401);
  check('a channel\'s follows take an account', (await asked(`/api/channels/${channel.id}/follows`, null)) === 401);
  check('  and are not for every member', (await asked(`/api/channels/${channel.id}/follows`, noor.token)) === 403);
  check('  but for who runs the space', (await asked(`/api/channels/${channel.id}/follows`, mara.token)) === 200);
  check('following starts from an announcement channel', (await asked(`/api/channels/${channel.id}/follow-targets`, noor.token)) === 400);
  check('changing a username takes an account', (await asked('/api/users/@me/username', null, 'POST')) === 401);
  check('a space\'s own address is not for every member', (await asked(`/api/spaces/${seed.spaces.nightShift.id}/vanity`, noor.token, 'PUT')) === 403);
  check('  and taking one away is for an administrator', (await asked(`/api/admin/spaces/${seed.spaces.nightShift.id}/vanity/revoke`, noor.token, 'POST')) === 403);
  const wrong = await fetch(`${WEB}/api/webhooks/1/not-a-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"content":"x"}' });
  check('a webhook address that does not exist writes nothing', wrong.status === 404);
  const { ctx, page } = await visit(`/channels/${spaceId}/events`, { token: noor.token });
  check('a space\'s events have a page of their own', page.url().endsWith(`/channels/${spaceId}/events`), page.url());
  check('  with the row that leads to it marked', (await page.locator('.nav-item[data-active="true"]').filter({ hasText: 'Events' }).count()) === 1);
  await ctx.close();
}

// ── What 1.25.0 added ────────────
{
  const asked = (url, token, method = 'GET') => fetch(WEB + url, { method, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) }).then((res) => res.status);
  const { noor } = seed.users;
  const spaceId = seed.spaces.nightShift.id;
  check('saved messages take an account', (await asked('/api/saved', null)) === 401);
  check('  and answer one', (await asked('/api/saved', noor.token)) === 200);
  check('keywords take an account', (await asked('/api/users/@me/keywords', null)) === 401);
  check('  and answer one', (await asked('/api/users/@me/keywords', noor.token)) === 200);
  check('  and find matches', (await asked('/api/users/@me/keyword-matches', noor.token)) === 200);
  check('a space\'s clips take an account', (await asked(`/api/spaces/${spaceId}/sounds`, null)) === 401);
  check('  and answer a member', (await asked(`/api/spaces/${spaceId}/sounds`, noor.token)) === 200);
  const adding = await fetch(`${WEB}/api/spaces/${spaceId}/sounds`, {
    method: 'POST', headers: { authorization: `Bearer ${noor.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', audio: 'T2dnUw==' }),
  });
  check('a member without the right adds no clip', adding.status === 403);
}

// ── What 1.26.0 added ────────────
{
  const asked = (url, headers = {}, method = 'GET') => fetch(WEB + url, { method, headers }).then((res) => res.status);
  const { noor, mara } = seed.users;
  const bearer = (user) => ({ authorization: `Bearer ${user.token}` });
  check('a person\'s bots take an account', (await asked('/api/bots')) === 401);
  check('the files a bot sends take its token', (await asked('/api/bots/@me/files', undefined, 'POST')) === 401);
  check('a person\'s own files answer only them', (await asked('/api/users/@me/storage')) === 401);
  check('  and answer them', (await asked('/api/users/@me/storage', bearer(noor))) === 200);
  check('  and answer one', (await asked('/api/bots', bearer(noor))) === 200);
  check('the bots of the instance are for an admin', (await asked('/api/admin/bots', bearer(noor))) === 403);
  check('  and answer one', (await asked('/api/admin/bots', bearer(mara))) === 200);
  const forged = { authorization: 'Bot 1.not-a-token' };
  check('a false bot token gets nowhere on an open route', (await asked('/api/users/@me', forged)) === 401);
  check('  and is refused outright on any other', (await asked('/api/admin/users', forged)) === 403);
  check('  also on the account itself', (await asked('/api/users/@me', forged, 'DELETE')) === 403);
}

// ── An invite link, as a chat app reads it ────────────
{
  const { inviteCode } = await fetch(`${WEB}/api/spaces/${seed.spaces.nightShift.id}/invite`, { method: 'POST', headers: { authorization: `Bearer ${seed.users.mara.token}` } }).then((r) => r.json());
  const res = await fetch(`${WEB}/join/${inviteCode}`);
  const html = await res.text();
  check('an invite link previews its space', /og:title" content="Night Shift"/.test(html), html.match(/og:title" content="[^"]*"/)?.[0]);
  check('  and is left out of search engines', res.headers.get('x-robots-tag') === 'noindex', res.headers.get('x-robots-tag') ?? 'no header');
  const maraHeaders = { authorization: `Bearer ${seed.users.mara.token}` };
  const preview = await fetch(`${WEB}/api/spaces/invite/${inviteCode}/preview`).then((r) => r.json());
  check('an invite preview says whether its space came from Discord', typeof preview.movedFromDiscord === 'boolean', JSON.stringify(preview.movedFromDiscord));
  const fromDiscord = await fetch(`${WEB}/join/${inviteCode}?from=discord`);
  check('  and a link marked from Discord opens the same page', fromDiscord.ok && /og:title" content="Night Shift"/.test(await fromDiscord.text()));
  const offer = await fetch(`${WEB}/api/emojis/available`, { headers: maraHeaders }).then((r) => r.json());
  check('a member reads what they may pick: the library and their spaces', Array.isArray(offer.library) && Array.isArray(offer.spaces)
    && offer.spaces.some((entry) => entry.spaceId === seed.spaces.nightShift.id), JSON.stringify(offer).slice(0, 120));
  const spaces = await fetch(`${WEB}/api/spaces`, { headers: maraHeaders }).then((r) => r.json());
  const address = spaces.find((entry) => entry.id === seed.spaces.nightShift.id)?.vanityCode ?? null;
  const setAddress = (code) => fetch(`${WEB}/api/spaces/${seed.spaces.nightShift.id}/vanity`, {
    method: 'PUT', headers: { ...maraHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ code }),
  });
  await setAddress('release-check');
  const own = await fetch(`${WEB}/join/release-check`).then((r) => r.text());
  check('a space\'s own address previews it like a link', /og:title" content="Night Shift"/.test(own));
  await setAddress(address);
  const given = await fetch(`${WEB}/join/release-check`).then((r) => r.text());
  check('  and leads nowhere once given up', !/og:title" content="Night Shift"/.test(given));
  const unknown = await fetch(`${WEB}/join/nosuchcode`);
  check('an unknown invite still opens the page', unknown.ok && /text\/html/.test(unknown.headers.get('content-type') ?? ''));
  const robots = await (await fetch(`${WEB}/robots.txt`)).text();
  check('robots.txt lets a preview service read an invite', !robots.includes('/join/'));
}

// ── English is the default, whatever the browser says ─
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-DE' });
  const page = await ctx.newPage();
  for (const path of ['/', '/login']) {
    await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
    const lang = await page.evaluate(() => document.documentElement.lang);
    check(`a German browser sees ${path} in English`, lang === 'en', lang);
  }
  await ctx.close();
}

// ── Changing language on the product page ─────────────
{
  const { ctx, page } = await visit('/', { viewport: { width: 1280, height: 800 } });
  await page.evaluate(() => { window.__sameDocument = true; window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => window.scrollY);
  await page.locator('#landing-language').selectOption('de');
  await page.waitForFunction(() => document.documentElement.lang === 'de', null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({ same: window.__sameDocument === true, y: window.scrollY, title: document.querySelector('h1')?.textContent }));
  check('the language changes without leaving the page', state.same, 'it reloaded');
  check('  and the page stays where it was', state.y > before * 0.8, `${before} to ${state.y}`);
  check('  in that language', state.title !== 'Pull up a chair.', state.title);
  await ctx.close();
}

// ── What a visitor can do on the product page ─────────
{
  const { ctx, page } = await visit('/');
  // Something laid over the page takes its clicks without looking any different. Only the browser's
  // own hit test shows that, so each thing that can be used is asked for by its place.
  const covered = await page.evaluate(async () => {
    const usable = [...document.querySelectorAll('#lp a, #lp button, #lp input, #lp select, #lp summary')].filter((element) => element.getClientRects().length > 0);
    const blocked = [];
    for (const element of usable) {
      if (element.closest('.lp-nav')) continue;
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise((frame) => requestAnimationFrame(frame));
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!top || !(element === top || element.contains(top) || top.contains(element))) {
        blocked.push(`${element.tagName} "${(element.textContent ?? '').trim().slice(0, 30)}" under ${top?.className || top?.tagName}`);
      }
    }
    return { count: usable.length, blocked };
  });
  check('everything on the product page can be clicked', covered.blocked.length === 0 && covered.count > 20, `${covered.count}: ${covered.blocked.slice(0, 3).join('; ')}`);

  const input = page.locator('.lp-demo-form input');
  await input.scrollIntoViewIfNeeded();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await input.click();
  await input.fill('Is this seat taken?');
  await input.press('Enter');
  await page.waitForTimeout(2200);
  const lines = await page.locator('.lp-demo-text').allTextContents();
  check('the channel to try takes a message', lines.includes('Is this seat taken?'), lines.join(' / '));
  check('  and someone answers', lines.length === 5, `${lines.length} lines`);
  check('  and nothing went over the network', requests.length === 0, requests.slice(0, 2).join(' '));
  check('  and a seat is offered', (await page.locator('.lp-demo-cta').count()) === 1);
  await ctx.close();
}

// ── Pictures ──────────────────────────────────────────
const changedPictures = [];
if (!options.includes('--doors-only')) {
  const channel = `/channels/${seed.spaces.nightShift.id}/${seed.spaces.nightShift.channels.general}`;
  const me = seed.users.mara.token;
  const STILL = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';
  const settle = async (p) => {
    await p.addStyleTag({ content: STILL }).catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(700);
  };
  const DESKTOP = { width: 1440, height: 900 };
  const PHONE = { width: 390, height: 844 };
  const shots = [];
  const shot = (name, viewport, token, run) => shots.push({ name, viewport, token, run });
  const open = (url) => async (p) => { await p.goto(WEB + url); await settle(p); };
  const after = (url, step) => async (p) => {
    await p.goto(WEB + url);
    await settle(p);
    await step(p);
    await p.waitForTimeout(400);
    await p.addStyleTag({ content: STILL }).catch(() => {});
  };

  shot('d-landing', DESKTOP, null, open('/'));
  shot('d-login', DESKTOP, null, open('/login'));
  shot('d-register', DESKTOP, null, open('/register'));
  shot('d-home', DESKTOP, me, open('/channels/@me'));
  shot('d-chat', DESKTOP, me, open(channel));
  shot('d-events', DESKTOP, me, open(`/channels/${seed.spaces.nightShift.id}/events`));
  shot('d-dm', DESKTOP, me, open(`/channels/@me/${seed.dm}`));
  shot('d-friends', DESKTOP, me, open('/friends'));
  shot('d-inbox', DESKTOP, me, open('/inbox'));
  shot('d-explore', DESKTOP, me, open('/explore'));
  shot('d-about', DESKTOP, me, open('/about'));
  shot('d-profile', DESKTOP, me, after(channel, async (p) => {
    await p.locator('[data-context-menu][role="button"]').filter({ hasText: 'Lena Hoffmann' }).first().click();
  }));
  shot('d-menu', DESKTOP, me, after(channel, async (p) => {
    await p.locator('#msg-' + (await p.locator('[id^="msg-"]').nth(4).getAttribute('id')).slice(4)).click({ button: 'right' });
  }));
  shot('d-settings', DESKTOP, me, after(channel, async (p) => {
    await p.getByRole('button', { name: /settings/i }).first().click();
  }));
  shot('d-create-space', DESKTOP, me, after('/channels/@me', async (p) => {
    await p.getByRole('button', { name: /create|new space|add a space/i }).first().click().catch(() => {});
  }));
  shot('d-admin', DESKTOP, me, open('/admin'));
  shot('d-admin-system', DESKTOP, me, open('/admin/system'));
  shot('m-admin', PHONE, me, open('/admin'));
  shot('m-home', PHONE, me, open('/channels/@me'));
  shot('m-chat', PHONE, me, open(channel));
  shot('m-login', PHONE, null, open('/login'));
  shot('m-landing', PHONE, null, open('/'));

  const folder = path.join(ROOT, 'dist', 'release-check');
  const last = path.join(folder, 'last');
  const current = path.join(folder, 'current');
  fs.rmSync(last, { recursive: true, force: true });
  if (fs.existsSync(current)) fs.renameSync(current, last);
  fs.mkdirSync(current, { recursive: true });

  for (const { name, viewport, token, run } of shots) {
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      locale: 'en-US',
      timezoneId: 'Europe/Berlin',
      hasTouch: viewport.width < 600,
      isMobile: viewport.width < 600,
    });
    await ctx.addInitScript(([t]) => {
      if (t) localStorage.setItem('backspace_token', t);
      localStorage.setItem('backspace-language', 'en');
    }, [token]);
    const p = await ctx.newPage();
    // Times stay still between runs, so a comparison shows what changed and not the clock.
    await p.clock.setFixedTime(new Date(seed.seededAt + 40 * 60 * 1000));
    const errors = [];
    p.on('pageerror', (error) => errors.push(error.message.slice(0, 160)));
    try {
      await run(p);
      await p.screenshot({ path: path.join(current, `${name}.png`) });
      check(`picture ${name} without page errors`, errors.length === 0, errors[0]);
    } catch (error) {
      check(`picture ${name} could be taken`, false, String(error.message).split('\n')[0].slice(0, 160));
    }
    await ctx.close();
  }

  if (fs.existsSync(last)) {
    for (const file of fs.readdirSync(current)) {
      const before = path.join(last, file);
      if (!fs.existsSync(before)) continue;
      const left = sharp(before).removeAlpha();
      const { width, height } = await left.metadata();
      const a = await left.raw().toBuffer();
      const b = await sharp(path.join(current, file)).removeAlpha().resize(width, height, { fit: 'fill' }).raw().toBuffer();
      let changed = 0;
      for (let i = 0; i < a.length; i += 3) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) changed += 1;
      }
      const percent = (changed / (a.length / 3)) * 100;
      if (percent > PICTURE_CHANGED) changedPictures.push(`${percent.toFixed(1).padStart(5)}%  ${path.join(current, file)}`);
    }
  }
}

await browser.close();
for (const line of failures) console.log(line);
if (changedPictures.length > 0) {
  console.log(`Changed since the last run, worth a look:\n${changedPictures.join('\n')}`);
}
console.log(failures.length === 0 ? `All ${passed} browser checks passed.` : `${failures.length} of ${passed + failures.length} browser checks failed.`);
process.exit(failures.length === 0 ? 0 : 1);
