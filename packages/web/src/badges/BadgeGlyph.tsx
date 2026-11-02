import type { BadgeId } from '@backspace/shared/src/badges';

/**
 * The badge glyphs (docs/systems/badges.md, after the badge style sheet in
 * assets/brand): one small drawing per badge on a 24px grid, mostly solid
 * shapes with the occasional line, so they keep their shape at 14px next to a
 * name and stay crisp at profile size. Colour comes from the text
 * (`currentColor`); the tone each badge is drawn in lives with its metadata.
 *
 * A part is a filled shape (`evenOdd` cuts its inner contours out) or a
 * stroked line.
 */
type Part = { fill: string; evenOdd?: boolean } | { stroke: string };

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

/** A gear outline: `teeth` flat-topped teeth between two radii, around the centre. */
function gear(teeth: number, crest: number, valley: number): string {
  const step = (Math.PI * 2) / teeth;
  const at = (radius: number, angle: number) => `${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`;
  const points: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const middle = i * step - Math.PI / 2;
    points.push(at(valley, middle - step * 0.5), at(crest, middle - step * 0.24), at(crest, middle + step * 0.24));
  }
  return `M${points.join('L')}Z`;
}

const SHIELD = 'M12 2.4 4.3 5.3v6.2c0 4.7 3.2 8.8 7.7 10.1 4.5-1.3 7.7-5.4 7.7-10.1V5.3L12 2.4Z';
const CROWN = 'M3.4 7.6l4.4 3.4L12 4.6l4.2 6.4 4.4-3.4-1.5 9.2H4.9L3.4 7.6Z';

