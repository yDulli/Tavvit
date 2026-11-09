#!/usr/bin/env node
/**
 * Cuts the badges out of the badge sheet (`assets/badges v3.png`: 8 rows of 8 flat marks on a dark
 * ground) into transparent pictures, one per badge of the registry (docs/systems/badges.md;
 * `BADGE_CELLS` below names the row and column of each), written to
 * `packages/web/src/badges/images/`.
 *
 * The marks are used exactly as the sheet draws them. The rows and columns are found in the sheet
 * itself, as the bands its ink falls in, since its margins are not even. The ground is then taken
 * away pixel by pixel: a pixel's cover is how far it stands from the ground's colour, measured
 * against the strongest stand-off near it, and its colour is the one that, laid over the ground
 * at that cover, gives back the sheet's own pixel. So inside a mark every pixel is the sheet's,
 * its smoothed edges stay smooth, and it lies on any surface without the sheet's ground. Every
 * mark is framed in one square of the same size, so their sizes keep to one another as drawn.
 *
 *   node scripts/badges/cut.mjs                  write the registry's pictures
 *   node scripts/badges/cut.mjs --preview <dir>  also every mark of the sheet, and contact
 *                                                sheets on the app's surfaces, to choose from
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHEET = join(ROOT, 'assets', 'badges v3.png');
const OUT = join(ROOT, 'packages', 'web', 'src', 'badges', 'images');
const ROWS = 8;
const COLUMNS = 8;
/** The side of a written picture: a badge is shown at 16 to 32px, so this is sharp at three times that. */
const SIDE = 96;

/** Which mark of the sheet each badge of the registry is: [row, column], counted from the top left. */
export const BADGE_CELLS = {
  staff: [0, 1],
  bot: [0, 6],
  server_owner: [0, 0],
  administrator: [1, 0],
  moderator: [4, 4],
  helper: [1, 2],
  founder: [7, 6],
  early_supporter: [4, 7],
  bug_hunter: [5, 0],
  developer: [0, 7],
  creator: [3, 5],
  event_participant: [6, 6],
  community_contributor: [2, 2],
  beta_tester: [5, 1],
  verified: [7, 3],
  partner: [6, 2],
};

/** Below this stand-off from the ground's colour a pixel is ground (the sheet's grain). */
const GRAIN = 10;
/** Past this stand-off a pixel is ink, for finding the rows and columns and each mark's extent. */
const INK = 28;
/** A gap in the ink shorter than this does not part two rows or columns. */
const BRIDGE = 12;
/** How far around a pixel the strongest stand-off is looked for, and how far past its extent a mark may reach. */
const NEAR = 4;
/** The weakest stand-off a mark's own colour may have: no mark is drawn closer to the ground than this. */
const FAINTEST_MARK = 48;
/** The frame around the largest mark, in its own size: room for its smoothed edges. */
const FRAME_ROOM = 1.12;

const args = process.argv.slice(2);
const previewAt = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null;

const { data, info } = await sharp(SHEET).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const at = (x, y) => (y * width + x) * 3;

// The ground: the median of the sheet, which is mostly ground.
const ground = [0, 1, 2].map((channel) => {
  const values = [];
  for (let i = channel; i < data.length; i += 3 * 7) values.push(data[i]);
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
});

const standOff = new Float32Array(width * height);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = at(x, y);
    standOff[y * width + x] = Math.max(Math.abs(data[i] - ground[0]), Math.abs(data[i + 1] - ground[1]), Math.abs(data[i + 2] - ground[2]));
  }
}

/** The runs along one axis where ink falls, gaps shorter than BRIDGE closed: the rows, or the columns. */
function bands(length, inkAt) {
  const runs = [];
  let start = -1;
  let lastInk = -BRIDGE - 1;
  for (let p = 0; p < length; p += 1) {
    if (!inkAt(p)) continue;
    if (start < 0) start = p;
    else if (p - lastInk > BRIDGE) {
      runs.push([start, lastInk]);
      start = p;
    }
    lastInk = p;
  }
  if (start >= 0) runs.push([start, lastInk]);
  return runs;
}

