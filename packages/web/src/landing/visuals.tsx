import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createFormatters } from '../i18n/createFormatters';
import { Glyph, nextChoice, type CssVars, type GlyphName } from './parts';

/**
 * The product page's drawn objects (docs/systems/landing.md, "Design"): glass cards that stand for
 * what Tavvit holds (a space, its tag, a voice room, a poll, an event, a role, a profile, a bot's
 * card), drawn by hand and never a picture of the app. Most of them can be tried: a vote counts, a
 * reaction toggles, a tag takes the letters typed into it. Everything stays on this page: nothing is
 * sent or stored, and the people in them are the invented members of the demo space Night Shift.
 */

/** The app's accent family (design-system.md), for avatars and roles. */
export type Tone = 'mint' | 'peach' | 'lavender' | 'sky' | 'amber' | 'rose' | 'coral';

const TONES: readonly Tone[] = ['lavender', 'sky', 'mint', 'amber', 'peach', 'rose', 'coral'];

/** Whether the page may move: false under reduced motion, and when the visitor paused it. */
export const MotionContext = createContext(true);

/**
 * The invented space of the page's scenes and the people in it. Names are names: they read the same
 * in every language, so they stand here once and not in the catalogs.
 */
const DEMO = {
  space: 'Night Shift',
  spaceInitial: 'N',
  voice: 'lounge',
  joinPath: '/join/',
  yuki: 'Yuki Tanaka',
  yukiMention: '@Yuki',
  lena: 'Lena Hoffmann',
  noor: 'Noor Haddad',
  bot: 'Build Bot',
} as const;

/** A time of day the way the page's language writes it: "4:39 PM" in English, "16:39" in German. */
function useClock(): (hour: number, minute: number) => string {
  const { i18n } = useTranslation('landing');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { formatTime } = useMemo(() => createFormatters(() => language), [language]);
  return (hour, minute) => formatTime(new Date(2026, 0, 1, hour, minute).getTime());
}

/** The address of the server the page was opened at, once the page runs; empty in the prerendered HTML. */
function useHost(): string {
  const [host, setHost] = useState('');
  useEffect(() => setHost(window.location.host), []);
  return host;
}

/** Arrow keys, Home and End move a choice among radio buttons, as a radio group's do. */
function radioKeys<T>(event: React.KeyboardEvent<HTMLElement>, choices: readonly T[], current: T, choose: (value: T) => void): void {
  const at = choices.indexOf(current);
  const next = nextChoice(event.key, at < 0 ? 0 : at, choices.length);
  if (next === null) return;
  event.preventDefault();
  const value = choices[next];
  if (value === undefined) return;
  choose(value);
  const group = event.currentTarget.parentElement;
  group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
}

export function Avatar({ initial, tone, size = 'md', speaking = false, className = '', style }: {
  initial: string;
  tone: Tone;
  size?: 'sm' | 'md' | 'lg';
  speaking?: boolean;
  className?: string;
  style?: CssVars;
}): React.JSX.Element {
  return (
    <span className={`lp-avatar ${className}`} data-tone={tone} data-size={size} data-speaking={speaking ? 'true' : undefined} style={style} aria-hidden="true">
      {initial}
    </span>
  );
}

/** A space's tag as members wear it: a symbol and two to four letters on a small plate. */
export function TagPlate({ symbol = 'moon', text, size = 'sm' }: { symbol?: GlyphName; text: string; size?: 'sm' | 'lg' }): React.JSX.Element {
  return (
    <span className="lp-plate" data-size={size}>
      <Glyph name={symbol} />
      <b>{text}</b>
    </span>
  );
}

export type FrameKind = 'headphones' | 'laurel' | 'halo';

/** The leaves of a laurel, along a circle around the picture, from its foot up one side. */
const LAUREL = Array.from({ length: 6 }, (_, index) => 100 + index * 17);

