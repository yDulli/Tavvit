import React from 'react';

/**
 * Tavvit's icons: one family of 24px line drawings, 1.75px strokes with round
 * caps and joins, so every control in the app is drawn with the same hand. They
 * take their colour from the text (`currentColor`) and their weight from the
 * `strokeWidth` prop, which is why one set serves a header button, a channel row
 * and a message toolbar alike.
 *
 * A glyph is a list of parts. A string is a stroked path; `{ dot: [x, y] }` is a
 * filled dot (the three of "more", the eyes of a face).
 */

type Part = string | { dot: readonly [number, number] };

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
}

/** A cog: `teeth` trapezoidal teeth between a valley radius and a crest radius, round-joined by the stroke. */
function cog(teeth: number, crest: number, valley: number): string {
  const step = (Math.PI * 2) / teeth;
  const at = (radius: number, angle: number) => `${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`;
  const segments: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const middle = i * step - Math.PI / 2;
    const parts = [
      at(valley, middle - step * 0.42),
      at(crest, middle - step * 0.2),
      at(crest, middle + step * 0.2),
      at(valley, middle + step * 0.42),
    ];
    segments.push(`${i === 0 ? 'M' : 'L'}${parts[0]}L${parts[1]}L${parts[2]}L${parts[3]}`);
  }
  return `${segments.join('')}Z`;
}

const MIC: Part[] = [
  'M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z',
  'M5.5 11.5a6.5 6.5 0 0 0 13 0',
  'M12 18v3M8.5 21h7',
];

const HEADPHONES: Part[] = [
  'M4 14.5v-2.5a8 8 0 0 1 16 0v2.5',
  'M4 14.5a1.8 1.8 0 0 1 1.8-1.8H7.5v6.6H5.8A1.8 1.8 0 0 1 4 17.5v-3Z',
  'M20 14.5a1.8 1.8 0 0 0-1.8-1.8H16.5v6.6h1.7a1.8 1.8 0 0 0 1.8-1.8v-3Z',
];

const BELL: Part[] = [
  'M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z',
  'M10 20a2.2 2.2 0 0 0 4 0',
];

const SPEAKER: Part[] = ['M11 5 6.5 9h-3v6h3L11 19V5Z'];

const SLASH = 'M4 4l16 16';

