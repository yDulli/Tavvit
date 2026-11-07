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
import { LANDING_IMAGES } from './images';
import { Glyph, Img, Lines, LogoLines, MainButton, pad, type CssVars, type FeatureItem } from './parts';
import { Stage } from './Stage';

/**
 * The public product page, shown at `/` to a visitor who is not signed in (landing/entry.ts), and
 * rendered ahead of time by the website's build (site/pages/index.astro). A plain document with its
 * own stylesheet (landing.css): its links are ordinary links, because every one of them leads out of
 * this small bundle and into the app (or to a file).
 *
 * Its idea is the plan (docs/systems/landing.md, "The idea"): Tavvit gives a group a place of its own,
 * and the page is a set of drawn sheets for one, numbered as a drawing set is. The opening draws a space
 * as a floor plan whose rooms are its channels, lit from above in their own colours; further on, the
 * same plan shows each part of a place beside the real screens of the app. Everything is built from the
 * app's own material (docs/systems/design-system.md), and what it says stays true: a feature named here
 * exists in the app, and nothing promises federation, native phone apps or end-to-end encryption.
 */

/**
 * The keys on the window inside, each on an empty patch of the picture beside the thing it names, and
 * the part of the window each one names (`part`), all as shares of the window's width and height.
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
 * The house's figures: every number is the app's own. None of ads and trackers is the code as it is
 * (docs/systems/legal.md); the rest are the app's lists and limits (`figures.ts`).
 */
const FIGURES = [
  { key: 'ads', value: 0 },
  { key: 'trackers', value: 0 },
  { key: 'languages', value: availableLanguages.length },
  { key: 'themes', value: LANDING_FIGURES.themes },
  { key: 'group', value: LANDING_FIGURES.group },
  { key: 'characters', value: LANDING_FIGURES.characters },
] as const;

/** The sheets of the set, in their order: the number each one carries in its head. */
const SHEETS = {
  inside: 2,
  developers: 3,
  privacy: 4,
  anywhere: 5,
  community: 6,
  features: 7,
  questions: 8,
} as const;

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
 * Lets each part of a sheet arrive once, when it first comes into view: the stylesheet holds a
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
            {/* An outline: the one white button of the opening is its own. */}
            {registrationOpen && <a className="lp-btn lp-btn-quiet lp-btn-sm lp-nav-cta" href="/register">{t('nav.register')}</a>}
          </div>
        </nav>
      </div>
    </header>
  );
}

/**
 * A sheet's head, as a drawing set carries one: a hairline, the sheet's number and name in Mono, and
 * the heading with its lead. Its parts arrive once, as everything below does.
 */