/** A frame drawn around a picture, as the app's decorations are: line art partly in front of it. */
export function Frame({ kind }: { kind: FrameKind }): React.JSX.Element {
  return (
    <svg className="lp-frame" data-kind={kind} viewBox="-24 -24 148 148" aria-hidden="true">
      {kind === 'headphones' && (
        <>
          <path className="lp-frame-band" d="M6 56C6 14 94 14 94 56" />
          <rect className="lp-frame-cup" x="-6" y="46" width="20" height="32" rx="7" />
          <rect className="lp-frame-cup" x="86" y="46" width="20" height="32" rx="7" />
        </>
      )}
      {kind === 'halo' && (
        <>
          <ellipse className="lp-frame-halo" cx="50" cy="-8" rx="27" ry="7.5" />
          {/* Two wings of three feathers each, spread out from the sides; the right one is the left mirrored. */}
          {['', 'matrix(-1 0 0 1 100 0)'].map((mirror) => (
            <g key={mirror || 'left'} transform={mirror || undefined}>
              <path className="lp-frame-wing" d="M6 44C-4 32-16 28-23 33c6 4 13 9 27 19z" />
              <path className="lp-frame-wing" d="M4 54C-8 47-19 46-24 52c7 2 14 4 27 8z" />
              <path className="lp-frame-wing" d="M5 63C-5 60-14 62-18 68c6 0 12-1 22-2z" />
            </g>
          ))}
        </>
      )}
      {kind === 'laurel' && (
        <>
          {LAUREL.map((angle) => {
            const left = (angle * Math.PI) / 180;
            const mirrored = 180 - angle;
            const right = (mirrored * Math.PI) / 180;
            const lx = 50 + 60 * Math.cos(left);
            const ly = 50 + 60 * Math.sin(left);
            const rx = 50 + 60 * Math.cos(right);
            const ry = 50 + 60 * Math.sin(right);
            return (
              <React.Fragment key={angle}>
                <ellipse className="lp-frame-leaf" cx={lx} cy={ly} rx="10" ry="4.2" transform={`rotate(${angle + 62} ${lx} ${ly})`} />
                <ellipse className="lp-frame-leaf" cx={rx} cy={ry} rx="10" ry="4.2" transform={`rotate(${mirrored - 62} ${rx} ${ry})`} />
              </React.Fragment>
            );
          })}
          <circle className="lp-frame-berry" cx="50" cy="111" r="4" />
        </>
      )}
    </svg>
  );
}

/**
 * Text that types itself, deletes itself and types the next phrase. A screen reader hears the first
 * phrase once; without motion, and in the prerendered HTML, the first phrase simply stands there.
 */
export function Typewriter({ phrases }: { phrases: readonly string[] }): React.JSX.Element {
  const moving = useContext(MotionContext);
  const [shown, setShown] = useState(phrases[0] ?? '');
  useEffect(() => {
    const first = phrases[0] ?? '';
    if (!moving || phrases.length < 2) {
      setShown(first);
      return undefined;
    }
    let phrase = 0;
    let length = first.length;
    let deleting = true;
    let timer = 0;
    const step = () => {
      if (deleting) {
        length -= 1;
        if (length <= 0) {
          deleting = false;
          phrase = (phrase + 1) % phrases.length;
          length = 0;
        }
      } else {
        length += 1;
      }
      const current = phrases[phrase] ?? '';
      setShown(current.slice(0, Math.max(0, length)));
      let wait = deleting ? 36 : 70;
      if (!deleting && length >= current.length) {
        deleting = true;
        wait = 2300;
      }
      timer = window.setTimeout(step, wait);
    };
    timer = window.setTimeout(step, 2300);
    return () => window.clearTimeout(timer);
  }, [moving, phrases]);
  return (
    <span className="lp-type">
      <span aria-hidden="true">{shown}</span>
      <span className="lp-caret" aria-hidden="true" />
      <span className="sr-only">{phrases[0]}</span>
    </span>
  );
}

/** Addresses in words, as a space's own invite address is written (3 to 32 small letters, digits or hyphens). */
const ADDRESSES = ['night-shift', 'book-club', 'fix-it-friday', 'your-space'] as const;

/** A space's own invite address, typing itself on this server's address. */
export function AddressCard({ label }: { label: string }): React.JSX.Element {
  const host = useHost();
  return (
    <div className="lp-address lp-glass">
      <p className="lp-address-label"><Glyph name="enter" />{label}</p>
      <p className="lp-address-line">
        <span className="lp-address-host">{host}</span>
        <span className="lp-address-path">{DEMO.joinPath}</span>
        <Typewriter phrases={ADDRESSES} />
      </p>
    </div>
  );
}

/** Night Shift's banner, drawn: two ridges under a moon, a few stars that come and go. */
function Banner(): React.JSX.Element {
  const stars: readonly [string, string, string][] = [['14%', '24%', '0s'], ['31%', '14%', '1.2s'], ['47%', '30%', '2.1s'], ['63%', '12%', '0.6s'], ['86%', '26%', '1.7s'], ['22%', '44%', '2.6s']];
  return (
    <div className="lp-banner" aria-hidden="true">
      {stars.map(([x, y, delay]) => <i key={`${x}${y}`} className="lp-star" style={{ '--x': x, '--y': y, '--d': delay } as CssVars} />)}
      <span className="lp-banner-moon" />
      <svg viewBox="0 0 400 120" preserveAspectRatio="none">
        <path className="lp-ridge-far" d="M0 120V90l46-26 36 20 46-34 42 32 44-24 48 30 44-26 46 24 48-18v52z" />
        <path className="lp-ridge-near" d="M0 120v-16l60-20 44 16 46-20 58 24 48-18 62 20 48-14 34 8v20z" />
      </svg>
    </div>
  );
}

