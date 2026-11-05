#!/usr/bin/env node
/**
 * Tavvit icon generator
 *
 * Reads from assets/brand/{app-icon.svg, app-icon-small.svg, mark-icon.svg,
 * mark-mono-light.svg, mark.svg, mark-tray.svg} and writes the entire desktop +
 * web icon set:
 *   - macOS .icns (10-rep iconset)
 *   - Windows .ico (multi-size)
 *   - Linux per-size PNGs (electron-builder dir mode)
 *   - macOS menu-bar template + @2x (18x22 / 36x44)
 *   - Windows tray .ico (multi-size, DPI-auto, glyph inset per frame)
 *   - Linux tray PNG (22x22, 18px glyph)
 *   - Web favicons, PWA, in-app brand logo, PWA maskable, apple-touch icon
 *   - assets/brand/app-icon-1024.png, a reference export of the app icon
 *
 * Run via `pnpm gen-icons` after artwork changes; commit the diff.
 *
 * THE ARTWORK: the masters are the owner's Tavvit logo (assets/brand/
 * logo-source.png), vectorised: a slanted T inside a thin ring, always white. The
 * app-icon family (dock, taskbar, Start menu, Alt-Tab, PWA install, iOS home
 * screen, the maskable Android icon) puts the mark on the app's own graphite
 * (#121316) in a rounded square at Apple's 22.37% corner radius. Favicons and the
 * colour tray icons are the small tile, because a white mark on transparent would
 * vanish in a light browser tab or on a light taskbar. See
 * docs/systems/design-system.md's Brand section.
 *
 * APP-ICON RENDERING: every app-icon output renders straight from vector.
 * `app-icon.svg` carries its own tile, so sharp/librsvg renders the SVG at the
 * target size and that's the pixel output. Sizes 16 and 32 render from
 * `app-icon-small.svg` instead: at that size the ring washes out, so the small
 * variant draws the T alone, larger, with a wider gap under the bar. See
 * APP_ICON_SMALL_MAX.
 *
 * DETERMINISM: byte-stable for a given lockfile only. After bumping
 * sharp / png-to-ico / png2icons, expect a follow-up regen+commit in
 * the dep-bump PR - that diff isn't an artwork change, just upstream
 * encoder differences.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import png2icons from 'png2icons';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SRC = {
  appIcon:       join(ROOT, 'assets/brand/app-icon.svg'),
  appIconSmall:  join(ROOT, 'assets/brand/app-icon-small.svg'),
  markIcon:      join(ROOT, 'assets/brand/mark-icon.svg'),
  markMonoLight: join(ROOT, 'assets/brand/mark-mono-light.svg'),
  mark:          join(ROOT, 'assets/brand/mark.svg'),
  markTray:      join(ROOT, 'assets/brand/mark-tray.svg'),
};

const DESKTOP_BUILD = join(ROOT, 'packages/desktop/build');
const DESKTOP_RES   = join(ROOT, 'packages/desktop/resources');
const WEB_ICONS      = join(ROOT, 'packages/web/public/icons');
const WEB_PUBLIC     = join(ROOT, 'packages/web/public');
const BRAND          = join(ROOT, 'assets/brand');

// The ground the Tavvit mark sits on: the app's frame colour, the same flat fill
// app-icon.svg paints inside its rounded tile. Outputs that must carry zero
// transparent pixels use it as an opaque canvas: the apple-touch icon (iOS paints
// transparent corners black and rounds the square itself) and the maskable PWA
// icon (Android launcher masks crop arbitrarily past the mark, so everything
// outside it must already look like the tile). Kept as a constant rather than
// re-parsed from app-icon.svg: the two sharing this literal value is the intended
// coupling, and if the tile colour ever changes both need editing.
const TILE_GROUND = '#121316';

// SVG render density. app-icon(-small).svg's viewBox is 256; mark(-small)
// is 133x180. At density 1200, the 256 box pre-renders to ~3200px and the
// 180-tall box to ~2250px — comfortably above every target here (largest
// is the 1024 reference export), so every output is a downscale. Sharp/
// libvips downscales with Lanczos, so over-rendering then resizing is
// fine and keeps output stable across all target sizes.
const SVG_DENSITY = 1200;

// App-icon outputs at this size or smaller render from app-icon-small.svg
// instead of app-icon.svg: the T alone, because a ring this thin disappears.
const APP_ICON_SMALL_MAX = 32;

// ---- helpers ----

const loadSvg = (path) => readFileSync(path);

async function renderPng(svg, size) {
  // Render SVG → square PNG at exact target size. fit: 'contain' preserves
  // aspect ratio: wide-bbox SVGs get transparent
  // top/bottom or left/right padding instead of being stretched square.
  return sharp(svg, { density: SVG_DENSITY })
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function renderTemplatePng(svg, height) {
  // Render a non-square SVG at an exact pixel height, width following the
  // SVG's own aspect ratio. mark-tray.svg carries its own 18x22 canvas
  // with the glyph already inset and centred, so nothing is fitted here.
  return sharp(svg, { density: SVG_DENSITY })
    .resize({ height })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

// Alpha centroid of a rendered RGBA buffer, in pixel-centre coordinates
// (a fully symmetric glyph centred on a W-wide canvas measures W / 2).
async function alphaCentroidX(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let weight = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3];
    sum += a * ((p % info.width) + 0.5);
    weight += a;
  }
  return weight === 0 ? info.width / 2 : sum / weight;
}

function parseMarkSvg(markSvg) {
  // Splits a mark master into its root viewBox and inner markup so the
  // glyph can be re-hosted inside another canvas at any size/position.
  const text = markSvg.toString('utf8');
  const open = text.match(/<svg\b[^>]*>/);
  const viewBox = open && open[0].match(/viewBox="([^"]+)"/);
  if (!open || !viewBox) throw new Error('parseMarkSvg: source SVG has no root <svg viewBox>');
  const [, , vbW, vbH] = viewBox[1].trim().split(/[\s,]+/).map(Number);
  const inner = text.slice(open.index + open[0].length, text.lastIndexOf('</svg>'));
  return { viewBox: viewBox[1], aspect: vbW / vbH, inner };
}

// Wraps a parsed mark in a canvas of canvasW x canvasH px with the glyph
// scaled to glyphH px tall and its top-left corner at (x, y), fractional
// positions allowed: the placement is baked into the vector before
// rasterising, so a sub-pixel correction renders as true coverage instead
// of a whole-pixel composite offset.
function placeMarkSvg(mark, canvasW, canvasH, glyphH, x, y) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">` +
      `<svg x="${x}" y="${y}" width="${glyphH * mark.aspect}" height="${glyphH}" viewBox="${mark.viewBox}">${mark.inner}</svg>` +
      `</svg>`,
  );
}

async function renderTrayGlyphPng(markSvg, canvasW, canvasH, glyphH) {
  // Colour tray glyph on a transparent canvas: glyphH px tall, centred
  // vertically by bounding box and horizontally by alpha centroid. The
  // mark's straight left edge and open right side put its centroid left
  // of its box centre, so a box-centred render reads left-heavy; the
  // first pass measures that offset and the second pass bakes the
  // correction into the vector placement.
  const mark = parseMarkSvg(markSvg);
  const render = (x, y) =>
    sharp(placeMarkSvg(mark, canvasW, canvasH, glyphH, x, y), { density: SVG_DENSITY })
      .resize(canvasW, canvasH)
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
  const x0 = (canvasW - glyphH * mark.aspect) / 2;
  const y0 = (canvasH - glyphH) / 2;
  const probe = await render(x0, y0);
  const shift = canvasW / 2 - (await alphaCentroidX(probe));
  const png = await render(x0 + shift, y0);
  const centroid = await alphaCentroidX(png);
  return { png, measured: `${canvasW}x${canvasH} glyph ${glyphH}h, centroid x ${centroid.toFixed(2)} (shift ${shift >= 0 ? '+' : ''}${shift.toFixed(2)})` };
}

// Tray frame sizes for Windows. Each frame is the small tile at full size: the
// tile brings its own ground, so the icon reads on a light and a dark taskbar.
const TRAY_ICO_SIZES = [16, 20, 24, 32, 40, 48];

function tileGroundSvg(size) {
  // Full-bleed flat square, no rounding. The platform (iOS, an Android launcher
  // mask) does its own rounding, or the mark is composited on top of it.
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" fill="${TILE_GROUND}"/></svg>`,
  );
}

async function renderAppIconPng(icons, size) {
  if (size <= APP_ICON_SMALL_MAX) return renderPng(icons.appIconSmall, size);
  if (size === 1024) {
    // Reuse the once-rendered 1024 buffer computed in main() instead of
    // re-invoking sharp — same deterministic bytes, one fewer rasterize.
    return icons.appIcon1024;
  }
  return renderPng(icons.appIcon, size);
}

async function writePng(path, svg, size) {
  mkdirSync(dirname(path), { recursive: true });
  const buf = await renderPng(svg, size);
  writeFileSync(path, buf);
}

async function writeTemplatePng(path, svg, height) {
  mkdirSync(dirname(path), { recursive: true });
  const buf = await renderTemplatePng(svg, height);
  writeFileSync(path, buf);
}

async function writeTrayPng(path, markSvg, canvasW, canvasH, glyphH) {
  mkdirSync(dirname(path), { recursive: true });
  const { png, measured } = await renderTrayGlyphPng(markSvg, canvasW, canvasH, glyphH);
  writeFileSync(path, png);
  return measured;
}

async function writeTrayIco(path, markSvg, sizes) {
  mkdirSync(dirname(path), { recursive: true });
  const frames = await Promise.all(sizes.map((s) => renderTrayGlyphPng(markSvg, s, s, s)));
  const ico = await pngToIco(frames.map((f) => f.png));
  writeFileSync(path, ico);
  return `${sizes.length} frames: ${frames.map((f) => f.measured).join('; ')}`;
}

async function writeAppIconPng(path, icons, size) {
  mkdirSync(dirname(path), { recursive: true });
  const buf = await renderAppIconPng(icons, size);
  writeFileSync(path, buf);
}

// Apple's icon-grid template places the visible artwork in an 824px
// square centred on a 1024 canvas (a 100px transparent margin each
// side) — every other OS frames its own icon (Windows applies its own
// padding in Explorer/taskbar, Linux desktop environments crop or pad
// per-DE, Android masks the maskable icon itself), so this margin is
// specific to the two macOS consumers: the .icns and the dev/dock
// `build/icon.png`. Renders the same badge composition as every other
// app-icon output (routed through renderAppIconPng, so 16/32 would still
// take the small variant, though neither macOS output ever requests
// those sizes) at the scaled-down inner size, then centres it on a
// transparent canvas of the requested size.
async function macIconPng(icons, size) {
  const innerSize = Math.round(size * (824 / 1024));
  const inner = await renderAppIconPng(icons, innerSize);
  const offset = Math.round((size - innerSize) / 2);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: inner, left: offset, top: offset }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function writeMacIconPng(path, icons, size) {
  mkdirSync(dirname(path), { recursive: true });
  const buf = await macIconPng(icons, size);
  writeFileSync(path, buf);
}

// Measures an already-rendered PNG buffer via sharp metadata — used to
// report .ico frame dimensions, since sharp can't read an .ico container
// back but the frame buffers are already in hand before packing.
async function dimsOfBuffer(buf) {
  const meta = await sharp(buf).metadata();
  return `${meta.width}x${meta.height}`;
}

async function writeAppIconIco(path, icons, sizes) {
  // Every pixel size routes through renderAppIconPng, so the whole .ico —
  // taskbar/Properties small reps through the Alt+Tab / explorer large
  // reps — shares the same vector rendering rule (small ↔ app-icon-small).
  // Windows auto-picks the closest size for the active DPI.
  mkdirSync(dirname(path), { recursive: true });
  const buffers = await Promise.all(sizes.map((s) => renderAppIconPng(icons, s)));
  const ico = await pngToIco(buffers);
  writeFileSync(path, ico);
  const dims = await Promise.all(buffers.map(dimsOfBuffer));
  return `${sizes.length} frames: ${dims.join(', ')}`;
}

async function writeAppIconIcns(path, macIcon1024) {
  // png2icons.createICNS takes a single high-res PNG and synthesises the
  // full 10-rep iconset internally (16/16@2x, 32/32@2x, 128/128@2x,
  // 256/256@2x, 512/512@2x) by downscaling it. Feed it the margined 1024
  // render (see macIconPng) so every synthesised rep inherits the same
  // Apple-grid margin proportionally — there's no per-rep hook into
  // png2icons to apply the margin after the fact.
  mkdirSync(dirname(path), { recursive: true });
  const icns = png2icons.createICNS(macIcon1024, png2icons.BICUBIC, 0);
  if (!icns) throw new Error(`png2icons.createICNS returned null for ${path}`);
  writeFileSync(path, icns);
  // png2icons hands back only the container bytes, no per-rep metadata —
  // report the one thing we can measure honestly: the source buffer it
  // was built from.
  const srcDims = await dimsOfBuffer(macIcon1024);
  return `${srcDims} source, container not decoded`;
}

async function writeAppleTouchIcon(path, markSvg, size, heightScale) {
  // iOS rounds the square itself and paints transparent pixels black, so the icon
  // is a full-bleed flat ground with the mark centred on it, like the maskable
  // icon. It is not app-icon.svg composited on a ground: that tile carries its
  // own rounded corners and a hairline, which would show as a faint inset
  // outline inside iOS's own mask.
  const innerHeight = Math.round(size * heightScale);
  const inner = await sharp(markSvg, { density: SVG_DENSITY })
    .resize({ height: innerHeight })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  mkdirSync(dirname(path), { recursive: true });
  const composed = await sharp(tileGroundSvg(size))
    .composite([{ input: inner, gravity: 'center' }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  writeFileSync(path, composed);
}

async function writeMaskableIcon(path, markSvg, canvas, heightScale) {
  // PWA maskable icon: the tile ground fills the full canvas (Android
  // launcher masks, such as circle, squircle or rounded-square, crop
  // arbitrarily past the icon's own bounding box, so the ground must extend
  // to every edge), with the mark centred at heightScale × canvas height.
  // Scaling by height (not by fitting a square) keeps the mark's proportions
  // identical to every other rendering of it. `markSvg` is mark-icon.svg, the
  // same white glyph as the app icon, transparent outside the glyph itself
  // so the ground shows through.
  const innerHeight = Math.round(canvas * heightScale);
  const inner = await sharp(markSvg, { density: SVG_DENSITY })
    .resize({ height: innerHeight })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  const bg = tileGroundSvg(canvas);
  mkdirSync(dirname(path), { recursive: true });
  const composed = await sharp(bg)
    .composite([{ input: inner, gravity: 'center' }])
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  writeFileSync(path, composed);
}

// ---- main ----

async function main() {
  // Spec: refuse to run if any source SVG is missing — fail loudly, not on
  // a downstream sharp error with a cryptic ENOENT.
  for (const [, path] of Object.entries(SRC)) {
    if (!existsSync(path)) {
      throw new Error(`Missing source SVG: ${relative(ROOT, path)} — see assets/brand/`);
    }
  }

  const appIcon       = loadSvg(SRC.appIcon);
  const appIconSmall  = loadSvg(SRC.appIconSmall);
  const markIcon      = loadSvg(SRC.markIcon);
  const markMonoLight = loadSvg(SRC.markMonoLight);
  const markTray      = loadSvg(SRC.markTray);

  // Rendered once at the top of the pipeline: it's both the .icns
  // synthesis input and the standalone reference export, and every
  // app-icon output ≥1024 (there's only the one) routes through it.
  const appIcon1024 = await renderPng(appIcon, 1024);

  const icons = { appIcon, appIconSmall, appIcon1024 };

  const written = [];
  // Records a row for the summary table. `info` is the routing decision
  // (which source, which rule) decided before rendering. `measured` is a
  // read-back of the actual written file — for a PNG that's always sharp's
  // own metadata on the bytes on disk, never the size we asked it to
  // render, so a resize bug or a corrupt write shows up here instead of
  // being hidden behind a label that only reflects intent. .ico/.icns
  // can't be read back by sharp as a container, so their writers hand back
  // a measured string built from the frame buffers (or source buffer)
  // they already held before packing — passed in as `measuredOverride`.
  async function trace(label, path, info, measuredOverride) {
    let measured = measuredOverride;
    if (measured === undefined) {
      if (path.endsWith('.png')) {
        const meta = await sharp(path).metadata();
        measured = `${meta.width}x${meta.height} ${meta.channels}ch${meta.hasAlpha ? '+a' : ''}`;
      } else if (path.endsWith('.svg')) {
        measured = 'vector';
      } else {
        measured = 'n/a';
      }
    }
    written.push({
      label,
      info,
      measured,
      bytes: statSync(path).size,
      path: relative(ROOT, path),
    });
  }

  // --- Brand: reference export ---
  mkdirSync(BRAND, { recursive: true });
  writeFileSync(join(BRAND, 'app-icon-1024.png'), appIcon1024);
  await trace('brand-1024', join(BRAND, 'app-icon-1024.png'), '1024x1024 (reference)');

  // --- Desktop: application icon ---
  const linuxSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  for (const s of linuxSizes) {
    const out = join(DESKTOP_BUILD, `icons/${s}x${s}.png`);
    await writeAppIconPng(out, icons, s);
    await trace('linux-png', out, `${s}x${s} (${s <= APP_ICON_SMALL_MAX ? 'small' : 'app-icon'})`);
  }

  // macOS dev/dock icon and packaged .icns: both apply Apple's icon-grid
  // margin (824/1024 artwork centred on the canvas) — see macIconPng.
  // Every other output below stays full-bleed.
  await writeMacIconPng(join(DESKTOP_BUILD, 'icon.png'), icons, 512);
  await trace('build-icon', join(DESKTOP_BUILD, 'icon.png'), '512x512 (Apple grid margin)');

  const macIcon1024 = await macIconPng(icons, 1024);
  const icnsMeasured = await writeAppIconIcns(join(DESKTOP_BUILD, 'icon.icns'), macIcon1024);
  await trace('mac-icns', join(DESKTOP_BUILD, 'icon.icns'), '10-rep iconset (Apple grid margin)', icnsMeasured);

  const winIcoMeasured = await writeAppIconIco(
    join(DESKTOP_BUILD, 'icon.ico'),
    icons,
    [16, 24, 32, 48, 64, 128, 256],
  );
  await trace('win-ico', join(DESKTOP_BUILD, 'icon.ico'), '7 sizes', winIcoMeasured);

  // --- Desktop: tray ---
  // macOS menu bar: mark-tray.svg is a silhouette tuned for the menu bar
  // (16px body on an 18x22 canvas, 2.8px arrow channel, centred by alpha
  // centroid), so it renders 1:1 here with no further fitting. The canvas
  // is 18 wide, not 22: the status item pads the image itself, and a 22px
  // box around a 12px glyph left a wider gap than the system icons keep.
  // main.ts marks the PNG as a template image and macOS tints the alpha;
  // the file must stay pure black. Electron resolves the @2x by suffix.
  await writeTemplatePng(join(DESKTOP_RES, 'tray-iconTemplate.png'), markTray, 22);
  await trace('tray-mac-1x', join(DESKTOP_RES, 'tray-iconTemplate.png'), '18x22 (mark-tray)');

  await writeTemplatePng(join(DESKTOP_RES, 'tray-iconTemplate@2x.png'), markTray, 44);
  await trace('tray-mac-2x', join(DESKTOP_RES, 'tray-iconTemplate@2x.png'), '36x44 (mark-tray)');

  // Windows and Linux trays are the small tile, which reads on a light and on
  // a dark taskbar alike. It is centred by alpha centroid, see
  // renderTrayGlyphPng.
  const trayIcoMeasured = await writeTrayIco(join(DESKTOP_RES, 'tray-icon.ico'), appIconSmall, TRAY_ICO_SIZES);
  await trace('tray-win-ico', join(DESKTOP_RES, 'tray-icon.ico'), '6 sizes (app-icon-small)', trayIcoMeasured);

  const trayPngMeasured = await writeTrayPng(join(DESKTOP_RES, 'tray-icon.png'), appIconSmall, 22, 22, 22);
  await trace('tray-linux', join(DESKTOP_RES, 'tray-icon.png'), '22x22 (app-icon-small)', trayPngMeasured);

  // --- Web: favicons + PWA + in-app ---
  // Favicons are the small tile: a white mark on transparent would vanish in a
  // light browser tab.
  await writePng(join(WEB_ICONS, 'favicon-16.png'), appIconSmall, 16);
  await trace('favicon-16', join(WEB_ICONS, 'favicon-16.png'), '16 (app-icon-small)');

  await writePng(join(WEB_ICONS, 'favicon-32.png'), appIconSmall, 32);
  await trace('favicon-32', join(WEB_ICONS, 'favicon-32.png'), '32 (app-icon-small)');

  // favicon.ico at the root, where browsers, link previews and search engines ask for
  // it without being told: 16 and 32 from the small tile, 48 from the app icon, the
  // smallest size Google's results take. The same rule as the Windows .ico.
  const faviconIcoMeasured = await writeAppIconIco(join(WEB_PUBLIC, 'favicon.ico'), icons, [16, 32, 48]);
  await trace('favicon-ico', join(WEB_PUBLIC, 'favicon.ico'), '16, 32, 48', faviconIcoMeasured);

  // The same small tile as a vector, for a browser tab at any density.
  copyFileSync(SRC.appIconSmall, join(WEB_ICONS, 'favicon.svg'));
  await trace('favicon-svg', join(WEB_ICONS, 'favicon.svg'), 'copy of app-icon-small.svg');

  await writeAppleTouchIcon(join(WEB_ICONS, 'apple-touch-icon.png'), markIcon, 180, 0.6);
  await trace('apple-touch', join(WEB_ICONS, 'apple-touch-icon.png'), '180 (mark on ground, opaque)');

  await writeAppIconPng(join(WEB_ICONS, 'icon-192.png'), icons, 192);
  await trace('pwa-192', join(WEB_ICONS, 'icon-192.png'), '192 (app-icon)');

  await writeAppIconPng(join(WEB_ICONS, 'icon-512.png'), icons, 512);
  await trace('pwa-512', join(WEB_ICONS, 'icon-512.png'), '512 (app-icon)');

  await writeMaskableIcon(join(WEB_ICONS, 'icon-maskable-512.png'), markIcon, 512, 0.6);
  await trace('pwa-maskable', join(WEB_ICONS, 'icon-maskable-512.png'), '512 (tile ground, 60% mark)');

  // In-app logo for the rail's brand tile: same app-icon render as every
  // other ≥128px consumer (dock, launcher, homescreen), just sized for the
  // rail slot. The tile's own rounded corners and hairline read cleanly
  // against the dark rail without any extra masking here.
  await writeAppIconPng(join(WEB_ICONS, 'logo.png'), icons, 256);
  await trace('in-app-logo', join(WEB_ICONS, 'logo.png'), '256 (app-icon, sidebar tile)');

  // logo-mark.svg is a byte copy of mark-mono-light.svg: the flat white mark,
  // for surfaces that need a single-colour glyph (an accent-coloured tile, a
  // notification badge) rather than the gradient mark.svg.
  copyFileSync(SRC.markMonoLight, join(WEB_ICONS, 'logo-mark.svg'));
  await trace('logo-mark-svg', join(WEB_ICONS, 'logo-mark.svg'), 'copy of mark-mono-light.svg');

  // mark.svg is the full-colour mark on transparent, a byte copy of assets/brand/mark.svg:
  // the login page, the empty states and the About page draw it as an <img>.
  copyFileSync(SRC.mark, join(WEB_ICONS, 'mark.svg'));
  await trace('mark-svg', join(WEB_ICONS, 'mark.svg'), 'copy of mark.svg');

  // --- Summary ---
  const fmtBytes = (n) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };
  console.log('\nGenerated icons:');
  console.log(
    '  ' + 'kind'.padEnd(14) + 'info'.padEnd(32) + 'measured'.padEnd(34) + 'size'.padStart(10) + '  path',
  );
  console.log(
    '  ' + '----'.padEnd(14) + '----'.padEnd(32) + '--------'.padEnd(34) + '----'.padStart(10) + '  ----',
  );
  for (const r of written) {
    console.log(
      '  ' +
        r.label.padEnd(14) +
        r.info.padEnd(32) +
        r.measured.padEnd(34) +
        fmtBytes(r.bytes).padStart(10) +
        '  ' +
        r.path,
    );
  }
  const totalBytes = written.reduce((sum, r) => sum + r.bytes, 0);
  console.log(`\n${written.length} files written, ${fmtBytes(totalBytes)} total.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
