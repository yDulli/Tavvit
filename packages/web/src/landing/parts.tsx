import React from 'react';
import type en from '../locales/en/landing.json';
import type { LandingImage } from './images';

/**
 * The small pieces the product page is put together from (docs/systems/landing.md): its marks, its
 * pictures, its one white button. They live here so the page and the plan (Plan.tsx) draw them alike.
 */

export type CssVars = React.CSSProperties & Record<`--${string}`, string | number>;

/** A line of the menu (`features.items.*`): the index and Explore's lists say only what it says. */
export type FeatureItem = keyof typeof en.features.items;

/** A number as the page's sheets and indices write it: two digits, in Geist Mono. */
export const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The page's marks, drawn as the app's channel icons are: a stroke on a 24px grid. The kinds of room
 * on the plan (a channel, a voice room, a thread, the events, the way in) use the same.
 */
export const GLYPHS = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  down: 'M12 4v14M6 12l6 6 6-6',
  download: 'M12 3v12M7 11l5 4 5-4M4 20h16',
  plus: 'M12 5v14M5 12h14',
  hash: 'M9.5 4 8 20M16 4l-1.5 16M5 9h15M4 15h15',
  speaker: 'M4 10v4h4l5 4V6l-5 4zM16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10',
  thread: 'M6 4v7a4 4 0 0 0 4 4h9M15 11l4 4-4 4',
  calendar: 'M4.5 6.5h15v13h-15zM4.5 10.5h15M8.5 4v4.5M15.5 4v4.5',
  enter: 'M11 4h8v16h-8M4 12h10M10.5 8.5 14 12l-3.5 3.5',
  lock: 'M7.5 11V8.5a4.5 4.5 0 0 1 9 0V11M5.5 11h13v9h-13z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  play: 'M8 5.5v13l10-6.5z',
  check: 'M5 12.5 9.5 17 19 7.5',
  mic: 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3.5',
  micOff: 'M15 9.5v-3a3 3 0 0 0-5.8-1.1M9 9v2.5a3 3 0 0 0 5.1 2.1M6 11a6 6 0 0 0 9.6 4.8M18 11a6 6 0 0 1-.5 2.4M12 17v3.5M4 4l16 16',
  camera: 'M3.5 7h12v10h-12zM15.5 10.5l5-3v9l-5-3',
  leave: 'M3.5 13.5c4.7-4 12.3-4 17 0l-2.2 2.3-3.3-1.4v-2.6a10 10 0 0 0-6 0v2.6l-3.3 1.4z',
  back: 'M19 12H5M11 6l-6 6 6 6',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4',
  palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.8-1 1.3-1.9-.6-1 .1-2.4 1.4-2.4H17a3.5 3.5 0 0 0 3.5-3.5c0-5.1-3.8-9.2-8.5-9.2zM7.5 12.5h.01M9.5 8h.01M14.5 7.5h.01',
  crown: 'M4 17.5h16M5 15l-1-8 4.5 3.5L12 5l3.5 5.5L20 7l-1 8z',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14c2 .7 3 2.6 3 6',
  // The symbols a space tag stands beside, and the marks of the page's glass objects.
  moon: 'M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z',
  book: 'M5 5a1.5 1.5 0 0 1 1.5-1.5H19V17H6.5A1.5 1.5 0 0 0 5 18.5zM5 18.5A1.5 1.5 0 0 0 6.5 20H19',
  wrench: 'M14.5 4.2a5 5 0 0 0-5.3 6.6L3.8 16.2a2 2 0 0 0 2.9 2.9l5.4-5.4a5 5 0 0 0 6.6-5.3l-2.9 2.9-2.8-.7-.7-2.8z',
  film: 'M4 6.5h16v12H4zM4 10.5h16M8 6.5l1.8 4M12.5 6.5l1.8 4M17 6.5l1.8 4',
  screen: 'M3.5 5h17v11h-17zM8.5 20h7M12 16v4M12 13.5v-6M9.5 10 12 7.5l2.5 2.5',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 14.5h3.5v5.5H5.5A1.5 1.5 0 0 1 4 18.5zM20 14.5h-3.5v5.5h2A1.5 1.5 0 0 0 20 18.5z',
  music: 'M9 18V5.5l11-2v12.5M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  shield: 'M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z',
  filter: 'M4 5.5h16l-6 7.5v5.5l-4 2v-7.5z',
  log: 'M7 4h11v16H7zM10 8.5h5M10 12h5M10 15.5h3M4.5 7v10',
  sparkle: 'M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z',
  windows: 'M4 5.5 11 4.5v7H4zM13 4.2l7-1v8.3h-7zM4 12.5h7v7l-7-1zM13 12.5h7v8.3l-7-1z',
  phone: 'M7.5 3h9v18h-9zM11 18h2',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z',
  bot: 'M6 8.5h12v10H6zM12 8.5V5M12 4.5h.01M9.5 13h.01M14.5 13h.01M9.5 16h5M3.5 12.5v3M20.5 12.5v3',
  template: 'M4 4.5h7v7H4zM13 4.5h7v4h-7zM13 11h7v8.5h-7zM4 14h7v5.5H4z',
} as const;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name }: { name: GlyphName }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPHS[name]} />
    </svg>
  );
}

/** The logo as a hairline, large, behind the closing: white, as the logo always is. */
export function LogoLines({ className = 'lp-logo-lines' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="393.6 367 465.6 465.6" aria-hidden="true">
      <circle cx="626.4" cy="599.8" r="229.9" />
      <path d="M549 498.5H769.82L723.4 556Q716.9 564.06 702 564.06H480.5L527.3 509Q536.6 498.5 549 498.5Z" />
      <path d="M642.72 573.83V685Q642.72 695.6 635.6 701.86L578.31 751.9V635.5Q578.31 627.2 584.5 622.2Z" />
    </svg>
  );
}

/** The one white button of an opening, as `.btn-hero` is in the app, with its arrow. */
export function MainButton({ href, className = '', children }: { href: string; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a className={`lp-btn lp-btn-hero lp-btn-lg ${className}`} href={href}>
      {children}
      <Glyph name="arrow" />
    </a>
  );
}

/** A heading's lines as the catalog breaks them: each on a line of its own. */
export function Lines({ text }: { text: string }): React.JSX.Element {
  const [first, ...rest] = text.split('\n');
  if (rest.length === 0) return <>{first}</>;
  return (
    <>
      <span className="lp-line">{first}</span>
      {'\n'}
      <span className="lp-line">{rest.join(' ')}</span>
    </>
  );
}

/** Every picture is lazy: the desktop's window and the phone's screen are both in the page, and only the one shown may load. */
export function Img({ image, alt = '', className }: { image: LandingImage; alt?: string; className?: string }): React.JSX.Element {
  return <img src={image.src} width={image.width} height={image.height} alt={alt} loading="lazy" decoding="async" className={className} />;
}

/**
 * Where the arrow keys take a choice among `count`: the next or the previous one, around the end,
 * and Home or End to the first or the last; null for any other key.
 */
export function nextChoice(key: string, active: number, count: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (active + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (active - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** Focuses a chosen tab and, in a strip that scrolls sideways on a phone, scrolls it into view. */
export function bringIntoView(element: HTMLElement | undefined): void {
  if (!element) return;
  element.focus();
  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
