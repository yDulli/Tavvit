import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InstanceInfoResponse } from '@backspace/shared';
import type { PublicStatus, ServiceState } from '@backspace/shared/src/publicStatus.js';
import { PRODUCT_NAME } from '@backspace/shared/src/constants.js';
import { availableLanguages, isSupportedLanguage } from '../i18n/languages';
import { DemoChat } from './DemoChat';
import { EXAMPLE_ROUTE, exampleRequest } from './example';
import { chooseLandingLanguage } from './i18n';
import { LANDING_IMAGES, LOOKS, type LandingImage } from './images';

/**
 * The public product page, shown at `/` to a visitor who is not signed in
 * (landing/entry.ts). A plain document with its own stylesheet (landing.css): its
 * links are ordinary links, because every one of them leads out of this small
 * bundle and into the app (or to a file). The pictures are real screens of the real
 * app with invented people in them; `scripts/landing-shots` retakes them.
 *
 * What it says has to stay true. A feature named here exists in the app; nothing
 * promises federation, native phone apps or end-to-end encryption.
 */

/** Each language's list of what changed, fetched when needed: the page's script does not carry them. */
const CHANGELOGS = import.meta.glob<{ versions: Record<string, { title: string }> }>('../locales/*/changelog.json', { import: 'default' });

/** The keys of the switcher's shortcut: the same in every language. */
const SWITCHER_KEYS = ['Ctrl', 'K'];

type CssVars = React.CSSProperties & Record<`--${string}`, string | number>;

/** What stands in a card's tag, and the arrows of the buttons. */
const GLYPHS = {
  chat: 'M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  people: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM16 8l-2.5 5.5L8 16l2.5-5.5z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  down: 'M12 4v14M6 12l6 6 6-6',
  download: 'M12 3v12M7 11l5 4 5-4M4 20h16',
} as const;

function Glyph({ name }: { name: keyof typeof GLYPHS }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPHS[name]} />
    </svg>
  );
}

/** The logo as a hairline, large, behind an opening. */
function LogoLines(): React.JSX.Element {
  return (
    <svg className="lp-logo-lines" viewBox="393.6 367 465.6 465.6" aria-hidden="true">
      <circle cx="626.4" cy="599.8" r="229.9" />
      <path d="M549 498.5H769.82L723.4 556Q716.9 564.06 702 564.06H480.5L527.3 509Q536.6 498.5 549 498.5Z" />
      <path d="M642.72 573.83V685Q642.72 695.6 635.6 701.86L578.31 751.9V635.5Q578.31 627.2 584.5 622.2Z" />
    </svg>
  );
}

/** The main button: white, with its arrow in a disc of the violet. */
function MainButton({ href, className = '', children }: { href: string; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a className={`lp-btn lp-btn-main ${className}`} href={href}>
      {children}
      <span className="lp-btn-disc"><Glyph name="arrow" /></span>
    </a>
  );
}

/** A heading's lines as the catalog breaks them. The second line of a card's heading takes the card's colour. */
function Lines({ text, tint = false }: { text: string; tint?: boolean }): React.JSX.Element {
  const [first, ...rest] = text.split('\n');
  if (rest.length === 0) return <>{first}</>;
  return (
    <>
      <span className="lp-line">{first}</span>
      {'\n'}
      <span className={tint ? 'lp-line lp-tint' : 'lp-line'}>{rest.join(' ')}</span>
    </>
  );
}

function Img({ image, alt = '', className }: { image: LandingImage; alt?: string; className?: string }): React.JSX.Element {
  return <img src={image.src} width={image.width} height={image.height} alt={alt} loading="lazy" decoding="async" className={className} />;
}

/**
 * A part of the big window's picture, in the pixels of the 1440 x 900 window it was taken from: what
 * a section is about, at a size that can be read, and no new file to load.
 */
