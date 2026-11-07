#!/usr/bin/env node
/**
 * Cuts the badges out of the badge sheet (`assets/brand/badge sheet.png`: 8 rows of 8 badges on a
 * lit grey ground) into transparent pictures, one per badge of the registry
 * (docs/systems/badges.md; `BADGE_CELLS` below names the row and column of each), written to
 * `packages/web/src/badges/images/`.
 *
 * A badge is drawn with crisp edges; the ground, its light, the shadows under the badges and the
 * glows around some are all soft. So the badges are found by their edges, the soft rest is worked
 * out as one smooth field and taken away, and what is left sits flat on any surface: no shadow,
 * no glow. Everything a badge's rim encloses stays whole, even where its dark face is close to
 * the ground's tone.
 *
 *   node scripts/badges/cut.mjs                  write the registry's pictures
 *   node scripts/badges/cut.mjs --preview <dir>  also every badge of the sheet, and contact
 *                                                sheets on the app's surfaces, to choose from
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHEET = join(ROOT, 'assets', 'brand', 'badge sheet.png');
const OUT = join(ROOT, 'packages', 'web', 'src', 'badges', 'images');
const ROWS = 8;
const COLUMNS = 8;
/** The side of a written picture: a badge is shown at 14 to 24px, so this is sharp at three times that. */
const SIDE = 72;

/** Which badge of the sheet each badge of the registry is: [row, column], counted from the top left. */
export const BADGE_CELLS = {
  staff: [7, 5],
  bot: [0, 7],
  server_owner: [0, 0],
  administrator: [0, 5],
  moderator: [0, 4],
  helper: [3, 6],
  founder: [0, 1],
  early_supporter: [2, 3],
  bug_hunter: [1, 0],
  developer: [0, 6],
  creator: [1, 5],
  event_participant: [2, 6],
  community_contributor: [1, 2],
  beta_tester: [1, 7],
  verified: [0, 3],
  partner: [2, 2],
};

/** A change in brightness this steep, between a pixel's neighbours, is the edge of a drawing. */
const EDGE_STEEP = 16;
/** How far around its edges a badge reaches: for finding it, and for leaving the ground out. */
const FIND_REACH = 4;
const GROUND_REACH = 8;
/** Below this difference from the ground a pixel outside a rim is clear; above the upper one, wholly badge. */
const CLEAR_BELOW = 6;
const SOLID_ABOVE = 26;
/** A pixel this much lighter than the ground is a rim or a drawing: the ground's flood stops there. */
const RIM_LIGHTER = 14;

const args = process.argv.slice(2);
const previewAt = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null;

const { data, info } = await sharp(SHEET).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const N = W * H;
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const luma = new Float32Array(N);
for (let k = 0; k < N; k += 1) luma[k] = lum(data[k * 3], data[k * 3 + 1], data[k * 3 + 2]);

// ── Edges ───────────────────────────────────────────────────────────────────
const edge = new Uint8Array(N);
for (let y = 1; y < H - 1; y += 1) {
  for (let x = 1; x < W - 1; x += 1) {
    const k = y * W + x;
    const gx = Math.abs(luma[k + 1] - luma[k - 1]);
    const gy = Math.abs(luma[k + W] - luma[k - W]);
    if (gx + gy > EDGE_STEEP) edge[k] = 1;
  }
}

/** A mask grown by `reach` pixels (a square neighbourhood, done one step at a time). */
function grow(mask, reach) {
  let current = mask;
  for (let step = 0; step < reach; step += 1) {
    const next = current.slice();
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const k = y * W + x;
        if (current[k]) continue;
        if ((x > 0 && current[k - 1]) || (x < W - 1 && current[k + 1]) || (y > 0 && current[k - W]) || (y < H - 1 && current[k + W])) next[k] = 1;
      }
    }
    current = next;
  }
  return current;
}