/** The poll of #patch-notes: its results stay hidden until one has voted, as the app's do. */
const POLL = [
  { key: 'completely', votes: 1 },
  { key: 'little', votes: 2 },
  { key: 'skill', votes: 4 },
] as const;

type PollKey = (typeof POLL)[number]['key'];

function Poll(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [vote, setVote] = useState<PollKey | null>(null);
  const total = POLL.reduce((sum, option) => sum + option.votes, 0) + (vote ? 1 : 0);
  return (
    <article className="lp-poll lp-glass" aria-label={t('home.scene.poll')}>
      <p className="lp-poll-q">{t('home.scene.poll')}</p>
      <ul className="lp-poll-bars" data-voted={vote ? 'true' : undefined}>
        {POLL.map((option) => {
          const votes = option.votes + (vote === option.key ? 1 : 0);
          const share = Math.round((votes / total) * 100);
          return (
            <li key={option.key} style={{ '--share': vote ? `${share}%` : '0%' } as CssVars}>
              <button type="button" aria-pressed={vote === option.key} onClick={() => setVote(option.key)}>
                <span>{vote === option.key && <Glyph name="check" />}{t(`home.scene.${option.key}`)}</span>
                {vote && <b>{share}%</b>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="lp-poll-foot" aria-live="polite">
        {vote ? t('home.inside.voted', { count: total }) : t('home.inside.vote')}
      </p>
    </article>
  );
}

/** What goes on in each room of the space card, as the card shows it when the room is chosen. */
type RoomKey = 'general' | 'lounge' | 'guides' | 'events';

const ROOMS: readonly { key: RoomKey; icon: GlyphName }[] = [
  { key: 'general', icon: 'hash' },
  { key: 'lounge', icon: 'speaker' },
  { key: 'guides', icon: 'thread' },
  { key: 'events', icon: 'calendar' },
];

function RoomPreview({ room }: { room: RoomKey }): React.JSX.Element {
  const { t } = useTranslation('landing');
  if (room === 'lounge') {
    return (
      <p className="lp-preview">
        <span className="lp-stack"><Avatar initial="L" tone="rose" size="sm" speaking /><Avatar initial="J" tone="sky" size="sm" /><Avatar initial="N" tone="peach" size="sm" /><Avatar initial="S" tone="coral" size="sm" /></span>
        <span className="lp-eq" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>{t('home.scene.speaking', { name: 'Lena' })}</span>
      </p>
    );
  }
  if (room === 'guides') {
    return (
      <p className="lp-preview">
        <Glyph name="thread" />
        <span><b>{t('home.inside.post')}</b></span>
        <span className="lp-preview-tag">{t('home.inside.postTags')}</span>
      </p>
    );
  }
  if (room === 'events') {
    return (
      <p className="lp-preview">
        <Glyph name="calendar" />
        <span><b>{t('home.scene.raid')}</b> · {t('home.scene.when')}</span>
        <span className="lp-preview-tag">{t('home.scene.going', { count: 6 })}</span>
      </p>
    );
  }
  return (
    <p className="lp-preview">
      <Avatar initial="N" tone="peach" size="sm" />
      <span><b>{DEMO.noor}</b> {t('home.scene.message')}</span>
    </p>
  );
}

/** A profile card, as someone's profile opens: banner, picture with its frame, name with the space's tag. */
export function ProfileCard({ name, handle, pronouns, initial, tone, frame, bio, role, look, className = '', style }: {
  name: string;
  handle: string;
  pronouns: string;
  initial: string;
  tone: Tone;
  frame?: FrameKind | null;
  bio?: string;
  role?: string;
  look: 'glass' | 'electric' | 'minimal';
  className?: string;
  style?: CssVars;
}): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <article className={`lp-profile ${look === 'minimal' ? '' : 'lp-glass'} ${look === 'electric' ? 'lp-electric' : ''} ${className}`} data-look={look} data-tone={tone} style={style}>
      <div className="lp-profile-banner" />
      <div className="lp-profile-face">
        <Avatar initial={initial} tone={tone} size="lg" />
        {frame && <Frame kind={frame} />}
      </div>
      <p className="lp-profile-name">{name}<TagPlate text="NITE" /></p>
      <p className="lp-profile-handle">@{handle} · {pronouns}</p>
      {bio && <p className="lp-profile-bio">{bio}</p>}
      {role && <p className="lp-profile-role"><i />{role}</p>}
      <span className="lp-profile-button">{t('home.identity.message')}</span>
    </article>
  );
}

/**
 * The opening's picture: Night Shift as a card, the way an invite or Explore shows a space, with what
 * goes on in it floating around it: its owner, its voice room, a poll, the next event. The card leans
 * towards a mouse that moves over it, and its rooms can be chosen to look in.
 */
export function HeroScene(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const moving = useContext(MotionContext);
  const [room, setRoom] = useState<RoomKey>('general');
  const lean = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!moving || event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--rx', ((event.clientX - box.left) / box.width - 0.5).toFixed(3));
    event.currentTarget.style.setProperty('--ry', ((event.clientY - box.top) / box.height - 0.5).toFixed(3));
  };
  const rest = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty('--rx', '0');
    event.currentTarget.style.setProperty('--ry', '0');
  };
  return (
    <div className="lp-scene" role="group" aria-label={t('home.scene.label')} onPointerMove={lean} onPointerLeave={rest}>
      <div className="lp-scene-rings" aria-hidden="true"><i /><i /><i /></div>

      <article className="lp-space lp-glass">
        <Banner />
        <div className="lp-space-body">
          <span className="lp-space-icon" aria-hidden="true">{DEMO.spaceInitial}</span>
          <p className="lp-space-name">{DEMO.space}<TagPlate text="NITE" /></p>
          <p className="lp-space-about">{t('home.scene.about')}</p>
          <p className="lp-space-meta">
            <span className="lp-online-dot" aria-hidden="true" />
            {t('home.scene.online', { count: 4 })}
            <span className="lp-sep" aria-hidden="true">·</span>
            {t('home.scene.members', { count: 8 })}
          </p>
          <div className="lp-space-rooms" role="radiogroup" aria-label={t('home.scene.rooms')}>
            {ROOMS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="radio"
                aria-checked={room === entry.key}
                tabIndex={room === entry.key ? 0 : -1}
                onClick={() => setRoom(entry.key)}
                onKeyDown={(event) => radioKeys(event, ROOMS.map((item) => item.key), room, setRoom)}
              >
                <Glyph name={entry.icon} />
                {entry.key === 'events' ? t('home.scene.events') : entry.key}
                {entry.key === 'lounge' && <b>4</b>}
              </button>
            ))}
          </div>
          <div className="lp-space-preview" key={room} aria-live="polite"><RoomPreview room={room} /></div>
        </div>
      </article>

      <div className="lp-float lp-scene-left" style={{ '--tilt': '-7deg', '--delay': '-2s' } as CssVars} aria-hidden="true">
        <ProfileCard name="Mara Lindqvist" handle="mara" pronouns="she/her" initial="M" tone="lavender" frame="laurel" role={t('home.scene.owner')} look="electric" />
      </div>

      <div className="lp-float lp-float-slow lp-scene-right" style={{ '--tilt': '6deg', '--delay': '-5s' } as CssVars} aria-hidden="true">
        <article className="lp-voice lp-glass">
          <p className="lp-card-head"><Glyph name="speaker" />{DEMO.voice}<span>{t('home.scene.talking', { count: 4 })}</span></p>
          <div className="lp-voice-grid">
            <Avatar initial="L" tone="rose" speaking />
            <Avatar initial="J" tone="sky" />
            <Avatar initial="N" tone="peach" />
            <Avatar initial="S" tone="coral" />
          </div>
          <p className="lp-voice-now"><span className="lp-eq"><i /><i /><i /><i /></span>{t('home.scene.speaking', { name: 'Lena' })}</p>
        </article>
      </div>

      <div className="lp-float lp-scene-poll" style={{ '--tilt': '-3deg', '--delay': '-7s' } as CssVars}>
        <Poll />
      </div>

      <div className="lp-float lp-float-slow lp-scene-event" style={{ '--tilt': '4deg', '--delay': '-3.5s' } as CssVars} aria-hidden="true">
        <article className="lp-event-chip lp-glass">
          <span className="lp-event-icon"><Glyph name="calendar" /></span>
          <span className="lp-event-text"><b>{t('home.scene.raid')}</b><small>{t('home.scene.when')}</small></span>
          <span className="lp-stack"><Avatar initial="J" tone="sky" size="sm" /><Avatar initial="L" tone="rose" size="sm" /><Avatar initial="Y" tone="amber" size="sm" /></span>
          <span className="lp-event-going">{t('home.scene.going', { count: 6 })}</span>
        </article>
      </div>
    </div>
  );
}

