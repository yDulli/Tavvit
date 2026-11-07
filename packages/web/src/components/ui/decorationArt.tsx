import type { CSSProperties, ReactNode } from 'react';
import type { AvatarFrame, Nameplate, ProfileEffect } from '@backspace/shared/src/decorations';

/**
 * The decorations' drawings (docs/systems/decorations.md, "Drawings"): pictures of things, made by
 * hand as vector drawings in one style, never light or glow. Each is a few flat shapes in two or
 * three tones of its colour with a darker outline of the same hue, lit from the upper left, and
 * moves only where a movement says something (a note leaving the headphones, an ear twitching, a
 * flame flickering, a petal falling). The motion itself is CSS (`styles/decorations.css`).
 *
 * A frame is drawn in the picture's own box, 0 to 100 on both axes, in a view a fifth larger on
 * every side; what sits behind the head (`back`) is drawn under the picture, what sits in front of
 * it (`front`) over it. Effects and nameplates are scenes in boxes of their own, and what falls or
 * rises in them is a small drawing (`sprites`) moved by the particles of `utils/decorations.ts`.
 */

export type FrameLayer = 'back' | 'front';

/** The view of a frame's drawing: the picture's box (0 to 100) and a fifth more on every side. */
export const FRAME_VIEW = '-20 -20 140 140';

const round = (value: number): number => Math.round(value * 100) / 100;
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/* ═══ Shapes several designs share ═══════════════════════════════════════ */

/** A five-pointed star round (x, y). */
function starPath(x: number, y: number, outer: number, inner = outer * 0.5, turn = 0): string {
  const points: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = radians(-90 + turn + index * 36);
    points.push(`${round(x + radius * Math.cos(angle))} ${round(y + radius * Math.sin(angle))}`);
  }
  return `M${points.join('L')}Z`;
}

/** A four-pointed sparkle round (x, y), `size` from its middle to each point. */
function sparklePath(x: number, y: number, size: number): string {
  const w = size * 0.18;
  const p = (dx: number, dy: number) => `${round(x + dx)} ${round(y + dy)}`;
  return `M${p(0, -size)}C${p(w, -w)} ${p(w, -w)} ${p(size, 0)}C${p(w, w)} ${p(w, w)} ${p(0, size)}C${p(-w, w)} ${p(-w, w)} ${p(-size, 0)}C${p(-w, -w)} ${p(-w, -w)} ${p(0, -size)}Z`;
}

/** A heart round (x, y), `size` wide, point down. */
function heartPath(x: number, y: number, size: number): string {
  const k = size / 17;
  const p = (dx: number, dy: number) => `${round(x + dx * k)} ${round(y + dy * k)}`;
  return `M${p(0, 8)}C${p(-2, 6.1)} ${p(-8.5, 1.9)} ${p(-8.5, -3.3)}C${p(-8.5, -6.1)} ${p(-6.4, -8)} ${p(-4, -8)}`
    + `C${p(-2.2, -8)} ${p(-0.8, -6.9)} ${p(0, -5.5)}C${p(0.8, -6.9)} ${p(2.2, -8)} ${p(4, -8)}`
    + `C${p(6.4, -8)} ${p(8.5, -6.1)} ${p(8.5, -3.3)}C${p(8.5, 1.9)} ${p(2, 6.1)} ${p(0, 8)}Z`;
}

/** A snowflake round (x, y): six arms, each with a pair of twigs. */
function snowflakePath(x: number, y: number, radius: number): string {
  const parts: string[] = [];
  for (let arm = 0; arm < 6; arm += 1) {
    const angle = radians(arm * 60 - 90);
    parts.push(`M${round(x)} ${round(y)}L${round(x + radius * Math.cos(angle))} ${round(y + radius * Math.sin(angle))}`);
    const baseX = x + radius * 0.56 * Math.cos(angle);
    const baseY = y + radius * 0.56 * Math.sin(angle);
    for (const side of [-1, 1]) {
      const twig = angle + side * radians(42);
      parts.push(`M${round(baseX)} ${round(baseY)}L${round(baseX + radius * 0.32 * Math.cos(twig))} ${round(baseY + radius * 0.32 * Math.sin(twig))}`);
    }
  }
  return parts.join('');
}