function WindowCrop({ x, y, width, height, alt }: { x: number; y: number; width: number; height: number; alt: string }): React.JSX.Element {
  const { window: image } = LANDING_IMAGES;
  return (
    <div className="lp-frame lp-crop" style={{ aspectRatio: `${width} / ${height}` }}>
      <img
        src={image.src}
        width={image.width}
        height={image.height}
        alt={alt}
        loading="lazy"
        decoding="async"
        style={{ width: `${(1440 / width) * 100}%`, marginLeft: `${(-x / width) * 100}%`, marginTop: `${(-y / width) * 100}%` }}
      />
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
 * Keeps a heading inside the page. A language with one long word ("Присаживайтесь.") would
 * run past the edge, or under what stands beside it: when the widest line of a heading is wider
 * than its section or its column, its size comes down until it fits.
 */
function useFitHeadings(root: React.RefObject<HTMLDivElement>, language: string): void {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const fit = () => {
      for (const heading of element.querySelectorAll<HTMLElement>('.lp-display, .lp-h2')) {
        heading.style.removeProperty('--fit');
        if (!heading.parentElement) continue;
        const room = roomIn(heading.parentElement);
        const widest = widestLine(heading);
        if (widest > room) heading.style.setProperty('--fit', `${Math.floor((parseFloat(getComputedStyle(heading).fontSize) * room) / widest)}px`);
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [root, language]);
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
  return (
    <header className="lp-nav">
      <div className="lp-wrap lp-nav-in">
        <a className="lp-brand" href="/">
          <img src="/icons/logo-mark.svg" alt="" width={22} height={22} />
          <span>{PRODUCT_NAME}</span>
        </a>
        <a className="lp-hide-phone" href="#features">{t('nav.features')}</a>
        <a className="lp-hide-phone" href="/download">{t('nav.download')}</a>
        <a className="lp-hide-phone" href="/developers">{t('nav.developers')}</a>
        <a className="lp-hide-phone" href="/help">{t('nav.help')}</a>
        <div className="lp-nav-right">
          <LanguagePicker id="landing-language-top" className="lp-nav-language" label={t('footer.language')} />
          <a href="/login">{t('nav.login')}</a>
          {registrationOpen && <a className="lp-nav-cta" href="/register">{t('nav.register')}</a>}
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
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" /></svg>
    </a>
  );
}

/** The small line above a heading: the room of the house this part of the page is. */
function Eyebrow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="lp-eyebrow">{children}</p>;
}

function Hero({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  // The one desktop app there is. Everyone else is offered a look around instead.
  const onWindows = /Windows/i.test(navigator.userAgent);
  return (
    <section aria-labelledby="landing-title" className="lp-hero">
      <div className="lp-hero-light" aria-hidden="true"><LogoLines /></div>
      <div className="lp-wrap lp-center">
        <News />
        <h1 id="landing-title" className="lp-display">{t('hero.title')}</h1>
        <p className="lp-lead">{t('hero.lead')}</p>
        <div className="lp-actions">
          <MainButton href={registrationOpen ? '/register' : '/login'}>{registrationOpen ? t('nav.register') : t('nav.login')}</MainButton>
          {onWindows
            ? <a className="lp-btn lp-btn-ghost" href="/download"><Glyph name="download" />{t('anywhere.desktop.link')}</a>
            : <a className="lp-btn lp-btn-ghost" href="#features"><Glyph name="down" />{t('hero.explore')}</a>}
        </div>
      </div>
      <div className="lp-wrap lp-hero-stage">
        <div className="lp-hero-shot lp-desk-only">
          <div className="lp-frame lp-bezel"><Img image={LANDING_IMAGES.window} alt={t('hero.alt')} /></div>
        </div>
        <div className="lp-frame lp-bezel lp-hero-phone lp-phone-only"><Img image={LANDING_IMAGES.phone} alt={t('anywhere.phone.alt')} /></div>
      </div>
    </section>
  );
}

function Statement(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section id="features" className="lp-sec lp-center">
      <div className="lp-wrap">
        <p className="lp-statement">{t('statement')}</p>
      </div>
    </section>
  );
}

interface FeatureCardProps {
  tone: 'violet' | 'blue' | 'coral' | 'teal';
  headingId: string;
  title: string;
  body: string;
  tag: string;
  glyph: keyof typeof GLYPHS;
  /** What stands under the words. */
  extra?: React.ReactNode;
  /** What stands under the card. */
  after?: React.ReactNode;
  children: React.ReactNode;
}

/** A large colour card: the words on its dark side, a real screen on glass plates on its bright one, and a tag on the screen. */
function FeatureCard({ tone, headingId, title, body, tag, glyph, extra, after, children }: FeatureCardProps): React.JSX.Element {
  return (
    <section aria-labelledby={headingId} className="lp-cardsec">
      <div className={`lp-card lp-tone-${tone}`}>
        <div className="lp-card-copy">
          <h2 id={headingId} className="lp-h2"><Lines text={title} tint /></h2>
          <p className="lp-rule">{body}</p>
          {extra}
        </div>
        <div className="lp-card-stage">
          {children}
          <div className="lp-tag"><span className="lp-tag-icon"><Glyph name={glyph} /></span>{tag}</div>
        </div>
      </div>
      {after && <div className="lp-after-card">{after}</div>}
    </section>
  );
}

function Demo({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [hasWritten, setHasWritten] = useState(false);
  return (
    <section aria-labelledby="landing-demo" className="lp-cardsec">
      <div className="lp-card lp-card-wide lp-tone-violet">
        <div className="lp-card-copy">
          <Eyebrow>{t('eyebrow.demo')}</Eyebrow>
          <h2 id="landing-demo" className="lp-h2"><Lines text={t('demo.title')} tint /></h2>
          <p className="lp-rule">{t('demo.body')}</p>
          <p className="lp-demo-note">{t('demo.note')}</p>
          {registrationOpen && hasWritten && <MainButton className="lp-demo-cta" href="/register">{t('demo.cta')}</MainButton>}
        </div>
        <div className="lp-card-stage"><DemoChat onFirstMessage={() => setHasWritten(true)} /></div>
      </div>
    </section>
  );
}

function Messages(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <FeatureCard tone="blue" headingId="landing-messages" title={t('messages.title')} body={t('messages.body')} tag={t('eyebrow.messages')} glyph="chat">
      <WindowCrop x={256} y={93} width={660} height={500} alt={t('messages.alt')} />
    </FeatureCard>
  );
}

/**
 * The same app with different people in it: real screens of the demo community's spaces. A
 * picture is only asked for once its group is chosen, or about to be.
 */
function Crowds(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [active, setActive] = useState(0);
  const crowds = [
    { key: 'raid', label: t('crowds.raid'), image: LANDING_IMAGES.window, alt: t('crowds.alts.raid') },
    { key: 'photo', label: t('crowds.photo'), image: LANDING_IMAGES.spacePhoto, alt: t('crowds.alts.photo') },
    { key: 'dev', label: t('crowds.dev'), image: LANDING_IMAGES.spaceDev, alt: t('crowds.alts.dev') },
    { key: 'books', label: t('crowds.books'), image: LANDING_IMAGES.spaceBooks, alt: t('crowds.alts.books') },
  ];
  const shown = crowds[active]!;
  const onKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (active + step + crowds.length) % crowds.length;
    setActive(next);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <>
      <div className="lp-crowds-bar">
        <Eyebrow>{t('eyebrow.crowds')}</Eyebrow>
        <h3 id="landing-crowds" className="lp-crowds-title">{t('crowds.title')}</h3>
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
              onClick={() => setActive(index)}
              onPointerEnter={() => { new Image().src = crowd.image.src; }}
            >
              {crowd.label}
            </button>
          ))}
        </div>
      </div>
      <div id="landing-crowd" role="tabpanel" aria-labelledby={`landing-crowd-${shown.key}`} className="lp-crowd-stage">
        <div key={shown.key} className="lp-frame lp-bezel lp-crowd-shot"><Img image={shown.image} alt={shown.alt} /></div>
      </div>
    </>
  );
}