const SYMBOLS: readonly GlyphName[] = ['moon', 'book', 'wrench', 'film', 'music', 'sparkle'];

/** The rule of a tag: 2 to 4 letters or digits (spaces.md, "Space tags"; `checkSpaceTag`). */
const TAG_RULE = /^[\p{L}\p{N}]{2,4}$/u;

/** The rule of an address in words: 3 to 32 small letters, digits or hyphens, a letter or digit at each end. */
const ADDRESS_RULE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/** Space tags to try: the letters and the symbol, worn at once by three members, and the address in words. */
export function TagMaker(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const host = useHost();
  const [text, setText] = useState('NITE');
  const [symbol, setSymbol] = useState<GlyphName>('moon');
  const [address, setAddress] = useState('night-shift');
  const tag = text.trim();
  const tagFits = TAG_RULE.test(tag);
  const addressFits = ADDRESS_RULE.test(address);
  const shown = tagFits ? tag : 'NITE';
  const wearers: readonly [string, string, Tone][] = [['Mara Lindqvist', 'M', 'lavender'], ['Jonas Weber', 'J', 'sky'], ['Lena Hoffmann', 'L', 'rose']];
  return (
    <div className="lp-vis lp-maker" role="group" aria-label={t('home.tags.try')}>
      <div className="lp-maker-stage lp-glass" data-arrive="">
        <p className="lp-card-label"><Glyph name="sparkle" />{t('home.tags.try')}</p>
        <div className="lp-maker-plate" key={`${shown}${symbol}`}><TagPlate symbol={symbol} text={shown} size="lg" /></div>
        <div className="lp-maker-controls">
          <label className="lp-field">
            <span>{t('home.tags.yourTag')}</span>
            <input
              value={text}
              maxLength={4}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!tagFits}
              aria-describedby="lp-tag-rule"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className="lp-symbols" role="radiogroup" aria-label={t('home.tags.symbol')}>
            {SYMBOLS.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={symbol === name}
                aria-label={t(`home.tags.symbols.${name as 'moon' | 'book' | 'wrench' | 'film' | 'music' | 'sparkle'}`)}
                tabIndex={symbol === name ? 0 : -1}
                onClick={() => setSymbol(name)}
                onKeyDown={(event) => radioKeys(event, SYMBOLS, symbol, setSymbol)}
              >
                <Glyph name={name} />
              </button>
            ))}
          </div>
        </div>
        <p id="lp-tag-rule" className="lp-rule" data-ok={tagFits ? 'true' : 'false'}><Glyph name={tagFits ? 'check' : 'plus'} />{t('home.tags.ruleTag')}</p>
      </div>
      <div className="lp-wearers lp-glass" data-arrive="" style={{ '--i': 1 } as CssVars}>
        <p className="lp-card-label">{t('home.tags.worn')}</p>
        {wearers.map(([name, initial, tone]) => (
          <p key={name} className="lp-wearer"><Avatar initial={initial} tone={tone} size="sm" /><span>{name}</span><TagPlate symbol={symbol} text={shown} /></p>
        ))}
      </div>
      <div className="lp-address lp-glass" data-arrive="" style={{ '--i': 2 } as CssVars}>
        <label className="lp-address-label" htmlFor="lp-address-input"><Glyph name="enter" />{t('home.tags.address')}</label>
        <p className="lp-address-line">
          <span className="lp-address-host">{host}</span>
          <span className="lp-address-path">{DEMO.joinPath}</span>
          <input
            id="lp-address-input"
            value={address}
            maxLength={32}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!addressFits}
            aria-describedby="lp-address-rule"
            onChange={(event) => setAddress(event.target.value.toLowerCase().replace(/\s+/g, '-'))}
          />
        </p>
        <p id="lp-address-rule" className="lp-rule" data-ok={addressFits ? 'true' : 'false'}><Glyph name={addressFits ? 'check' : 'plus'} />{t('home.tags.ruleAddress')}</p>
      </div>
    </div>
  );
}

