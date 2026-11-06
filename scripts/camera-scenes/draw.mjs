#!/usr/bin/env node
/**
 * Draws the camera's scenes (scenes.mjs) into packages/web/src/camera/scenes/: each as a
 * 1280x720 JPEG, the size the camera sends, and a 320x180 one for the picker.
 *
 *   npm install --prefix /tmp/camera-scenes playwright-core
 *   PLAYWRIGHT_PREFIX=/tmp/camera-scenes node scripts/camera-scenes/draw.mjs
 *
 * Chrome renders the SVG (the system's Chrome, or CHROME_PATH), sharp writes the JPEGs. A
 * scene over its size budget fails the run: the pictures load when someone opens the camera
 * settings, and the full one again when they choose it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { HEIGHT, SCENES, WIDTH } from './scenes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'packages/web/src/camera/scenes');
const FULL_BUDGET = 220 * 1024;
const THUMB_BUDGET = 24 * 1024;

const DEFAULT_CHROME = {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
};

function playwright() {
  const prefix = process.env.PLAYWRIGHT_PREFIX;
  if (!prefix) throw new Error('Set PLAYWRIGHT_PREFIX to a folder with playwright-core installed (see the top of this file).');
  return createRequire(join(prefix, 'package.json'))('playwright-core');
}

async function main() {
  const { chromium } = playwright();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? DEFAULT_CHROME[process.platform] });
  mkdirSync(OUT, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    for (const scene of SCENES) {
      await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">${scene.draw()}</body></html>`);
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      const full = await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
      const thumb = await sharp(png).resize(320, 180).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      if (full.length > FULL_BUDGET) throw new Error(`${scene.file}.jpg is ${Math.round(full.length / 1024)} KB, over ${FULL_BUDGET / 1024} KB.`);
      if (thumb.length > THUMB_BUDGET) throw new Error(`${scene.file}-thumb.jpg is ${Math.round(thumb.length / 1024)} KB, over ${THUMB_BUDGET / 1024} KB.`);
      writeFileSync(join(OUT, `${scene.file}.jpg`), full);
      writeFileSync(join(OUT, `${scene.file}-thumb.jpg`), thumb);
      console.log(`${scene.id}: ${Math.round(full.length / 1024)} KB, thumbnail ${Math.round(thumb.length / 1024)} KB`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