const GLYPHS: Record<BadgeId, readonly Part[]> = {
  bot: [
    { fill: 'M11 2.5h2v2.6h4.2A2.8 2.8 0 0 1 20 7.9v8.3a2.8 2.8 0 0 1-2.8 2.8H6.8A2.8 2.8 0 0 1 4 16.2V7.9a2.8 2.8 0 0 1 2.8-2.8H11V2.5Zm-2.2 7.2a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm6.4 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4ZM8.5 15v1.6h7V15h-7ZM2 20.2h20v1.6H2Z' },
  ],
  staff: [
    { fill: 'M12 2.7l2.83 5.73 6.32.92-4.57 4.46 1.08 6.29L12 17.13l-5.66 2.97 1.08-6.29-4.57-4.46 6.32-.92L12 2.7Z' },
  ],
  server_owner: [
    { fill: CROWN },
    { fill: 'M5 18.4h14v2.2H5Z' },
  ],
  administrator: [
    { fill: `${gear(8, 10.4, 7.8)}${circle(12, 12, 3.3)}`, evenOdd: true },
  ],
  moderator: [
    { fill: `${SHIELD}M12 7.2c1.9 1.8 2.9 3.5 2.9 5.2 0 1.7-1.3 3.1-2.9 3.1s-2.9-1.4-2.9-3.1c0-1.7 1-3.4 2.9-5.2Z`, evenOdd: true },
  ],
  helper: [
    { fill: circle(9.4, 7.6, 3.5) },
    { fill: 'M2.8 19.6c0-3.7 2.9-6.4 6.6-6.4s6.6 2.7 6.6 6.4v.8H2.8v-.8Z' },
    { fill: 'M18.1 8.4h1.9v2.7h2.7V13H20v2.7h-1.9V13h-2.7v-1.9h2.7V8.4Z' },
  ],
  founder: [
    { fill: 'M4.2 9.8l4.1 3L12 7l3.7 5.8 4.1-3-1.3 7.6h-13L4.2 9.8Z' },
    { fill: `${circle(4, 8.2, 1.5)}${circle(12, 5, 1.5)}${circle(20, 8.2, 1.5)}` },
    { fill: 'M5.3 18.6h13.4v2H5.3Z' },
  ],
  early_supporter: [
    { fill: 'M12 20.4s-7.9-4.7-7.9-10.4c0-2.6 2-4.7 4.6-4.7 1.4 0 2.6.7 3.3 1.8.7-1.1 1.9-1.8 3.3-1.8 2.6 0 4.6 2.1 4.6 4.7 0 5.7-7.9 10.4-7.9 10.4Z' },
  ],
  bug_hunter: [
    { fill: 'M12 8.3c2.9 0 5 2.3 5 5.6 0 3.5-2.2 6.4-5 6.4s-5-2.9-5-6.4c0-3.3 2.1-5.6 5-5.6ZM11.3 9.6v9.4h1.4V9.6h-1.4Z', evenOdd: true },
    { fill: 'M9.2 7.9a2.8 2.8 0 0 1 5.6 0H9.2Z' },
    { stroke: 'M7 11.3 4.4 9.9M7 14.2H4.1M7.5 17l-2.7 1.6M17 11.3l2.6-1.4M17 14.2h2.9M16.5 17l2.7 1.6M10.3 5.6 9 4M13.7 5.6 15 4' },
  ],
  developer: [
    { stroke: 'M8.4 7.4 3.8 12l4.6 4.6M15.6 7.4 20.2 12l-4.6 4.6M13.7 5.2l-3.4 13.6' },
  ],
  creator: [
    { fill: 'M20.7 3.3a1.3 1.3 0 0 1 0 1.9l-7.6 7.6-2.6-2.6 7.6-7.6a1.3 1.3 0 0 1 1.9 0l.7.7Z' },
    { fill: 'M9.5 11.3l3.1 3.1c-.2 3-2.3 5.4-5.4 5.9-1.3.2-2.7.1-4.2-.3 1.2-.9 1.4-2.1 1.5-3.3.2-2.7 2.3-5.1 5-5.4Z' },
  ],
  event_participant: [
    { stroke: 'M5.2 6.3h13.6a1.7 1.7 0 0 1 1.7 1.7v11a1.7 1.7 0 0 1-1.7 1.7H5.2A1.7 1.7 0 0 1 3.5 19V8a1.7 1.7 0 0 1 1.7-1.7ZM3.5 10.6h17M8 3.8v4.4M16 3.8v4.4' },
    { fill: 'M7.6 13.4h3.4v3.4H7.6Z' },
  ],
  community_contributor: [
    { fill: circle(12, 7.4, 3) },
    { fill: 'M6.6 19c0-3.2 2.4-5.5 5.4-5.5s5.4 2.3 5.4 5.5v.6H6.6V19Z' },
    { fill: `${circle(5.4, 9.2, 2.3)}${circle(18.6, 9.2, 2.3)}` },
    { fill: 'M1.5 18.7c0-2.5 1.8-4.3 4.1-4.3.9 0 1.7.3 2.4.8-1.1 1.1-1.7 2.6-1.8 4.1H1.5v-.6ZM22.5 18.7c0-2.5-1.8-4.3-4.1-4.3-.9 0-1.7.3-2.4.8 1.1 1.1 1.7 2.6 1.8 4.1h4.7v-.6Z' },
  ],
  beta_tester: [
    { fill: `M14.5 3.7c2.5-.7 4.7-.7 6-.5.2 1.3.2 3.5-.5 6-.7 2.6-2.4 5-4.9 7l.2 2.7-2.7 2.7-1.2-3.2-3.8-3.8-3.2-1.2 2.7-2.7 2.7.2c2-2.5 4.4-4.2 6.7-5.2Z${circle(15.6, 8.4, 1.6)}`, evenOdd: true },
    { fill: 'M7.2 15.4c-1.7.4-2.9 2-3 4.7 2.7-.1 4.3-1.3 4.7-3l-1.7-1.7Z' },
  ],
  verified: [
    { stroke: 'M12 2.9 5 5.6v5.6c0 4.3 2.9 8 7 9.4 4.1-1.4 7-5.1 7-9.4V5.6L12 2.9ZM8.7 12.2l2.3 2.3 4.4-4.7' },
  ],
  partner: [
    { fill: 'M1.6 9.1l3.8-2.3 2.8 1.2-2.2 4.8-2.6-.8-1.8-2.9ZM22.4 9.1l-3.8-2.3-2.8 1.2 2.2 4.8 2.6-.8 1.8-2.9Z' },
    { fill: 'M8.4 8.4l3-1.4c.8-.4 1.6-.4 2.3 0l3.6 1.7 1.6 4.1-5 4.8c-.7.6-1.7.6-2.3 0l-5.1-5 1.9-4.2Z' },
  ],
};

export function BadgeGlyph({ id, size }: { id: BadgeId; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="flex-shrink-0">
      {GLYPHS[id].map((part, index) => ('fill' in part ? (
        <path
          key={index}
          d={part.fill}
          fill="currentColor"
          fillRule={part.evenOdd ? 'evenodd' : undefined}
          clipRule={part.evenOdd ? 'evenodd' : undefined}
        />
      ) : (
        <path
          key={index}
          d={part.stroke}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )))}
    </svg>
  );
}
