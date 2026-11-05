#!/usr/bin/env node
/* global localStorage -- used only inside the script handed to the browser */
/**
 * Takes the product page's pictures from the running app (see README.md here) and
 * writes them, optimised, to packages/web/src/landing/assets, with their sizes
 * beside them. Real screens with invented people: nothing here draws a picture.
 *
 * Usage: node scripts/landing-shots/shoot.mjs <seed.json> [only-this-name]
 */
/* global document -- what `page.evaluate` runs in the browser */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { drawSocialCard } from './card.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = join(ROOT, 'packages/web/src/landing/assets');
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// A development tool, so not a dependency of the project: see README.md.
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_PREFIX ?? process.cwd(), 'package.json'))('playwright-core');

const [seedFile, only] = process.argv.slice(2);
if (!seedFile) throw new Error('Usage: shoot.mjs <seed.json> [only-this-name]');
const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
const channel = `/channels/${seed.spaces.nightShift.id}/${seed.spaces.nightShift.channels.general}`;
const nightShiftChannel = (name) => `/channels/${seed.spaces.nightShift.id}/${seed.spaces.nightShift.channels[name]}`;
const me = seed.users.mara.token;

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const STILL = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';

/**
 * Ends a picture under the last of these rows that fits whole, plus a margin, so
 * the frame does not cut a line of text or a card in half.
 */
const underLastWhole = (selector, margin) => async (page, clip) => {
  const bottoms = await page.locator(selector).evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().bottom));
  const whole = bottoms.filter((bottom) => bottom + margin <= clip.y + clip.height);
  return whole.length ? Math.round(Math.max(...whole) + margin - clip.y) : clip.height;
};

/**
 * name, what to open, the part of the window to keep (CSS pixels), the width of the
 * file in pixels; `fit` shortens the kept part to where its content allows a clean end.
 */
const openSwitcher = async (page) => {
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  await page.keyboard.type('raid', { delay: 30 });
  await page.waitForTimeout(400);
};

const NARROW = { width: 1180, height: 760 };