/** A mask with what it encloses filled in: whatever the sheet's edge cannot reach around it. */
function filled(mask) {
  const reached = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  const seed = (k) => {
    if (reached[k] || mask[k]) return;
    reached[k] = 1;
    queue[tail++] = k;
  };
  for (let x = 0; x < W; x += 1) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y += 1) { seed(y * W); seed(y * W + W - 1); }
  while (head < tail) {
    const k = queue[head++];
    const x = k % W;
    if (x > 0) seed(k - 1);
    if (x < W - 1) seed(k + 1);
    if (k >= W) seed(k - W);
    if (k < N - W) seed(k + W);
  }
  const out = new Uint8Array(N);
  for (let k = 0; k < N; k += 1) out[k] = reached[k] ? 0 : 1;
  return out;
}

// ── The ground ──────────────────────────────────────────────────────────────
// Everything away from the badges, blurred so that only what is ground counts: block sums on a
// coarse grid, a gaussian across it, back up to every pixel. Close by, a fine blur follows the
// light and the shadows; deep inside a badge, where no ground is near, a wide one stands in.
const notGround = filled(grow(edge, GROUND_REACH));
const BLOCK = 8;
const GW = Math.ceil(W / BLOCK);
const GH = Math.ceil(H / BLOCK);

function gaussianOnGrid(values, channels, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = [];
  for (let k = -radius; k <= radius; k += 1) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const pass = (input, horizontal) => {
    const output = new Float64Array(input.length);
    for (let y = 0; y < GH; y += 1) {
      for (let x = 0; x < GW; x += 1) {
        for (let c = 0; c < channels; c += 1) {
          let sum = 0;
          for (let k = -radius; k <= radius; k += 1) {
            const xx = horizontal ? Math.min(GW - 1, Math.max(0, x + k)) : x;
            const yy = horizontal ? y : Math.min(GH - 1, Math.max(0, y + k));
            sum += input[(yy * GW + xx) * channels + c] * kernel[k + radius];
          }
          output[(y * GW + x) * channels + c] = sum;
        }
      }
    }
    return output;
  };
  return pass(pass(values, true), false);
}

const sums = new Float64Array(GW * GH * 3);
const weights = new Float64Array(GW * GH);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const k = y * W + x;
    if (notGround[k]) continue;
    const g = Math.floor(y / BLOCK) * GW + Math.floor(x / BLOCK);
    for (let c = 0; c < 3; c += 1) sums[g * 3 + c] += data[k * 3 + c];
    weights[g] += 1;
  }
}
const fineSums = gaussianOnGrid(sums, 3, 1.5);
const fineWeights = gaussianOnGrid(weights, 1, 1.5);
const wideSums = gaussianOnGrid(sums, 3, 8);
const wideWeights = gaussianOnGrid(weights, 1, 8);
const blockGround = new Float64Array(GW * GH * 3);
const fullBlock = BLOCK * BLOCK;
for (let g = 0; g < GW * GH; g += 1) {
  // How much ground the fine blur saw, against a block's worth: enough, and it alone decides.
  const share = Math.min(1, fineWeights[g] / (fullBlock * 0.6));
  for (let c = 0; c < 3; c += 1) {
    const fine = fineSums[g * 3 + c] / Math.max(1e-9, fineWeights[g]);
    const wide = wideSums[g * 3 + c] / Math.max(1e-9, wideWeights[g]);
    blockGround[g * 3 + c] = fineWeights[g] > 1e-6 ? share * fine + (1 - share) * wide : wide;
  }
}
const ground = new Float32Array(N * 3);
for (let y = 0; y < H; y += 1) {
  const gy = Math.min(GH - 1, Math.max(0, (y + 0.5) / BLOCK - 0.5));
  const y0 = Math.floor(gy);
  const y1 = Math.min(GH - 1, y0 + 1);
  const fy = gy - y0;
  for (let x = 0; x < W; x += 1) {
    const gx = Math.min(GW - 1, Math.max(0, (x + 0.5) / BLOCK - 0.5));
    const x0 = Math.floor(gx);
    const x1 = Math.min(GW - 1, x0 + 1);
    const fx = gx - x0;
    for (let c = 0; c < 3; c += 1) {
      const top = blockGround[(y0 * GW + x0) * 3 + c] * (1 - fx) + blockGround[(y0 * GW + x1) * 3 + c] * fx;
      const bottom = blockGround[(y1 * GW + x0) * 3 + c] * (1 - fx) + blockGround[(y1 * GW + x1) * 3 + c] * fx;
      ground[(y * W + x) * 3 + c] = top * (1 - fy) + bottom * fy;
    }
  }
}
const difference = new Float32Array(N);
const lighter = new Float32Array(N);
for (let k = 0; k < N; k += 1) {
  let d = 0;
  for (let c = 0; c < 3; c += 1) d = Math.max(d, Math.abs(data[k * 3 + c] - ground[k * 3 + c]));
  difference[k] = d;
  lighter[k] = luma[k] - lum(ground[k * 3], ground[k * 3 + 1], ground[k * 3 + 2]);
}

