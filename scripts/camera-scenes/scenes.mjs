/**
 * The scenes a person can lay behind themselves on camera (packages/web/src/camera/,
 * docs/systems/voice.md, "Camera backgrounds"), drawn as SVG. draw.mjs renders them.
 *
 * Each is a room seen through a lens focused on the person in front of it: the room is soft,
 * its lights turn into round blurs, and light falls into it from above in the colour of the
 * place, as everywhere in the app (docs/systems/design-system.md). Nothing is busy in the
 * middle, where the person sits. Everything is made from shapes and a seeded random, so the
 * pictures come out the same every time.
 */

export const WIDTH = 1280;
export const HEIGHT = 720;

/** mulberry32: a small seeded random, so a scene draws the same every time. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (next, low, high) => low + (high - low) * next();
const pick = (next, list) => list[Math.floor(next() * list.length) % list.length];
const n = (value) => Math.round(value * 10) / 10;

/**
 * The whole picture: `back` is the room, softened by the depth of field; `front` (bokeh,
 * light) is softened more; a fine grain keeps the gradients from banding in the JPEG.
 */
function picture({ defs = '', back, front = '', depth, grain = 0.07 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    ${defs}
    <filter id="depth" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${depth}"/></filter>
    <filter id="bokeh" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${depth * 2.2}"/></filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="28"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <g filter="url(#depth)">${back}</g>
  <g filter="url(#bokeh)">${front}</g>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" filter="url(#grain)" opacity="${grain}" style="mix-blend-mode:overlay"/>
</svg>`;
}

/** A light falling from above: a wide pool of colour at the top edge. */
function lightFromAbove(id, color, strength, { cx = 0.5, spread = 0.8 } = {}) {
  return {
    defs: `<radialGradient id="${id}" cx="${cx}" cy="-0.04" r="${spread}">
      <stop offset="0" stop-color="${color}" stop-opacity="${strength}"/>
      <stop offset="0.45" stop-color="${color}" stop-opacity="${n(strength * 0.35)}"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>`,
    shape: `<rect x="-60" y="-60" width="${WIDTH + 120}" height="${HEIGHT + 120}" fill="url(#${id})"/>`,
  };
}

/** Round blurs of lights out of focus, in `colors`, within a box. */
function bokeh(next, count, { x0, x1, y0, y1, r0, r1, colors, o0, o1 }) {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    out += `<circle cx="${n(between(next, x0, x1))}" cy="${n(between(next, y0, y1))}" r="${n(between(next, r0, r1))}" fill="${pick(next, colors)}" opacity="${n(between(next, o0, o1) * 100) / 100}"/>`;
  }
  return out;
}

/** The app's own room: a wall of graphite slats, the violet light falling on it from above. */
function graphite() {
  const light = lightFromAbove('graphite-light', '#7466e8', 0.4, { spread: 0.8 });
  const white = lightFromAbove('graphite-white', '#e8e6ff', 0.09, { spread: 0.45 });
  let slats = '';
  for (let x = -40, i = 0; x < WIDTH + 40; x += 18, i += 1) {
    slats += `<rect x="${x}" y="-60" width="18" height="620" fill="${i % 2 === 0 ? '#1b1c22' : '#18191e'}"/>
      <rect x="${x}" y="-60" width="1.5" height="620" fill="#fff" opacity="0.055"/>
      <rect x="${x + 16}" y="-60" width="2" height="620" fill="#000" opacity="0.32"/>`;
  }
  return picture({
    depth: 2.6,
    defs: `${light.defs}${white.defs}
      <linearGradient id="graphite-shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.7" stop-color="#000" stop-opacity="0.25"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/>
      </linearGradient>
      <linearGradient id="graphite-floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#17181d"/><stop offset="1" stop-color="#0b0c0e"/>
      </linearGradient>
      <linearGradient id="graphite-wash" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#c9c3ff" stop-opacity="0"/><stop offset="1" stop-color="#c9c3ff" stop-opacity="0.07"/>
      </linearGradient>`,
    back: `<rect x="-60" y="-60" width="${WIDTH + 120}" height="${HEIGHT + 120}" fill="#141519"/>
      ${slats}
      <rect x="-60" y="-60" width="${WIDTH + 120}" height="620" fill="url(#graphite-shade)"/>
      <rect x="860" y="-60" width="480" height="620" fill="url(#graphite-wash)"/>
      <rect x="-60" y="560" width="${WIDTH + 120}" height="220" fill="url(#graphite-floor)"/>
      <rect x="-60" y="559" width="${WIDTH + 120}" height="1.5" fill="#fff" opacity="0.07"/>
      ${light.shape}${white.shape}`,
    front: `<ellipse cx="640" cy="600" rx="520" ry="50" fill="#7466e8" opacity="0.07"/>`,
  });
}

/** A tavern: a beam, two lanterns, shelves of bottles, everything warm and out of focus. */
function tavern() {
  const next = random(1701);
  const light = lightFromAbove('tavern-light', '#f2a65a', 0.34, { spread: 0.9 });
  const glassColors = ['#9a5a1c', '#b8742a', '#2f5d3a', '#3e6e44', '#5b3418', '#7c8a86', '#6a2028', '#8a4a1e'];
  let shelves = '';
  for (const [y, height] of [[250, 125], [420, 135]]) {
    let x = 70;
    while (x < 1210) {
      if (next() < 0.14) {
        x += between(next, 18, 60);
        continue;
      }
      const isMug = next() < 0.18;
      const width = isMug ? between(next, 34, 46) : between(next, 22, 36);
      const tall = isMug ? between(next, 34, 48) : between(next, height * 0.55, height * 0.95);
      const color = isMug ? pick(next, ['#6b4a2e', '#7a5634', '#5a3d27']) : pick(next, glassColors);
      const top = y - tall;
      if (isMug) {
        shelves += `<rect x="${n(x)}" y="${n(top)}" width="${n(width)}" height="${n(tall)}" rx="4" fill="${color}" opacity="0.9"/>
          <path d="M${n(x + width)} ${n(top + tall * 0.25)} q14 4 0 ${n(tall * 0.45)}" stroke="${color}" stroke-width="5" fill="none" opacity="0.9"/>`;
      } else {
        const neck = width * 0.32;
        const shoulder = top + tall * 0.38;
        shelves += `<path d="M${n(x)} ${n(y)} V${n(shoulder + 10)} Q${n(x)} ${n(shoulder)} ${n(x + (width - neck) / 2)} ${n(shoulder - 8)} V${n(top)} H${n(x + (width + neck) / 2)} V${n(shoulder - 8)} Q${n(x + width)} ${n(shoulder)} ${n(x + width)} ${n(shoulder + 10)} V${n(y)} Z" fill="${color}" opacity="0.88"/>
          <rect x="${n(x + width * 0.18)}" y="${n(shoulder + 6)}" width="2.5" height="${n((y - shoulder) * 0.7)}" fill="#ffe2b0" opacity="0.32"/>`;
        if (next() < 0.5) shelves += `<rect x="${n(x + 3)}" y="${n(shoulder + (y - shoulder) * 0.35)}" width="${n(width - 6)}" height="${n((y - shoulder) * 0.3)}" fill="#e8d4a8" opacity="0.5"/>`;
      }
      x += width + between(next, 6, 14);
    }
    shelves += `<rect x="40" y="${y}" width="1200" height="16" fill="#4a2d18"/><rect x="40" y="${y}" width="1200" height="2" fill="#b07a44" opacity="0.5"/>
      <rect x="40" y="${y + 16}" width="1200" height="10" fill="#000" opacity="0.35"/>`;
  }
  let planks = '';
  for (let x = -40; x < WIDTH + 40; x += 64) {
    const tone = pick(next, ['#24170f', '#20140d', '#271a11', '#1d120c']);
    planks += `<rect x="${x}" y="70" width="64" height="${HEIGHT}" fill="${tone}"/><rect x="${x}" y="70" width="2" height="${HEIGHT}" fill="#000" opacity="0.45"/>`;
  }
  const lantern = (cx, top) => `<rect x="${cx - 1}" y="70" width="2" height="${top - 70}" fill="#000" opacity="0.6"/>
    <rect x="${cx - 16}" y="${top}" width="32" height="44" rx="5" fill="#2a1a0f"/>
    <rect x="${cx - 11}" y="${top + 6}" width="22" height="32" rx="3" fill="#ffcf8a"/>
    <circle cx="${cx}" cy="${top + 22}" r="9" fill="#fff4dc"/>`;
  return picture({
    depth: 3.6,
    grain: 0.08,
    defs: `${light.defs}
      <radialGradient id="tavern-lamp" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#ffc77a" stop-opacity="0.75"/><stop offset="0.35" stop-color="#f2a65a" stop-opacity="0.28"/><stop offset="1" stop-color="#f2a65a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="tavern-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a100a"/><stop offset="1" stop-color="#0b0705"/></linearGradient>`,
    back: `<rect x="-60" y="-60" width="${WIDTH + 120}" height="${HEIGHT + 120}" fill="#1c120c"/>
      ${planks}
      <rect x="-60" y="-60" width="${WIDTH + 120}" height="130" fill="#120a06"/>
      <rect x="-60" y="66" width="${WIDTH + 120}" height="4" fill="#5a3920" opacity="0.6"/>
      ${shelves}
      <rect x="-60" y="560" width="${WIDTH + 120}" height="220" fill="url(#tavern-floor)"/>
      ${lantern(300, 120)}${lantern(985, 108)}
      ${light.shape}`,
    front: `<circle cx="300" cy="142" r="230" fill="url(#tavern-lamp)"/>
      <circle cx="985" cy="130" r="250" fill="url(#tavern-lamp)"/>
      ${bokeh(next, 34, { x0: 0, x1: WIDTH, y0: 40, y1: 470, r0: 10, r1: 34, colors: ['#ffc77a', '#f2a65a', '#ffd9a0', '#e8915a'], o0: 0.08, o1: 0.3 })}`,
  });
}

/** A study: a wall of books in the app's accent colours, a lamp in the corner. */
function library() {
  const next = random(2203);
  const light = lightFromAbove('library-light', '#f4d7a8', 0.26, { cx: 0.62, spread: 0.85 });
  const spines = ['#3f8a6a', '#b07a5a', '#6e66a8', '#3f6f99', '#a8802e', '#9a4d63', '#a85a48', '#5b5249', '#3d3a36', '#4f6b5c', '#7a6a8f'];
  let books = '';
  const rows = [150, 290, 430, 570];
  for (const base of rows) {
    let x = 52;
    while (x < 1228) {
      if (next() < 0.06) {
        x += between(next, 30, 80);
        continue;
      }
      const width = between(next, 11, 28);
      const height = between(next, 82, 122);
      const color = pick(next, spines);
      const lean = next() < 0.08 ? between(next, -9, 9) : 0;
      const top = base - height;
      const bands = next() < 0.6 ? `<rect x="${n(x)}" y="${n(top + height * 0.12)}" width="${n(width)}" height="3" fill="#000" opacity="0.28"/><rect x="${n(x)}" y="${n(top + height * 0.8)}" width="${n(width)}" height="3" fill="#000" opacity="0.28"/>` : '';
      const label = next() < 0.4 ? `<rect x="${n(x + width * 0.25)}" y="${n(top + height * 0.35)}" width="${n(width * 0.5)}" height="${n(height * 0.18)}" fill="#f1e6d0" opacity="0.35"/>` : '';
      books += `<g transform="rotate(${n(lean)} ${n(x + width / 2)} ${base})"><rect x="${n(x)}" y="${n(top)}" width="${n(width)}" height="${n(height)}" rx="1.5" fill="${color}" opacity="0.82"/>${bands}${label}<rect x="${n(x)}" y="${n(top)}" width="1.5" height="${n(height)}" fill="#fff" opacity="0.12"/></g>`;
      x += width + (lean ? 8 : between(next, 0.5, 2.5));
    }
    books += `<rect x="30" y="${base}" width="1220" height="14" fill="#2f2117"/><rect x="30" y="${base}" width="1220" height="2" fill="#a07a52" opacity="0.4"/><rect x="30" y="${base + 14}" width="1220" height="12" fill="#000" opacity="0.4"/>`;
  }
  const posts = [30, 336, 642, 948, 1236].map((x) => `<rect x="${x}" y="0" width="16" height="${HEIGHT}" fill="#271b13"/><rect x="${x}" y="0" width="2" height="${HEIGHT}" fill="#a07a52" opacity="0.25"/>`).join('');
  return picture({
    depth: 3.8,
    defs: `${light.defs}
      <radialGradient id="library-lamp" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#ffd59a" stop-opacity="0.65"/><stop offset="0.4" stop-color="#f2b46a" stop-opacity="0.2"/><stop offset="1" stop-color="#f2b46a" stop-opacity="0"/>
      </radialGradient>`,
    back: `<rect x="-60" y="-60" width="${WIDTH + 120}" height="${HEIGHT + 120}" fill="#17130f"/>
      <rect x="-60" y="-60" width="${WIDTH + 120}" height="100" fill="#0f0c09"/>
      ${books}${posts}
      <path d="M1090 40 h90 l-22 48 h-46 z" fill="#3b2a1c"/><rect x="1132" y="0" width="3" height="40" fill="#000" opacity="0.6"/>
      ${light.shape}`,
    front: `<circle cx="1135" cy="110" r="300" fill="url(#library-lamp)"/>
      ${bokeh(next, 14, { x0: 820, x1: WIDTH, y0: 20, y1: 260, r0: 12, r1: 30, colors: ['#ffd59a', '#f2b46a'], o0: 0.08, o1: 0.22 })}`,
  });
}

/** A big window onto a city at night: lit windows far off, its lights as round blurs. */
function nightWindow() {
  const next = random(3307);
  const light = lightFromAbove('night-light', '#8fb4ff', 0.18, { spread: 0.9 });
  const frame = { x: 150, y: 60, w: 980, h: 500 };
  let city = '';
  let x = frame.x - 20;
  while (x < frame.x + frame.w + 20) {
    const width = between(next, 50, 130);
    const height = between(next, 90, 330);
    const top = frame.y + frame.h - height;
    const tone = pick(next, ['#0d1424', '#101a2e', '#0b1120', '#131d33']);
    city += `<rect x="${n(x)}" y="${n(top)}" width="${n(width)}" height="${n(height)}" fill="${tone}"/>`;
    for (let wy = top + 12; wy < frame.y + frame.h - 10; wy += 15) {
      for (let wx = x + 8; wx < x + width - 8; wx += 12) {
        if (next() < 0.32) {
          const lit = pick(next, ['#f2c27a', '#f2c27a', '#ffd9a0', '#9ccfff', '#c7b8ff']);
          city += `<rect x="${n(wx)}" y="${n(wy)}" width="4" height="5" fill="${lit}" opacity="${n(between(next, 0.35, 0.9) * 100) / 100}"/>`;
        }
      }
    }
    x += width + between(next, 2, 16);
  }
  const bars = `<rect x="${frame.x - 18}" y="${frame.y - 18}" width="${frame.w + 36}" height="18" fill="#1b1e26"/>
    <rect x="${frame.x - 18}" y="${frame.y + frame.h}" width="${frame.w + 36}" height="22" fill="#1d2029"/>
    <rect x="${frame.x - 18}" y="${frame.y + frame.h}" width="${frame.w + 36}" height="2" fill="#fff" opacity="0.1"/>
    <rect x="${frame.x - 18}" y="${frame.y}" width="18" height="${frame.h}" fill="#1b1e26"/>
    <rect x="${frame.x + frame.w}" y="${frame.y}" width="18" height="${frame.h}" fill="#1b1e26"/>
    <rect x="${frame.x + frame.w / 3 - 5}" y="${frame.y}" width="10" height="${frame.h}" fill="#1b1e26"/>
    <rect x="${frame.x + (frame.w * 2) / 3 - 5}" y="${frame.y}" width="10" height="${frame.h}" fill="#1b1e26"/>
    <rect x="${frame.x}" y="${frame.y + frame.h * 0.42}" width="${frame.w}" height="10" fill="#1b1e26"/>`;
  return picture({
    depth: 2.8,
    defs: `${light.defs}
      <linearGradient id="night-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#071022"/><stop offset="0.6" stop-color="#16213f"/><stop offset="1" stop-color="#33305a"/>
      </linearGradient>
      <linearGradient id="night-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13151b"/><stop offset="1" stop-color="#0b0c0f"/></linearGradient>
      <clipPath id="night-glass"><rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}"/></clipPath>`,
    back: `<rect x="-60" y="-60" width="${WIDTH + 120}" height="${HEIGHT + 120}" fill="url(#night-wall)"/>
      <g clip-path="url(#night-glass)">
        <rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="url(#night-sky)"/>
        ${city}
        <rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="#7d9cff" opacity="0.05"/>
      </g>
      ${bars}
      ${light.shape}`,
    front: `<rect x="${frame.x}" y="${frame.y + frame.h - 120}" width="${frame.w}" height="160" fill="#3a3a78" opacity="0.18" filter="url(#glow)"/>
      ${bokeh(next, 26, { x0: frame.x + 20, x1: frame.x + frame.w - 20, y0: frame.y + frame.h * 0.5, y1: frame.y + frame.h - 10, r0: 8, r1: 26, colors: ['#f2c27a', '#ffd9a0', '#9ccfff', '#c7b8ff', '#8fd3c0'], o0: 0.14, o1: 0.4 })}`,
  });
}

/** One leaf, centred on (cx, cy), lying along `angle` degrees. */
function leafShape(cx, cy, length, angle, color, opacity) {
  const half = length / 2;
  const width = length * 0.34;
  return `<g transform="translate(${n(cx)} ${n(cy)}) rotate(${n(angle)})" opacity="${opacity}">
    <path d="M${n(-half)} 0 C${n(-half * 0.4)} ${n(-width)} ${n(half * 0.5)} ${n(-width * 0.8)} ${n(half)} 0 C${n(half * 0.5)} ${n(width * 0.8)} ${n(-half * 0.4)} ${n(width)} ${n(-half)} 0 Z" fill="${color}"/>
    <path d="M${n(-half)} 0 L${n(half * 0.92)} 0" stroke="#bfeed4" stroke-width="1.5" opacity="0.22"/>
  </g>`;
}

/** A plant growing up from (x, base): stems fanning out, a long leaf at the end of each. */
function plant(next, x, base, { height, spread, stems, leaf, colors, stem = '#1c3a2a', opacity = 1 }) {
  let out = '';
  for (let i = 0; i < stems; i += 1) {
    const angle = (-90 + between(next, -spread, spread)) * (Math.PI / 180);
    const length = height * between(next, 0.55, 1);
    const ex = x + Math.cos(angle) * length;
    const ey = base + Math.sin(angle) * length;
    const bend = between(next, -40, 40);
    out += `<path d="M${n(x)} ${n(base)} Q${n((x + ex) / 2 + bend)} ${n((base + ey) / 2)} ${n(ex)} ${n(ey)}" stroke="${stem}" stroke-width="${n(between(next, 2.5, 4.5))}" fill="none" opacity="${opacity}"/>`;
    const size = between(next, leaf * 0.7, leaf);
    const degrees = (angle * 180) / Math.PI + between(next, -12, 12);
    const tip = (degrees * Math.PI) / 180;
    out += leafShape(ex + Math.cos(tip) * size * 0.45, ey + Math.sin(tip) * size * 0.45, size, degrees, pick(next, colors), opacity);
  }
  return out;
}

/** A vine hanging from the roof at x, its small leaves to either side. */
function vine(next, x, length, colors) {
  const sway = between(next, -60, 60);
  let out = `<path d="M${n(x)} -10 Q${n(x + sway)} ${n(length * 0.5)} ${n(x + sway * 0.4)} ${n(length)}" stroke="#1c3a2a" stroke-width="2.5" fill="none"/>`;
  for (let t = 0.12; t < 1; t += between(next, 0.07, 0.12)) {
    const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * (x + sway) + t * t * (x + sway * 0.4);
    const py = (1 - t) * (1 - t) * -10 + 2 * (1 - t) * t * (length * 0.5) + t * t * length;
    const side = Math.round(t * 20) % 2 === 0 ? 1 : -1;
    out += leafShape(px + side * 22, py, between(next, 38, 62), side > 0 ? between(next, 10, 50) : between(next, 130, 170), pick(next, colors), 0.92);
  }
  return out;
}

/** A greenhouse: daylight through glass, plants growing up at the sides, vines from the roof. */
function greenhouse() {
  const next = random(4409);
  const light = lightFromAbove('greenhouse-light', '#bdf0d2', 0.3, { spread: 0.9 });
  let glass = '';
  for (let x = -40; x < WIDTH + 40; x += 160) glass += `<rect x="${x}" y="-60" width="5" height="${HEIGHT + 120}" fill="#d8f5e6" opacity="0.08"/>`;
  for (const y of [150, 330]) glass += `<rect x="-60" y="${y}" width="${WIDTH + 120}" height="4" fill="#d8f5e6" opacity="0.07"/>`;
  const far = ['#173a2a', '#1b4130', '#14321f'];
  const mid = ['#1f4a35', '#2a5c42', '#24533c', '#2f6b4a'];
  const bright = ['#2f6b4a', '#3a7a55', '#2a5c42'];
  const back = [
    plant(next, 120, 760, { height: 520, spread: 55, stems: 9, leaf: 150, colors: far, opacity: 0.8 }),
    plant(next, 1160, 760, { height: 540, spread: 55, stems: 9, leaf: 150, colors: far, opacity: 0.8 }),
    plant(next, 640, 790, { height: 260, spread: 70, stems: 7, leaf: 110, colors: far, opacity: 0.55 }),
  ].join('');
  const sides = [
    plant(next, 40, 760, { height: 470, spread: 40, stems: 8, leaf: 190, colors: mid }),
    plant(next, 290, 780, { height: 330, spread: 45, stems: 6, leaf: 160, colors: bright }),
    plant(next, 1240, 760, { height: 480, spread: 40, stems: 8, leaf: 190, colors: mid }),
    plant(next, 1000, 780, { height: 340, spread: 45, stems: 6, leaf: 160, colors: bright }),
    vine(next, 430, 250, mid),
    vine(next, 860, 220, mid),
    vine(next, 650, 120, bright),
  ].join('');
  return picture({
    depth: 3.2,
    defs: `${light.defs}
      <linearGradient id="greenhouse-air" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#34483f"/><stop offset="0.5" stop-color="#1b2722"/><stop offset="1" stop-color="#0e1412"/>
      </linearGradient>`,
    back: `<rect x="-60" y="-60" width="${WIDTH + 120}" height="${HEIGHT + 120}" fill="url(#greenhouse-air)"/>
      ${glass}${back}${sides}
      ${light.shape}`,
    front: `${leafShape(30, 690, 360, -35, '#12291d', 0.95)}${leafShape(1250, 680, 380, 215, '#143024', 0.95)}
      ${bokeh(next, 16, { x0: 220, x1: 1060, y0: 10, y1: 220, r0: 14, r1: 34, colors: ['#e6fbef', '#bdf0d2', '#fff6d8'], o0: 0.05, o1: 0.14 })}`,
  });
}

/** Scene id (as in packages/web/src/camera/backgrounds.ts) → its file name and drawing. */
export const SCENES = [
  { id: 'graphite', file: 'graphite', draw: graphite },
  { id: 'tavern', file: 'tavern', draw: tavern },
  { id: 'library', file: 'library', draw: library },
  { id: 'nightWindow', file: 'night-window', draw: nightWindow },
  { id: 'greenhouse', file: 'greenhouse', draw: greenhouse },
];
