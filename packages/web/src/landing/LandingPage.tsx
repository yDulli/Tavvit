import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InstanceInfoResponse } from '@backspace/shared';
import type { PublicStatus, ServiceState } from '@backspace/shared/src/publicStatus.js';
import { PRODUCT_NAME } from '@backspace/shared/src/constants.js';
import { SITE_ORIGIN_TOKEN } from '@backspace/shared/src/site.js';
import { availableLanguages, isSupportedLanguage } from '../i18n/languages';
import { DemoChat } from './DemoChat';
import { EXAMPLE_ROUTE, exampleRequest } from './example';
import { LANDING_FIGURES } from './figures';
import { chooseLandingLanguage } from './i18n';
import { LANDING_IMAGES, LOOKS, type LandingImage } from './images';

/**
 * The public product page, shown at `/` to a visitor who is not signed in
 * (landing/entry.ts). A plain document with its own stylesheet (landing.css): its
 * links are ordinary links, because every one of them leads out of this small
 * bundle and into the app (or to a file). The pictures are real screens of the real
 * app with invented people in them; `scripts/landing-shots` retakes them.
 *
 * The page is built from the app's own material (docs/systems/design-system.md):
 * graphite surfaces told apart by a step in tone and a hairline, light behind the
 * content in the colour of the place, one violet signal, small corners, Geist and
 * Geist Mono. It is a document of chapters, each with an index in the margin, and
 * what it says has to stay true: a feature named here exists in the app, and nothing
 * promises federation, native phone apps or end-to-end encryption.
 */

/** Each language's list of what changed, fetched when needed: the page's script does not carry them. */
const CHANGELOGS = import.meta.glob<{ versions: Record<string, { title: string }> }>('../locales/*/changelog.json', { import: 'default' });

/** The keys of the switcher's shortcut: the same in every language. */
const SWITCHER_KEYS = ['Ctrl', 'K'];

/**
 * The keys that open the page's switcher on an Apple device; everywhere else they are the app's Ctrl
 * and K. Both are in the page and the stylesheet shows one (`data-lp-os`, set before the first paint),
 * because the page's HTML is written before anyone's device is known (`landingPlatform`).
 */
const APPLE_JUMP_KEYS: readonly string[] = ['⌘', 'K'];
/** The keys the switcher's foot names, the same in every language. */
const JUMP_HINTS = { move: ['↑', '↓'], go: ['Enter'], close: ['Esc'] } as const;

/**
 * The keys on the opening's window, each on an empty patch of the picture beside the thing it
 * names, and the part of the window each one names (`part`), all as shares of the window's width
 * and height. Pointing at a part, or at its line in the legend, lights that part and dims the rest.
 * They belong to this `window.webp`: when `scripts/landing-shots` retakes it, look at them again.
 */
const WINDOW_KEYS = [
  { key: 'spaces', x: 52.7, y: 2.6, part: { x: 6.6, y: 0.6, w: 45.2, h: 4.4 } },
  { key: 'channels', x: 14.3, y: 31.9, part: { x: 0, y: 5.3, w: 17.2, h: 94.7 } },
  { key: 'conversation', x: 78, y: 25, part: { x: 17.2, y: 5.3, w: 65.6, h: 94.7 } },
  { key: 'members', x: 95.5, y: 7.5, part: { x: 82.8, y: 5.3, w: 17.2, h: 94.7 } },
] as const;

type WindowKey = (typeof WINDOW_KEYS)[number]['key'];
type WindowPart = (typeof WINDOW_KEYS)[number]['part'];

/** The part of the window a point is in, as shares of the window's width and height; null between parts. */
function partAt(x: number, y: number): WindowKey | null {
  return WINDOW_KEYS.find(({ part }) => x >= part.x && x <= part.x + part.w && y >= part.y && y <= part.y + part.h)?.key ?? null;
}

/**
 * The figures of the opening: every number is the app's own. None of ads and trackers is the code
 * as it is (docs/systems/legal.md); the rest are the app's lists and limits (`figures.ts`).
 */
const FIGURES = [
  { key: 'ads', value: 0 },
  { key: 'trackers', value: 0 },
  { key: 'languages', value: availableLanguages.length },
  { key: 'themes', value: LANDING_FIGURES.themes },
  { key: 'group', value: LANDING_FIGURES.group },
  { key: 'characters', value: LANDING_FIGURES.characters },
] as const;

/**
 * The chapters in their order, for the contents, the rail and the switcher: each name's key in the
 * catalog, the id of its heading, and the mark it has in the rail, as a channel has its icon.
 */
const CONTENTS = [
  ['demo', 'landing-demo', 'hash'],
  ['spaces', 'landing-spaces', 'spaces'],
  ['messages', 'landing-messages', 'chat'],
  ['around', 'landing-around', 'thread'],
  ['voice', 'landing-voice', 'speaker'],
  ['people', 'landing-people', 'people'],
  ['looks', 'landing-themes', 'palette'],
  ['community', 'landing-community', 'compass'],
  ['developers', 'landing-developers', 'code'],
  ['privacy', 'landing-privacy', 'shield'],
  ['anywhere', 'landing-anywhere', 'devices'],
  ['features', 'landing-all', 'list'],
  ['questions', 'landing-questions', 'help'],
] as const satisfies readonly (readonly [string, string, GlyphName])[];

/** Every place the rail lists, in order: the opening, then each chapter. */
const RAIL_IDS: readonly string[] = ['landing-title', ...CONTENTS.map(([, id]) => id)];

/** A chapter's number as the margin and the pill write it. */
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The colour each demo space lights its room with, as the app lights its panels in the colour
 * of the place you are in: the accent at home, and a space's own colour inside it.
 */
const PLACES = {
  raid: 'rgb(var(--accent-primary))',
  photo: 'rgb(var(--accent-rose))',
  dev: 'rgb(var(--accent-mint))',
  books: 'rgb(var(--accent-coral))',
} as const;

type CssVars = React.CSSProperties & Record<`--${string}`, string | number>;

/**
 * The arrows of the buttons, the mark of an answer that opens and the download; then the marks of
 * the rail and the switcher, drawn as the app's channel icons are, as a stroke on a 24px grid.
 */
const GLYPHS = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  down: 'M12 4v14M6 12l6 6 6-6',
  download: 'M12 3v12M7 11l5 4 5-4M4 20h16',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  chevron: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  home: 'M4 11l8-6.5 8 6.5M6 9.5V20h4.5v-5.5h3V20H18V9.5',
  hash: 'M9.5 4 8 20M16 4l-1.5 16M5 9h15M4 15h15',
  spaces: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  chat: 'M20 12a7.5 7.5 0 0 1-7.5 7.5H5l1.6-2.6A7.5 7.5 0 1 1 20 12z',
  thread: 'M6 4v7a4 4 0 0 0 4 4h9M15 11l4 4-4 4',
  speaker: 'M4 10v4h4l5 4V6l-5 4zM16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10',
  people: 'M15.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H7a3.5 3.5 0 0 0-3.5 3.5V20M9.5 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20.5 20v-1.5a3.5 3.5 0 0 0-2.5-3.4M15.5 4.6a3.5 3.5 0 0 1 0 6.8',
  palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.5-.6 1.5-1.4 0-1.4-1.3-1.8-1.3-3 0-.9.7-1.6 1.6-1.6h2.2a4.5 4.5 0 0 0 4.5-4.5c0-3.6-3.8-6.5-8.5-6.5zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  compass: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM15.5 8.5l-2 5-5 2 2-5z',
  code: 'M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5l-3 14',
  shield: 'M12 3.5 19 6v5.5c0 4.2-3 7.7-7 9-4-1.3-7-4.8-7-9V6z',
  devices: 'M3 5.5h12v9H3zM6.5 18.5h5M9 14.5v4M17.5 8.5h3.5v11h-3.5z',
  list: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  help: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 16.5h.01',
  page: 'M13.5 3.5h-7v17h11v-13zM13.5 3.5v4h4',
} as const;