// ── The badges ──────────────────────────────────────────────────────────────
// Each badge is one region of edges grown a little and filled in; a part that stands apart
// (the arcs of an antenna, a number inside laurels) joins the largest region next to it.
const region = filled(grow(edge, FIND_REACH));
const label = new Int32Array(N).fill(-1);
const regions = [];
{
  const queue = new Int32Array(N);
  for (let start = 0; start < N; start += 1) {
    if (!region[start] || label[start] !== -1) continue;
    const id = regions.length;
    let head = 0;
    let tail = 0;
    label[start] = id;
    queue[tail++] = start;
    const found = { id, pixels: [], minX: W, minY: H, maxX: -1, maxY: -1 };
    while (head < tail) {
      const k = queue[head++];
      found.pixels.push(k);
      const x = k % W;
      const y = (k - x) / W;
      found.minX = Math.min(found.minX, x);
      found.maxX = Math.max(found.maxX, x);
      found.minY = Math.min(found.minY, y);
      found.maxY = Math.max(found.maxY, y);
      const neighbours = [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1];
      for (const nk of neighbours) {
        if (nk >= 0 && region[nk] && label[nk] === -1) {
          label[nk] = id;
          queue[tail++] = nk;
        }
      }
    }
    regions.push(found);
  }
}
const MAIN = 2500;
const mains = regions.filter((r) => r.pixels.length >= MAIN);
if (mains.length !== ROWS * COLUMNS) {
  throw new Error(`found ${mains.length} badges on the sheet, expected ${ROWS * COLUMNS}: ${mains.map((b) => `${b.minX},${b.minY} ${b.maxX - b.minX + 1}x${b.maxY - b.minY + 1}`).join('; ')}`);
}
const badges = mains.map((main) => ({ ...main, parts: [main] }));
for (const small of regions.filter((r) => r.pixels.length < MAIN && r.pixels.length >= 8)) {
  let best = null;
  let bestApart = Infinity;
  for (const badge of badges) {
    const apart = Math.max(small.minX - badge.maxX, badge.minX - small.maxX, small.minY - badge.maxY, badge.minY - small.maxY);
    if (apart < bestApart) {
      bestApart = apart;
      best = badge;
    }
  }
  if (best && bestApart <= 14) {
    best.parts.push(small);
    best.minX = Math.min(best.minX, small.minX);
    best.minY = Math.min(best.minY, small.minY);
    best.maxX = Math.max(best.maxX, small.maxX);
    best.maxY = Math.max(best.maxY, small.maxY);
  }
}
// Rows by height on the sheet, then each row from the left.
badges.sort((a, b) => (a.minY + a.maxY) - (b.minY + b.maxY));
const grid = [];
for (let row = 0; row < ROWS; row += 1) {
  grid.push(badges.slice(row * COLUMNS, (row + 1) * COLUMNS).sort((a, b) => (a.minX + a.maxX) - (b.minX + b.maxX)));
}

