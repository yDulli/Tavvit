import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InstanceInfoResponse } from '@backspace/shared';
import type { PublicStatus, ServiceState } from '@backspace/shared/src/publicStatus.js';
import { PRODUCT_NAME } from '@backspace/shared/src/constants.js';
import { SITE_ORIGIN_TOKEN } from '@backspace/shared/src/site.js';
import { availableLanguages, isSupportedLanguage } from '../i18n/languages';
import { EXAMPLE_ROUTE, exampleRequest } from './example';
import { LANDING_FIGURES } from './figures';
import { chooseLandingLanguage } from './i18n';
import { ChromeWord, LightField, PointerAura } from './light';
import { Glyph, Lines, bringIntoView, nextChoice, pad, type CssVars, type FeatureItem, type GlyphName } from './parts';
import {
  AddressCard,
  BotMessage,
  HeroScene,
  MotionContext,
  MovingVisual,
  OrderVisual,
  PlanVisual,
  ProfileShowcase,
  TagMaker,
  TalkVisual,
  VoiceVisual,
} from './visuals';

/**
 * The public product page, shown at `/` to a visitor who is not signed in (landing/entry.ts), and
 * rendered ahead of time by the website's build (site/pages/index.astro). A plain document with its
 * own stylesheet (landing.css): its links are ordinary links, because every one of them leads out of
 * this small bundle and into the app (or to a file).
 *
 * "Schwarzlicht" (docs/systems/landing.md, "Design"), the look of Showomat: pure black and white ink,
 * the name in polished chrome over a field of flowing light threads, headlines that rise out of a
 * clip, mono labels behind a turning spark, pills whose fill rises, frames with a faint light from
 * their corner, a ring of light that trails the pointer. No picture of the app: the page draws the
 * things a group has in Tavvit (a space, its tag, a voice room, a profile) as objects.
 * What it says stays true: a feature named here exists in the app, and nothing promises federation,
 * native phone apps or end-to-end encryption.
 */

/** Each language's list of what changed, fetched when needed: the page's script does not carry them. */
const CHANGELOGS = import.meta.glob<{ versions: Record<string, { title: string }> }>('../locales/*/changelog.json', { import: 'default' });

/** Where the visitor's choice to stop the page's motion is kept, in this browser only. */
const MOTION_KEY = 'tavvit.landing.motion';

/** The band of what is inside, from the index of features (`features.items`), which every language has. */
const MARQUEE: readonly FeatureItem[] = [
  'threads', 'voiceChannels', 'screen', 'polls', 'events', 'soundboard', 'roles', 'overrides', 'voiceMessages',
  'emoji', 'audit', 'webhooks', 'commands', 'saved', 'noise', 'welcome', 'push', 'windows',
];

/** The parts of the app, one tab each, with the lines of the index that belong to it. */
const TABS = [
  { key: 'talk', points: ['replies', 'threads', 'polls', 'voiceMessages', 'files', 'search'] },
  { key: 'voice', points: ['voiceChannels', 'screen', 'noise', 'soundboard', 'calls', 'ptt'] },
  { key: 'plan', points: ['events', 'welcome', 'saved', 'keywords'] },
  { key: 'order', points: ['roles', 'overrides', 'automod', 'bans', 'audit', 'reports'] },
] as const satisfies readonly { key: string; points: readonly FeatureItem[] }[];

type TabKey = (typeof TABS)[number]['key'];

const TAB_VISUALS: Record<TabKey, () => React.JSX.Element> = {
  talk: TalkVisual,
  voice: VoiceVisual,
  plan: PlanVisual,
  order: OrderVisual,
};

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
 * word ("Присаживайтесь.") would run past the edge, and a long line of a two-line heading would break a
 * second time into single words: when a line, measured unbroken, is wider than the heading's own column,
 * the size comes down until it fits.
 */