const REACTIONS = [
  { key: 'fire', emoji: '🔥', count: 2 },
  { key: 'chart', emoji: '📈', count: 2 },
] as const;

/** Talk: a message whose reactions can be given, a reply to it, its thread, and a poll to vote in. */
export function TalkVisual(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const clock = useClock();
  const [given, setGiven] = useState<ReadonlySet<string>>(new Set(['fire']));
  const toggle = (key: string) => setGiven((now) => {
    const next = new Set(now);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return (
    <div className="lp-vis lp-talk-vis" role="group" aria-label={t('home.inside.tabs.talk.tab')}>
      <div className="lp-msg lp-glass">
        <Avatar initial="Y" tone="amber" size="sm" />
        <div>
          <p className="lp-msg-head">{DEMO.yuki}<time>{clock(16, 39)}</time></p>
          <p className="lp-msg-text">{t('home.inside.first')}</p>
          <p className="lp-reactions">
            {REACTIONS.map((reaction) => (
              <button key={reaction.key} type="button" aria-pressed={given.has(reaction.key)} onClick={() => toggle(reaction.key)}>
                <span aria-hidden="true">{reaction.emoji}</span>
                <b key={String(given.has(reaction.key))}>{reaction.count + (given.has(reaction.key) ? 1 : 0)}</b>
              </button>
            ))}
          </p>
        </div>
      </div>
      <div className="lp-msg lp-glass lp-msg-reply">
        <p className="lp-reply-to"><span aria-hidden="true" />{DEMO.yuki}</p>
        <Avatar initial="L" tone="rose" size="sm" />
        <div>
          <p className="lp-msg-head">{DEMO.lena}<TagPlate text="NITE" /><time>{clock(16, 54)}</time></p>
          <p className="lp-msg-text"><span className="lp-mention">{DEMO.yukiMention}</span> {t('home.inside.reply')}</p>
        </div>
      </div>
      <div className="lp-thread lp-glass">
        <Glyph name="thread" />
        <b>{t('home.inside.thread')}</b>
        <span>{t('home.inside.replies', { count: 7 })}</span>
        <span className="lp-stack"><Avatar initial="L" tone="rose" size="sm" /><Avatar initial="S" tone="coral" size="sm" /><Avatar initial="N" tone="peach" size="sm" /></span>
      </div>
      <Poll />
    </div>
  );
}

const SEATS: readonly { name: string; initial: string; tone: Tone }[] = [
  { name: 'Lena', initial: 'L', tone: 'rose' },
  { name: 'Jonas', initial: 'J', tone: 'sky' },
  { name: 'Noor', initial: 'N', tone: 'peach' },
  { name: 'Sam', initial: 'S', tone: 'coral' },
  { name: 'Theo', initial: 'T', tone: 'mint' },
];

/** Voice: a room with its people around it; whoever is chosen speaks, and one's own microphone mutes. */
export function VoiceVisual(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [speaker, setSpeaker] = useState('Lena');
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(true);
  return (
    <div className="lp-vis lp-voice-vis" role="group" aria-label={t('home.inside.tabs.voice.tab')}>
      <div className="lp-orbit">
        <div className="lp-orbit-ring" aria-hidden="true" />
        <div className="lp-orbit-core lp-glass">
          <Glyph name="speaker" />
          <b>{DEMO.voice}</b>
          <small aria-live="polite">{t('home.scene.speaking', { name: speaker })}</small>
        </div>
        <div className="lp-orbit-turn">
          {SEATS.map((seat, index) => (
            <span key={seat.name} className="lp-orbit-seat" style={{ '--a': `${index * 72}deg` } as CssVars}>
              <button type="button" aria-pressed={speaker === seat.name} aria-label={seat.name} onClick={() => setSpeaker(seat.name)}>
                <Avatar initial={seat.initial} tone={seat.tone} speaking={speaker === seat.name} />
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="lp-controls lp-glass">
        <button type="button" className="lp-control" aria-pressed={muted} aria-label={muted ? t('home.inside.unmute') : t('home.inside.mute')} onClick={() => setMuted((now) => !now)} data-off={muted ? 'true' : undefined}>
          <Glyph name={muted ? 'micOff' : 'mic'} />
        </button>
        <span className="lp-control" aria-hidden="true"><Glyph name="headphones" /></span>
        <span className="lp-control" aria-hidden="true"><Glyph name="camera" /></span>
        <button type="button" className="lp-control" aria-pressed={sharing} aria-label={t('home.inside.share')} onClick={() => setSharing((now) => !now)} data-on={sharing ? 'true' : undefined}>
          <Glyph name="screen" />
        </button>
        <span className="lp-control" aria-hidden="true"><Glyph name="music" /></span>
        <span className="lp-control lp-control-leave" aria-hidden="true"><Glyph name="leave" /></span>
      </div>
      <span className="lp-live lp-glass" aria-hidden="true"><i />{t('home.inside.watching')}</span>
    </div>
  );
}

/** Plan: an event to go to and be reminded of, and a forum post that stays. */
export function PlanVisual(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [going, setGoing] = useState(false);
  const [reminded, setReminded] = useState(false);
  return (
    <div className="lp-vis lp-plan-vis" role="group" aria-label={t('home.inside.tabs.plan.tab')}>
      <article className="lp-event lp-glass">
        <p className="lp-event-when">{t('home.inside.soon')}</p>
        <p className="lp-event-title">{t('home.scene.raid')}</p>
        <p className="lp-event-date">{t('home.inside.date')}</p>
        <div className="lp-event-foot">
          <span className="lp-stack">
            {going && <Avatar initial={t('home.inside.you').slice(0, 1)} tone="lavender" size="sm" className="lp-pop" />}
            <Avatar initial="J" tone="sky" size="sm" /><Avatar initial="L" tone="rose" size="sm" /><Avatar initial="N" tone="peach" size="sm" /><Avatar initial="S" tone="coral" size="sm" />
          </span>
          <span aria-live="polite">{t('home.scene.going', { count: going ? 7 : 6 })}</span>
        </div>
        <div className="lp-event-actions">
          <button type="button" className="lp-mini-btn lp-mini-primary" aria-pressed={going} onClick={() => setGoing((now) => !now)}>
            <Glyph name={going ? 'check' : 'plus'} />{going ? t('home.inside.goingYes') : t('home.inside.going')}
          </button>
          <button type="button" className="lp-mini-btn" aria-pressed={reminded} onClick={() => setReminded((now) => !now)}>
            <Glyph name={reminded ? 'check' : 'bell'} />{reminded ? t('home.inside.reminded') : t('home.inside.remind')}
          </button>
        </div>
      </article>
      <article className="lp-post lp-glass">
        <p className="lp-post-title">{t('home.inside.post')}</p>
        <p className="lp-post-tags"><span>{t('home.inside.postTags')}</span></p>
        <p className="lp-post-by"><Avatar initial="N" tone="peach" size="sm" />{DEMO.noor}</p>
      </article>
    </div>
  );
}

type SwitchKey = 'send' | 'attach' | 'pin' | 'kick';

/**
 * The demo space's roles with four of the permissions each grants, as Night Shift's owner set them
 * (the bits of its roles in `scripts/landing-shots`). They can be switched here; nothing is saved.
 */
const ROLES: readonly { name: string; tone: Tone; granted: number; switches: Record<SwitchKey, boolean> }[] = [
  { name: 'Raid Lead', tone: 'lavender', granted: 20, switches: { send: true, attach: true, pin: true, kick: true } },
  { name: 'Regulars', tone: 'mint', granted: 11, switches: { send: true, attach: true, pin: false, kick: false } },
  { name: 'New Blood', tone: 'sky', granted: 7, switches: { send: true, attach: false, pin: false, kick: false } },
  { name: '@everyone', tone: 'amber', granted: 6, switches: { send: true, attach: false, pin: false, kick: false } },
];

const SWITCHES: readonly SwitchKey[] = ['send', 'attach', 'pin', 'kick'];

/** Keep order: the space's roles, the switches of the one chosen, and the log. */
export function OrderVisual(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [chosen, setChosen] = useState(ROLES[0]?.name ?? '');
  const [switches, setSwitches] = useState<Record<string, Record<SwitchKey, boolean>>>(() => Object.fromEntries(ROLES.map((role) => [role.name, { ...role.switches }])));
  const role = ROLES.find((entry) => entry.name === chosen) ?? ROLES[0];
  const current = switches[chosen];
  const log: readonly [string, Tone, 'one' | 'two' | 'three'][] = [['M', 'lavender', 'one'], ['J', 'sky', 'two'], ['M', 'lavender', 'three']];
  const flip = (key: SwitchKey) => setSwitches((now) => ({ ...now, [chosen]: { ...now[chosen], [key]: !now[chosen]?.[key] } as Record<SwitchKey, boolean> }));
  const granted = (name: string) => {
    const base = ROLES.find((entry) => entry.name === name);
    if (!base) return 0;
    const changed = SWITCHES.reduce((sum, key) => sum + (Number(switches[name]?.[key] ?? false) - Number(base.switches[key])), 0);
    return base.granted + changed;
  };
  return (
    <div className="lp-vis lp-order-vis" role="group" aria-label={t('home.inside.tabs.order.tab')}>
      <article className="lp-roles lp-glass">
        <p className="lp-card-label">{t('home.inside.rolesTitle')}</p>
        <div role="radiogroup" aria-label={t('home.inside.rolesTitle')}>
          {ROLES.map((entry) => (
            <button
              key={entry.name}
              type="button"
              role="radio"
              aria-checked={chosen === entry.name}
              tabIndex={chosen === entry.name ? 0 : -1}
              className="lp-role"
              data-tone={entry.tone}
              onClick={() => setChosen(entry.name)}
              onKeyDown={(event) => radioKeys(event, ROLES.map((item) => item.name), chosen, setChosen)}
            >
              <i aria-hidden="true" />
              <span>{entry.name}</span>
              <small>{t('home.inside.granted', { count: granted(entry.name) })}</small>
            </button>
          ))}
        </div>
      </article>
      <article className="lp-switches lp-glass" aria-label={role?.name}>
        {SWITCHES.map((key) => (
          <p key={key} className="lp-switch-row">
            <span id={`lp-switch-${key}`}>{t(`home.inside.switch.${key}`)}</span>
            <button
              type="button"
              role="switch"
              className="lp-switch"
              aria-checked={current?.[key] ?? false}
              aria-labelledby={`lp-switch-${key}`}
              onClick={() => flip(key)}
            />
          </p>
        ))}
      </article>
      <article className="lp-log lp-glass">
        {log.map(([initial, tone, key]) => (
          <p key={key} className="lp-log-row"><Avatar initial={initial} tone={tone} size="sm" /><span>{t(`home.inside.log.${key}`)}</span></p>
        ))}
      </article>
    </div>
  );
}

/** Moving in: what a Discord server template and a bot of one's own bring across, into a space. */
export function MovingVisual(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const template = ['roles', 'categories', 'channels', 'permissions'] as const;
  const bot = ['emoji', 'stickers'] as const;
  return (
    <div className="lp-vis lp-moving-vis" aria-hidden="true">
      <article className="lp-move lp-glass">
        <p className="lp-card-label"><Glyph name="template" />{t('home.moving.from')}</p>
        {template.map((key, index) => (
          <p key={key} className="lp-move-row" data-arrive="" style={{ '--i': index } as CssVars}><Glyph name="check" />{t(`home.moving.items.${key}`)}</p>
        ))}
        <p className="lp-card-label lp-move-bot"><Glyph name="bot" />{t('home.moving.bot')}</p>
        {bot.map((key, index) => (
          <p key={key} className="lp-move-row" data-arrive="" style={{ '--i': index + 4 } as CssVars}><Glyph name="check" />{t(`home.moving.items.${key}`)}</p>
        ))}
      </article>
      <span className="lp-move-arrow"><Glyph name="arrow" /></span>
      <article className="lp-move-to lp-glass">
        <span className="lp-space-icon">{DEMO.spaceInitial}</span>
        <b>{DEMO.space}</b>
        <small>{t('home.moving.to')}</small>
      </article>
    </div>
  );
}

const FRAMES: readonly (FrameKind | 'none')[] = ['laurel', 'headphones', 'halo', 'none'];

/** Profiles to try on: three cards, the middle one taking the frame and the colour chosen under it. */
export function ProfileShowcase(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [frame, setFrame] = useState<FrameKind | 'none'>('laurel');
  const [tone, setTone] = useState<Tone>('lavender');
  return (
    <div className="lp-showcase">
      <div className="lp-cards" aria-hidden="true">
        <ProfileCard className="lp-card-left" name="Jonas Weber" handle="jonas" pronouns="he/him" initial="J" tone="sky" frame="headphones" bio={t('home.identity.bio.jonas')} role="Raid Lead" look="glass" />
        <ProfileCard key={`${frame}${tone}`} className="lp-card-mid" name="Mara Lindqvist" handle="mara" pronouns="she/her" initial="M" tone={tone} frame={frame === 'none' ? null : frame} bio={t('home.identity.bio.mara')} role={t('home.scene.owner')} look="electric" />
        <ProfileCard className="lp-card-right" name="Lena Hoffmann" handle="lena" pronouns="she/her" initial="L" tone="rose" frame="halo" bio={t('home.identity.bio.lena')} role="Raid Lead" look="minimal" />
      </div>
      <div className="lp-dresser lp-glass" role="group" aria-label={t('home.identity.try')} data-arrive="">
        <p className="lp-card-label"><Glyph name="sparkle" />{t('home.identity.try')}</p>
        <div className="lp-dresser-row">
          <span className="lp-dresser-name">{t('home.identity.frame')}</span>
          <div className="lp-segments" role="radiogroup" aria-label={t('home.identity.frame')}>
            {FRAMES.map((entry) => (
              <button
                key={entry}
                type="button"
                role="radio"
                aria-checked={frame === entry}
                tabIndex={frame === entry ? 0 : -1}
                onClick={() => setFrame(entry)}
                onKeyDown={(event) => radioKeys(event, FRAMES, frame, setFrame)}
              >
                {t(`home.identity.frames.${entry}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="lp-dresser-row">
          <span className="lp-dresser-name">{t('home.identity.colour')}</span>
          <div className="lp-swatches" role="radiogroup" aria-label={t('home.identity.colour')}>
            {TONES.map((entry) => (
              <button
                key={entry}
                type="button"
                role="radio"
                data-tone={entry}
                aria-checked={tone === entry}
                aria-label={t(`home.identity.tones.${entry}`)}
                tabIndex={tone === entry ? 0 : -1}
                onClick={() => setTone(entry)}
                onKeyDown={(event) => radioKeys(event, TONES, tone, setTone)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A bot's message with a card, as the app shows one: marked as a bot, its fields in columns. */
export function BotMessage(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const clock = useClock();
  return (
    <article className="lp-bot lp-glass" aria-hidden="true">
      <Avatar initial="B" tone="sky" size="sm" />
      <div>
        <p className="lp-msg-head">{DEMO.bot}<span className="lp-bot-mark">{t('home.bot.mark')}</span><time>{clock(17, 22)}</time></p>
        <p className="lp-msg-text">{t('home.bot.done')}</p>
        <div className="lp-bot-card">
          <p className="lp-bot-title">{t('home.bot.card')}</p>
          <p className="lp-bot-detail">{t('home.bot.detail')}</p>
          <dl>
            <div><dt>{t('home.bot.tests')}</dt><dd>{t('home.bot.testsValue')}</dd></div>
            <div><dt>{t('home.bot.coverage')}</dt><dd>87%</dd></div>
            <div><dt>{t('home.bot.took')}</dt><dd>{t('home.bot.tookValue')}</dd></div>
          </dl>
        </div>
      </div>
    </article>
  );
}