type GlyphName = keyof typeof GLYPHS;

function Glyph({ name }: { name: GlyphName }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPHS[name]} />
    </svg>
  );
}

/** The logo as a hairline, large, behind the closing: white, as the logo always is. */
function LogoLines(): React.JSX.Element {
  return (
    <svg className="lp-logo-lines" viewBox="393.6 367 465.6 465.6" aria-hidden="true">
      <circle cx="626.4" cy="599.8" r="229.9" />
      <path d="M549 498.5H769.82L723.4 556Q716.9 564.06 702 564.06H480.5L527.3 509Q536.6 498.5 549 498.5Z" />
      <path d="M642.72 573.83V685Q642.72 695.6 635.6 701.86L578.31 751.9V635.5Q578.31 627.2 584.5 622.2Z" />
    </svg>
  );
}

/** The one white button of an opening, as `.btn-hero` is in the app, with its arrow. */
function MainButton({ href, className = '', children }: { href: string; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a className={`lp-btn lp-btn-hero lp-btn-lg ${className}`} href={href}>
      {children}
      <Glyph name="arrow" />
    </a>
  );
}

/** A heading's lines as the catalog breaks them: each on a line of its own. */
function Lines({ text }: { text: string }): React.JSX.Element {
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

/** Every picture is lazy, the hero's too: the desktop's window and the phone's screen are both in the page, and only the one shown may load. */
function Img({ image, alt = '', className }: { image: LandingImage; alt?: string; className?: string }): React.JSX.Element {
  return <img src={image.src} width={image.width} height={image.height} alt={alt} loading="lazy" decoding="async" className={className} />;
}

/**
 * A part of the big window's picture, in the pixels of the 1440 x 900 window it was taken from: what
 * a section is about, at a size that can be read, and no new file to load.
 */
function WindowCrop({ x, y, width, height, alt }: { x: number; y: number; width: number; height: number; alt: string }): React.JSX.Element {
  const { window: image } = LANDING_IMAGES;
  // The rectangle goes to the stylesheet as custom properties, which a narrow window overrides with a narrower part.
  const crop = { '--crop-x': x, '--crop-y': y, '--crop-w': width, aspectRatio: `${width} / ${height}` } as CssVars;
  return (
    <div className="lp-frame lp-crop" style={crop}>
      <img src={image.src} width={image.width} height={image.height} alt={alt} loading="lazy" decoding="async" />
    </div>
  );
}

/** The width of a heading's widest line of text. */
function widestLine(heading: HTMLElement): number {
  const range = document.createRange();
  const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
  let widest = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) widest = Math.max(widest, rect.width);
  }
  return widest;
}

function roomIn(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

/**
 * Keeps a heading inside its column, and on the lines the catalog gave it. A language with one long
 * word ("Присаживайтесь.") would run past the edge, and a long line of a two-line heading ("Reden,
 * wenn Tippen zu langsam ist.") would break a second time into single words: when a line, measured
 * unbroken, is wider than the heading's own column, the size comes down until it fits.
 */
function useFitHeadings(root: React.RefObject<HTMLDivElement>, language: string): void {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const fit = () => {
      for (const heading of element.querySelectorAll<HTMLElement>('.lp-display, .lp-h2')) {
        heading.style.removeProperty('--fit');
        const room = roomIn(heading);
        const lines = Array.from(heading.querySelectorAll<HTMLElement>('.lp-line'));
        let widest = 0;
        if (lines.length === 0) {
          widest = widestLine(heading);
        } else {
          for (const line of lines) {
            line.style.whiteSpace = 'nowrap';
            widest = Math.max(widest, widestLine(line));
            line.style.removeProperty('white-space');
          }
        }
        if (widest > room) heading.style.setProperty('--fit', `${Math.floor((parseFloat(getComputedStyle(heading).fontSize) * room) / widest)}px`);
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [root, language]);
}

/**
 * Lets each part of a chapter arrive once, when it first comes into view: the stylesheet holds a
 * `[data-arrive]` element at the first frame of its animation until `data-in` lets it play, and
 * only while the page says it can watch the viewport, so nothing is ever hidden for good.
 *
 * A page rendered ahead of time (`prerendered`) was on screen before this ran: what the visitor
 * already sees, or has scrolled past, stays where it is (`data-in="shown"`, no animation) instead of
 * vanishing and arriving again. Only the parts further down arrive.
 */
function useArrivals(root: React.RefObject<HTMLDivElement>, prerendered: boolean): void {
  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    if (prerendered) {
      const fold = window.innerHeight;
      for (const part of element.querySelectorAll<HTMLElement>('[data-arrive]')) {
        if (part.getBoundingClientRect().top < fold) part.setAttribute('data-in', 'shown');
      }
    }
    element.setAttribute('data-arrivals', 'on');
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-in', 'true');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    // Every part that has not arrived, now and whenever the page changes: a change of language
    // mounts what it translates anew, and a part nobody watched would stay at its first frame.
    const watch = () => {
      for (const part of element.querySelectorAll<HTMLElement>('[data-arrive]:not([data-in])')) observer.observe(part);
    };
    watch();
    const changes = typeof MutationObserver === 'undefined' ? null : new MutationObserver(watch);
    changes?.observe(element, { childList: true, subtree: true });
    return () => {
      changes?.disconnect();
      observer.disconnect();
      element.removeAttribute('data-arrivals');
    };
  }, [root, prerendered]);
}

/**
 * Where the arrow keys take a choice among `count`: the next or the previous one, around the end,
 * and Home or End to the first or the last; null for any other key. Up and Down work as Left and
 * Right do, as a radio group expects.
 */