/** A cherry blossom: five petals round its middle, `scale` 1 for one about 18 across. */
function Blossom({ x, y, scale = 1, turn = 0, petal = '#f7aec4', line = '#b4567a' }: {
  x: number;
  y: number;
  scale?: number;
  turn?: number;
  petal?: string;
  line?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn}) scale(${scale})`}>
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse key={angle} cx={0} cy={-4.6} rx={3.6} ry={4.8} transform={`rotate(${angle})`} fill={petal} stroke={line} strokeWidth={1.4} />
      ))}
      <circle r={2.5} fill="#f4c94f" stroke="#9b7a12" strokeWidth={1.2} />
    </g>
  );
}

/** A small leaf pointing along +x from its stalk, `length` long. */
function leafPath(length: number): string {
  const l = length;
  return `M0 0C${round(l * 0.26)} ${round(-l * 0.3)} ${round(l * 0.7)} ${round(-l * 0.32)} ${l} 0C${round(l * 0.7)} ${round(l * 0.32)} ${round(l * 0.26)} ${round(l * 0.3)} 0 0Z`;
}

/** Points along a circle round the picture's middle: `angle` from the top, clockwise. */
const aroundHead = (angle: number, radius: number): [number, number] => [
  round(50 + radius * Math.sin(radians(angle))),
  round(50 - radius * Math.cos(radians(angle))),
];

/** A soft path through points (Catmull-Rom as cubic curves). */
function smoothPath(points: readonly [number, number][]): string {
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    d += `C${round(p1[0] + (p2[0] - p0[0]) / 6)} ${round(p1[1] + (p2[1] - p0[1]) / 6)} ${round(p2[0] - (p3[0] - p1[0]) / 6)} ${round(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** A cloud: puffs over a flat base, outlined round the whole (the outline is drawn first, under the fill). */
function Cloud({ x, y, scale = 1, fill = '#ffffff', line = '#8a9ab0' }: { x: number; y: number; scale?: number; fill?: string; line?: string }) {
  const puffs = [[-9, 2, 6.4], [-1.5, -3.4, 8], [8, 0, 6.6], [13, 4, 4.6]] as const;
  const shapes = (
    <>
      {puffs.map(([cx, cy, r], index) => <circle key={index} cx={cx} cy={cy} r={r} />)}
      <rect x={-15} y={1.5} width={32} height={7.5} rx={3.75} />
    </>
  );
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g fill={line} stroke={line} strokeWidth={3}>{shapes}</g>
      <g fill={fill}>{shapes}</g>
      <path d="M-12.6 1.2C-12.2 -1.6 -10 -3.4 -7.4 -3.6" fill="none" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={1.3} strokeLinecap="round" />
    </g>
  );
}

/** A crescent moon round (x, y). */
function Moon({ x, y, radius, fill = '#f6e7b8', line = '#a68b48' }: { x: number; y: number; radius: number; fill?: string; line?: string }) {
  const r = radius;
  const d = `M${round(x + r * 0.42)} ${round(y - r * 0.9)}A${r} ${r} 0 1 0 ${round(x + r * 0.96)} ${round(y + r * 0.3)}A${round(r * 0.8)} ${round(r * 0.8)} 0 0 1 ${round(x + r * 0.42)} ${round(y - r * 0.9)}Z`;
  return (
    <g>
      <path d={d} fill={fill} stroke={line} strokeWidth={Math.max(0.9, r * 0.14)} strokeLinejoin="round" />
      <circle cx={round(x - r * 0.38)} cy={round(y + r * 0.1)} r={round(r * 0.16)} fill={line} opacity={0.35} />
      <circle cx={round(x - r * 0.1)} cy={round(y + r * 0.52)} r={round(r * 0.11)} fill={line} opacity={0.35} />
    </g>
  );
}

/* ═══ Frames ════════════════════════════════════════════════════════════ */

/* ── Headphones ── */

const HEADPHONE = { shell: '#eceef2', light: '#ffffff', line: '#656a77', cushion: '#3a3d47', cushionLine: '#25272e', accent: '#ef8a6a', accentLine: '#a24a33' };

function HeadphoneCup() {
  return (
    <g>
      <rect x={-11} y={39} width={15} height={38} rx={7.5} fill={HEADPHONE.shell} stroke={HEADPHONE.line} strokeWidth={2.2} />
      <rect x={-11} y={53} width={3.4} height={10} rx={1.7} fill={HEADPHONE.accent} />
      <path d="M-6.4 45.5C-7.4 52 -7.4 64 -6.4 70.5" fill="none" stroke={HEADPHONE.light} strokeWidth={2.2} strokeLinecap="round" />
      <rect x={2.5} y={42} width={8.5} height={32} rx={4.25} fill={HEADPHONE.cushion} stroke={HEADPHONE.cushionLine} strokeWidth={2} />
      <path d="M5.4 47V69" stroke="#4d515d" strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}

function Note({ beamed }: { beamed: boolean }) {
  if (beamed) {
    return (
      <g fill={HEADPHONE.accent} stroke={HEADPHONE.accentLine} strokeWidth={1.1}>
        <ellipse cx={0} cy={9} rx={3.1} ry={2.4} transform="rotate(-22 0 9)" />
        <ellipse cx={8} cy={7} rx={3.1} ry={2.4} transform="rotate(-22 8 7)" />
        <path d="M2.7 8.2V-2.6M10.7 6.2V-4.6" fill="none" strokeWidth={1.8} stroke={HEADPHONE.accent} strokeLinecap="round" />
        <path d="M2.7 -2.6L10.7 -4.6" fill="none" strokeWidth={2.8} stroke={HEADPHONE.accent} strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g fill={HEADPHONE.accent} stroke={HEADPHONE.accentLine} strokeWidth={1.1}>
      <ellipse cx={0} cy={9} rx={3.3} ry={2.5} transform="rotate(-22 0 9)" />
      <path d="M2.9 8.2V-3.4C4.6 -0.6 7.4 0.4 6.9 4.6" fill="none" strokeWidth={1.8} stroke={HEADPHONE.accent} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Headphones({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') {
    return (
      <g>
        <path d="M-6 46A56 56 0 0 1 106 46L98 46A48 48 0 0 0 2 46Z" fill={HEADPHONE.shell} stroke={HEADPHONE.line} strokeWidth={2.2} strokeLinejoin="round" />
        <path d="M14.8 16.4A46 46 0 0 1 85.2 16.4" fill="none" stroke={HEADPHONE.accent} strokeWidth={5} strokeLinecap="round" />
        <path d="M23.5 0.1A53 53 0 0 1 76.5 0.1" fill="none" stroke={HEADPHONE.light} strokeWidth={2} strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g>
      <HeadphoneCup />
      <g transform="matrix(-1 0 0 1 100 0)"><HeadphoneCup /></g>
      <g className="deco-art-passing">
        <g transform="translate(106 30)"><g className="deco-art-note"><Note beamed={false} /></g></g>
        <g transform="translate(110 38)"><g className="deco-art-note deco-art-late"><Note beamed /></g></g>
      </g>
    </g>
  );
}

/* ── Cat ears ── */

const EAR = { fur: '#f4eee8', line: '#6f6359', inner: '#f3a4b8', innerShade: '#e08aa0' };

function CatEar() {
  return (
    <g>
      <path d="M4 40C-5 26 -7 4 0 -12Q3.5 -19.5 9.5 -16C22 -10 36 -3 46 6Z" fill={EAR.fur} stroke={EAR.line} strokeWidth={2.2} strokeLinejoin="round" />
      <path d="M9 30C3 18 2 2 6 -7.5Q8.6 -12.6 13 -9.8C23 -4 31 1 38 8Z" fill={EAR.inner} />
      <path d="M8.2 -5.6C12.6 -2.4 17 1.2 20.6 5.4" fill="none" stroke={EAR.innerShade} strokeWidth={1.6} strokeLinecap="round" />
      <path d="M-2.4 2C-2.6 -4 -1.6 -8.6 0.6 -12" fill="none" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" />
    </g>
  );
}

function CatEars({ layer }: { layer: FrameLayer }) {
  if (layer === 'front') return null;
  return (
    <g>
      <g className="deco-art-ear"><CatEar /></g>
      <g transform="matrix(-1 0 0 1 100 0)"><g className="deco-art-ear deco-art-late"><CatEar /></g></g>
    </g>
  );
}

/* ── Crown ── */

const GOLD = { base: '#f2c84b', light: '#ffe28a', shade: '#cf9a2c', line: '#7a5410' };

function Crown({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') return null;
  return (
    <g transform="translate(31 5) rotate(-15) scale(0.84)">
      <g className="deco-art-crown">
        <path d="M-20 2L-22 -22L-11 -11L0 -26L11 -11L22 -22L20 2Z" fill={GOLD.base} stroke={GOLD.line} strokeWidth={2.4} strokeLinejoin="round" />
        <path d="M-18.8 -4L-20 -17.8L-12.4 -10.2L-12 -4Z" fill={GOLD.light} />
        <path d="M-3.6 -4L-0.2 -21.2L1.2 -4Z" fill={GOLD.light} opacity={0.75} />
        <rect x={-21} y={-6} width={42} height={9} rx={2.5} fill={GOLD.shade} stroke={GOLD.line} strokeWidth={2.2} />
        <path d="M-17.6 -3.4H15.6" stroke={GOLD.light} strokeWidth={1.4} strokeLinecap="round" />
        <ellipse cx={0} cy={-1.5} rx={3.6} ry={2.8} fill="#e0465e" stroke="#6d1726" strokeWidth={1.4} />
        <circle cx={-11.5} cy={-1.5} r={2.3} fill="#4f8ff0" stroke="#1d427e" strokeWidth={1.3} />
        <circle cx={11.5} cy={-1.5} r={2.3} fill="#4f8ff0" stroke="#1d427e" strokeWidth={1.3} />
        <circle cx={-22} cy={-23.6} r={2.8} fill={GOLD.light} stroke={GOLD.line} strokeWidth={1.8} />
        <circle cx={0} cy={-27.8} r={3} fill={GOLD.light} stroke={GOLD.line} strokeWidth={1.8} />
        <circle cx={22} cy={-23.6} r={2.8} fill={GOLD.light} stroke={GOLD.line} strokeWidth={1.8} />
      </g>
      <g className="deco-art-pop"><path d={sparklePath(16, -19, 5)} fill="#fffbe8" stroke={GOLD.line} strokeWidth={1.1} strokeLinejoin="round" /></g>
    </g>
  );
}

/* ── Angel: a halo over the head, wings behind it ── */

function Wing() {
  return (
    <g className="deco-art-wing">
      <path d="M14 48C6 36 -4 22 -17 14C-15.4 21 -16.4 26.4 -14.6 30C-17.8 33 -18.6 39 -16 43C-18 46.6 -17.6 52 -14 55C-7 56.4 3 55 14 52Z" fill="#fbfbfd" stroke="#7f8796" strokeWidth={2.2} strokeLinejoin="round" />
      <path d="M-12.4 31.4C-4.6 32.4 3.4 36 10 41M-13.4 44C-5.4 44.2 2.8 46.2 10 49.4" stroke="#c4cad7" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <path d="M-14.2 18.6C-8.4 22.6 -2.4 28.2 2.6 34" stroke="#ffffff" strokeWidth={1.6} fill="none" strokeLinecap="round" />
    </g>
  );
}

function Angel({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') {
    return (
      <g>
        <Wing />
        <g transform="matrix(-1 0 0 1 100 0)"><Wing /></g>
      </g>
    );
  }
  return (
    <g className="deco-art-float">
      <ellipse cx={50} cy={-9} rx={25} ry={6.5} fill="none" stroke="#8a6a12" strokeWidth={6.4} />
      <ellipse cx={50} cy={-9} rx={25} ry={6.5} fill="none" stroke="#f6d35e" strokeWidth={4} />
      <path d="M30.6 -12.6A25 6.5 0 0 1 46 -15.3" stroke="#fff4c2" strokeWidth={1.5} fill="none" strokeLinecap="round" />
    </g>
  );
}

/* ── Horns ── */

function Horn() {
  return (
    <g>
      <path d="M17 18C9.6 8 7 -4 10.6 -17.6C15.4 -9.6 25 -3.6 37 5.4Z" fill="#c23a46" stroke="#4d0f18" strokeWidth={2.2} strokeLinejoin="round" />
      <path d="M12.4 6.6C16.4 5.4 20.6 5.8 24 8M11.4 -2.4C14.6 -3.2 17.6 -2.6 20.2 -0.8" stroke="#86202d" strokeWidth={1.5} fill="none" strokeLinecap="round" />
      <path d="M11.4 1.6C10.6 -4.2 10.8 -9.6 12.2 -13.8" stroke="#ef7a80" strokeWidth={1.8} fill="none" strokeLinecap="round" />
    </g>
  );
}

function Horns({ layer }: { layer: FrameLayer }) {
  if (layer === 'front') return null;
  return (
    <g>
      <Horn />
      <g transform="matrix(-1 0 0 1 100 0)"><Horn /></g>
    </g>
  );
}

/* ── Laurel ── */

const LAUREL_COLORS = { leaf: '#e2bd5f', light: '#f3d995', line: '#7d5b16', rib: '#b4892c', stem: '#a07a24' };
const LAUREL_RADIUS = 57;

const onLaurel = (degrees: number): [number, number] => [
  round(50 + LAUREL_RADIUS * Math.cos(radians(degrees))),
  round(50 + LAUREL_RADIUS * Math.sin(radians(degrees))),
];

/** Leaves along the left branch, from the bottom up: alternately outward and inward, smaller towards the tip. */
const LAUREL_LEAVES = [104, 114, 124, 134, 144, 154, 164, 174, 184, 194, 203].map((degrees, index) => {
  const [x, y] = onLaurel(degrees);
  const along = (Math.atan2(Math.cos(radians(degrees)), -Math.sin(radians(degrees))) * 180) / Math.PI;
  return {
    x,
    y,
    rotation: round(index === 10 ? along : along + (index % 2 === 0 ? -40 : 40)),
    scale: round(1.05 - index * 0.035),
  };
});

const [STEM_FROM_X, STEM_FROM_Y] = onLaurel(98);
const [STEM_TO_X, STEM_TO_Y] = onLaurel(206);
const LAUREL_STEM = `M${STEM_FROM_X} ${STEM_FROM_Y}A${LAUREL_RADIUS} ${LAUREL_RADIUS} 0 0 1 ${STEM_TO_X} ${STEM_TO_Y}`;

function LaurelBranch() {
  return (
    <g>
      <path d={LAUREL_STEM} fill="none" stroke={LAUREL_COLORS.stem} strokeWidth={2.4} strokeLinecap="round" />
      {LAUREL_LEAVES.map((leaf, index) => (
        <g key={index} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rotation}) scale(${leaf.scale})`}>
          <path d={leafPath(14)} fill={LAUREL_COLORS.leaf} stroke={LAUREL_COLORS.line} strokeWidth={1.5} strokeLinejoin="round" />
          <path d="M0.8 -0.3C4 -3 9.4 -3.6 13.2 -0.2Z" fill={LAUREL_COLORS.light} />
          <path d="M2 0H11.6" stroke={LAUREL_COLORS.rib} strokeWidth={1.1} strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
}

const BOW = { ribbon: '#d4485e', light: '#ec7d8e', line: '#6e1d2c', shade: '#a8344a' };

function Laurel({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') {
    return (
      <g>
        <LaurelBranch />
        <g transform="matrix(-1 0 0 1 100 0)"><LaurelBranch /></g>
      </g>
    );
  }
  return (
    <g transform="matrix(0.84 0 0 0.84 8 13.5)">
      <g className="deco-art-bow" stroke={BOW.line} strokeWidth={2} strokeLinejoin="round">
        <path d="M47.6 104.6L41 116.6L45 115.4L46.8 119.2L51.4 105.6Z" fill={BOW.shade} />
        <path d="M52.4 104.6L59 116.6L55 115.4L53.2 119.2L48.6 105.6Z" fill={BOW.shade} />
        <path d="M50 103C42.6 95.6 33.6 96.4 34.4 103.4C35.2 110.2 43.2 109.4 50 103Z" fill={BOW.ribbon} />
        <path d="M50 103C57.4 95.6 66.4 96.4 65.6 103.4C64.8 110.2 56.8 109.4 50 103Z" fill={BOW.ribbon} />
        <path d="M37.6 101.6C39.6 99.4 43 99.2 46 101.4" fill="none" stroke={BOW.light} strokeWidth={1.6} strokeLinecap="round" />
        <rect x={46.4} y={99.4} width={7.2} height={7.4} rx={2.6} fill={BOW.light} />
      </g>
    </g>
  );
}

/* ── Blossoms: a crown of cherry blossoms ── */

const CROWN_LEAVES = [-74, -46, -16, 16, 46, 74].map((angle, index) => {
  const [x, y] = aroundHead(angle, 51);
  return { x, y, rotation: round(angle + (index % 2 === 0 ? -150 : -30)) };
});

const CROWN_BLOSSOMS = [
  { angle: -60, scale: 0.86, petal: '#fdeef3', line: '#b98aa0' },
  { angle: -31, scale: 1, petal: '#f7aec4', line: '#b4567a' },
  { angle: 0, scale: 1.08, petal: '#fdeef3', line: '#b98aa0' },
  { angle: 31, scale: 1, petal: '#f7aec4', line: '#b4567a' },
  { angle: 60, scale: 0.86, petal: '#fdeef3', line: '#b98aa0' },
].map((blossom, index) => {
  const [x, y] = aroundHead(blossom.angle, 51);
  return { ...blossom, x, y, turn: index * 17 };
});

function Blossoms({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') return null;
  return (
    <g>
      {CROWN_LEAVES.map((leaf, index) => (
        <path key={index} d={leafPath(11)} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rotation})`} fill="#7cc48a" stroke="#2f6e44" strokeWidth={1.4} strokeLinejoin="round" />
      ))}
      {CROWN_BLOSSOMS.map((blossom, index) => (
        <Blossom key={index} x={blossom.x} y={blossom.y} scale={blossom.scale} turn={blossom.turn} petal={blossom.petal} line={blossom.line} />
      ))}
      <g className="deco-art-passing">
        <g transform="translate(98 30)">
          <g className="deco-art-drift">
            <ellipse cx={0} cy={0} rx={2.6} ry={3.6} fill="#f7aec4" stroke="#b4567a" strokeWidth={1.1} />
          </g>
        </g>
      </g>
    </g>
  );
}

/* ── Flames ── */

const FLAMES = [
  { x: 6, tip: 8, width: 9, speed: 1.1 },
  { x: 20, tip: -9, width: 11, speed: 0.9 },
  { x: 36, tip: -18, width: 12, speed: 1.25 },
  { x: 52, tip: -14, width: 12, speed: 1 },
  { x: 67, tip: -18, width: 12, speed: 1.15 },
  { x: 82, tip: -7, width: 11, speed: 0.95 },
  { x: 95, tip: 9, width: 9, speed: 1.2 },
];

function flamePath(x: number, tip: number, width: number, base = 34): string {
  return `M${x - width} ${base}C${x - width - 2} ${base - 14} ${round(x - width * 0.4)} ${tip + 12} ${x} ${tip}C${round(x + width * 0.4)} ${tip + 12} ${x + width + 2} ${base - 14} ${x + width} ${base}Z`;
}

function Flames({ layer }: { layer: FrameLayer }) {
  if (layer === 'front') return null;
  const flame = (scale: number) => FLAMES.map((f, index) => (
    <path
      key={index}
      className="deco-art-flame"
      style={{ animationDuration: `${f.speed}s` } as CSSProperties}
      d={flamePath(f.x, round(34 - (34 - f.tip) * scale), round(f.width * (0.35 + scale * 0.65)))}
    />
  ));
  return (
    <g>
      <g fill="#7c2410" stroke="#7c2410" strokeWidth={4.4} strokeLinejoin="round">{flame(1)}</g>
      <g fill="#f0662f">{flame(1)}</g>
      <g fill="#f99b38">{flame(0.72)}</g>
      <g fill="#ffd863">{flame(0.44)}</g>
    </g>
  );
}

/* ── Frost: snow on the head ── */

const SNOW_PUFFS = [[-64, 7.5], [-44, 9], [-22, 10], [0, 10.5], [22, 10], [44, 9], [64, 7.5]].map(([angle, r]) => {
  const [x, y] = aroundHead(angle!, 48);
  return { x, y, r: r! };
});

function Frost({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') return null;
  const puffs = (shift = 0, shrink = 0) => SNOW_PUFFS.map((puff, index) => <circle key={index} cx={puff.x} cy={puff.y - shift} r={puff.r - shrink} />);
  return (
    <g>
      <g fill="none" stroke="#7f9fbf" strokeWidth={4.6}>{puffs()}</g>
      <g fill="#dcebf8">{puffs()}</g>
      <g fill="#ffffff">{puffs(1.8, 1)}</g>
      <path d="M38.6 12.4L43 12.6L40.6 21Z M58.6 12.6L62.6 13L60.4 19.6Z" fill="#d7eefc" stroke="#6aa6cc" strokeWidth={1.3} strokeLinejoin="round" />
      <g className="deco-art-passing">
        {[{ x: -9, y: 48, delay: 0 }, { x: 109, y: 54, delay: 1.6 }, { x: -6, y: 70, delay: 3 }].map((flake, index) => (
          <g key={index} transform={`translate(${flake.x} ${flake.y})`}>
            <g className="deco-art-drift" style={{ animationDelay: `${flake.delay}s` } as CSSProperties}>
              <path d={snowflakePath(0, 0, 4.6)} stroke="#7f9fbf" strokeWidth={3} strokeLinecap="round" fill="none" />
              <path d={snowflakePath(0, 0, 4.6)} stroke="#ffffff" strokeWidth={1.4} strokeLinecap="round" fill="none" />
            </g>
          </g>
        ))}
      </g>
    </g>
  );
}

/* ── Stars ── */

const STAR_GOLD = { fill: '#ffd84d', light: '#fff1a8', line: '#9a7414' };

function Stars({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') return null;
  return (
    <g strokeLinejoin="round">
      <g transform="translate(87 -1)">
        <g className="deco-art-sway">
          <path d={starPath(0, 0, 11.5)} fill={STAR_GOLD.fill} stroke={STAR_GOLD.line} strokeWidth={2.2} />
          <path d={starPath(-1.2, -1, 5.6)} fill={STAR_GOLD.light} />
        </g>
      </g>
      <g transform="translate(106 21)"><g className="deco-art-twinkle"><path d={starPath(0, 0, 7)} fill={STAR_GOLD.fill} stroke={STAR_GOLD.line} strokeWidth={1.8} /></g></g>
      <g transform="translate(66 -13)"><g className="deco-art-twinkle deco-art-late"><path d={starPath(0, 0, 5.4)} fill={STAR_GOLD.fill} stroke={STAR_GOLD.line} strokeWidth={1.6} /></g></g>
      <g transform="translate(103 -11)"><g className="deco-art-pop"><path d={sparklePath(0, 0, 4.4)} fill="#fffbe8" stroke={STAR_GOLD.line} strokeWidth={1.1} /></g></g>
      <g transform="translate(113 41)"><g className="deco-art-pop deco-art-late"><path d={sparklePath(0, 0, 3.4)} fill="#fffbe8" stroke={STAR_GOLD.line} strokeWidth={1} /></g></g>
    </g>
  );
}

/* ── Hearts ── */

const HEART_RED = { fill: '#f2557a', line: '#8e1f3b', light: '#ffb3c4' };
const HEART_PINK = { fill: '#ff9fbd', line: '#a8466a', light: '#ffe0ea' };

function DrawnHeart({ x, y, size, turn = 0, colors }: { x: number; y: number; size: number; turn?: number; colors: typeof HEART_RED }) {
  const k = size / 17;
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <path d={heartPath(0, 0, size)} fill={colors.fill} stroke={colors.line} strokeWidth={Math.max(1.2, 1.9 * k)} strokeLinejoin="round" />
      <path d={`M${round(-5.6 * k)} ${round(-3.4 * k)}C${round(-5.4 * k)} ${round(-5 * k)} ${round(-4.4 * k)} ${round(-5.8 * k)} ${round(-3.2 * k)} ${round(-5.9 * k)}`} fill="none" stroke={colors.light} strokeWidth={Math.max(1, 1.6 * k)} strokeLinecap="round" />
    </g>
  );
}

function Hearts({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') return null;
  return (
    <g>
      <DrawnHeart x={3} y={84} size={22} turn={-18} colors={HEART_RED} />
      <DrawnHeart x={20} y={101} size={12} turn={14} colors={HEART_PINK} />
      <g className="deco-art-passing">
        <g transform="translate(110 72)"><g className="deco-art-rise"><DrawnHeart x={0} y={0} size={10} colors={HEART_RED} /></g></g>
        <g transform="translate(104 64)"><g className="deco-art-rise deco-art-late"><DrawnHeart x={0} y={0} size={8} colors={HEART_PINK} /></g></g>
      </g>
    </g>
  );
}

/* ── Bubbles ── */

function Bubble({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#d6efff" fillOpacity={0.3} stroke="#7fc0ea" strokeWidth={1.8} />
      <path d={`M${round(x - r * 0.62)} ${round(y - r * 0.18)}A${round(r * 0.66)} ${round(r * 0.66)} 0 0 1 ${round(x - r * 0.12)} ${round(y - r * 0.64)}`} fill="none" stroke="#ffffff" strokeWidth={1.6} strokeLinecap="round" />
      <circle cx={round(x + r * 0.42)} cy={round(y + r * 0.4)} r={round(Math.max(0.8, r * 0.13))} fill="#ffffff" fillOpacity={0.85} />
    </g>
  );
}

function Bubbles({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') return null;
  return (
    <g>
      <Bubble x={-7} y={64} r={8} />
      <Bubble x={3} y={84} r={5} />
      <g className="deco-art-passing">
        {[{ x: 108, y: 66, r: 5.6, delay: 0 }, { x: 103, y: 60, r: 3.8, delay: 1.3 }, { x: 112, y: 62, r: 3, delay: 2.5 }].map((bubble, index) => (
          <g key={index} transform={`translate(${bubble.x} ${bubble.y})`}>
            <g className="deco-art-rise" style={{ animationDelay: `${bubble.delay}s` } as CSSProperties}><Bubble x={0} y={0} r={bubble.r} /></g>
          </g>
        ))}
      </g>
    </g>
  );
}

/* ── Your colours: a loop drawn round the picture with a marker ── */

const DOODLE_LOOP = smoothPath(
  [0, 1.5, -1, 2, -1.5, 1, 0, -2, 1.5, -1, 2, 0, 1.2, -0.6].map((wobble, index) => aroundHead(26 + index * 30, 57 + wobble)),
);

function Doodle({ layer }: { layer: FrameLayer }) {
  if (layer === 'back') return null;
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path className="deco-art-doodle" d={DOODLE_LOOP} pathLength={100} stroke="var(--deco-a)" strokeWidth={3.4} />
      <path d={sparklePath(99, -6, 6.4)} stroke="var(--deco-b)" strokeWidth={2.2} />
      <path d="M108.6 4.6L112.4 2.6M106.4 -14.6L109.2 -17.4" stroke="var(--deco-b)" strokeWidth={2} />
    </g>
  );
}

/** A frame's drawing for one layer, or null where the design has nothing on it. */
export function frameArt(frame: AvatarFrame, layer: FrameLayer): ReactNode {
  switch (frame) {
    case 'headphones': return <Headphones layer={layer} />;
    case 'catears': return <CatEars layer={layer} />;
    case 'crown': return <Crown layer={layer} />;
    case 'halo': return <Angel layer={layer} />;
    case 'horns': return <Horns layer={layer} />;
    case 'laurel': return <Laurel layer={layer} />;
    case 'blossom': return <Blossoms layer={layer} />;
    case 'kindling': return <Flames layer={layer} />;
    case 'frost': return <Frost layer={layer} />;
    case 'stardust': return <Stars layer={layer} />;
    case 'hearts': return <Hearts layer={layer} />;
    case 'fizz': return <Bubbles layer={layer} />;
    case 'theme': return <Doodle layer={layer} />;
  }
}

/** Which layers each frame's drawing has. */
export const FRAME_LAYERS: Record<AvatarFrame, readonly FrameLayer[]> = {
  headphones: ['back', 'front'],
  catears: ['back'],
  crown: ['front'],
  halo: ['back', 'front'],
  horns: ['back'],
  laurel: ['back', 'front'],
  blossom: ['front'],
  kindling: ['back'],
  frost: ['front'],
  stardust: ['front'],
  hearts: ['front'],
  fizz: ['front'],
  theme: ['front'],
};

/* ═══ Sprites: what falls and rises ═════════════════════════════════════ */

/** A sprite element's attributes, named in camelCase as in JSX (`strokeWidth`) and given their SVG spelling when drawn. */
type SvgAttributes = Readonly<Record<string, string | number>>;

/** One element of a sprite's drawing. */
interface SvgElement {
  tag: 'path' | 'circle' | 'ellipse' | 'rect' | 'g';
  attributes: SvgAttributes;
  children?: readonly SvgElement[];
}

const svgName = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const svgValue = (value: string | number): string => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function svgMarkup(element: SvgElement): string {
  const attributes = Object.entries(element.attributes).map(([name, value]) => ` ${svgName(name)}="${svgValue(value)}"`).join('');
  const children = element.children?.map(svgMarkup).join('') ?? '';
  return children ? `<${element.tag}${attributes}>${children}</${element.tag}>` : `<${element.tag}${attributes}/>`;
}

/** A small drawing as a CSS picture, for the particles of effects and nameplates. */
function sprite(elements: readonly SvgElement[], view = '0 0 24 24'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">${elements.map(svgMarkup).join('')}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const shape = (d: string, attributes: SvgAttributes = {}): SvgElement => ({ tag: 'path', attributes: { d, ...attributes } });
const dot = (cx: number, cy: number, r: number, attributes: SvgAttributes = {}): SvgElement => ({ tag: 'circle', attributes: { cx, cy, r, ...attributes } });
const oval = (cx: number, cy: number, rx: number, ry: number, attributes: SvgAttributes = {}): SvgElement => ({ tag: 'ellipse', attributes: { cx, cy, rx, ry, ...attributes } });
const box = (x: number, y: number, width: number, height: number, attributes: SvgAttributes = {}): SvgElement => ({ tag: 'rect', attributes: { x, y, width, height, ...attributes } });
const group = (attributes: SvgAttributes, children: readonly SvgElement[]): SvgElement => ({ tag: 'g', attributes, children });

/** A filled shape with its outline. */
const outlined = (fill: string, stroke: string, strokeWidth: number): SvgAttributes => ({ fill, stroke, strokeWidth, strokeLinejoin: 'round' });
/** A line with round ends. */
const stroked = (stroke: string, strokeWidth: number): SvgAttributes => ({ fill: 'none', stroke, strokeWidth, strokeLinecap: 'round' });

const PETAL = 'M12 21C6.5 17.5 5 12 6.6 7.4C7.6 4.6 10 3.2 11 5.2L12 7L13 5.2C14 3.2 16.4 4.6 17.4 7.4C19 12 17.5 17.5 12 21Z';
const LEAF = 'M12 2.5C13.6 5 16.8 5.2 17.2 8.2C19.6 8.4 21 10.6 19.4 12.6C20.8 14.6 19 17 16.6 16.4C16 19 13.6 19.6 12 21.5C10.4 19.6 8 19 7.4 16.4C5 17 3.2 14.6 4.6 12.6C3 10.6 4.4 8.4 6.8 8.2C7.2 5.2 10.4 5 12 2.5Z';
const LEAF_VEINS = 'M12 21.5V7M12 13L8 10M12 13L16 10M12 16.5L9 15M12 16.5L15 15';
const RIBBON = 'M4 9C8 4 11 13 15 8S20 10 20 14';

/** An autumn leaf in one colour, its veins a shade darker. */
function leaf(fill: string, stroke: string, veins: string): string {
  return sprite([shape(LEAF, outlined(fill, stroke, 1.3)), shape(LEAF_VEINS, stroked(veins, 1))]);
}

/** A heart with a light on its upper left. */
function heart(fill: string, stroke: string, light: string): string {
  return sprite([shape(heartPath(12, 12.5, 18), outlined(fill, stroke, 1.6)), shape('M6.4 8.6C6.6 7.4 7.4 6.8 8.4 6.7', stroked(light, 1.5))]);
}

/** A butterfly seen from above, its wings in one colour with lighter spots. */
function butterfly(fill: string, light: string, stroke: string): string {
  const wings = 'M15 12C9 2 1 3 2.6 11C3.6 15 9.6 16.4 15 14Z M15 15.4C9.6 15.4 4.4 19 6 23.6C7.6 27.4 12.8 24.4 15 17.6Z';
  return sprite([
    group({ fill, stroke, strokeWidth: 1.2, strokeLinejoin: 'round' }, [shape(wings), shape(wings, { transform: 'matrix(-1 0 0 1 32 0)' })]),
    group({ fill: light }, [dot(7, 9, 1.9), dot(25, 9, 1.9), dot(9, 21, 1.3), dot(23, 21, 1.3)]),
    oval(16, 15, 1.7, 7.4, { fill: '#2b2230' }),
    shape('M15.4 8.2C14.6 5.6 13.4 4 11.6 3M16.6 8.2C17.4 5.6 18.6 4 20.4 3', stroked('#2b2230', 1)),
  ], '0 0 32 28');
}

/** A note, or two beamed together. */
function note(fill: string, stroke: string, beamed: boolean): string {
  const stem = (d: string): SvgElement[] => [
    shape(d, { ...stroked(stroke, 3.6), strokeLinejoin: 'round' }),
    shape(d, { ...stroked(fill, 1.8), strokeLinejoin: 'round' }),
  ];
  const head = (x: number, y: number, rx: number, ry: number): SvgElement => oval(x, y, rx, ry, { transform: `rotate(-22 ${x} ${y})`, fill, stroke, strokeWidth: 1.3 });
  return beamed
    ? sprite([...stem('M8.6 18V6.4L19.6 4V16'), head(5.4, 18.6, 3.6, 2.8), head(16.4, 16.6, 3.6, 2.8)])
    : sprite([...stem('M12.4 18V4.6C14.4 7.8 18.2 8.6 17.6 13'), head(8.6, 18.4, 4.2, 3.2)]);
}

const SPRITE = {
  petal: sprite([shape(PETAL, outlined('#f7b3c6', '#c25e7d', 1.4)), shape('M12 18.4V11', stroked('#e58aa6', 1.1))]),
  petalLight: sprite([shape(PETAL, outlined('#fde3eb', '#c98aa0', 1.4))]),
  flake: sprite([shape(snowflakePath(12, 12, 10), stroked('#7f9fbf', 3.6)), shape(snowflakePath(12, 12, 10), stroked('#ffffff', 1.7))]),
  drop: sprite([
    shape('M12 3C12 3 6 10.5 6 14.5A6 6 0 0 0 18 14.5C18 10.5 12 3 12 3Z', outlined('#b9defa', '#3f7fb4', 1.5)),
    shape('M9.2 14.6A3 3 0 0 0 11 17.4', stroked('#ffffff', 1.3)),
  ]),
  heart: heart('#f2557a', '#8e1f3b', '#ffb3c4'),
  heartPink: heart('#ff9fbd', '#a8466a', '#ffe0ea'),
  leafOrange: leaf('#ec8a3c', '#8b4313', '#b85d1e'),
  leafYellow: leaf('#e8b23f', '#86600f', '#b98a1f'),
  leafRed: leaf('#d9573a', '#7b2414', '#a83a22'),
  ribbon: sprite([shape(RIBBON, stroked('#9a3f22', 5.2)), shape(RIBBON, stroked('#ec7850', 3))]),
  star: sprite([shape(starPath(12, 12.6, 9.6), outlined('#f5c142', '#94690f', 1.5))]),
  dot: sprite([dot(12, 12, 6.4, { fill: '#5cc491', stroke: '#2c7a54', strokeWidth: 1.5 }), shape('M8.8 10.6A3.6 3.6 0 0 1 11 8.4', stroked('#d3f5e3', 1.3))]),
  bubble: sprite([
    dot(12, 12, 9.6, { fill: '#d6efff', fillOpacity: 0.3, stroke: '#86c6ee', strokeWidth: 1.4 }),
    shape('M7 9.4A5.6 5.6 0 0 1 10.4 6.2', stroked('#ffffff', 1.6)),
    dot(15.6, 15.4, 1.1, { fill: '#ffffff', fillOpacity: 0.85 }),
  ]),
  lantern: sprite([
    box(8.5, 3, 7, 3, { rx: 1, fill: '#c99a2e', stroke: '#6d4f12', strokeWidth: 1.1 }),
    shape('M12 6C5.6 6 4.6 10.6 4.6 15C4.6 19.4 5.6 24 12 24C18.4 24 19.4 19.4 19.4 15C19.4 10.6 18.4 6 12 6Z', { fill: '#f2683c', stroke: '#8a2d14', strokeWidth: 1.3 }),
    oval(12, 15, 4.2, 6.8, { fill: '#ff9d63' }),
    shape('M12 6.4C9.6 8.4 9 11.6 9 15S9.6 21.6 12 23.6M12 6.4C14.4 8.4 15 11.6 15 15S14.4 21.6 12 23.6', { fill: 'none', stroke: '#c94a22', strokeWidth: 1 }),
    shape('M7.4 11.4C7.8 9.6 8.6 8.4 9.8 7.8', stroked('#ffc6a6', 1.2)),
    box(8.5, 24, 7, 2.6, { rx: 1, fill: '#c99a2e', stroke: '#6d4f12', strokeWidth: 1.1 }),
    shape('M12 26.6V29.4', stroked('#c99a2e', 1.4)),
  ], '0 0 24 30'),
  twinkle: sprite([shape(sparklePath(12, 12, 10), outlined('#fff4d6', '#b39a64', 1.2))]),
  spark: sprite([shape(sparklePath(12, 12, 9), outlined('#ffc35a', '#a8501a', 1.4))]),
  butterflyOrange: butterfly('#f59a3c', '#ffd9a8', '#5a2a0c'),
  butterflyBlue: butterfly('#5aa7e6', '#d4ebff', '#163f6b'),
  butterflyPink: butterfly('#f7a0c0', '#ffe3ee', '#7a2a4a'),
  noteCoral: note('#ef8a6a', '#8a3a22', false),
  noteLavender: note('#a596ef', '#4a3c9a', true),
  noteMint: note('#5cc491', '#226b48', false),
} as const;

/** The custom properties that give a layer's particles their drawings: the first, then every second and third. */
function spriteStyle(...sprites: readonly string[]): CSSProperties {
  const [first, second, third] = sprites;
  return {
    '--sprite-a': first,
    ...(second ? { '--sprite-b': second } : {}),
    ...(third ? { '--sprite-c': third } : {}),
  } as CSSProperties;
}

/** The drawings an effect's particles wear, or null for an effect without particles. */
export function effectSprites(effect: ProfileEffect): CSSProperties | null {
  switch (effect) {
    case 'butterflies': return spriteStyle(SPRITE.butterflyOrange, SPRITE.butterflyBlue, SPRITE.butterflyPink);
    case 'notes': return spriteStyle(SPRITE.noteCoral, SPRITE.noteLavender, SPRITE.noteMint);
    case 'stars': return spriteStyle(SPRITE.twinkle);
    case 'snow': return spriteStyle(SPRITE.flake);
    case 'bubbles': return spriteStyle(SPRITE.bubble);
    case 'lanterns': return spriteStyle(SPRITE.lantern);
    case 'petals': return spriteStyle(SPRITE.petal, SPRITE.petalLight);
    case 'leaves': return spriteStyle(SPRITE.leafOrange, SPRITE.leafYellow, SPRITE.leafRed);
    case 'hearts': return spriteStyle(SPRITE.heart, SPRITE.heartPink);
    case 'confetti': return spriteStyle(SPRITE.ribbon, SPRITE.star, SPRITE.dot);
    default: return null;
  }
}

/** The drawings a nameplate's particles wear, or null for one without particles. */
export function nameplateSprites(nameplate: Nameplate): CSSProperties | null {
  switch (nameplate) {
    case 'sakura': return spriteStyle(SPRITE.petal, SPRITE.petalLight);
    case 'snow': return spriteStyle(SPRITE.flake);
    case 'rain': return spriteStyle(SPRITE.drop);
    case 'embers': return spriteStyle(SPRITE.spark);
    case 'starlit': return spriteStyle(SPRITE.twinkle);
    default: return null;
  }
}

/* ═══ Effects: scenes over the banner ═══════════════════════════════════ */

/* ── Night sky ── */

function NightSky() {
  return (
    <>
      <svg className="deco-art-corner" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <g className="deco-art-float"><Moon x={20} y={19} radius={12.5} /></g>
      </svg>
      {/* Now and then a star falls: its tail behind it, up and to the left. */}
      <svg className="deco-art-shooting" viewBox="-34 -12 40 20" aria-hidden="true" focusable="false">
        <path d="M-2.2 2.8L-32 -9.6L-2.8 -0.6Z" fill="#fff4d6" opacity={0.85} />
        <path d={starPath(0, 1, 4.4)} fill="#fff4d6" stroke="#b39a64" strokeWidth={1} strokeLinejoin="round" />
      </svg>
    </>
  );
}

/* ── Cherry blossoms: a branch in the corner ── */

function CherryBranch({ className = 'deco-art-branch' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 36" aria-hidden="true" focusable="false">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M66 -2C52 4 40 6 26 14C20 17.6 14 18.6 6 18M40 7.4C42 13 41 18 37 23.6" stroke="#4a2c1e" strokeWidth={4.4} />
        <path d="M66 -2C52 4 40 6 26 14C20 17.6 14 18.6 6 18M40 7.4C42 13 41 18 37 23.6" stroke="#8a5a42" strokeWidth={2.6} />
      </g>
      <Blossom x={30} y={12} scale={0.62} turn={10} />
      <Blossom x={47} y={4} scale={0.56} turn={40} petal="#fdeef3" line="#b98aa0" />
      <Blossom x={37} y={24} scale={0.58} turn={25} petal="#fdeef3" line="#b98aa0" />
      <Blossom x={14} y={18.6} scale={0.5} turn={60} />
      <circle cx={22} cy={15} r={1.7} fill="#f7aec4" stroke="#b4567a" strokeWidth={0.9} />
      <circle cx={57} cy={2.4} r={1.5} fill="#f7aec4" stroke="#b4567a" strokeWidth={0.9} />
    </svg>
  );
}

/** An effect's scene, or null for one that is particles alone. */
export function effectArt(effect: ProfileEffect): ReactNode {
  switch (effect) {
    case 'stars': return <NightSky />;
    case 'petals': return <CherryBranch />;
    default: return null;
  }
}

/* ═══ Nameplates: scenes at the end of a row ════════════════════════════ */

/* ── Vinyl ── */

function Vinyl() {
  return (
    <svg className="deco-art-scene deco-art-vinyl" viewBox="0 0 70 40" aria-hidden="true" focusable="false">
      <g>
        <g className="deco-art-disc-turn">
          <circle cx={30} cy={20} r={17} fill="#17171b" stroke="#050506" strokeWidth={1.2} />
          <circle cx={30} cy={20} r={14.4} fill="none" stroke="#33343c" strokeWidth={0.9} />
          <circle cx={30} cy={20} r={11.8} fill="none" stroke="#2b2c33" strokeWidth={0.9} />
          <circle cx={30} cy={20} r={9.2} fill="none" stroke="#33343c" strokeWidth={0.9} />
          <circle cx={30} cy={20} r={6} fill="#ec7850" />
          <path d="M26.6 18A4 4 0 0 1 33.4 18" fill="none" stroke="#ffe6d6" strokeWidth={1} strokeLinecap="round" />
          <circle cx={30} cy={20} r={1.1} fill="#0a0a0c" />
        </g>
        <path d="M16.6 12.6A16 16 0 0 1 25.6 5.2" fill="none" stroke="#ffffff" strokeOpacity={0.3} strokeWidth={1.6} strokeLinecap="round" />
      </g>
      <g transform="rotate(-5 53 20)">
        <rect x={36} y={3} width={34} height={34} rx={2} fill="#2d3a6b" stroke="#121733" strokeWidth={1.4} />
        <circle cx={53} cy={21} r={9} fill="#f2a65a" />
        <rect x={43} y={22.6} width={20} height={1.7} fill="#2d3a6b" />
        <rect x={43} y={26.1} width={20} height={1.7} fill="#2d3a6b" />
        <rect x={43} y={29.6} width={20} height={1.7} fill="#2d3a6b" />
        <circle cx={64.4} cy={8.6} r={1.6} fill="#f5ecd0" />
        <path d="M38.6 5.6H52" stroke="#ffffff" strokeOpacity={0.22} strokeWidth={1.2} strokeLinecap="round" />
      </g>
    </svg>
  );
}

/* ── Skyline ── */

const SKY = { back: '#2a2f5c', front: '#1a1d3a', lit: '#ffd58a', dark: '#30355f', moon: '#f5ecd0' };

const SKYLINE_FRONT = [
  { x: 39, top: 25, width: 8 },
  { x: 48, top: 16, width: 9 },
  { x: 59, top: 27, width: 11 },
  { x: 71, top: 19, width: 7 },
  { x: 79, top: 28, width: 10 },
  { x: 90, top: 22, width: 8 },
];

const SKYLINE_BACK = [
  { x: 33, top: 19, width: 9 },
  { x: 43, top: 12, width: 7 },
  { x: 52, top: 21, width: 10 },
  { x: 63, top: 14, width: 8 },
  { x: 74, top: 23, width: 9 },
  { x: 84, top: 17, width: 8 },
  { x: 93, top: 25, width: 6 },
];

const SKYLINE_WINDOWS = (() => {
  const panes: { x: number; y: number; lit: boolean; blink: boolean }[] = [];
  SKYLINE_FRONT.forEach((building, buildingIndex) => {
    for (let row = 0; building.top + 3 + row * 4 < 37; row += 1) {
      for (let column = 0; 1.6 + column * 3 < building.width - 1.6; column += 1) {
        const seed = (buildingIndex * 7 + row * 3 + column * 5) % 11;
        panes.push({
          x: building.x + 1.6 + column * 3,
          y: building.top + 3 + row * 4,
          lit: seed % 3 !== 0,
          blink: seed === 4 || seed === 9,
        });
      }
    }
  });
  return panes;
})();

function Skyline() {
  return (
    <svg className="deco-art-scene deco-art-skyline" viewBox="0 0 100 40" aria-hidden="true" focusable="false">
      <Moon x={84} y={9} radius={4.6} fill={SKY.moon} line="#b8a776" />
      <g fill={SKY.back}>
        {SKYLINE_BACK.map((building, index) => <rect key={index} x={building.x} y={building.top} width={building.width} height={40 - building.top} />)}
      </g>
      <g fill={SKY.front}>
        {SKYLINE_FRONT.map((building, index) => <rect key={index} x={building.x} y={building.top} width={building.width} height={40 - building.top} />)}
        <rect x={52.2} y={10} width={0.9} height={6} />
      </g>
      <circle className="deco-art-beacon" cx={52.65} cy={9.6} r={1} fill="#ff6b6b" />
      {SKYLINE_WINDOWS.map((pane, index) => (
        <rect
          key={index}
          className={pane.blink ? 'deco-art-window' : undefined}
          style={pane.blink ? { animationDelay: `${(index % 5) * 0.7}s` } : undefined}
          x={pane.x}
          y={pane.y}
          width={1.5}
          height={2}
          fill={pane.lit ? SKY.lit : SKY.dark}
        />
      ))}
    </svg>
  );
}

/* ── Snowy pines ── */

function Pine({ x, height, base = 40 }: { x: number; height: number; base?: number }) {
  const tiers = [0, 1, 2].map((tier) => {
    const top = base - height + tier * height * 0.26;
    const bottom = top + height * 0.46;
    const half = height * (0.2 + tier * 0.09);
    return { top, bottom, half };
  });
  return (
    <g strokeLinejoin="round">
      <rect x={x - 1.4} y={base - height * 0.16} width={2.8} height={height * 0.16} fill="#6b4a3a" stroke="#3a2418" strokeWidth={0.9} />
      {tiers.map((tier, index) => (
        <g key={index}>
          <path d={`M${round(x)} ${round(tier.top)}L${round(x + tier.half)} ${round(tier.bottom)}L${round(x - tier.half)} ${round(tier.bottom)}Z`} fill="#2f7a55" stroke="#174431" strokeWidth={1} />
          <path d={`M${round(x)} ${round(tier.top + 0.6)}L${round(x + tier.half * 0.5)} ${round(tier.top + (tier.bottom - tier.top) * 0.48)}Q${round(x)} ${round(tier.top + (tier.bottom - tier.top) * 0.62)} ${round(x - tier.half * 0.5)} ${round(tier.top + (tier.bottom - tier.top) * 0.48)}Z`} fill="#ffffff" />
        </g>
      ))}
    </g>
  );
}

function SnowyPines() {
  return (
    <svg className="deco-art-scene deco-art-pines" viewBox="0 0 70 40" aria-hidden="true" focusable="false">
      <Pine x={30} height={18} />
      <Pine x={46} height={30} />
      <Pine x={60} height={22} />
      <path d="M14 40C22 34.4 30 35.6 38 37.6C46 35 56 34.6 70 37.8V40Z" fill="#ffffff" stroke="#9fb9d1" strokeWidth={1} />
    </svg>
  );
}

/* ── Rain ── */

function RainCloud() {
  return (
    <svg className="deco-art-scene deco-art-rainplate" viewBox="0 0 50 40" aria-hidden="true" focusable="false">
      <Cloud x={30} y={11} scale={0.8} fill="#c9d3e0" line="#5f6f86" />
    </svg>
  );
}

/* ── Campfire ── */

function Campfire() {
  return (
    <svg className="deco-art-scene deco-art-campfire" viewBox="0 0 50 40" aria-hidden="true" focusable="false">
      <g strokeLinejoin="round">
        <g className="deco-art-flame deco-art-fire" fill="#f0662f" stroke="#7c2410" strokeWidth={1.2}>
          <path d="M23 33C17 30 16.6 22 22.4 14.6C22.6 19 24.6 20.4 26 18.6C26.6 15.4 25.6 12.4 27.6 8.6C29.6 15 34.6 18.4 33.6 25.4C33 30 29.6 33 26 33Z" />
        </g>
        <g className="deco-art-flame deco-art-fire deco-art-late" fill="#ffd863" stroke="none">
          <path d="M25 33C22 31 22.4 26 25.6 21.6C26.6 24.6 28.4 24.8 28.8 22.8C31 26.4 31 31 27.6 33Z" />
        </g>
        <rect x={13} y={31} width={26} height={4.6} rx={2.3} transform="rotate(-12 26 33.3)" fill="#8a5a3c" stroke="#3e2516" strokeWidth={1.1} />
        <rect x={13} y={31} width={26} height={4.6} rx={2.3} transform="rotate(12 26 33.3)" fill="#9b6845" stroke="#3e2516" strokeWidth={1.1} />
        <circle cx={14.2} cy={36.2} r={1.6} fill="#d9b48e" stroke="#3e2516" strokeWidth={0.8} />
        <circle cx={37.8} cy={36.2} r={1.6} fill="#d9b48e" stroke="#3e2516" strokeWidth={0.8} />
      </g>
    </svg>
  );
}

/* ── A starry night over the hills ── */

function StarryHills() {
  return (
    <svg className="deco-art-scene deco-art-hills" viewBox="0 0 70 40" aria-hidden="true" focusable="false">
      <Moon x={58} y={9} radius={5} />
      <path d="M8 40C18 30 30 28 42 33C50 28 60 27 70 30V40Z" fill="#2a3466" />
      <path d="M26 40C36 34 48 33 58 37C62 35.6 66 35.4 70 36V40Z" fill="#1c2349" />
      <g strokeLinejoin="round">
        <path d="M37 33.4V29L40.4 26.4L43.8 29V33.4Z" fill="#4a3c5e" stroke="#16122a" strokeWidth={0.9} />
        <rect x={39.4} y={29.8} width={2} height={2} fill="#ffd58a" />
      </g>
    </svg>
  );
}

/* ── The sea, and a boat on it ── */

/** Five swells of water, 30 apart, so a row of them can slide one swell along and start again unseen. */
const WAVE = 'M0 6C5 1.6 10 1.6 15 6S25 10.4 30 6S40 1.6 45 6S55 10.4 60 6S70 1.6 75 6S85 10.4 90 6S100 1.6 105 6S115 10.4 120 6S130 1.6 135 6S145 10.4 150 6V20H0Z';

function Sea() {
  return (
    <svg className="deco-art-scene deco-art-sea" viewBox="0 0 80 40" aria-hidden="true" focusable="false">
      <g className="deco-art-boat">
        <path d="M48 26.4H66L62.6 31H51.6Z" fill="#d4485e" stroke="#6e1d2c" strokeWidth={1} strokeLinejoin="round" />
        <path d="M57 25.6V10.6" stroke="#5a3a28" strokeWidth={1.2} strokeLinecap="round" />
        <path d="M57.8 11.6L64.6 24.2H57.8Z" fill="#fdfbf6" stroke="#8a8a96" strokeWidth={0.9} strokeLinejoin="round" />
        <path d="M56.2 13.6L51.4 24.2H56.2Z" fill="#f1ede4" stroke="#8a8a96" strokeWidth={0.9} strokeLinejoin="round" />
      </g>
      <g className="deco-art-waves-back"><path d={WAVE} transform="translate(0 24)" fill="#3d7fc4" stroke="#1d4f86" strokeWidth={1} /></g>
      <g className="deco-art-waves-front"><path d={WAVE} transform="translate(-15 30)" fill="#5aa7e6" stroke="#2a6aa8" strokeWidth={1} /></g>
    </svg>
  );
}

/* ── Mountains at sunset ── */

function Mountains() {
  return (
    <svg className="deco-art-scene deco-art-mountains" viewBox="0 0 80 40" aria-hidden="true" focusable="false">
      <circle cx={58} cy={26} r={11} fill="#ffb347" stroke="#b8621c" strokeWidth={1.2} />
      <path d="M50.6 21.4A9 9 0 0 1 56 16.4" fill="none" stroke="#ffe0a6" strokeWidth={1.4} strokeLinecap="round" />
      <g className="deco-art-birds" fill="none" stroke="#3b2a55" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 9.6L42 11.2L44 9.6M46.6 6.6L48.2 7.8L49.8 6.6" />
      </g>
      <path d="M18 40L34 22L42 29L52 18L66 30L72 25L80 31V40Z" fill="#7b5ea8" stroke="#3b2a55" strokeWidth={1} strokeLinejoin="round" />
      <path d="M48.6 21.6L52 18L55.6 21.2L53 22.4L51.2 21Z" fill="#efe6ff" />
      <path d="M28 40L42 31L50 35L60 28L72 36L80 33V40Z" fill="#4b3b78" stroke="#251a44" strokeWidth={1} strokeLinejoin="round" />
    </svg>
  );
}

/* ── Forest ── */

function TallPine({ x, height, fill, line }: { x: number; height: number; fill: string; line: string }) {
  const top = 40 - height;
  return (
    <g className="deco-art-tree" strokeLinejoin="round">
      <path d={`M${x} ${top}L${round(x + height * 0.22)} ${round(top + height * 0.42)}H${round(x + height * 0.12)}L${round(x + height * 0.3)} ${round(top + height * 0.78)}H${round(x - height * 0.3)}L${round(x - height * 0.12)} ${round(top + height * 0.42)}H${round(x - height * 0.22)}Z`} fill={fill} stroke={line} strokeWidth={1} />
      <rect x={x - 1.2} y={round(top + height * 0.78)} width={2.4} height={round(height * 0.22)} fill="#6b4a3a" />
    </g>
  );
}

function Forest() {
  return (
    <svg className="deco-art-scene deco-art-forest" viewBox="0 0 80 40" aria-hidden="true" focusable="false">
      <TallPine x={38} height={24} fill="#3f8f6a" line="#1f5a40" />
      <TallPine x={66} height={30} fill="#3f8f6a" line="#1f5a40" />
      <TallPine x={52} height={34} fill="#2d7353" line="#174431" />
      <TallPine x={74} height={20} fill="#2d7353" line="#174431" />
      <path d="M24 40C34 37 50 36.6 80 37.4V40Z" fill="#2b5e3f" />
      <g strokeLinejoin="round">
        <rect x={43.4} y={34} width={2.4} height={4} rx={1} fill="#f3eadb" stroke="#6b5a48" strokeWidth={0.8} />
        <path d="M40.6 34.6C40.6 30.6 48.6 30.6 48.6 34.6Z" fill="#d9473f" stroke="#6e1d1a" strokeWidth={0.9} />
        <circle cx={43} cy={32.6} r={0.7} fill="#ffffff" />
        <circle cx={46} cy={32.2} r={0.6} fill="#ffffff" />
      </g>
    </svg>
  );
}

/* ── Your colours: bunting ── */

const BUNTING = Array.from({ length: 7 }, (_, index) => {
  const x = 22 + index * 8.6;
  const y = round(5 + Math.sin((index / 6) * Math.PI) * 4.4);
  return { x: round(x), y, index };
});

function Bunting() {
  return (
    <svg className="deco-art-scene deco-art-bunting" viewBox="0 0 80 40" aria-hidden="true" focusable="false">
      <path d={smoothPath([[14, 3], ...BUNTING.map(({ x, y }) => [x, y] as [number, number]), [82, 3]])} fill="none" stroke="#c9c2b6" strokeWidth={0.9} />
      {BUNTING.map(({ x, y, index }) => (
        <g key={index} transform={`translate(${x} ${y})`}>
          <path
            className="deco-art-pennant"
            style={{ animationDelay: `${index * 0.18}s` } as CSSProperties}
            d="M-3.6 0H3.6L0 9.6Z"
            fill={index % 2 === 0 ? 'var(--deco-a)' : 'var(--deco-b)'}
            stroke="rgb(0 0 0 / 0.4)"
            strokeWidth={0.8}
            strokeLinejoin="round"
          />
        </g>
      ))}
    </svg>
  );
}

/** A nameplate's scene, or null for one without. */
export function nameplateArt(nameplate: Nameplate): ReactNode {
  switch (nameplate) {
    case 'vinyl': return <Vinyl />;
    case 'skyline': return <Skyline />;
    case 'sakura': return <CherryBranch className="deco-art-scene deco-art-sakura" />;
    case 'snow': return <SnowyPines />;
    case 'rain': return <RainCloud />;
    case 'embers': return <Campfire />;
    case 'starlit': return <StarryHills />;
    case 'waves': return <Sea />;
    case 'sunset': return <Mountains />;
    case 'moss': return <Forest />;
    case 'theme': return <Bunting />;
  }
}