function Spaces(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section aria-labelledby="landing-spaces" className="lp-sec">
      <div className="lp-wrap">
        <div className="lp-center">
          <Eyebrow>{t('eyebrow.spaces')}</Eyebrow>
          <h2 id="landing-spaces" className="lp-h2">{t('spaces.title')}</h2>
          <p className="lp-lead">{t('spaces.body')}</p>
        </div>
        <div className="lp-phones lp-phone-only">
          <div className="lp-frame"><Img image={LANDING_IMAGES.phone} alt={t('spaces.alt')} /></div>
          <div className="lp-frame"><Img image={LANDING_IMAGES.phoneChannels} /></div>
          <div className="lp-frame"><Img image={LANDING_IMAGES.phoneMembers} /></div>
        </div>
        <div className="lp-block">
          <Crowds />
          <div className="lp-anatomy lp-desk-only">
            <span className="lp-label">{t('spaces.layers.channels')}</span>
            <span className="lp-label">{t('spaces.layers.conversation')}</span>
            <span className="lp-label">{t('spaces.layers.members')}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Voice(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <FeatureCard tone="coral" headingId="landing-voice" title={t('voice.title')} body={t('voice.body')} tag={t('eyebrow.voice')} glyph="voice">
      <div className="lp-frame"><Img image={LANDING_IMAGES.voice} alt={t('voice.alt')} /></div>
    </FeatureCard>
  );
}