function useFitHeadings(root: React.RefObject<HTMLDivElement>, language: string): void {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const fit = () => {
      for (const heading of element.querySelectorAll<HTMLElement>('.lp-display, .lp-h2, .lp-hero-title')) {
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
 * Lets each part of a section arrive once, as it is about to come into view: the stylesheet holds a
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
    // A part starts on its way a quarter of a screen before it comes into view, so it stands
    // where it belongs by the time it is looked at: waiting until it was already on screen left a
    // phone, where a flick scrolls a screen at a time, showing empty room where a card was still
    // to appear. One scrolled past before anything could be told (a long flick) just stands there.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const passed = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
        if (!entry.isIntersecting && !passed) continue;
        entry.target.setAttribute('data-in', passed ? 'shown' : 'true');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px 25% 0px', threshold: 0 });
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
 * The light a glass card catches from the pointer: `.lp-spotlight` draws it where `--mx`/`--my` say.
 * A mouse only; a touch scrolls.
 */
function useSpotlight(root: React.RefObject<HTMLDivElement>): void {
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) return;
      const card = event.target.closest<HTMLElement>('.lp-spotlight');
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    };
    element.addEventListener('pointermove', move, { passive: true });
    return () => element.removeEventListener('pointermove', move);
  }, [root]);
}

/**
 * Whether the page moves. It does, unless the system asks for less motion or the visitor paused it
 * with the footer's switch, a choice this browser keeps. Nothing that matters ever depends on it.
 */
function useMotion(): { paused: boolean; moving: boolean; toggle: () => void } {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(MOTION_KEY) === 'off') setPaused(true);
    } catch {
      // Storage refused: the page moves, as it would for anyone.
    }
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(query.matches);
    read();
    // An older browser's query has no `addEventListener`; the setting is then read once.
    query.addEventListener?.('change', read);
    return () => query.removeEventListener?.('change', read);
  }, []);
  const toggle = () => setPaused((now) => {
    const next = !now;
    try {
      window.localStorage.setItem(MOTION_KEY, next ? 'off' : 'on');
    } catch {
      // Kept for this visit only.
    }
    return next;
  });
  return { paused, moving: !paused && !reduced, toggle };
}

/**
 * Whether the page has moved under the nav, which then sits a little more solid, and how far it has
 * been read: a share written straight onto the nav (`--read`) once a frame, so scrolling renders nothing.
 */
function useScrolled(nav: React.RefObject<HTMLElement>): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setScrolled(window.scrollY > 8);
      const room = document.documentElement.scrollHeight - window.innerHeight;
      nav.current?.style.setProperty('--read', room > 0 ? (window.scrollY / room).toFixed(4) : '0');
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [nav]);
  return scrolled;
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

/** The light far behind the page: one wide glow above it, so the black is never a hole. It takes no clicks. */
function Ambient(): React.JSX.Element {
  return (
    <div className="lp-ambient" aria-hidden="true">
      <i className="lp-ambient-glow" />
    </div>
  );
}