const smoothstep = (low, high, value) => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** One badge cut out: RGBA of its box and where in that box the badge is. */
function cutBadge(badge) {
  const pad = 2;
  const x0 = Math.max(0, badge.minX - pad);
  const y0 = Math.max(0, badge.minY - pad);
  const x1 = Math.min(W - 1, badge.maxX + pad);
  const y1 = Math.min(H - 1, badge.maxY + pad);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const n = bw * bh;
  const ours = new Uint8Array(n);
  for (const part of badge.parts) for (const k of part.pixels) {
    const x = k % W;
    const y = (k - x) / W;
    ours[(y - y0) * bw + (x - x0)] = 1;
  }
  // The ground floods in from the box's edges over everything not lighter than itself. It stops
  // at a rim, so what a rim encloses is never reached and stays whole.
  const outside = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (i, j) => {
    const k = j * bw + i;
    if (outside[k] || lighter[(y0 + j) * W + (x0 + i)] >= RIM_LIGHTER) return;
    outside[k] = 1;
    queue[tail++] = k;
  };
  for (let i = 0; i < bw; i += 1) { seed(i, 0); seed(i, bh - 1); }
  for (let j = 0; j < bh; j += 1) { seed(0, j); seed(bw - 1, j); }
  while (head < tail) {
    const k = queue[head++];
    const i = k % bw;
    const j = (k - i) / bw;
    if (i > 0) seed(i - 1, j);
    if (i < bw - 1) seed(i + 1, j);
    if (j > 0) seed(i, j - 1);
    if (j < bh - 1) seed(i, j + 1);
  }
  const rgba = Buffer.alloc(n * 4);
  for (let j = 0; j < bh; j += 1) {
    for (let i = 0; i < bw; i += 1) {
      const k = j * bw + i;
      const p = (y0 + j) * W + (x0 + i);
      let alpha = 0;
      if (ours[k]) alpha = outside[k] ? smoothstep(CLEAR_BELOW, SOLID_ABOVE, difference[p]) : 1;
      if (alpha < 0.04) alpha = 0;
      for (let c = 0; c < 3; c += 1) {
        // Undo the ground's share, so the colour is the badge's own over any surface.
        const own = alpha > 0 ? (data[p * 3 + c] - (1 - alpha) * ground[p * 3 + c]) / alpha : 0;
        rgba[k * 4 + c] = Math.max(0, Math.min(255, Math.round(own)));
      }
      rgba[k * 4 + 3] = Math.round(alpha * 255);
    }
  }
  return { rgba, width: bw, height: bh, box: { minX: badge.minX - x0 + FIND_REACH, minY: badge.minY - y0 + FIND_REACH, maxX: badge.maxX - x0 - FIND_REACH, maxY: badge.maxY - y0 - FIND_REACH } };
}

/** A cut badge as a square picture of `side` pixels, centred in it. */
async function square({ rgba, width, height, box }, side) {
  const pad = 2;
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const size = Math.max(w, h) + pad * 2;
  const left = Math.round(box.minX + w / 2 - size / 2);
  const top = Math.round(box.minY + h / 2 - size / 2);
  // The square may reach past the cut box: lay it on a transparent canvas big enough for it.
  const canvasWidth = width + size * 2;
  const canvasHeight = height + size * 2;
  const placed = await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: rgba, raw: { width, height, channels: 4 }, left: size, top: size }])
    .raw()
    .toBuffer();
  return sharp(placed, { raw: { width: canvasWidth, height: canvasHeight, channels: 4 } })
    .extract({ left: left + size, top: top + size, width: size, height: size })
    .resize(side, side, { kernel: 'lanczos3' });
}

mkdirSync(OUT, { recursive: true });
for (const [id, [row, col]] of Object.entries(BADGE_CELLS)) {
  const picture = await square(cutBadge(grid[row][col]), SIDE);
  const file = join(OUT, `${id}.webp`);
  await picture.webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(file);
  console.log(`${id.padEnd(22)} row ${row}, column ${col}  ${file.slice(ROOT.length + 1)}`);
}

if (previewAt) {
  mkdirSync(previewAt, { recursive: true });
  const cells = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
      const cut = cutBadge(grid[row][col]);
      const large = await (await square(cut, 96)).png().toBuffer();
      const small = await (await square(cut, 36)).png().toBuffer();
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
      composites.push({ input: small, left: col * tile + 80, top: row * tile + 80 });
    }
    await sharp({ create: { width: COLUMNS * tile, height: ROWS * tile, channels: 4, background } })
      .composite(composites)
      .png()
      .toFile(join(previewAt, `${name}.png`));
  }
  console.log(`preview in ${previewAt}`);
}