export const ICONS = {
  hash: ['M4 9h16M4 15h16M10 3 8 21M16 3l-2 18'],
  translate: ['m5 8 6 6', 'm4 14 6-6 2-3', 'M2 5h12', 'M7 2h1', 'm22 22-5-10-5 10', 'M14 18h6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  megaphone: ['M3.5 10.5v3a1 1 0 0 0 1 1h3l9 4.5V5l-9 4.5h-3a1 1 0 0 0-1 1Z', 'M19.5 9.5a3.5 3.5 0 0 1 0 5', 'M8 14.5v3.25a2 2 0 0 0 4 0V16.5'],
  forum: ['M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9.5L6 16v-3h-.5A1.5 1.5 0 0 1 4 11.5v-6Z', 'M19 9h.5A1.5 1.5 0 0 1 21 10.5v6a1.5 1.5 0 0 1-1.5 1.5H19v3l-3.5-3H11'],
  tag: ['M3.5 12.2V5A1.5 1.5 0 0 1 5 3.5h7.2a1.5 1.5 0 0 1 1.06.44l7.3 7.3a1.5 1.5 0 0 1 0 2.12l-7.2 7.2a1.5 1.5 0 0 1-2.12 0l-7.3-7.3a1.5 1.5 0 0 1-.44-1.06Z', 'M8 8h.01'],
  volume: [...SPEAKER, 'M15 9.2a4 4 0 0 1 0 5.6', 'M17.8 6.4a8 8 0 0 1 0 11.2'],
  'volume-off': [...SPEAKER, 'm16 9.5 5 5M21 9.5l-5 5'],
  mic: MIC,
  'mic-off': [...MIC, SLASH],
  headphones: HEADPHONES,
  'headphones-off': [...HEADPHONES, SLASH],
  settings: [cog(8, 9.3, 7.2), circle(12, 12, 3)],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-up': ['m6 15 6-6 6 6'],
  'chevron-right': ['m9 6 6 6-6 6'],
  'chevron-left': ['m15 6-6 6 6 6'],
  plus: ['M12 5v14M5 12h14'],
  x: ['M6 6l12 12M18 6 6 18'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  search: [circle(10.5, 10.5, 6.5), 'm20 20-4.9-4.9'],
  bell: BELL,
  'bell-off': [...BELL, SLASH],
  users: [
    circle(9.5, 8.5, 3.5),
    'M3.5 20v-1a4.5 4.5 0 0 1 4.5-4.5h3a4.5 4.5 0 0 1 4.5 4.5v1',
    'M16 5.2a3.5 3.5 0 0 1 0 6.6',
    'M20.5 20v-1a4.5 4.5 0 0 0-3-4.2',
  ],
  user: [circle(12, 8, 4), 'M5 20v-1a4.5 4.5 0 0 1 4.5-4.5h5A4.5 4.5 0 0 1 19 19v1'],
  message: ['M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H9l-5 3.5Z'],
  refresh: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v4.5h-4.5'],
  'user-plus': [circle(9, 8, 3.5), 'M2.5 20v-1A4.5 4.5 0 0 1 7 14.5h4a4.5 4.5 0 0 1 4.5 4.5v1', 'M19 8v6M16 11h6'],
  phone: ['M5.2 4h3l1.6 4.1-2.1 1.4a11.5 11.5 0 0 0 6.8 6.8l1.4-2.1 4.1 1.6v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3.2 6.2 2 2 0 0 1 5.2 4Z'],
  video: [
    'M3.5 8A2 2 0 0 1 5.5 6h8A2 2 0 0 1 15.5 8v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V8Z',
    'm15.5 10.5 5-2.8v8.6l-5-2.8',
  ],
  home: ['M4 11 12 4l8 7v8.5a.5.5 0 0 1-.5.5H15v-5.5H9V20H4.5a.5.5 0 0 1-.5-.5V11Z'],
  compass: [circle(12, 12, 9), 'm15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1Z'],
  info: [circle(12, 12, 9), 'M12 11v5', { dot: [12, 8] }],
  pin: ['M9 4h6l-1 5 3 3v1.5H7V12l3-3-1-5Z', 'M12 13.5V20'],
  forward: ['M14 5l6 6-6 6', 'M20 11H9a5 5 0 0 0-5 5v3'],
  poll: ['M5 20V10', 'M12 20V4', 'M19 20v-7'],
  bookmark: ['M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  thread: ['M4 5h16', 'M4 10h10', 'M9 15h11', 'M9 20h7', 'M4 10v10'],
  'eye-off': ['M4 4l16 16', 'M9.9 5.3A9.9 9.9 0 0 1 12 5c5.5 0 9 5 10 7a16 16 0 0 1-3.2 4M6.4 6.5A15.4 15.4 0 0 0 2 12c1 2 4.5 7 10 7 1.8 0 3.4-.5 4.8-1.3', 'M10 10a3 3 0 0 0 4 4'],
  link: ['M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1', 'M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1'],
  smile: [circle(12, 12, 9), 'M8.5 14a4 4 0 0 0 7 0', { dot: [9, 9.5] }, { dot: [15, 9.5] }],
  paperclip: ['m20 11-8.5 8.5a5 5 0 0 1-7-7l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8-8'],
  send: ['M20.5 3.5 10 14', 'M20.5 3.5 14 20.5l-4-6.5-6.5-4 17-6.5Z'],
  reply: ['m10 6-6 6 6 6', 'M4 12h10a6 6 0 0 1 6 6v1'],
  edit: ['M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z', 'm14.5 7.5 3 3'],
  trash: [
    'M4.5 7h15M9 7V4.5h6V7',
    'M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7',
    'M10 11v5M14 11v5',
  ],
  copy: ['M8 9a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9Z', 'M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3'],
  more: [{ dot: [5, 12] }, { dot: [12, 12] }, { dot: [19, 12] }],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z'],
  download: ['M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14'],
  upload: ['M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14'],
  monitor: ['M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M8 20h8M12 16v4'],
  star: ['m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z'],
  crown: ['M4 8l3.5 4L12 5.5l4.5 6.5L20 8l-1.5 10h-13L4 8Z'],
  sparkle: [
    'M11 3.5l1.9 5.6 5.6 1.9-5.6 1.9L11 18.5l-1.9-5.6L3.5 11l5.6-1.9L11 3.5Z',
    'M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
  ],
  at: [circle(12, 12, 3.5), 'M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8'],
  'arrow-down': ['M12 5v14M6.5 13.5 12 19l5.5-5.5'],
  image: ['M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', circle(9, 9, 1.6), 'm20 15-4.5-4.5L7 19'],
  gif: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M9.5 10.3A2.5 2.5 0 1 0 9.5 13.7v-1.4H8.4', 'M12.8 9.5v5M15.4 14.5v-5h2.4M15.4 12h2'],
  grid: ['M4 4h6.5v6.5H4V4ZM13.5 4H20v6.5h-6.5V4ZM4 13.5h6.5V20H4v-6.5ZM13.5 13.5H20V20h-6.5v-6.5Z'],
  palette: [
    'M12 3a9 9 0 1 0 0 18 2.2 2.2 0 0 0 1.6-3.7 2.2 2.2 0 0 1 1.6-3.8H17a4 4 0 0 0 4-4C21 5.9 17 3 12 3Z',
    { dot: [7.5, 11] },
    { dot: [10.5, 7.2] },
    { dot: [15.2, 7.6] },
  ],
  flag: ['M5 21V4', 'M5 4h12l-2.5 4 2.5 4H5'],
  shield: ['M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6l-7-2.5Z', 'm9 12 2.2 2.2L15.5 10'],
  globe: [circle(12, 12, 9), 'M3 12h18', 'M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z'],
  hourglass: ['M7 3.5h10M7 20.5h10', 'M8 3.5c0 4 2.5 5 4 8.5-1.5 3.5-4 4.5-4 8.5', 'M16 3.5c0 4-2.5 5-4 8.5 1.5 3.5 4 4.5 4 8.5'],
  moon: ['M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2Z'],
  logout: ['M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4', 'm15 8 4 4-4 4M19 12H9'],
  login: ['M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4', 'm9 8 4 4-4 4M13 12H3'],
  file: ['M6.5 3.5H14L18.5 8v11a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z', 'M14 3.5V8h4.5'],
  music: ['M9 18V6.5L19.5 4v11.5', circle(6.5, 18, 2.5), circle(17, 15.5, 2.5)],
  play: ['M7.5 4.5v15l12-7.5-12-7.5Z'],
  pause: ['M8.5 5v14M15.5 5v14'],
  alert: [circle(12, 12, 9), 'M12 7.5v5', { dot: [12, 16] }],
} as const satisfies Record<string, readonly Part[]>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  /** Pixels; the glyph is drawn on a 24 grid and scaled. */
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
  /** An accessible name. Without one the icon is decorative and hidden from assistive technology. */
  title?: string;
}

export function Icon({ name, size = 20, strokeWidth = 1.75, className, style, title }: IconProps): React.JSX.Element {
  const parts: readonly Part[] = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {parts.map((part, index) => {
        if (typeof part === 'string') return <path key={index} d={part} />;
        return <circle key={index} cx={part.dot[0]} cy={part.dot[1]} r={1.35} fill="currentColor" stroke="none" />;
      })}
    </svg>
  );
}