const SHOTS = [
  { name: 'thread', url: `${nightShiftChannel('raid-planning')}?thread=${seed.thread}`, viewport: { width: 1320, height: 960 }, clip: { x: 248, y: 48, width: 1072, height: 912 }, width: 1700, quality: 74 },
  { name: 'poll', url: nightShiftChannel('patch-notes'), element: '[data-poll="true"]', width: 880 },
  { name: 'event', url: `/channels/${seed.spaces.nightShift.id}/events`, viewport: NARROW, element: 'li.surface-card', width: 1500 },
  { name: 'welcome', url: `/channels/${seed.spaces.bookshelf.id}/${seed.spaces.bookshelf.channels['this-month']}`, element: '.modal-panel', width: 1100 },
  { name: 'bot-card', url: `/channels/${seed.spaces.openFriday.id}/${seed.spaces.openFriday.channels['code-review']}`, viewport: NARROW, element: '.msg-row', hasText: 'Build passed', keepWidth: 596, width: 1192 },
  { name: 'space-photo', url: `/channels/${seed.spaces.fieldNotes.id}/${seed.spaces.fieldNotes.channels.critique}`, width: 2200, quality: 74 },
  { name: 'space-dev', url: `/channels/${seed.spaces.openFriday.id}/${seed.spaces.openFriday.channels['code-review']}`, width: 2200, quality: 74 },
  { name: 'space-books', url: `/channels/${seed.spaces.bookshelf.id}/${seed.spaces.bookshelf.channels['this-month']}`, width: 2200, quality: 74, open: async (page) => {
    await page.locator('.modal-panel button').filter({ hasText: /got it/i }).click();
  } },
  { name: 'window', url: channel, width: 2200, quality: 74 },
  { name: 'phone', url: channel, viewport: PHONE, width: 780 },
  { name: 'phone-channels', url: channel, viewport: PHONE, width: 780, open: async (page) => {
    await page.locator('button[aria-label*="ack" i]').first().click();
  } },
  { name: 'phone-members', url: channel, viewport: PHONE, width: 780, open: async (page) => {
    await page.locator('button[aria-label*="ember" i]').first().click();
  } },
  { name: 'switcher', url: channel, width: 2200, quality: 74, open: openSwitcher },
  { name: 'switcher-card', url: channel, width: 1400, quality: 80, element: '[role="dialog"]', open: openSwitcher },
  { name: 'profile', url: channel, width: 680, element: '[data-user-profile-popout]', open: async (page) => {
    await page.locator('[data-context-menu][role="button"]').filter({ hasText: 'Lena Hoffmann' }).first().click();
  } },
  { name: 'friends', url: '/friends', viewport: { width: 1180, height: 760 }, clip: { x: 248, y: 48, width: 932, height: 470 }, width: 1864 },
  { name: 'voice', url: '/dev-voice-room.html', viewport: { width: 1200, height: 660 }, width: 2000 },
  { name: 'community', as: 'robin', url: '/explore', clip: { x: 248, y: 48, width: 944, height: 560 }, fit: underLastWhole('.card-grid > *', 12), width: 2000 },
  { name: 'look-a0', url: channel, state: { theme: 'carbon' }, width: 1100, quality: 72, scale: 1 },
  { name: 'look-a1', url: channel, state: { theme: 'moss', accent: '#5a8f1c' }, width: 1100, quality: 72, scale: 1 },
  { name: 'look-a2', url: channel, state: { theme: 'clay', accent: '#e0501f' }, width: 1100, quality: 72, scale: 1 },
  { name: 'look-a3', url: channel, state: { theme: 'plum', accent: '#a23fd0' }, width: 1100, quality: 72, scale: 1 },
  { name: 'look-a4', url: channel, state: { theme: 'harbor', accent: '#0f7fc4' }, width: 1100, quality: 72, scale: 1 },
  { name: 'look-a5', url: channel, state: { theme: 'custom', custom: { hue: 340, strength: 40, depth: 0 }, accent: '#d4376b' }, width: 1100, quality: 72, scale: 1 },
  { name: 'look-a6', url: channel, state: { theme: 'ink', accent: '#0e8f7e' }, width: 1100, quality: 72, scale: 1 },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const sizesFile = join(ROOT, 'packages/web/src/landing/imageSizes.ts');
const generated = only ? readFileSync(sizesFile, 'utf8') : null;
const sizes = only ? JSON.parse(generated.match(/LANDING_IMAGE_SIZES = (\{[\s\S]*?\n\}) as const;/)[1]) : {};
mkdirSync(ASSETS, { recursive: true });
let total = 0;

for (const shot of SHOTS) {
  if (only && shot.name !== only) continue;
  const viewport = shot.viewport ?? DESKTOP;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: shot.scale ?? 2,
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    hasTouch: viewport.width < 600,
    isMobile: viewport.width < 600,
  });
  await context.addInitScript(([token, theme]) => {
    localStorage.setItem('backspace_token', token);
    localStorage.setItem('i18nextLng', 'en');
    localStorage.setItem('backspace-language', 'en');
    if (theme) localStorage.setItem('orbit-appearance', JSON.stringify({ state: theme, version: 0 }));
  }, [shot.as ? seed.users[shot.as].token : me, shot.state ?? null]);
  const page = await context.newPage();
  // Times in the pictures read as a moment shortly after the last message.
  await page.clock.setFixedTime(new Date(seed.seededAt + 12 * 60 * 1000));
  await page.goto(WEB + shot.url);
  await page.addStyleTag({ content: STILL }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  // A list shows its skeleton until its rows have come and settled.
  await page.waitForFunction(() => !document.querySelector('[role="status"]'), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  if (shot.open) {
    await shot.open(page);
    await page.waitForTimeout(500);
  }
  await page.mouse.move(0, viewport.height - 1);
  await page.waitForTimeout(150);
  const clip = shot.clip && shot.fit ? { ...shot.clip, height: await shot.fit(page, shot.clip) } : shot.clip;
  const element = shot.element ? page.locator(shot.element).filter(shot.hasText ? { hasText: shot.hasText } : {}).first() : null;
  // `keepWidth` leaves out the empty end of a row that is wider than what it holds.
  const raw = element && shot.keepWidth
    ? await page.screenshot({ clip: { ...(await element.boundingBox()), width: shot.keepWidth } })
    : element
      ? await element.screenshot()
      : await page.screenshot(clip ? { clip } : {});
  const file = await sharp(raw)
    .resize({ width: shot.width, withoutEnlargement: true })
    .webp({ quality: shot.quality ?? 78, effort: 6, smartSubsample: true })
    .toBuffer();
  const meta = await sharp(file).metadata();
  writeFileSync(join(ASSETS, `${shot.name}.webp`), file);
  sizes[shot.name] = { width: meta.width, height: meta.height };
  total += file.length;
  console.log(`${shot.name.padEnd(18)} ${String(meta.width).padStart(5)}x${String(meta.height).padEnd(5)} ${(file.length / 1024).toFixed(0).padStart(5)} KB`);
  await context.close();
}
// The link preview shows the window just taken, with the product's name and headline (card.mjs).
if (!only || only === 'window') {
  const bytes = await drawSocialCard(browser);
  console.log(`${'social-card'.padEnd(18)}  1200x630  ${(bytes / 1024).toFixed(0).padStart(5)} KB`);
}
await browser.close();

const sorted = Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(sizesFile, `// Written by scripts/landing-shots/shoot.mjs: the size of each picture, so the page keeps its layout while they load.
export const LANDING_IMAGE_SIZES = ${JSON.stringify(sorted, null, 2)} as const;
`);
console.log(`total ${(total / 1024).toFixed(0)} KB`);