function SheetHead({ sheet, name, headingId, title, lead, className = '' }: { sheet: number; name: string; headingId: string; title: string; lead?: string; className?: string }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <header className={`lp-sheet-head ${className}`} data-arrive="">
      <p className="lp-sheet-meta">
        <span className="lp-mono">{t('plan.block.sheet')} {pad(sheet)}</span>
        <span className="lp-label">{name}</span>
      </p>
      <h2 id={headingId} className="lp-h2 lp-ink"><Lines text={title} /></h2>
      {lead && <p className="lp-lead">{lead}</p>}
    </header>
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

/**
 * Inside the place: the same space in the app, the real window, with four keys on it and the legend
 * that answers them. Pointing at a part lights it.
 */
function Inside(): React.JSX.Element {
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
    <section aria-labelledby="landing-inside" className="lp-sheet lp-inside">
      <div className="lp-wrap">
        <SheetHead sheet={SHEETS.inside} name={t('inside.label')} headingId="landing-inside" title={t('inside.title')} lead={t('inside.body')} className="lp-sheet-head-split" />
        <figure className="lp-inside-stage lp-desk-only" data-arrive="">
          <div className="lp-frame lp-window" onPointerMove={onWindowPointer} onPointerLeave={() => light(null)}>
            <Img image={LANDING_IMAGES.window} alt={t('hero.alt')} />
            <div className="lp-spot" data-on={lit ? 'true' : undefined} style={spotStyle} aria-hidden="true" />
            {/* The keys stand on the picture and take no clicks; the legend beside it answers them. */}
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
        <div className="lp-inside-phone lp-phone-only" data-arrive="">
          <div className="lp-device"><Img image={LANDING_IMAGES.phoneChannels} alt={t('inside.alt')} /></div>
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

/** The workshop: what a program can do in a place, with the one request a bot really sends. */
function Developers(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const origin = usePageOrigin();
  const lines = exampleRequest(origin).split('\n');
  const points = [
    { key: 'api', title: t('developers.points.api.title'), body: t('developers.points.api.body') },
    { key: 'commands', title: t('developers.points.commands.title'), body: t('developers.points.commands.body') },
    { key: 'rights', title: t('developers.points.rights.title'), body: t('developers.points.rights.body') },
  ];
  return (
    <section aria-labelledby="landing-developers" className="lp-sheet lp-workshop">
      <div className="lp-wrap">
        <SheetHead sheet={SHEETS.developers} name={t('chapters.developers')} headingId="landing-developers" title={t('developers.title')} lead={t('developers.body')} className="lp-sheet-head-split" />
        <div className="lp-workshop-stage">
          <figure className="lp-code" data-arrive="">
            <figcaption>
              <span className="lp-code-method">{EXAMPLE_ROUTE.method}</span>
              {EXAMPLE_ROUTE.path}
            </figcaption>
            <div className="lp-code-body">
              <ol className="lp-code-gutter lp-mono" aria-hidden="true">{lines.map((_, index) => <li key={index}>{index + 1}</li>)}</ol>
              <pre><ExampleCode code={lines.join('\n')} /></pre>
            </div>
          </figure>
          <div className="lp-frame lp-dev-card" data-arrive="" style={{ '--i': 1 } as CssVars}><Img image={LANDING_IMAGES.botCard} alt={t('developers.alt')} /></div>
        </div>
        <Points className="lp-three lp-under" points={points} />
        <div className="lp-actions"><a className="lp-btn lp-btn-quiet" href="/developers">{t('developers.link')}<Glyph name="arrow" /></a></div>
      </div>
    </section>
  );
}

/**
 * The house rules: what Tavvit will not do, said as large as the opening, then the facts as a
 * specification, the app's own numbers beside what protects an account.
 */
function Privacy({ twoFactor }: { twoFactor: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const points = [
    ...(twoFactor ? [{ key: 'twoFactor', title: t('privacy.points.twoFactor.title'), body: t('privacy.points.twoFactor.body') }] : []),
    { key: 'devices', title: t('privacy.points.devices.title'), body: t('privacy.points.devices.body') },
    { key: 'data', title: t('privacy.points.data.title'), body: t('privacy.points.data.body') },
    { key: 'contact', title: t('privacy.points.contact.title'), body: t('privacy.points.contact.body') },
  ];
  return (
    <section aria-labelledby="landing-privacy" className="lp-sheet lp-band lp-rules">
      <div className="lp-light" aria-hidden="true" />
      <div className="lp-wrap">
        <header className="lp-sheet-head" data-arrive="">
          <p className="lp-sheet-meta">
            <span className="lp-mono">{t('plan.block.sheet')} {pad(SHEETS.privacy)}</span>
            <span className="lp-label">{t('chapters.privacy')}</span>
          </p>
          <h2 id="landing-privacy" className="lp-display lp-ink"><Lines text={t('privacy.title')} /></h2>
          <p className="lp-lead">{t('privacy.body')}</p>
        </header>
        <div className="lp-spec" data-arrive="">
          <dl className="lp-spec-figures">
            {FIGURES.map((figure) => (
              <div key={figure.key}>
                <dt>{t(`figures.${figure.key}`)}</dt>
                <dd className="lp-mono">{t('figures.value', { value: figure.value })}</dd>
              </div>
            ))}
          </dl>
          <dl className="lp-spec-points">
            {points.map((point) => (
              <div key={point.key}>
                <dt>{point.title}</dt>
                <dd>{point.body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="lp-figures-note" data-arrive="">{t('figures.note')}</p>
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
    <section aria-labelledby="landing-anywhere" className="lp-sheet lp-anywhere">
      <div className="lp-wrap lp-anywhere-grid">
        <div>
          <SheetHead sheet={SHEETS.anywhere} name={t('chapters.anywhere')} headingId="landing-anywhere" title={t('anywhere.title')} />
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
        </div>
        <div className="lp-anywhere-stage" data-arrive="" style={{ '--i': 1 } as CssVars}>
          <div className="lp-device"><Img image={LANDING_IMAGES.phone} alt={t('anywhere.phone.alt')} /></div>
        </div>
      </div>
    </section>
  );
}

/** Moving in: a place to find on Explore, or one of your own in three steps, drawn along a dimension line. */
function Community(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const steps = (['one', 'two', 'three'] as const).map((key) => ({ key, title: t(`moving.${key}.title`), body: t(`moving.${key}.body`) }));
  return (
    <section aria-labelledby="landing-community" className="lp-sheet lp-band lp-moving">
      <div className="lp-wrap">
        <SheetHead sheet={SHEETS.community} name={t('chapters.community')} headingId="landing-community" title={t('community.title')} lead={t('community.body')} className="lp-sheet-head-split" />
        <div className="lp-frame lp-window lp-community-shot" data-arrive=""><Img image={LANDING_IMAGES.community} alt={t('community.alt')} /></div>
        <h3 className="lp-moving-title" data-arrive="">{t('moving.title')}</h3>
        <ol className="lp-steps">
          {steps.map((step, index) => (
            <li key={step.key} data-arrive="" style={{ '--i': index } as CssVars}>
              <span className="lp-step-n lp-mono">{pad(index + 1)}</span>
              <h4 className="lp-cell-title">{step.title}</h4>
              <p className="lp-cell-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The menu: everything in the app, as an index at the back of the set. */
function FeatureTable({ twoFactor }: { twoFactor: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const rows: readonly { key: string; name: string; items: readonly FeatureItem[] }[] = [
    { key: 'messages', name: t('features.groups.messages'), items: ['replies', 'emoji', 'files', 'links', 'search', 'unread', 'voiceMessages', 'pins', 'forward', 'saved', 'keywords'] },
    { key: 'voice', name: t('features.groups.voice'), items: ['voiceChannels', 'video', 'screen', 'calls', 'noise', 'ptt', 'soundboard'] },
    { key: 'spaces', name: t('features.groups.spaces'), items: ['categories', 'roles', 'overrides', 'invites', 'listing', 'spaceProfiles'] },
    { key: 'community', name: t('features.groups.community'), items: ['threads', 'events', 'polls', 'welcome', 'template'] },
    { key: 'moderation', name: t('features.groups.moderation'), items: ['bans', 'automod', 'slow', 'audit', 'voiceMod', 'reports'] },
    { key: 'yours', name: t('features.groups.yours'), items: ['themes', 'styles', 'density', 'contrast', 'languages'] },
    { key: 'account', name: t('features.groups.account'), items: [...(twoFactor ? ['twoFactor' as const] : []), 'devices', 'export', 'deleteAccount', 'contactRules', 'blocking'] },
    { key: 'developers', name: t('features.groups.developers'), items: ['botApi', 'commands', 'cards', 'webhooks', 'portal', 'docs'] },
    { key: 'everywhere', name: t('features.groups.everywhere'), items: ['browser', 'windows', 'games', 'phone', 'push'] },
  ];
  return (
    <section id="features" aria-labelledby="landing-all" className="lp-sheet lp-index-sheet">
      <div className="lp-wrap">
        <SheetHead sheet={SHEETS.features} name={t('chapters.features')} headingId="landing-all" title={t('features.title')} />
        <dl className="lp-index">
          {rows.map((row, index) => (
            <div key={row.key} data-arrive="" style={{ '--i': index % 3 } as CssVars}>
              <dt><span className="lp-mono">{pad(index + 1)}</span>{row.name}</dt>
              <dd><ul>{row.items.map((item) => <li key={item}>{t(`features.items.${item}`)}</li>)}</ul></dd>
            </div>
          ))}
        </dl>
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
    <section aria-labelledby="landing-questions" className="lp-sheet lp-band lp-questions">
      <div className="lp-wrap lp-questions-grid">
        <div>
          <SheetHead sheet={SHEETS.questions} name={t('chapters.questions')} headingId="landing-questions" title={t('questions.title')} />
          <div className="lp-actions lp-questions-more" data-arrive=""><a className="lp-btn lp-btn-quiet" href="/help">{t('questions.more')}<Glyph name="arrow" /></a></div>
        </div>
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
      </div>
    </section>
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
          <p className="lp-closer">{t('closer')}</p>
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
  const version = info?.version ?? null;
  // Absent on an older server, where the page says what it always said.
  const twoFactor = info?.twoFactor !== false;

  return (
    <div id="lp" ref={root}>
      <Nav registrationOpen={registrationOpen} />
      <main>
        <Stage registrationOpen={registrationOpen} chat={chat} version={version} />
        <Inside />
        <Developers />
        <Privacy twoFactor={twoFactor} />
        <Anywhere />
        <Community />
        <FeatureTable twoFactor={twoFactor} />
        <Questions />
        <FinalCall registrationOpen={registrationOpen} />
      </main>
      <Footer sourceUrl={sourceUrl} version={version} chat={chat} />
    </div>
  );
}