/** The strip over everything: what Tavvit is, in a few facts of its own. */
function Strip({ version }: { version: string | null }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const facts = [
    t('home.strip.tags'),
    t('home.strip.permissions', { count: LANDING_FIGURES.permissions }),
    t('home.strip.languages', { count: availableLanguages.length }),
    t('home.strip.clean'),
  ];
  return (
    <div className="lp-strip">
      <div className="lp-wrap lp-strip-in">
        <p className="lp-strip-name">“{PRODUCT_NAME}” <span>{t('home.hero.label')}</span></p>
        <ul>{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
        {version && <a className="lp-strip-version" href="/changelog">{t('life.version', { version })}</a>}
      </div>
    </div>
  );
}

function Nav({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const nav = useRef<HTMLElement>(null);
  const scrolled = useScrolled(nav);
  return (
    <header ref={nav} className="lp-nav" data-scrolled={scrolled ? 'true' : 'false'}>
      <div className="lp-wrap lp-nav-bar">
        <span className="lp-nav-read" aria-hidden="true" />
        <a className="lp-brand" href="/">
          <img src="/icons/logo-mark.svg" alt="" width={20} height={20} />
          <span>{PRODUCT_NAME}</span>
        </a>
        <nav className="lp-nav-links" aria-label={t('nav.label')}>
          <a href="#features">{t('nav.features')}</a>
          <a href="/download">{t('nav.download')}</a>
          <a href="/developers">{t('nav.developers')}</a>
          <a href="/help">{t('nav.help')}</a>
        </nav>
        <div className="lp-nav-right">
          <LanguagePicker id="landing-language-top" className="lp-nav-language" label={t('footer.language')} />
          <a className="lp-nav-login" href="/login">{t('nav.login')}</a>
          {registrationOpen && <a className="lp-btn lp-btn-primary" href="/register">{t('nav.register')}</a>}
        </div>
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

function Hero({ registrationOpen, chat }: { registrationOpen: boolean; chat: ServiceState | null }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const known = chat === 'ok' || chat === 'down';
  return (
    <section className="lp-hero" aria-labelledby="landing-title">
      <LightField />
      <div className="lp-wrap lp-hero-in">
        <p className="lp-hero-meta lp-rise" style={{ '--i': 0 } as CssVars}>
          <a className="lp-status" href="/status" data-state={known ? chat : undefined} style={known ? undefined : { visibility: 'hidden' }}>
            <i aria-hidden="true" />
            {chat === 'down' ? t('life.down') : t('life.ok')}
          </a>
          <News />
        </p>
        {/* The name fills the first screen, in chrome; the heading under it says what it is. */}
        <div className="lp-hero-word"><ChromeWord word={PRODUCT_NAME} /></div>
        <div className="lp-hero-row">
          <h1 id="landing-title" className="lp-hero-title">
            <Lines text={t('home.hero.title')} />
            {'\n'}
            <span className="lp-line lp-hero-accent">{t('home.hero.accent')}</span>
          </h1>
          <div className="lp-hero-side lp-rise" style={{ '--i': 4 } as CssVars}>
            <p className="lp-hero-lead">{t('home.hero.lead')}</p>
            <div className="lp-actions lp-hero-actions">
              <a className="lp-btn lp-btn-primary lp-btn-lg" href={registrationOpen ? '/register' : '/login'}>
                {registrationOpen ? t('nav.register') : t('nav.login')}
                <Glyph name="arrow" />
              </a>
              {/* The one desktop app there is, on Windows; everyone else is shown what is inside.
                  Both are in the page's HTML and the stylesheet shows one (`data-lp-os`, set before the first paint). */}
              <a className="lp-arrow-link lp-for-windows" href="/download"><Glyph name="download" />{t('anywhere.desktop.link')}</a>
              <a className="lp-arrow-link lp-not-windows" href="#features">{t('home.hero.more')}<Glyph name="down" /></a>
            </div>
          </div>
        </div>
      </div>
      <HeroScene />
    </section>
  );
}

/** What is inside, passing by. It stops under the pointer, without motion, and for the footer's switch. */
function Marquee(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const items = MARQUEE.map((key) => t(`features.items.${key}`));
  const row = (copy: boolean) => (
    <ul className="lp-marquee-row" aria-hidden={copy || undefined}>
      {items.map((item) => <li key={item}>{item}<span aria-hidden="true">✦</span></li>)}
    </ul>
  );
  return (
    <section className="lp-marquee" aria-label={t('home.marquee')}>
      <div className="lp-marquee-track">
        {row(false)}
        {row(true)}
      </div>
    </section>
  );
}

/** A section's head: its number and name in Mono, the heading with its light, the lead. */
function Head({ index, kicker, id, title, body, center = false }: { index: number; kicker: string; id: string; title: string; body?: string; center?: boolean }): React.JSX.Element {
  return (
    <header className={`lp-head${center ? ' lp-head-center' : ''}`} data-arrive="">
      <p className="lp-kicker"><span>{pad(index)}</span>{kicker}</p>
      <h2 id={id} className="lp-h2"><Lines text={title} /></h2>
      {body && <p className="lp-lead">{body}</p>}
    </header>
  );
}

function Tags(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const items = (['tag', 'address', 'look'] as const).map((key) => ({
    key,
    title: t(`home.tags.items.${key}.title`),
    body: t(`home.tags.items.${key}.body`),
  }));
  return (
    <section className="lp-section" aria-labelledby="landing-tags">
      <div className="lp-wrap lp-split">
        <div className="lp-split-copy">
          <Head index={1} kicker={t('home.tags.kicker')} id="landing-tags" title={t('home.tags.title')} body={t('home.tags.body')} />
          <ol className="lp-numbered">
            {items.map((item, index) => (
              <li key={item.key} data-arrive="" style={{ '--i': index } as CssVars}>
                <span className="lp-numbered-n">{index + 1}</span>
                <b>{item.title}</b>
                <span>{item.body}</span>
              </li>
            ))}
          </ol>
        </div>
        <TagMaker />
      </div>
    </section>
  );
}

/** The parts of the app as tabs: arrow keys move between them, as a tab list's do. */
function Inside(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <section id="features" className="lp-section" aria-labelledby="landing-inside">
      <div className="lp-wrap">
        <Head index={2} kicker={t('home.inside.kicker')} id="landing-inside" title={t('home.inside.title')} center />
        <div className="lp-tabs lp-glass" role="tablist" aria-label={t('home.inside.label')} data-arrive="">
          {TABS.map((tab, index) => (
            <button
              key={tab.key}
              ref={(element) => { tabs.current[index] = element; }}
              type="button"
              role="tab"
              id={`lp-tab-${tab.key}`}
              aria-selected={index === active}
              aria-controls={`lp-panel-${tab.key}`}
              tabIndex={index === active ? 0 : -1}
              className="lp-tab"
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                const next = nextChoice(event.key, active, TABS.length);
                if (next === null) return;
                event.preventDefault();
                setActive(next);
                bringIntoView(tabs.current[next] ?? undefined);
              }}
            >
              <span className="lp-tab-n">{pad(index + 1)}</span>
              {t(`home.inside.tabs.${tab.key}.tab`)}
            </button>
          ))}
        </div>
        {TABS.map((tab, index) => {
          const Visual = TAB_VISUALS[tab.key];
          return (
            <div
              key={tab.key}
              role="tabpanel"
              id={`lp-panel-${tab.key}`}
              aria-labelledby={`lp-tab-${tab.key}`}
              hidden={index !== active}
              className="lp-panel lp-glass"
            >
              <div className="lp-panel-copy">
                <h3 className="lp-h3">{t(`home.inside.tabs.${tab.key}.title`)}</h3>
                <p className="lp-body">{t(`home.inside.tabs.${tab.key}.body`)}</p>
                <ul className="lp-points">
                  {tab.points.map((point) => <li key={point}><Glyph name="check" />{t(`features.items.${point}`)}</li>)}
                </ul>
              </div>
              <div className="lp-panel-visual"><Visual /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Moving({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section className="lp-section" aria-labelledby="landing-moving">
      <div className="lp-wrap lp-split lp-split-flip">
        <div className="lp-split-copy">
          <Head index={3} kicker={t('home.moving.kicker')} id="landing-moving" title={t('home.moving.title')} body={t('home.moving.body')} />
          <p className="lp-note" data-arrive="">{t('home.moving.note')}</p>
          <div className="lp-actions" data-arrive="">
            {registrationOpen && <a className="lp-btn lp-btn-primary" href="/register">{t('nav.register')}<Glyph name="arrow" /></a>}
            <a className="lp-arrow-link" href="/help">{t('home.moving.help')}<Glyph name="arrow" /></a>
          </div>
        </div>
        <MovingVisual />
      </div>
    </section>
  );
}

function Identity(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const chips = ['frames', 'effects', 'nameplates', 'names', 'badges', 'themes', 'perSpace', 'community'] as const;
  return (
    <section className="lp-section lp-identity" aria-labelledby="landing-identity">
      <div className="lp-identity-light" aria-hidden="true" />
      <div className="lp-wrap">
        <Head index={4} kicker={t('home.identity.kicker')} id="landing-identity" title={t('home.identity.title')} body={t('home.identity.body')} center />
        <ProfileShowcase />
        <ul className="lp-chips" data-arrive="">
          {chips.map((chip) => <li key={chip}>{t(`home.identity.chips.${chip}`)}</li>)}
        </ul>
      </div>
    </section>
  );
}

function Scenes(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const tags = ['a', 'b', 'c', 'd'] as const;
  const scenes = [
    { key: 'gaming', link: null },
    { key: 'creators', link: { href: '/creators', label: t('home.scenes.items.creators.link') } },
    { key: 'developers', link: { href: '/developers', label: t('home.scenes.items.developers.link') } },
    { key: 'clubs', link: null },
  ] as const;
  return (
    <section className="lp-section" aria-labelledby="landing-scenes">
      <div className="lp-wrap">
        <Head index={5} kicker={t('home.scenes.kicker')} id="landing-scenes" title={t('home.scenes.title')} />
        <div className="lp-scenes">
          {scenes.map((scene, index) => (
            <article key={scene.key} className="lp-scene-card lp-glass lp-spotlight" data-arrive="" data-tilt="" style={{ '--i': index } as CssVars}>
              <p className="lp-scene-n">{pad(index + 1)}</p>
              <h3 className="lp-h3">{t(`home.scenes.items.${scene.key}.title`)}</h3>
              <p className="lp-body">{t(`home.scenes.items.${scene.key}.body`)}</p>
              <ul className="lp-tags">
                {tags.map((tag) => <li key={tag}>{t(`home.scenes.items.${scene.key}.tags.${tag}`)}</li>)}
              </ul>
              {scene.link && <a className="lp-link" href={scene.link.href}>{scene.link.label}<Glyph name="arrow" /></a>}
            </article>
          ))}
        </div>
      </div>
    </section>
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

/** Copies text to the clipboard and says so for a moment; quietly does nothing where the browser refuses. */
function CopyButton({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="lp-copy"
      data-copied={copied ? 'true' : undefined}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
      }}
    >
      <Glyph name={copied ? 'check' : 'template'} />
      <span aria-live="polite">{copied ? t('home.code.copied') : t('home.code.copy')}</span>
    </button>
  );
}

/** The workshop: what a program can do in a space, with the one request a bot really sends. */
function Developers(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const origin = usePageOrigin();
  const lines = exampleRequest(origin).split('\n');
  const points: readonly { key: string; icon: GlyphName }[] = [
    { key: 'api', icon: 'globe' },
    { key: 'commands', icon: 'bot' },
    { key: 'rights', icon: 'shield' },
  ];
  return (
    <section className="lp-section" aria-labelledby="landing-developers">
      <div className="lp-wrap">
        <Head index={6} kicker={t('chapters.developers')} id="landing-developers" title={t('developers.title')} body={t('developers.body')} />
        <div className="lp-build">
          <figure className="lp-code lp-glass" data-arrive="">
            <figcaption>
              <span className="lp-code-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="lp-code-method">{EXAMPLE_ROUTE.method}</span>
              <span className="lp-code-path">{EXAMPLE_ROUTE.path}</span>
              <CopyButton text={lines.join('\n')} />
            </figcaption>
            <div className="lp-code-body">
              <ol className="lp-code-gutter" aria-hidden="true">{lines.map((_, index) => <li key={index}>{index + 1}</li>)}</ol>
              <pre><ExampleCode code={lines.join('\n')} /></pre>
            </div>
          </figure>
          <div data-arrive="" style={{ '--i': 1 } as CssVars}><BotMessage /></div>
        </div>
        <div className="lp-cells lp-cells-3">
          {points.map((point, index) => (
            <div key={point.key} className="lp-cell lp-glass lp-spotlight" data-arrive="" style={{ '--i': index } as CssVars}>
              <span className="lp-cell-icon"><Glyph name={point.icon} /></span>
              <h3 className="lp-cell-title">{t(`developers.points.${point.key as 'api' | 'commands' | 'rights'}.title`)}</h3>
              <p className="lp-cell-body">{t(`developers.points.${point.key as 'api' | 'commands' | 'rights'}.body`)}</p>
            </div>
          ))}
        </div>
        <div className="lp-actions" data-arrive=""><a className="lp-arrow-link" href="/developers">{t('developers.link')}<Glyph name="arrow" /></a></div>
      </div>
    </section>
  );
}

/** The house rules: what Tavvit will not do, said as large as the opening, then what protects an account. */
function Rules({ twoFactor }: { twoFactor: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const points: readonly { key: 'twoFactor' | 'devices' | 'data' | 'contact'; icon: GlyphName }[] = [
    ...(twoFactor ? [{ key: 'twoFactor' as const, icon: 'lock' as const }] : []),
    { key: 'devices', icon: 'screen' },
    { key: 'data', icon: 'download' },
    { key: 'contact', icon: 'people' },
  ];
  return (
    <section className="lp-section lp-rules" aria-labelledby="landing-rules">
      <div className="lp-rules-light" aria-hidden="true" />
      <div className="lp-wrap">
        <p className="lp-kicker lp-kicker-center" data-arrive=""><span>{pad(7)}</span>{t('chapters.privacy')}</p>
        <h2 id="landing-rules" className="lp-display" data-arrive=""><Lines text={t('privacy.title')} /></h2>
        <p className="lp-lead lp-rules-lead" data-arrive="">{t('privacy.body')}</p>
        <div className={`lp-cells ${points.length === 4 ? 'lp-cells-4' : 'lp-cells-3'}`}>
          {points.map((point, index) => (
            <div key={point.key} className="lp-cell lp-glass lp-spotlight" data-arrive="" style={{ '--i': index } as CssVars}>
              <span className="lp-cell-icon"><Glyph name={point.icon} /></span>
              <h3 className="lp-cell-title">{t(`privacy.points.${point.key}.title`)}</h3>
              <p className="lp-cell-body">{t(`privacy.points.${point.key}.body`)}</p>
            </div>
          ))}
        </div>
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
    <section className="lp-section" aria-labelledby="landing-anywhere">
      <div className="lp-wrap">
        <Head index={8} kicker={t('chapters.anywhere')} id="landing-anywhere" title={t('anywhere.title')} />
        <div className="lp-devices">
          <article className="lp-device lp-glass lp-spotlight" data-arrive="" data-tilt="">
            <span className="lp-device-icon"><Glyph name="windows" /></span>
            <p className="lp-body">{t('anywhere.desktop.body')}</p>
            <a className="lp-link" href="/download">{t('anywhere.desktop.link')}<Glyph name="download" /></a>
          </article>
          <article className="lp-device lp-glass lp-spotlight" data-arrive="" data-tilt="" style={{ '--i': 1 } as CssVars}>
            <span className="lp-device-icon"><Glyph name="phone" /></span>
            <p className="lp-body">{t('anywhere.phone.body')}</p>
            <PhoneCode />
          </article>
        </div>
      </div>
    </section>
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
    <section className="lp-section" aria-labelledby="landing-questions">
      <div className="lp-wrap lp-questions">
        <div>
          <Head index={9} kicker={t('chapters.questions')} id="landing-questions" title={t('questions.title')} />
          <div className="lp-actions" data-arrive=""><a className="lp-arrow-link" href="/help">{t('questions.more')}<Glyph name="arrow" /></a></div>
        </div>
        <div className="lp-faq" data-arrive="">
          {questions.map((question, index) => (
            <details key={question.key} className="lp-glass" open={index === 0}>
              <summary>
                {question.q}
                <Glyph name="plus" />
              </summary>
              <p>{question.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section className="lp-section lp-closing" aria-labelledby="landing-cta">
      <div className="lp-wrap">
        <div className="lp-closing-box" data-arrive="">
          <div className="lp-closing-grid" aria-hidden="true" />
          <div className="lp-closing-copy">
            <h2 id="landing-cta" className="lp-display"><Lines text={t('home.closing.title')} /></h2>
            <p className="lp-lead">{registrationOpen ? t('cta.body') : t('cta.closed')}</p>
            <div className="lp-actions">
              {registrationOpen && <a className="lp-btn lp-btn-primary lp-btn-lg" href="/register">{t('cta.register')}<Glyph name="arrow" /></a>}
              {registrationOpen
                ? <a className="lp-arrow-link" href="/login">{t('cta.login')}<Glyph name="arrow" /></a>
                : <a className="lp-btn lp-btn-primary lp-btn-lg" href="/login">{t('cta.login')}<Glyph name="arrow" /></a>}
            </div>
          </div>
          <div className="lp-closing-side" aria-hidden="true"><AddressCard label={t('home.closing.address')} /></div>
        </div>
      </div>
    </section>
  );
}

function Footer({ sourceUrl, version, chat, motion }: {
  sourceUrl: string | null;
  version: string | null;
  chat: ServiceState | null;
  motion: { paused: boolean; toggle: () => void };
}): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <a className="lp-brand" href="/">
              <img src="/icons/logo-mark.svg" alt="" width={20} height={20} loading="lazy" />
              <span>{PRODUCT_NAME}</span>
            </a>
            <p className="lp-closer">{t('closer')}</p>
            <div className="lp-footer-language">
              <label htmlFor="landing-language" className="lp-footer-title">{t('footer.language')}</label>
              {/* 16px on a phone: Safari zooms into a smaller field on focus, and the app's rule for that does not run on this page. */}
              <LanguagePicker id="landing-language" className="lp-select" />
            </div>
          </div>
          <nav aria-label={t('footer.product')}>
            <p className="lp-footer-title">{t('footer.product')}</p>
            <ul>
              <li><a href="#features">{t('nav.features')}</a></li>
              <li><a href="/download">{t('nav.download')}</a></li>
              <li><a href="/developers">{t('footer.developers')}</a></li>
              <li><a href="/creators">{t('footer.creators')}</a></li>
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
          <button type="button" className="lp-motion" aria-pressed={motion.paused} onClick={motion.toggle}>
            <Glyph name={motion.paused ? 'play' : 'pause'} />
            {motion.paused ? t('home.motion.play') : t('home.motion.pause')}
          </button>
        </div>
      </div>
    </footer>
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
  // Asked once, for the opening and the footer.
  const chat = useChatState();
  const motion = useMotion();
  useFitHeadings(root, i18n.resolvedLanguage ?? i18n.language);
  useArrivals(root, prerendered);
  useSpotlight(root);

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
  const version = info?.version ?? null;
  // Absent on an older server, where the page says what it always said.
  const twoFactor = info?.twoFactor !== false;

  return (
    <MotionContext.Provider value={motion.moving}>
      <div id="lp" ref={root} data-motion={motion.paused ? 'off' : 'on'}>
        <Ambient />
        <PointerAura />
        <Strip version={version} />
        <Nav registrationOpen={registrationOpen} />
        <main>
          <Hero registrationOpen={registrationOpen} chat={chat} />
          <Marquee />
          <Tags />
          <Inside />
          <Moving registrationOpen={registrationOpen} />
          <Identity />
          <Scenes />
          <Developers />
          <Rules twoFactor={twoFactor} />
          <Anywhere />
          <Questions />
          <Closing registrationOpen={registrationOpen} />
        </main>
        <Footer sourceUrl={sourceUrl} version={version} chat={chat} motion={motion} />
      </div>
    </MotionContext.Provider>
  );
}
