#!/usr/bin/env node
/**
 * Builds the public website (astro.config.mjs) after Vite has built the app, and puts it into the
 * web build the server sends from (docs/systems/landing.md, "How it is built"):
 *
 *   dist/.site/<page>.html  the pages, with SITE_ORIGIN_TOKEN where the server writes its origin.
 *                           A dot folder: the static file handler does not serve it, so a page only
 *                           ever leaves through utils/webDocument.ts.
 *   dist/_astro/            their scripts, stylesheets and pictures, hashed, served as files.
 *
 * Then it checks what the server's policy and the page's promises depend on, and fails the build
 * when one does not hold: no script written into a page (the policy allows files from this origin
 * only), every file a page names exists, and the product page's scripts stay within its budget.
 *
 * Astro's anonymous usage reporting is switched off: building Tavvit sends nothing anywhere.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

process.env.ASTRO_TELEMETRY_DISABLED = '1';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'dist-site');
const PAGES_DIR = join(DIST, '.site');
const ASSETS_DIR = join(DIST, '_astro');

/** The product page's script budget, gzipped (landing.md, "What a visitor downloads"). */
const LANDING_SCRIPT_BUDGET = 150 * 1024;

/** The pages the server expects, as shared/src/site.ts names them. */
const PAGES = ['index.html', 'status.html', 'help.html', 'changelog.html', 'roadmap.html', 'creators.html'];

const ORIGIN_TOKEN = '%%TAVVIT_ORIGIN%%';

function fail(message) {
  console.error(`[site] ${message}`);
  process.exit(1);
}

if (!existsSync(join(DIST, 'index.html'))) fail('dist/index.html is missing: run Vite\'s build first (pnpm --filter @backspace/web build).');

const { build } = await import('astro');
rmSync(OUT, { recursive: true, force: true });
await build({ root: WEB, logLevel: 'warn' });

// ── Move the output into the web build ──
rmSync(PAGES_DIR, { recursive: true, force: true });
rmSync(ASSETS_DIR, { recursive: true, force: true });
mkdirSync(PAGES_DIR, { recursive: true });
for (const page of PAGES) {
  const from = join(OUT, page);
  if (!existsSync(from)) fail(`Astro did not write ${page}.`);
  renameSync(from, join(PAGES_DIR, page));
}
if (existsSync(join(OUT, '_astro'))) cpSync(join(OUT, '_astro'), ASSETS_DIR, { recursive: true });
// Whatever else is there is Astro's copy of `public/`, which Vite's build already put into dist.
const PUBLIC = join(WEB, 'public');
const leftover = readdirSync(OUT).filter((name) => name !== '_astro' && !existsSync(join(PUBLIC, name)));
if (leftover.length > 0) fail(`Astro wrote files nobody serves: ${leftover.join(', ')}.`);
rmSync(OUT, { recursive: true, force: true });

// ── Check the pages ──
const assetPath = (url) => join(DIST, ...url.replace(/^\//, '').split('/'));

/** The files a script imports at once (not `import()`), as paths relative to the build. */
function staticImports(url) {
  const source = readFileSync(assetPath(url), 'utf8');
  const found = new Set();
  for (const match of source.matchAll(/(?:^|[;\n}])\s*import\s*(?:[\w$*{}\s,]+from\s*)?["']([^"']+)["']/g)) {
    const target = match[1];
    if (target.startsWith('./') || target.startsWith('../')) found.add(posix.normalize(posix.join(posix.dirname(url), target)));
    else if (target.startsWith('/')) found.add(target);
  }
  return [...found];
}

let landingScripts = 0;
for (const page of PAGES) {
  const html = readFileSync(join(PAGES_DIR, page), 'utf8');
  if (!html.includes(`href="${ORIGIN_TOKEN}`)) fail(`${page} has no canonical address to fill in.`);

  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attributes = match[1];
    const isData = /type="application\/ld\+json"/.test(attributes);
    if (!/\bsrc=/.test(attributes) && !isData) fail(`${page} has a script written into it, which the server's policy would block: ${match[0].slice(0, 120)}`);
  }

  const files = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)].map((match) => match[1]);
  for (const file of files) if (!existsSync(assetPath(file))) fail(`${page} names ${file}, which the build does not have.`);

  if (page === 'index.html') {
    const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="(\/_astro\/[^"]+)"/g)].map((match) => match[1]);
    if (entries.length === 0) fail('The product page has no script to take it over.');
    const seen = new Set();
    const queue = [...entries];
    while (queue.length > 0) {
      const url = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      if (!existsSync(assetPath(url))) fail(`A script of the product page imports ${url}, which the build does not have.`);
      landingScripts += gzipSync(readFileSync(assetPath(url))).length;
      queue.push(...staticImports(url));
    }
  }
}

if (landingScripts > LANDING_SCRIPT_BUDGET) {
  fail(`The product page's scripts are ${Math.round(landingScripts / 1024)} KB gzipped, over its budget of ${LANDING_SCRIPT_BUDGET / 1024} KB.`);
}

const bytes = (path) => statSync(path).size;
const pageSizes = PAGES.map((page) => `${page} ${Math.round(bytes(join(PAGES_DIR, page)) / 1024)} KB`).join(', ');
console.log(`[site] ${PAGES.length} pages in dist/.site (${pageSizes}); the product page's scripts are ${Math.round(landingScripts / 1024)} KB gzipped.`);