function nextChoice(key: string, active: number, count: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (active + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (active - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** Focuses a chosen tab and, in a strip that scrolls sideways on a phone, scrolls it into view. */
function bringIntoView(element: HTMLElement | undefined): void {
  if (!element) return;
  element.focus();
  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** Whether the page has moved under the nav, which then draws its hairline. */
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => setScrolled(window.scrollY > 8);
    read();
    window.addEventListener('scroll', read, { passive: true });
    return () => window.removeEventListener('scroll', read);
  }, []);
  return scrolled;
}

function LanguagePicker({ id, className, label }: { id: string; className: string; label?: string }): React.JSX.Element {
  const { i18n } = useTranslation('landing');
  return (
    <select
      id={id}
      aria-label={label}
      value={i18n.resolvedLanguage ?? i18n.language}
      onChange={(event) => {
        if (isSupportedLanguage(event.target.value)) void chooseLandingLanguage(event.target.value);
      }}
      className={className}
    >
      {availableLanguages.map((language) => (
        <option key={language.code} value={language.code}>{language.nativeName}</option>
      ))}
    </select>
  );
}

function Nav({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const scrolled = useScrolled();
  return (
    <header className="lp-nav" data-scrolled={scrolled ? 'true' : 'false'}>
      <div className="lp-wrap lp-nav-in">
        <a className="lp-brand" href="/">
          <img src="/icons/logo-mark.svg" alt="" width={20} height={20} />
          <span>{PRODUCT_NAME}</span>
        </a>
        <nav className="lp-nav-links" aria-label={t('nav.label')}>
          <a className="lp-nav-link lp-hide-phone" href="#features">{t('nav.features')}</a>
          <a className="lp-nav-link lp-hide-phone" href="/download">{t('nav.download')}</a>
          <a className="lp-nav-link lp-hide-phone" href="/developers">{t('nav.developers')}</a>
          <a className="lp-nav-link lp-hide-phone" href="/help">{t('nav.help')}</a>
          <div className="lp-nav-right">
            <LanguagePicker id="landing-language-top" className="lp-nav-language lp-hide-phone" label={t('footer.language')} />
            <a className="lp-nav-link" href="/login">{t('nav.login')}</a>
            {/* An outline: the one white button of the opening is the hero's. */}
            {registrationOpen && <a className="lp-btn lp-btn-quiet lp-btn-sm lp-nav-cta" href="/register">{t('nav.register')}</a>}
          </div>
        </nav>
      </div>
    </header>
  );
}

/** The newest line of `/changelog`, in the page's language. Its room stays reserved while it loads, so nothing jumps. */
function News(): React.JSX.Element {
  const { t, i18n } = useTranslation('landing');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void CHANGELOGS[`../locales/${language}/changelog.json`]?.()
      .then((catalog) => {
        const newest = Object.values(catalog.versions)[0];
        if (live && newest) setTitle(newest.title);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [language]);
  return (
    <a className="lp-news" href="/changelog" style={title ? undefined : { visibility: 'hidden' }}>
      <span className="lp-news-label">{t('news.label')}</span>
      <span className="lp-news-title">{title}</span>
      <Glyph name="arrow" />
    </a>
  );
}

interface ChapterProps {
  /** Its number in the margin. */
  index: number;
  /** Its name in the margin, under the number. */
  name: string;
  headingId: string;
  title: string;
  lead?: string;
  className?: string;
  /** The colour of the place, for a chapter with light. */
  place?: string;
  children: React.ReactNode;
}

/**
 * A chapter of the document: a hairline, the index in the margin, the heading and its lead side
 * by side, and the chapter's own composition under them. A chapter with a place is lit in its colour,
 * behind the content, as the app lights the room you are in.
 */
function Chapter({ index, name, headingId, title, lead, className = '', place, children }: ChapterProps): React.JSX.Element {
  const style = place ? ({ '--lp-place-target': place } as CssVars) : undefined;
  return (
    <section aria-labelledby={headingId} className={`lp-chapter ${className}`} style={style}>
      {place && <div className="lp-light" aria-hidden="true" />}
      <div className="lp-wrap">
        <header className="lp-chapter-head" data-arrive="">
          <p className="lp-index">
            <span className="lp-mono">{String(index).padStart(2, '0')}</span>
            <span className="lp-label">{name}</span>
          </p>
          <h2 id={headingId} className="lp-h2 lp-ink"><Lines text={title} /></h2>
          {lead && <p className="lp-lead">{lead}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}

/** Short points on a hairline grid, each a title and a sentence. Keyed by the catalog's key, which a change of language keeps. */
function Points({ points, className = '' }: { points: readonly { key: string; title: string; body: string }[]; className?: string }): React.JSX.Element {
  return (
    <div className={`lp-grid ${className}`}>
      {points.map((point, index) => (
        <div key={point.key} data-arrive="" style={{ '--i': index } as CssVars}>
          <h3 className="lp-cell-title">{point.title}</h3>
          <p className="lp-cell-body">{point.body}</p>
        </div>
      ))}
    </div>
  );
}

function Hero({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  // The part of the window pointed at, and where its light stands: it keeps its place while it fades.
  const [lit, setLit] = useState<WindowKey | null>(null);
  const [spot, setSpot] = useState<WindowPart>(WINDOW_KEYS[2].part);
  const light = (key: WindowKey | null) => {
    setLit(key);
    const mark = WINDOW_KEYS.find((entry) => entry.key === key);
    if (mark) setSpot(mark.part);
  };
  // Only a mouse points: a touch on the picture is a scroll, and the legend says the same in words.
  const onWindowPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    light(partAt(((event.clientX - box.left) / box.width) * 100, ((event.clientY - box.top) / box.height) * 100));
  };
  const spotStyle = { '--x': `${spot.x}%`, '--y': `${spot.y}%`, '--w': `${spot.w}%`, '--h': `${spot.h}%` } as CssVars;
  return (
    <section aria-labelledby="landing-title" className="lp-hero">
      <div className="lp-light lp-light-rings" aria-hidden="true" />
      <div className="lp-wrap">
        <div className="lp-hero-copy">
          <div>
            <News />
            <h1 id="landing-title" className="lp-display lp-ink">{t('hero.title')}</h1>
          </div>
          <div>
            <p className="lp-lead">{t('hero.lead')}</p>
            <div className="lp-actions">
              <MainButton href={registrationOpen ? '/register' : '/login'}>{registrationOpen ? t('nav.register') : t('nav.login')}</MainButton>
              {/* The one desktop app there is, on Windows; everyone else is offered a look around. Both are
                  in the page's HTML and the stylesheet shows one (`data-lp-os`, set before the first paint). */}
              <a className="lp-btn lp-btn-quiet lp-btn-lg lp-for-windows" href="/download"><Glyph name="download" />{t('anywhere.desktop.link')}</a>
              <a className="lp-btn lp-btn-quiet lp-btn-lg lp-not-windows" href="#features"><Glyph name="down" />{t('hero.explore')}</a>
            </div>
          </div>
        </div>
        <figure className="lp-hero-stage lp-desk-only">
          <div className="lp-frame lp-window" onPointerMove={onWindowPointer} onPointerLeave={() => light(null)}>
            <Img image={LANDING_IMAGES.window} alt={t('hero.alt')} />
            <div className="lp-spot" data-on={lit ? 'true' : undefined} style={spotStyle} aria-hidden="true" />
            {/* The keys stand on the picture and take no clicks; the legend under it answers them. */}
            <div className="lp-key-layer" aria-hidden="true">
              {WINDOW_KEYS.map((mark, index) => (
                <span key={mark.key} className="lp-mark" data-on={lit === mark.key ? 'true' : undefined} style={{ left: `${mark.x}%`, top: `${mark.y}%` }}>{index + 1}</span>
              ))}
            </div>
          </div>
          <figcaption className="lp-legend">
            {WINDOW_KEYS.map((mark, index) => (
              <div
                key={mark.key}
                data-on={lit === mark.key ? 'true' : undefined}
                onPointerEnter={(event) => { if (event.pointerType === 'mouse') light(mark.key); }}
                onPointerLeave={() => light(null)}
              >
                <p className="lp-legend-title"><span className="lp-mark">{index + 1}</span>{t(`hero.keys.${mark.key}.title`)}</p>
                <p className="lp-legend-body">{t(`hero.keys.${mark.key}.body`)}</p>
              </div>
            ))}
          </figcaption>
        </figure>
        <div className="lp-hero-phone lp-phone-only">
          <div className="lp-device"><Img image={LANDING_IMAGES.phone} alt={t('anywhere.phone.alt')} /></div>
        </div>
      </div>
    </section>
  );
}

/** One line of display type, six figures of the app's own under it, and the contents of the page: what the nav's "Features" leads to. */
function Statement(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section id="features" aria-label={t('nav.features')} className="lp-sec lp-band">
      <div className="lp-wrap">
        <p className="lp-statement lp-ink" data-arrive="">{t('statement')}</p>
        <dl className="lp-grid lp-figures">
          {FIGURES.map((figure, index) => (
            <div key={figure.key} data-arrive="" style={{ '--i': index } as CssVars}>
              <dt className="lp-label">{t(`figures.${figure.key}`)}</dt>
              <dd className="lp-figure">{t('figures.value', { value: figure.value })}</dd>
            </div>
          ))}
        </dl>
        <p className="lp-figures-note" data-arrive="">{t('figures.note')}</p>
        <nav className="lp-contents" aria-label={t('contents.label')} data-arrive="">
          <p className="lp-label">{t('contents.label')}</p>
          <ol>
            {CONTENTS.map(([key, id], index) => (
              <li key={key}>
                <a href={`#${id}`}>
                  <span className="lp-mono">{String(index + 1).padStart(2, '0')}</span>
                  {t(`chapters.${key}`)}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </section>
  );
}

function Demo({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [hasWritten, setHasWritten] = useState(false);
  return (
    <Chapter index={1} name={t('chapters.demo')} headingId="landing-demo" title={t('demo.title')} lead={t('demo.body')}>
      <div className="lp-frame lp-window lp-demo-stage" data-arrive="">
        <DemoChat onFirstMessage={() => setHasWritten(true)} />
      </div>
      <div className="lp-demo-after">
        <p className="lp-demo-note">{t('demo.note')}</p>
        {registrationOpen && hasWritten && <a className="lp-btn lp-btn-quiet lp-demo-cta" href="/register">{t('demo.cta')}<Glyph name="arrow" /></a>}
      </div>
    </Chapter>
  );
}

/**
 * The same app with different people in it: real screens of the demo community's spaces. A
 * picture is only asked for once its group is chosen, or about to be, and the chapter's light
 * takes the colour of the chosen space, as the app's panels do.
 */
function Spaces(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [active, setActive] = useState(0);
  const crowds = [
    { key: 'raid', label: t('crowds.raid'), image: LANDING_IMAGES.window, alt: t('crowds.alts.raid'), place: PLACES.raid },
    { key: 'photo', label: t('crowds.photo'), image: LANDING_IMAGES.spacePhoto, alt: t('crowds.alts.photo'), place: PLACES.photo },
    { key: 'dev', label: t('crowds.dev'), image: LANDING_IMAGES.spaceDev, alt: t('crowds.alts.dev'), place: PLACES.dev },
    { key: 'books', label: t('crowds.books'), image: LANDING_IMAGES.spaceBooks, alt: t('crowds.alts.books'), place: PLACES.books },
  ];
  const shown = crowds[active]!;
  const onKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = nextChoice(event.key, active, crowds.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    bringIntoView(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]);
  };
  return (
    <Chapter index={2} name={t('chapters.spaces')} headingId="landing-spaces" title={t('spaces.title')} lead={t('spaces.body')} className="lp-band" place={shown.place}>
      <div className="lp-phones lp-phone-only">
        <div className="lp-frame"><Img image={LANDING_IMAGES.phone} alt={t('spaces.alt')} /></div>
        <div className="lp-frame"><Img image={LANDING_IMAGES.phoneChannels} /></div>
        <div className="lp-frame"><Img image={LANDING_IMAGES.phoneMembers} /></div>
      </div>
      <div className="lp-crowds" data-arrive="">
        <h3 id="landing-crowds" className="lp-h3">{t('crowds.title')}</h3>
        <div className="lp-tabs" role="tablist" aria-labelledby="landing-crowds" onKeyDown={onKeys}>
          {crowds.map((crowd, index) => (
            <button
              key={crowd.key}
              type="button"
              role="tab"
              id={`landing-crowd-${crowd.key}`}
              aria-selected={index === active}
              aria-controls="landing-crowd"
              tabIndex={index === active ? 0 : -1}
              className="lp-tab"
              onClick={(event) => { setActive(index); bringIntoView(event.currentTarget); }}
              onPointerEnter={() => { new Image().src = crowd.image.src; }}
            >
              {crowd.label}
            </button>
          ))}
        </div>
        <div id="landing-crowd" role="tabpanel" aria-labelledby={`landing-crowd-${shown.key}`} className="lp-crowd-stage">
          <div key={shown.key} className="lp-frame lp-window lp-crowd-shot"><Img image={shown.image} alt={shown.alt} /></div>
        </div>
      </div>
    </Chapter>
  );
}

function Messages(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const marks = [
    { key: 'replies', title: t('messages.marks.replies.title'), body: t('messages.marks.replies.body') },
    { key: 'reactions', title: t('messages.marks.reactions.title'), body: t('messages.marks.reactions.body') },
    { key: 'content', title: t('messages.marks.content.title'), body: t('messages.marks.content.body') },
    { key: 'switcher', title: t('messages.marks.switcher.title'), body: t('messages.marks.switcher.body'), keys: SWITCHER_KEYS },
  ];
  return (
    <Chapter index={3} name={t('chapters.messages')} headingId="landing-messages" title={t('messages.title')} lead={t('messages.body')}>
      <div className="lp-split">
        <div className="lp-marks" data-arrive="">
          {marks.map((mark) => (
            <div key={mark.key}>
              <h3 className="lp-h3">
                {mark.title}
                {mark.keys && (
                  <span className="lp-keycaps" aria-hidden="true">
                    {mark.keys.map((key) => <kbd key={key} className="lp-key">{key}</kbd>)}
                  </span>
                )}
              </h3>
              <p>{mark.body}</p>
            </div>
          ))}
        </div>
        <div data-arrive="" style={{ '--i': 1 } as CssVars}>
          <WindowCrop x={256} y={93} width={660} height={540} alt={t('messages.alt')} />
        </div>
      </div>
    </Chapter>
  );
}

/** A tile of the mosaic: a feature with its real screen at the foot. */
function Tile({ className, title, body, children, index }: { className: string; title: string; body: string; children?: React.ReactNode; index: number }): React.JSX.Element {
  return (
    <article className={`lp-tile ${className}`} data-arrive="" style={{ '--i': index } as CssVars}>
      <h3 className="lp-h3">{title}</h3>
      <p className="lp-cell-body">{body}</p>
      {children}
    </article>
  );
}

function Around(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const points = [
    { key: 'voice', title: t('around.points.voice.title'), body: t('around.points.voice.body') },
    { key: 'saved', title: t('around.points.saved.title'), body: t('around.points.saved.body') },
    { key: 'alerts', title: t('around.points.alerts.title'), body: t('around.points.alerts.body') },
  ];
  return (
    <Chapter index={4} name={t('chapters.around')} headingId="landing-around" title={t('around.title')} lead={t('around.body')} className="lp-band">
      <div className="lp-mosaic">
        <Tile className="lp-tile-thread" index={0} title={t('around.thread.title')} body={t('around.thread.body')}>
          <div className="lp-frame lp-thread-shot"><Img image={LANDING_IMAGES.thread} alt={t('around.thread.alt')} /></div>
        </Tile>
        <Tile className="lp-tile-poll" index={1} title={t('around.poll.title')} body={t('around.poll.body')}>
          <div className="lp-frame"><Img image={LANDING_IMAGES.poll} alt={t('around.poll.alt')} /></div>
        </Tile>
        <Tile className="lp-tile-welcome" index={2} title={t('around.welcome.title')} body={t('around.welcome.body')}>
          <div className="lp-frame"><Img image={LANDING_IMAGES.welcome} alt={t('around.welcome.alt')} /></div>
        </Tile>
        <Tile className="lp-tile-event" index={3} title={t('around.event.title')} body={t('around.event.body')}>
          <div className="lp-frame lp-event-shot"><Img image={LANDING_IMAGES.event} alt={t('around.event.alt')} /></div>
        </Tile>
        <div className="lp-tile lp-tile-points" data-arrive="" style={{ '--i': 4 } as CssVars}>
          {points.map((point) => (
            <div key={point.key}>
              <h3 className="lp-h3">{point.title}</h3>
              <p className="lp-cell-body">{point.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Chapter>
  );
}

function Voice(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const points = [
    { key: 'screen', title: t('voice.points.screen.title'), body: t('voice.points.screen.body') },
    { key: 'noise', title: t('voice.points.noise.title'), body: t('voice.points.noise.body') },
    { key: 'calls', title: t('voice.points.calls.title'), body: t('voice.points.calls.body') },
  ];
  return (
    <Chapter index={5} name={t('chapters.voice')} headingId="landing-voice" title={t('voice.title')} lead={t('voice.body')}>
      <div className="lp-frame lp-window lp-voice-shot" data-arrive=""><Img image={LANDING_IMAGES.voice} alt={t('voice.alt')} /></div>
      <Points className="lp-three lp-under" points={points} />
    </Chapter>
  );
}

function People(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <Chapter index={6} name={t('chapters.people')} headingId="landing-people" title={t('friends.title')} lead={`${t('friends.body')} ${t('profiles.body')}`} className="lp-band">
      <div className="lp-people-stage" data-arrive="">
        <div className="lp-frame lp-window lp-people-friends"><Img image={LANDING_IMAGES.friends} alt={t('friends.alt')} /></div>
        <div className="lp-frame lp-people-card"><Img image={LANDING_IMAGES.profile} alt={t('profiles.alt')} /></div>
      </div>
    </Chapter>
  );
}

/** Every look of the app, one picture each: the visitor picks a theme and the room takes its colour. */
function Looks(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [active, setActive] = useState(0);
  const look = LOOKS[active]!;
  const names = LOOKS.map((entry) => t(`themes.names.${entry.key}`));
  const onKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = nextChoice(event.key, active, LOOKS.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    bringIntoView(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]);
  };
  return (
    <Chapter index={7} name={t('chapters.looks')} headingId="landing-themes" title={t('themes.title')} lead={t('themes.body')} place={look.accent}>
      <div className="lp-looks" data-arrive="">
        {/* A choice of one look among seven: a radio group, which the arrow keys walk through. */}
        <div className="lp-looks-bar" role="radiogroup" aria-label={t('themes.pick')} onKeyDown={onKeys}>
          {LOOKS.map((entry, index) => (
            <button
              key={entry.key}
              type="button"
              role="radio"
              aria-checked={index === active}
              tabIndex={index === active ? 0 : -1}
              className="lp-swatch"
              style={{ '--swatch': entry.surface, '--swatch-accent': entry.accent } as CssVars}
              onClick={() => setActive(index)}
              onPointerEnter={() => { new Image().src = entry.image.src; }}
            >
              <i aria-hidden="true" />
              {names[index]}
            </button>
          ))}
        </div>
        <div className="lp-look-stage" aria-live="polite">
          <div key={look.key} className="lp-frame lp-window lp-look-shot"><Img image={look.image} alt={t('themes.alt', { name: names[active] })} /></div>
        </div>
      </div>
    </Chapter>
  );
}

function Community(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const points = [
    { key: 'explore', title: t('community.points.explore.title'), body: t('community.points.explore.body') },
    { key: 'moderation', title: t('community.points.moderation.title'), body: t('community.points.moderation.body') },
    { key: 'reports', title: t('community.points.reports.title'), body: t('community.points.reports.body') },
    { key: 'rights', title: t('community.points.rights.title'), body: t('community.points.rights.body') },
    { key: 'invites', title: t('community.points.invites.title'), body: t('community.points.invites.body') },
    { key: 'template', title: t('community.points.template.title'), body: t('community.points.template.body') },
  ];
  const steps = [
    { key: 'one', title: t('moving.one.title'), body: t('moving.one.body') },
    { key: 'two', title: t('moving.two.title'), body: t('moving.two.body') },
    { key: 'three', title: t('moving.three.title'), body: t('moving.three.body') },
  ];
  return (
    <Chapter index={8} name={t('chapters.community')} headingId="landing-community" title={t('community.title')} lead={t('community.body')} className="lp-band">
      <div className="lp-community">
        <div className="lp-frame lp-window lp-community-shot" data-arrive=""><Img image={LANDING_IMAGES.community} alt={t('community.alt')} /></div>
        <Points className="lp-two" points={points} />
      </div>
      <div className="lp-moving">
        <h3 id="landing-moving" className="lp-h2 lp-ink lp-h2-small" data-arrive="">{t('moving.title')}</h3>
        <ol className="lp-grid lp-three lp-steps" aria-labelledby="landing-moving">
          {steps.map((step, index) => (
            <li key={step.key} data-arrive="" style={{ '--i': index } as CssVars}>
              <span className="lp-step-number lp-mono" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <h4 className="lp-cell-title">{step.title}</h4>
              <p className="lp-cell-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </Chapter>
  );
}

/** The example in colour: the command, its flags and what is quoted. Its text stays as it is. */
function ExampleCode({ code }: { code: string }): React.JSX.Element {
  const kindOf = (piece: string): string | null => {
    if (piece === 'curl') return 'lp-code-command';
    if (/^-[XHd]$/.test(piece)) return 'lp-code-flag';
    return /^["']/.test(piece) ? 'lp-code-text' : null;
  };
  return (
    <code>
      {code.split(/(\bcurl\b|-[XHd](?=\s)|"[^"]*"|'[^']*')/).map((piece, index) => {
        const kind = kindOf(piece);
        return kind ? <span key={index} className={kind}>{piece}</span> : <React.Fragment key={index}>{piece}</React.Fragment>;
      })}
    </code>
  );
}

/**
 * The address this page was opened at, for the example a bot would send. A page rendered ahead of
 * time has no address yet: its HTML carries `SITE_ORIGIN_TOKEN`, which the server replaces with its
 * own origin and also writes into `<html data-origin>`, so the first render here says the same as the
 * HTML it takes over. A visitor who came in by another address sees theirs a moment later.
 */
function usePageOrigin(): string {
  const [origin, setOrigin] = useState(() => (typeof window === 'undefined'
    ? SITE_ORIGIN_TOKEN
    : document.documentElement.dataset.origin ?? window.location.origin));
  useEffect(() => {
    if (origin !== window.location.origin) setOrigin(window.location.origin);
  }, [origin]);
  return origin;
}

function Developers(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const origin = usePageOrigin();
  const points = [
    { key: 'api', title: t('developers.points.api.title'), body: t('developers.points.api.body') },
    { key: 'commands', title: t('developers.points.commands.title'), body: t('developers.points.commands.body') },
    { key: 'rights', title: t('developers.points.rights.title'), body: t('developers.points.rights.body') },
  ];
  return (
    <Chapter index={9} name={t('chapters.developers')} headingId="landing-developers" title={t('developers.title')} lead={t('developers.body')}>
      <div className="lp-dev-stage">
        <figure className="lp-code" data-arrive="">
          <figcaption>
            <span className="lp-code-method">{EXAMPLE_ROUTE.method}</span>
            {EXAMPLE_ROUTE.path}
          </figcaption>
          <pre><ExampleCode code={exampleRequest(origin)} /></pre>
        </figure>
        <div className="lp-frame lp-dev-card" data-arrive="" style={{ '--i': 1 } as CssVars}><Img image={LANDING_IMAGES.botCard} alt={t('developers.alt')} /></div>
      </div>
      <Points className="lp-three lp-under" points={points} />
      <div className="lp-actions"><a className="lp-btn lp-btn-quiet" href="/developers">{t('developers.link')}<Glyph name="arrow" /></a></div>
    </Chapter>
  );
}

function Privacy({ twoFactor }: { twoFactor: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section aria-labelledby="landing-privacy" className="lp-sec lp-band lp-privacy">
      <div className="lp-wrap">
        <p className="lp-index lp-index-row" data-arrive="">
          <span className="lp-mono">10</span>
          <span className="lp-label">{t('chapters.privacy')}</span>
        </p>
        <h2 id="landing-privacy" className="lp-display lp-ink" data-arrive=""><Lines text={t('privacy.title')} /></h2>
        <p className="lp-lead" data-arrive="">{t('privacy.body')}</p>
        <Points className="lp-four" points={[
          ...(twoFactor ? [{ key: 'twoFactor', title: t('privacy.points.twoFactor.title'), body: t('privacy.points.twoFactor.body') }] : []),
          { key: 'devices', title: t('privacy.points.devices.title'), body: t('privacy.points.devices.body') },
          { key: 'data', title: t('privacy.points.data.title'), body: t('privacy.points.data.body') },
          { key: 'contact', title: t('privacy.points.contact.title'), body: t('privacy.points.contact.body') },
        ]} />
      </div>
    </section>
  );
}

/**
 * A code that opens this server on a phone: there is no store to send anyone to. The library
 * comes when the code is nearly in sight, so a visitor who never gets here does not pay for it.
 */
function PhoneCode(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const box = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState<{ path: string; size: number } | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    let live = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void import('qrcode-generator').then(({ default: qrcode }) => {
        if (!live) return;
        const qr = qrcode(0, 'M');
        qr.addData(window.location.origin);
        qr.make();
        const size = qr.getModuleCount();
        let path = '';
        for (let row = 0; row < size; row += 1) {
          for (let column = 0; column < size; column += 1) {
            if (qr.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
          }
        }
        setCode({ path, size });
      });
    }, { rootMargin: '600px' });
    observer.observe(element);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={box} className="lp-qr lp-desk-only">
      <div className="lp-qr-code">
        {code && <svg viewBox={`0 0 ${code.size} ${code.size}`} shapeRendering="crispEdges" aria-hidden="true"><path d={code.path} /></svg>}
      </div>
      <p>{t('anywhere.qr')}</p>
    </div>
  );
}

function Anywhere(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <Chapter index={11} name={t('chapters.anywhere')} headingId="landing-anywhere" title={t('anywhere.title')}>
      <div className="lp-anywhere-copy" data-arrive="">
        <div>
          <p className="lp-body">{t('anywhere.desktop.body')}</p>
          <a className="lp-link" href="/download">{t('anywhere.desktop.link')}<Glyph name="download" /></a>
        </div>
        <div>
          <p className="lp-body">{t('anywhere.phone.body')}</p>
          <PhoneCode />
        </div>
      </div>
      <div className="lp-anywhere-stage" data-arrive="" style={{ '--i': 1 } as CssVars}>
        <div className="lp-frame lp-window lp-anywhere-window"><Img image={LANDING_IMAGES.window} /></div>
        <div className="lp-device lp-anywhere-phone lp-desk-only"><Img image={LANDING_IMAGES.phone} alt={t('anywhere.phone.alt')} /></div>
      </div>
    </Chapter>
  );
}

function FeatureTable({ twoFactor }: { twoFactor: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const rows = [
    {
      key: 'messages',
      name: t('features.groups.messages'),
      items: [t('features.items.replies'), t('features.items.emoji'), t('features.items.files'), t('features.items.links'), t('features.items.search'), t('features.items.unread'), t('features.items.voiceMessages'), t('features.items.pins'), t('features.items.forward'), t('features.items.saved'), t('features.items.keywords')],
    },
    {
      key: 'voice',
      name: t('features.groups.voice'),
      items: [t('features.items.voiceChannels'), t('features.items.video'), t('features.items.screen'), t('features.items.calls'), t('features.items.noise'), t('features.items.ptt'), t('features.items.soundboard')],
    },
    {
      key: 'spaces',
      name: t('features.groups.spaces'),
      items: [t('features.items.categories'), t('features.items.roles'), t('features.items.overrides'), t('features.items.invites'), t('features.items.listing'), t('features.items.spaceProfiles')],
    },
    {
      key: 'community',
      name: t('features.groups.community'),
      items: [t('features.items.threads'), t('features.items.events'), t('features.items.polls'), t('features.items.welcome'), t('features.items.template')],
    },
    {
      key: 'moderation',
      name: t('features.groups.moderation'),
      items: [t('features.items.bans'), t('features.items.automod'), t('features.items.slow'), t('features.items.audit'), t('features.items.voiceMod'), t('features.items.reports')],
    },
    {
      key: 'yours',
      name: t('features.groups.yours'),
      items: [t('features.items.themes'), t('features.items.styles'), t('features.items.density'), t('features.items.contrast'), t('features.items.languages')],
    },
    {
      key: 'account',
      name: t('features.groups.account'),
      items: [...(twoFactor ? [t('features.items.twoFactor')] : []), t('features.items.devices'), t('features.items.export'), t('features.items.deleteAccount'), t('features.items.contactRules'), t('features.items.blocking')],
    },
    {
      key: 'developers',
      name: t('features.groups.developers'),
      items: [t('features.items.botApi'), t('features.items.commands'), t('features.items.cards'), t('features.items.webhooks'), t('features.items.portal'), t('features.items.docs')],
    },
    {
      key: 'everywhere',
      name: t('features.groups.everywhere'),
      items: [t('features.items.browser'), t('features.items.windows'), t('features.items.games'), t('features.items.phone'), t('features.items.push')],
    },
  ];
  return (
    <Chapter index={12} name={t('chapters.features')} headingId="landing-all" title={t('features.title')} className="lp-band">
      <dl className="lp-grid lp-three lp-menu">
        {rows.map((row, index) => (
          <div key={row.key} className="lp-group" data-arrive="" style={{ '--i': index % 3 } as CssVars}>
            <dt>{row.name}</dt>
            <dd><ul>{row.items.map((item) => <li key={item}>{item}</li>)}</ul></dd>
          </div>
        ))}
      </dl>
    </Chapter>
  );
}

/** Plain `details`: they open without a script and with the keyboard. */
function Questions(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const questions = (['join', 'phone', 'computers', 'moving', 'bots', 'trouble'] as const).map((key) => ({
    key,
    q: t(`questions.items.${key}.q`),
    a: t(`questions.items.${key}.a`),
  }));
  return (
    <Chapter index={13} name={t('chapters.questions')} headingId="landing-questions" title={t('questions.title')}>
      <div className="lp-faq" data-arrive="">
        {questions.map((question, index) => (
          <details key={question.key} open={index === 0}>
            <summary>
              {question.q}
              <Glyph name="plus" />
            </summary>
            <p>{question.a}</p>
          </details>
        ))}
      </div>
      <div className="lp-actions lp-questions-more"><a className="lp-btn lp-btn-quiet" href="/help">{t('questions.more')}<Glyph name="arrow" /></a></div>
    </Chapter>
  );
}

function FinalCall({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section aria-labelledby="landing-cta" className="lp-final">
      <div className="lp-light" aria-hidden="true" />
      <LogoLines />
      <div className="lp-wrap">
        <h2 id="landing-cta" className="lp-display lp-ink" data-arrive="">{t('cta.title')}</h2>
        <p className="lp-lead" data-arrive="">{registrationOpen ? t('cta.body') : t('cta.closed')}</p>
        <div className="lp-actions" data-arrive="">
          {registrationOpen && <MainButton href="/register">{t('cta.register')}</MainButton>}
          {registrationOpen
            ? <a className="lp-btn lp-btn-quiet lp-btn-lg" href="/login">{t('cta.login')}</a>
            : <MainButton href="/login">{t('cta.login')}</MainButton>}
        </div>
      </div>
    </section>
  );
}

/** Whether the chat runs, from the same answer as `/status`; null while nobody knows. */
function useChatState(): ServiceState | null {
  const [state, setState] = useState<ServiceState | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/status')
      .then((response) => (response.ok ? (response.json() as Promise<Partial<PublicStatus>>) : null))
      .then((body) => { if (live) setState(body?.services?.chat ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return state;
}

function Footer({ sourceUrl, version, chat }: { sourceUrl: string | null; version: string | null; chat: ServiceState | null }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer-grid">
          <div>
            <a className="lp-brand" href="/">
              <img src="/icons/logo-mark.svg" alt="" width={20} height={20} loading="lazy" />
              <span>{PRODUCT_NAME}</span>
            </a>
            <div className="lp-footer-language">
              <label htmlFor="landing-language" className="field-label">{t('footer.language')}</label>
              {/* 16px on a phone: Safari zooms into a smaller field on focus, and the app's rule for that does not run on this page. */}
              <LanguagePicker id="landing-language" className="input-search w-full max-md:text-base" />
            </div>
          </div>
          <nav aria-label={t('footer.product')}>
            <p className="lp-footer-title">{t('footer.product')}</p>
            <ul>
              <li><a href="#features">{t('nav.features')}</a></li>
              <li><a href="/download">{t('nav.download')}</a></li>
              <li><a href="/developers">{t('footer.developers')}</a></li>
              <li><a href="/help">{t('footer.help')}</a></li>
              <li><a href="/roadmap">{t('footer.roadmap')}</a></li>
              <li><a href="/changelog">{t('footer.changelog')}</a></li>
              <li><a href="/status">{t('footer.status')}</a></li>
            </ul>
          </nav>
          <nav aria-label={t('footer.legal')}>
            <p className="lp-footer-title">{t('footer.legal')}</p>
            <ul>
              <li><a href="/imprint">{t('footer.imprint')}</a></li>
              <li><a href="/privacy">{t('footer.privacy')}</a></li>
              <li><a href="/terms">{t('footer.terms')}</a></li>
              <li><a href="/report">{t('footer.report')}</a></li>
              {sourceUrl && <li><a href={sourceUrl}>{t('footer.source')}</a></li>}
            </ul>
          </nav>
        </div>
        <div className="lp-life">
          {(chat === 'ok' || chat === 'down') && (
            <a href="/status" data-state={chat}>
              <i aria-hidden="true" />
              {chat === 'ok' ? t('life.ok') : t('life.down')}
            </a>
          )}
          {version && <a className="lp-mono" href="/changelog">{t('life.version', { version })}</a>}
          <p className="lp-closer">{t('closer')}</p>
        </div>
      </div>
    </footer>
  );
}

/**
 * How far the visitor has read, kept as the app keeps a channel's: the chapter open now (the last
 * whose top has passed a line a third of the way down the window), every chapter that has been open,
 * so one skipped by a jump stays unread, and whether the opening is behind and the footer not yet in
 * sight, which is when the pill may float.
 */
function useReading(): { open: string | null; read: ReadonlySet<string>; between: boolean } {
  const [open, setOpen] = useState<string | null>(null);
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set());
  const [between, setBetween] = useState(false);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const height = window.innerHeight;
      let now: string | null = null;
      for (const id of RAIL_IDS) {
        const top = document.getElementById(id)?.closest('section')?.getBoundingClientRect().top;
        if (top !== undefined && top <= height / 3) now = id;
      }
      setOpen(now);
      if (now !== null) {
        const id = now;
        setRead((before) => (before.has(id) ? before : new Set(before).add(id)));
      }
      const opening = document.querySelector('.lp-hero')?.getBoundingClientRect();
      const footer = document.querySelector('.lp-footer')?.getBoundingClientRect();
      setBetween(Boolean(opening && footer && opening.bottom < 0 && footer.top > height));
    };
    const schedule = () => { if (frame === 0) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return { open, read, between };
}

/** One way the switcher offers: a chapter's heading on this page, or another page. */
interface JumpItem {
  id: string;
  label: string;
  glyph: GlyphName;
  heading?: string;
  href?: string;
  /** A chapter's number, as its margin writes it. */
  number?: string;
  unread?: boolean;
}

/**
 * The page's own switcher, as the app's (components/ui/QuickSwitcher.tsx): Ctrl K or the rail's
 * search opens it, typing narrows the chapters and pages, the arrows choose, Enter goes and Escape
 * closes. A chapter is scrolled to and its heading takes the focus; a page is opened.
 */
function Jump({ items, onClose }: { items: readonly JumpItem[]; onClose: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation('landing');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Whether the focus goes back where it was: not when a chapter's heading has taken it.
  const restore = useRef(true);
  const listId = useId();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(language);
  const wanted = fold(query.trim());
  const results = wanted ? items.filter((item) => fold(item.label).includes(wanted)) : items;
  const active = Math.min(selected, Math.max(results.length - 1, 0));

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.current?.focus();
    return () => { if (restore.current) before?.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, results.length]);

  const choose = (item: JumpItem) => {
    if (item.href) {
      onClose();
      window.location.assign(item.href);
      return;
    }
    const heading = item.heading ? document.getElementById(item.heading) : null;
    restore.current = heading === null;
    onClose();
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    // The page's own scroll behaviour decides: smooth, or at once for a reader who asks for less motion.
    heading.scrollIntoView({ block: 'start' });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected(results.length === 0 ? 0 : (active + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(results.length === 0 ? 0 : (active - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const item = results[active];
      if (item) choose(item);
    } else if (event.key === 'Tab') {
      // The field is all there is to focus in the dialog: the choices are chosen from it.
      event.preventDefault();
    }
  };

  return (
    <div className="modal-scrim lp-jump" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('jump.open')} className="glass-modal lp-jump-panel">
        <div className="lp-jump-field">
          <Glyph name="search" />
          <input
            ref={field}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
            onKeyDown={onKeyDown}
            placeholder={t('jump.placeholder')}
            autoComplete="off"
            spellCheck={false}
            className="input-embedded"
          />
        </div>
        {results.length > 0 ? (
          <ul ref={list} id={listId} role="listbox" aria-label={t('jump.open')} className="lp-jump-list">
            {results.map((item, index) => (
              <li
                key={item.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                data-unread={item.unread ? 'true' : undefined}
                onMouseMove={() => setSelected(index)}
                onClick={() => choose(item)}
              >
                <Glyph name={item.glyph} />
                <span className="lp-jump-label">{item.label}</span>
                {item.unread && <i className="lp-dot" aria-hidden="true" />}
                {item.href ? <span className="label-mono">{t('jump.page')}</span> : item.number && <span className="label-mono" aria-hidden="true">{item.number}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p id={listId} role="status" className="lp-jump-none">{t('jump.none', { query: query.trim() })}</p>
        )}
        <p className="lp-jump-hints" aria-hidden="true">
          <span>{JUMP_HINTS.move.map((key) => <kbd key={key} className="kbd">{key}</kbd>)}{t('jump.move')}</span>
          <span>{JUMP_HINTS.go.map((key) => <kbd key={key} className="kbd">{key}</kbd>)}{t('jump.go')}</span>
          <span>{JUMP_HINTS.close.map((key) => <kbd key={key} className="kbd">{key}</kbd>)}{t('jump.close')}</span>
        </p>
      </div>
    </div>
  );
}

interface RailProps {
  open: string | null;
  read: ReadonlySet<string>;
  unread: number;
  chat: ServiceState | null;
  version: string | null;
  onJump: () => void;
}

/**
 * The page's chapters as a space's channels, beside the page on a wide window: the open one is
 * selected as the open channel is, one not yet read is bright with its dot, and the category counts
 * what is left. It is the contents of the page (the statement's list stands in for it on a narrower
 * window), the switcher's way in, and at its foot what the server says of itself.
 */
function Rail({ open, read, unread, chat, version, onJump }: RailProps): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <nav className="lp-rail" aria-label={t('contents.label')}>
      <div className="lp-rail-in">
        <button type="button" className="lp-rail-jump" aria-haspopup="dialog" onClick={onJump}>
          <Glyph name="search" />
          <span className="lp-rail-grow">{t('jump.open')}</span>
          <span className="lp-rail-keys lp-not-apple" aria-hidden="true">{SWITCHER_KEYS.map((key) => <kbd key={key} className="kbd">{key}</kbd>)}</span>
          <span className="lp-rail-keys lp-for-apple" aria-hidden="true">{APPLE_JUMP_KEYS.map((key) => <kbd key={key} className="kbd">{key}</kbd>)}</span>
        </button>
        <a
          className="nav-item"
          href="#landing-title"
          data-active={open === 'landing-title' ? 'true' : undefined}
          aria-current={open === 'landing-title' ? 'location' : undefined}
        >
          <Glyph name="home" />
          <span className="lp-rail-grow">{t('rail.welcome')}</span>
        </a>
        <p className="lp-rail-category">
          <Glyph name="chevron" />
          <span className="lp-rail-grow">{t('contents.label')}</span>
          {unread > 0 && (
            <span className="count-badge-muted">
              <span aria-hidden="true">{unread}</span>
              <span className="sr-only">{t('rail.unread', { count: unread })}</span>
            </span>
          )}
        </p>
        <ol className="lp-rail-list">
          {CONTENTS.map(([key, id, glyph]) => (
            <li key={id}>
              <a
                className="nav-item"
                href={`#${id}`}
                data-active={open === id ? 'true' : undefined}
                data-unread={read.has(id) ? undefined : 'true'}
                aria-current={open === id ? 'location' : undefined}
              >
                <Glyph name={glyph} />
                <span className="lp-rail-grow">{t(`chapters.${key}`)}</span>
                {!read.has(id) && <i className="lp-dot" aria-hidden="true" />}
              </a>
            </li>
          ))}
        </ol>
        {/* What the footer links, said here in words: the rail stays in sight while the footer does not. */}
        {(chat === 'ok' || chat === 'down' || version) && (
          <div className="lp-rail-foot">
            {(chat === 'ok' || chat === 'down') && (
              <p className="lp-rail-life" data-state={chat}><i aria-hidden="true" />{chat === 'ok' ? t('life.ok') : t('life.down')}</p>
            )}
            {version && <p className="lp-mono lp-rail-version">{t('life.version', { version })}</p>}
          </div>
        )}
      </div>
    </nav>
  );
}

/**
 * On a narrower window the rail gives way to a pill at the foot of the screen, as the app's floating
 * controls stand: it names the chapter open now and opens the switcher. It comes once the opening is
 * behind and goes before the footer, so it never stands on the page's last links.
 */
function JumpPill({ open, unread, onJump }: { open: string | null; unread: number; onJump: () => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const index = CONTENTS.findIndex(([, id]) => id === open);
  const chapter = CONTENTS[index];
  return (
    <button type="button" className="glass-bubble lp-pill" aria-haspopup="dialog" onClick={onJump}>
      <span className="sr-only">{t('jump.open')}</span>
      {chapter && <span className="lp-mono lp-pill-n" aria-hidden="true">{pad(index + 1)}</span>}
      <span className="lp-rail-grow">{chapter ? t(`chapters.${chapter[0]}`) : t('rail.welcome')}</span>
      {unread > 0 && <span className="count-badge-muted" aria-hidden="true">{unread}</span>}
      <Glyph name="up" />
    </button>
  );
}

/**
 * The page read as a space: the rail, the pill and the switcher, which share what has been read and
 * whether the switcher is open. Ctrl K (Command K on an Apple device) opens it anywhere on the page,
 * as in the app, and closes it again.
 */
function Wayfinding({ registrationOpen, chat, version }: { registrationOpen: boolean; chat: ServiceState | null; version: string | null }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const { open, read, between } = useReading();
  const [jumping, setJumping] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setJumping((now) => !now);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const unread = CONTENTS.filter(([, id]) => !read.has(id)).length;
  const items: JumpItem[] = [
    { id: 'landing-title', label: t('rail.welcome'), glyph: 'home', heading: 'landing-title' },
    ...CONTENTS.map(([key, id, glyph], index): JumpItem => ({ id, label: t(`chapters.${key}`), glyph, heading: id, number: pad(index + 1), unread: !read.has(id) })),
    ...(registrationOpen ? [{ id: '/register', label: t('nav.register'), glyph: 'page' as const, href: '/register' }] : []),
    { id: '/login', label: t('nav.login'), glyph: 'page', href: '/login' },
    { id: '/download', label: t('nav.download'), glyph: 'page', href: '/download' },
    { id: '/developers', label: t('nav.developers'), glyph: 'page', href: '/developers' },
    { id: '/help', label: t('nav.help'), glyph: 'page', href: '/help' },
    { id: '/changelog', label: t('footer.changelog'), glyph: 'page', href: '/changelog' },
    { id: '/roadmap', label: t('footer.roadmap'), glyph: 'page', href: '/roadmap' },
    { id: '/status', label: t('footer.status'), glyph: 'page', href: '/status' },
  ];

  return (
    <>
      <Rail open={open} read={read} unread={unread} chat={chat} version={version} onJump={() => setJumping(true)} />
      {between && !jumping && <JumpPill open={open} unread={unread} onJump={() => setJumping(true)} />}
      {jumping && <Jump items={items} onClose={() => setJumping(false)} />}
    </>
  );
}

/**
 * The product page. `prerendered`: this render takes over HTML the website's build wrote
 * (site/pages/index.astro), so it must start from what that HTML says.
 */
export function LandingPage({ prerendered = false }: { prerendered?: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation('landing');
  const [info, setInfo] = useState<InstanceInfoResponse | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Asked once, for the footer and the rail.
  const chat = useChatState();
  useFitHeadings(root, i18n.resolvedLanguage ?? i18n.language);
  useArrivals(root, prerendered);

  useEffect(() => {
    document.title = t('meta.title');
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  }, [t]);

  // Only to know whether this server takes new accounts and where its source is.
  // Until the answer arrives (or if it never does) the page assumes it is open.
  useEffect(() => {
    let live = true;
    fetch('/api/instance/info')
      .then((response) => (response.ok ? (response.json() as Promise<InstanceInfoResponse>) : null))
      .then((body) => { if (live) setInfo(body); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const registrationOpen = info?.registrationOpen ?? true;
  const sourceUrl = info?.sourceCodeUrl ?? null;
  // Absent on an older server, where the page says what it always said.
  const twoFactor = info?.twoFactor !== false;

  return (
    <div id="lp" ref={root}>
      <Nav registrationOpen={registrationOpen} />
      <div className="lp-shell">
        <Wayfinding registrationOpen={registrationOpen} chat={chat} version={info?.version ?? null} />
        <main>
        <Hero registrationOpen={registrationOpen} />
        <Statement />
        <Demo registrationOpen={registrationOpen} />
        <Spaces />
        <Messages />
        <Around />
        <Voice />
        <People />
        <Looks />
        <Community />
        <Developers />
        <Privacy twoFactor={twoFactor} />
        <Anywhere />
        <FeatureTable twoFactor={twoFactor} />
        <Questions />
        <FinalCall registrationOpen={registrationOpen} />
        </main>
      </div>
      <Footer sourceUrl={sourceUrl} version={info?.version ?? null} chat={chat} />
    </div>
  );
}