function Conversations(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <FeatureCard
      tone="violet"
      headingId="landing-conversations"
      title={t('conversations.title')}
      body={t('conversations.body')}
      tag={t('eyebrow.conversations')}
      glyph="search"
      extra={(
        <div className="lp-keycaps lp-desk-only" aria-hidden="true">
          {SWITCHER_KEYS.map((key) => <span key={key} className="lp-key">{key}</span>)}
        </div>
      )}
    >
      <div className="lp-frame lp-switcher">
        <Img image={LANDING_IMAGES.switcher} alt={t('conversations.alt')} />
        <div className="lp-switcher-card"><Img image={LANDING_IMAGES.switcherCard} /></div>
      </div>
    </FeatureCard>
  );
}

/** Short points under a section, each a title and a sentence. */
function Points({ points, className = '' }: { points: readonly { title: string; body: string }[]; className?: string }): React.JSX.Element {
  return (
    <div className={`lp-points ${className}`}>
      {points.map((point) => (
        <div key={point.title}>
          <h3>{point.title}</h3>
          <p>{point.body}</p>
        </div>
      ))}
    </div>
  );
}

/** A feature with a real screen under its words, or beside them when the screen is wide. */
function Feature({ image, title, body, alt, className = '' }: { image: LandingImage; title: string; body: string; alt: string; className?: string }): React.JSX.Element {
  return (
    <article className={`lp-feature ${className}`}>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="lp-frame"><Img image={image} alt={alt} /></div>
    </article>
  );
}

function Around(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section aria-labelledby="landing-around" className="lp-sec">
      <div className="lp-wrap">
        <div className="lp-center">
          <Eyebrow>{t('eyebrow.around')}</Eyebrow>
          <h2 id="landing-around" className="lp-h2">{t('around.title')}</h2>
          <p className="lp-lead">{t('around.body')}</p>
        </div>
        <div className="lp-features">
          <Feature className="lp-feature-wide lp-feature-thread" image={LANDING_IMAGES.thread} title={t('around.thread.title')} body={t('around.thread.body')} alt={t('around.thread.alt')} />
          <Feature image={LANDING_IMAGES.poll} title={t('around.poll.title')} body={t('around.poll.body')} alt={t('around.poll.alt')} />
          <Feature image={LANDING_IMAGES.welcome} title={t('around.welcome.title')} body={t('around.welcome.body')} alt={t('around.welcome.alt')} />
          <Feature className="lp-feature-wide lp-feature-event" image={LANDING_IMAGES.event} title={t('around.event.title')} body={t('around.event.body')} alt={t('around.event.alt')} />
        </div>
        <Points points={[
          { title: t('around.points.voice.title'), body: t('around.points.voice.body') },
          { title: t('around.points.saved.title'), body: t('around.points.saved.body') },
          { title: t('around.points.alerts.title'), body: t('around.points.alerts.body') },
        ]} />
      </div>
    </section>
  );
}

function People(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <FeatureCard tone="teal" headingId="landing-people" title={t('friends.title')} body={`${t('friends.body')} ${t('profiles.body')}`} tag={t('eyebrow.people')} glyph="people">
      <div className="lp-people-stage">
        <div className="lp-frame lp-people-friends"><Img image={LANDING_IMAGES.friends} alt={t('friends.alt')} /></div>
        <div className="lp-frame lp-people-card"><Img image={LANDING_IMAGES.profile} alt={t('profiles.alt')} /></div>
      </div>
    </FeatureCard>
  );
}