const rowInk = new Uint32Array(height);
const colInk = new Uint32Array(width);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    if (standOff[y * width + x] > INK) {
      rowInk[y] += 1;
      colInk[x] += 1;
    }
  }
}
const rows = bands(height, (y) => rowInk[y] > 0);
const cols = bands(width, (x) => colInk[x] > 0);
if (rows.length !== ROWS || cols.length !== COLUMNS) {
  throw new Error(`The sheet should hold ${ROWS} rows of ${COLUMNS} marks; its ink falls in ${rows.length} rows and ${cols.length} columns.`);
}

/** Each mark's extent: its ink inside its row and column. */
const marks = rows.map(([y0, y1]) => cols.map(([x0, x1]) => {
  let minX = x1; let minY = y1; let maxX = x0; let maxY = y0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (standOff[y * width + x] <= INK) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}));
const largest = Math.max(...marks.flat().map((mark) => Math.max(mark.maxX - mark.minX + 1, mark.maxY - mark.minY + 1)));
const FRAME = Math.ceil(largest * FRAME_ROOM);

/** One mark as a transparent square of FRAME sheet pixels, centred on it. */
function cutMark({ minX, minY, maxX, maxY }) {
  const left = Math.round((minX + maxX) / 2) - Math.floor(FRAME / 2);
  const top = Math.round((minY + maxY) / 2) - Math.floor(FRAME / 2);
  const rgba = Buffer.alloc(FRAME * FRAME * 4);
  for (let y = 0; y < FRAME; y += 1) {
    for (let x = 0; x < FRAME; x += 1) {
      const sx = left + x;
      const sy = top + y;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      // Only this mark: the frame may reach a neighbour's ink.
      if (sx < minX - NEAR || sx > maxX + NEAR || sy < minY - NEAR || sy > maxY + NEAR) continue;
      const d = standOff[sy * width + sx];
      if (d <= GRAIN) continue;
      let strongest = 0;
      for (let dy = -NEAR; dy <= NEAR; dy += 1) {
        for (let dx = -NEAR; dx <= NEAR; dx += 1) {
          const nx = sx + dx;
          const ny = sy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          strongest = Math.max(strongest, standOff[ny * width + nx]);
        }
      }
      const cover = Math.max(0, Math.min(1, (d - GRAIN) / (Math.max(strongest, FAINTEST_MARK) - GRAIN)));
      if (cover <= 0) continue;
      const i = at(sx, sy);
      const o = (y * FRAME + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        // The colour that, at this cover over the ground, is the sheet's own pixel.
        rgba[o + channel] = Math.max(0, Math.min(255, Math.round((data[i + channel] - (1 - cover) * ground[channel]) / cover)));
      }
      rgba[o + 3] = Math.round(cover * 255);
    }
  }
  return rgba;
}

/** A cut mark at `side` pixels. */
function sized(rgba, side) {
  return sharp(rgba, { raw: { width: FRAME, height: FRAME, channels: 4 } }).resize(side, side, { kernel: 'lanczos3' });
}

mkdirSync(OUT, { recursive: true });
for (const [id, [row, col]] of Object.entries(BADGE_CELLS)) {
  const file = join(OUT, `${id}.webp`);
  await sized(cutMark(marks[row][col]), SIDE).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(file);
  console.log(`${id.padEnd(22)} row ${row}, column ${col}  ${file.slice(ROOT.length + 1)}`);
}

if (previewAt) {
  mkdirSync(previewAt, { recursive: true });
  const cells = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
      const cut = cutMark(marks[row][col]);
      const large = await sized(cut, 96).png().toBuffer();
      const small = await sized(cut, 32).png().toBuffer();
      writeFileSync(join(previewAt, `badge-${row}-${col}.png`), large);
      cells.push({ row, col, large, small });
    }
  }
  // Contact sheets on the app's surfaces: the floating card's and the content's.
  for (const [name, background] of [['on-floating', '#1e1f25'], ['on-content', '#15161b']]) {
    const tile = 120;
    const composites = [];
    for (const { row, col, large, small } of cells) {
      composites.push({ input: large, left: col * tile + 4, top: row * tile + 4 });
      composites.push({ input: small, left: col * tile + 84, top: row * tile + 84 });
    }
    await sharp({ create: { width: COLUMNS * tile, height: ROWS * tile, channels: 4, background } })
      .composite(composites)
      .png()
      .toFile(join(previewAt, `${name}.png`));
  }
  console.log(`preview in ${previewAt}`);
}
