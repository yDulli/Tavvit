#!/usr/bin/env node
/**
 * Draws the picture a link to Tavvit previews with: social-card.html, at 1200x630, into
 * packages/web/public/social-card.jpg (docs/systems/landing.md, "Search and previews").
 *
 * shoot.mjs runs it after it has retaken the window the card shows; on its own it redraws the
 * card from the window there is:
 *
 *   PLAYWRIGHT_PREFIX=/tmp/landing-shots node scripts/landing-shots/card.mjs
 *
 * A JPEG, because every service shows one, kept under 300 KB, above which some (WhatsApp) show
 * no picture at all; the colour is not subsampled, so the type stays sharp.
 */
/* global document -- what `page.evaluate` runs in the browser */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'packages/web/public/social-card.jpg');
const MAX_BYTES = 300 * 1024;

/** Draws the card with a browser that is already open, and returns its size in bytes. */
export async function drawSocialCard(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(join(HERE, 'social-card.html')).href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    const fonts = await page.evaluate(() => [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family));
    if (!fonts.includes('Geist')) throw new Error('The card\'s type did not load.');
    const png = await page.screenshot({ type: 'png' });
    const jpeg = await sharp(png).jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
    if (jpeg.length > MAX_BYTES) throw new Error(`The card is ${Math.round(jpeg.length / 1024)} KB, over ${MAX_BYTES / 1024} KB.`);
    writeFileSync(OUT, jpeg);
    return jpeg.length;
  } finally {
    await page.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  // A development tool, so not a dependency of the project: see README.md.
  const { chromium } = createRequire(join(process.env.PLAYWRIGHT_PREFIX ?? process.cwd(), 'package.json'))('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const bytes = await drawSocialCard(browser);
    console.log(`social-card.jpg 1200x630 ${Math.round(bytes / 1024)} KB`);
  } finally {
    await browser.close();
  }
}