function Themes(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section aria-labelledby="landing-themes" className="lp-cardsec">
      <div className="lp-card lp-card-center lp-tone-coral">
        <Eyebrow>{t('eyebrow.themes')}</Eyebrow>
        <h2 id="landing-themes" className="lp-h2"><Lines text={t('themes.title')} tint /></h2>
        <p className="lp-lead" style={{ marginInline: 'auto' }}>{t('themes.body')}</p>
        <div className="lp-fan" role="img" aria-label={t('themes.alt')}>
          {LOOKS.map((look) => (
            <div key={look.position} className="lp-fan-card" style={{ '--i': look.position } as CssVars}>
              <Img image={look.image} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Community(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const points = [
    { title: t('community.points.explore.title'), body: t('community.points.explore.body') },
    { title: t('community.points.moderation.title'), body: t('community.points.moderation.body') },
    { title: t('community.points.reports.title'), body: t('community.points.reports.body') },
    { title: t('community.points.rights.title'), body: t('community.points.rights.body') },
    { title: t('community.points.invites.title'), body: t('community.points.invites.body') },
    { title: t('community.points.template.title'), body: t('community.points.template.body') },
  ];
  return (
    <FeatureCard tone="blue" headingId="landing-community" title={t('community.title')} body={t('community.body')} tag={t('eyebrow.community')} glyph="compass" after={<Points points={points} />}>
      <div className="lp-frame lp-community-shot"><Img image={LANDING_IMAGES.community} alt={t('community.alt')} /></div>
    </FeatureCard>
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

function Moving(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const steps = [
    { title: t('moving.one.title'), body: t('moving.one.body') },
    { title: t('moving.two.title'), body: t('moving.two.body') },
    { title: t('moving.three.title'), body: t('moving.three.body') },
  ];
  return (
    <section aria-labelledby="landing-moving" className="lp-sec">
      <div className="lp-wrap lp-center">
        <Eyebrow>{t('eyebrow.moving')}</Eyebrow>
        <h2 id="landing-moving" className="lp-h2">{t('moving.title')}</h2>
        <ol className="lp-steps">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="lp-step-number" aria-hidden="true">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Developers(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const points = [
    { title: t('developers.points.api.title'), body: t('developers.points.api.body') },
    { title: t('developers.points.commands.title'), body: t('developers.points.commands.body') },
    { title: t('developers.points.rights.title'), body: t('developers.points.rights.body') },
  ];
  return (
    <section aria-labelledby="landing-developers" className="lp-sec lp-dev">
      <div className="lp-wrap">
        <div className="lp-center">
          <Eyebrow>{t('eyebrow.developers')}</Eyebrow>
          <h2 id="landing-developers" className="lp-h2">{t('developers.title')}</h2>
          <p className="lp-lead">{t('developers.body')}</p>
          <div className="lp-actions"><MainButton href="/developers">{t('developers.link')}</MainButton></div>
        </div>
        <div className="lp-dev-stage">
          <figure className="lp-code">
            <figcaption className="lp-label">
              <span className="lp-code-method">{EXAMPLE_ROUTE.method}</span>
              {EXAMPLE_ROUTE.path}
            </figcaption>
            <pre><ExampleCode code={exampleRequest(window.location.origin)} /></pre>
          </figure>
          <div className="lp-frame lp-dev-card"><Img image={LANDING_IMAGES.botCard} alt={t('developers.alt')} /></div>
        </div>
        <div className="lp-chips">
          {points.map((point) => (
            <div key={point.title} className="lp-chip-item">
              <h3 className="lp-chip">{point.title}</h3>
              <p>{point.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Privacy({ twoFactor }: { twoFactor: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section aria-labelledby="landing-privacy" className="lp-sec lp-noads">
      <div className="lp-wrap lp-center">
        <Eyebrow>{t('eyebrow.privacy')}</Eyebrow>
        <h2 id="landing-privacy" className="lp-display"><Lines text={t('privacy.title')} /></h2>
        <p className="lp-lead">{t('privacy.body')}</p>
        <Points className="lp-points-four" points={[
          ...(twoFactor ? [{ title: t('privacy.points.twoFactor.title'), body: t('privacy.points.twoFactor.body') }] : []),
          { title: t('privacy.points.devices.title'), body: t('privacy.points.devices.body') },
          { title: t('privacy.points.data.title'), body: t('privacy.points.data.body') },
          { title: t('privacy.points.contact.title'), body: t('privacy.points.contact.body') },
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
    <section aria-labelledby="landing-anywhere" className="lp-sec lp-anywhere">
      <div className="lp-wrap">
        <div className="lp-center">
          <Eyebrow>{t('eyebrow.anywhere')}</Eyebrow>
          <h2 id="landing-anywhere" className="lp-h2"><Lines text={t('anywhere.title')} /></h2>
        </div>
        <div className="lp-block">
          <div className="lp-anywhere-copy">
            <div>
              <p className="lp-lead">{t('anywhere.desktop.body')}</p>
              <a className="lp-link" href="/download">{t('anywhere.desktop.link')}</a>
            </div>
            <div>
              <p className="lp-lead">{t('anywhere.phone.body')}</p>
              <PhoneCode />
            </div>
          </div>
          <div className="lp-anywhere-stage">
            <div className="lp-frame lp-bezel lp-anywhere-window"><Img image={LANDING_IMAGES.window} /></div>
            <div className="lp-frame lp-bezel lp-anywhere-phone lp-desk-only"><Img image={LANDING_IMAGES.phone} alt={t('anywhere.phone.alt')} /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureTable({ twoFactor }: { twoFactor: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const rows = [
    {
      name: t('features.groups.messages'),
      items: [t('features.items.replies'), t('features.items.emoji'), t('features.items.files'), t('features.items.links'), t('features.items.search'), t('features.items.unread'), t('features.items.voiceMessages'), t('features.items.pins'), t('features.items.forward'), t('features.items.saved'), t('features.items.keywords')],
    },
    {
      name: t('features.groups.voice'),
      items: [t('features.items.voiceChannels'), t('features.items.video'), t('features.items.screen'), t('features.items.calls'), t('features.items.noise'), t('features.items.ptt'), t('features.items.soundboard')],
    },
    {
      name: t('features.groups.spaces'),
      items: [t('features.items.categories'), t('features.items.roles'), t('features.items.overrides'), t('features.items.invites'), t('features.items.listing'), t('features.items.spaceProfiles')],
    },
    {
      name: t('features.groups.community'),
      items: [t('features.items.threads'), t('features.items.events'), t('features.items.polls'), t('features.items.welcome'), t('features.items.template')],
    },
    {
      name: t('features.groups.moderation'),
      items: [t('features.items.bans'), t('features.items.automod'), t('features.items.slow'), t('features.items.audit'), t('features.items.voiceMod'), t('features.items.reports')],
    },
    {
      name: t('features.groups.yours'),
      items: [t('features.items.themes'), t('features.items.styles'), t('features.items.density'), t('features.items.contrast'), t('features.items.languages')],
    },
    {
      name: t('features.groups.account'),
      items: [...(twoFactor ? [t('features.items.twoFactor')] : []), t('features.items.devices'), t('features.items.export'), t('features.items.deleteAccount'), t('features.items.contactRules'), t('features.items.blocking')],
    },
    {
      name: t('features.groups.developers'),
      items: [t('features.items.botApi'), t('features.items.commands'), t('features.items.cards'), t('features.items.webhooks'), t('features.items.portal'), t('features.items.docs')],
    },
    {
      name: t('features.groups.everywhere'),
      items: [t('features.items.browser'), t('features.items.windows'), t('features.items.games'), t('features.items.phone'), t('features.items.push')],
    },
  ];
  return (
    <section aria-labelledby="landing-all" className="lp-sec">
      <div className="lp-wrap lp-center">
        <Eyebrow>{t('eyebrow.features')}</Eyebrow>
        <h2 id="landing-all" className="lp-h2">{t('features.title')}</h2>
        <dl className="lp-groups">
          {rows.map((row) => (
            <div key={row.name} className="lp-group">
              <dt>{row.name}</dt>
              <dd><ul>{row.items.map((item) => <li key={item}>{item}</li>)}</ul></dd>
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
  const questions = [
    { q: t('questions.items.join.q'), a: t('questions.items.join.a') },
    { q: t('questions.items.phone.q'), a: t('questions.items.phone.a') },
    { q: t('questions.items.computers.q'), a: t('questions.items.computers.a') },
    { q: t('questions.items.moving.q'), a: t('questions.items.moving.a') },
    { q: t('questions.items.bots.q'), a: t('questions.items.bots.a') },
    { q: t('questions.items.trouble.q'), a: t('questions.items.trouble.a') },
  ];
  return (
    <section aria-labelledby="landing-questions" className="lp-sec">
      <div className="lp-wrap lp-center">
        <Eyebrow>{t('eyebrow.questions')}</Eyebrow>
        <h2 id="landing-questions" className="lp-h2">{t('questions.title')}</h2>
        <div className="lp-faq">
          {questions.map((question, index) => (
            <details key={question.q} open={index === 0}>
              <summary>
                {question.q}
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 8l5 5 5-5" />
                </svg>
              </summary>
              <p>{question.a}</p>
            </details>
          ))}
        </div>
        <div className="lp-actions lp-questions-more"><a className="lp-btn lp-btn-ghost" href="/help">{t('questions.more')}</a></div>
      </div>
    </section>
  );
}

function FinalCall({ registrationOpen }: { registrationOpen: boolean }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <section aria-labelledby="landing-cta" className="lp-cardsec">
      <div className="lp-card lp-card-center lp-tone-glow lp-final">
        <LogoLines />
        <Eyebrow>{t('eyebrow.cta')}</Eyebrow>
        <h2 id="landing-cta" className="lp-h2">{t('cta.title')}</h2>
        <p className="lp-lead" style={{ marginInline: 'auto' }}>{registrationOpen ? t('cta.body') : t('cta.closed')}</p>
        <div className="lp-actions" style={{ justifyContent: 'center' }}>
          {registrationOpen && <MainButton href="/register">{t('cta.register')}</MainButton>}
          {registrationOpen
            ? <a className="lp-btn lp-btn-ghost" href="/login">{t('cta.login')}</a>
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

function Footer({ sourceUrl, version }: { sourceUrl: string | null; version: string | null }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const chat = useChatState();
  return (
    <footer className="lp-footer">
      <div className="lp-wrap"><div className="lp-footer-in">
      <div className="lp-footer-grid">
        <div>
          <a className="lp-brand" href="/">
            <img src="/icons/logo-mark.svg" alt="" width={22} height={22} loading="lazy" />
            <span>{PRODUCT_NAME}</span>
          </a>
          <div className="lp-footer-language">
            <label htmlFor="landing-language" className="field-label">{t('footer.language')}</label>
            {/* 16px on a phone: Safari zooms into a smaller field on focus, and the app's rule for that does not run on this page. */}
            <LanguagePicker id="landing-language" className="input-search w-full max-md:text-base" />
          </div>
        </div>
        <nav aria-label={t('footer.product')}>
          <p className="lp-label">{t('footer.product')}</p>
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
          <p className="lp-label">{t('footer.legal')}</p>
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
        {version && <a href="/changelog">{t('life.version', { version })}</a>}
        <p className="lp-closer">{t('closer')}</p>
      </div>
      </div></div>
    </footer>
  );
}

export function LandingPage(): React.JSX.Element {
  const { t, i18n } = useTranslation('landing');
  const [info, setInfo] = useState<InstanceInfoResponse | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useFitHeadings(root, i18n.resolvedLanguage ?? i18n.language);

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
      <main>
        <Hero registrationOpen={registrationOpen} />
        <Statement />
        <Demo registrationOpen={registrationOpen} />
        <Messages />
        <Spaces />
        <Voice />
        <Conversations />
        <Around />
        <People />
        <Themes />
        <Community />
        <Moving />
        <Developers />
        <Privacy twoFactor={twoFactor} />
        <Anywhere />
        <FeatureTable twoFactor={twoFactor} />
        <Questions />
        <FinalCall registrationOpen={registrationOpen} />
      </main>
      <Footer sourceUrl={sourceUrl} version={info?.version ?? null} />
    </div>
  );
}
