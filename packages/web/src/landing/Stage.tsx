import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServiceState } from '@backspace/shared/src/publicStatus.js';
import { ClipsRoom, PollRoom, ThreadRoom, type PollChoice } from './channels';
import { DemoChat } from './DemoChat';
import { EventRoom, WatchRoom } from './gatherings';
import { LOOKS, type Look } from './images';
import { MembersPanel, roomOf } from './members';
import { Glyph, Lines, MainButton, nextChoice, pad, type CssVars } from './parts';
import { Plan, roomName, type RoomSays } from './Plan';
import { PLAN_PEOPLE, PLAN_ROOMS, PLAN_SPACE, type PersonId, type RoomId } from './planData';
import { Invite, VoiceRoom, Welcome, type VoiceState } from './rooms';
import { useWalk, type Whereabouts } from './useWalk';

/**
 * The opening: Tavvit itself, on one screen, with the list of channels drawn as a floor plan
 * (docs/systems/landing.md, "The stage"). The visitor arrives at the door of Night Shift, the demo space
 * of the page's pictures, with an invite; choosing a room on the plan walks them there (useWalk.ts) and
 * opens it beside the plan, as the app opens a channel, each room with what it is for: the welcome and
 * its rules at the way in, #general to write in (DemoChat.tsx), the thread of raid-planning, clips with
 * a spoiler, the poll of patch-notes (channels.tsx), the lounge to drop into (rooms.tsx), movie night to
 * watch along and the events to go to (gatherings.tsx). The window's bar opens the member list
 * (members.tsx) and the looks, which the window takes on. Being outside, in but not yet agreed, and
 * agreed are the app's own three steps: someone who is not a member sees no room, a member who has not
 * agreed to required rules may read but not write, vote or talk (`rules_not_accepted`), and agreeing
 * opens the rest. Nothing leaves the page.
 */

/** Each language's list of what changed, fetched when needed: the page's script does not carry them. */
const CHANGELOGS = import.meta.glob<{ versions: Record<string, { title: string }> }>('../locales/*/changelog.json', { import: 'default' });

/** The rooms a member may only read until they agree to the space's rules: the text channels. */
const TEXT_ROOMS: ReadonlySet<RoomId> = new Set(PLAN_ROOMS.filter((room) => room.kind === 'text').map((room) => room.id));

/** Every room but the way in, which is all someone outside the space may see of it. */
const BEHIND_THE_DOOR: ReadonlySet<RoomId> = new Set(PLAN_ROOMS.filter((room) => room.id !== 'entrance').map((room) => room.id));

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

function wantsLessMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Rgb = readonly [number, number, number];

function rgbOf(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A colour as the app's tokens hold one: three numbers, for `rgb(var(--token))`. */
function triplet(colour: Rgb): string {
  return colour.map((part) => Math.round(Math.min(255, Math.max(0, part)))).join(' ');
}

const darker = (colour: Rgb, share: number): Rgb => [colour[0] * share, colour[1] * share, colour[2] * share];
const lighter = (colour: Rgb, share: number): Rgb => [colour[0] + (255 - colour[0]) * share, colour[1] + (255 - colour[1]) * share, colour[2] + (255 - colour[2]) * share];

/**
 * A look laid on the window: its surface in the app's steps of tone, darker for the frame and the
 * sidebar and lighter for what floats, and its accent where the app has its signal. The first look is
 * the page's own, so choosing it lays nothing on.
 */
function lookStyle(look: Look | undefined): CssVars | undefined {
  if (!look || look === LOOKS[0]) return undefined;
  const surface = rgbOf(look.surface);
  const accent = rgbOf(look.accent);
  return {
    '--bg-base': triplet(darker(surface, 0.7)),
    '--bg-channel': triplet(darker(surface, 0.85)),
    '--bg-members': triplet(darker(surface, 0.9)),
    '--bg-chat': triplet(surface),
    '--bg-elevated': triplet(lighter(surface, 0.07)),
    '--bg-input': triplet(darker(surface, 0.62)),
    '--accent-primary': triplet(accent),
    '--on-accent': '255 255 255',
    '--accent-primary-hover': triplet(darker(accent, 0.88)),
    '--violet': triplet(accent),
    '--violet-soft': triplet(lighter(accent, 0.3)),
  };
}

/**
 * What the rooms say while the visitor is about: the text room they stand in counts them, the lounge
 * counts them while they are in the call and movie night while they watch (wherever they stand, as a
 * call goes on while one reads a channel), and a room they have looked into is no longer new.
 */
function roomsSay(where: Whereabouts, inCall: boolean, watching: boolean, seen: ReadonlySet<RoomId>): Partial<Record<RoomId, RoomSays | null>> {
  const says: Partial<Record<RoomId, RoomSays | null>> = {};
  for (const room of PLAN_ROOMS) {
    if (room.state === 'unread' && seen.has(room.id)) says[room.id] = null;
    if (room.id === where && room.kind === 'text') says[room.id] = { state: 'here', count: room.people.length + 1 };
    if (room.id === 'lounge' && inCall) says[room.id] = { state: 'talking', count: room.people.length + 1 };
    if (room.id === 'movie' && watching) says[room.id] = { state: 'watching', count: room.people.length + 1 };
  }
  return says;
}

export function Stage({ registrationOpen, chat, version }: { registrationOpen: boolean; chat: ServiceState | null; version: string | null }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [where, setWhere] = useState<Whereabouts>('outside');
  const [agreed, setAgreed] = useState(false);
  const [seen, setSeen] = useState<ReadonlySet<RoomId>>(new Set());
  const [wrote, setWrote] = useState(false);
  const [voice, setVoice] = useState<VoiceState>({ joined: false, muted: false, camera: false });
  const [watching, setWatching] = useState(false);
  const [following, setFollowing] = useState(false);
  const [vote, setVote] = useState<PollChoice | null>(null);
  const [going, setGoing] = useState(false);
  const [reminder, setReminder] = useState(false);
  const [members, setMembers] = useState(false);
  const [found, setFound] = useState<PersonId | null>(null);
  const [looks, setLooks] = useState(false);
  const [look, setLook] = useState(0);
  const floor = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const swatches = useRef<(HTMLButtonElement | null)[]>([]);
  const marker = useWalk(floor, where);

  /** Where the room stands under the plan (a narrow window), it is brought into view. */
  const showPane = () => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1100px)').matches) {
      pane.current?.scrollIntoView({ block: 'nearest', behavior: wantsLessMotion() ? 'auto' : 'smooth' });
    }
  };
  const go = (room: RoomId) => {
    setWhere(room);
    setMembers(false);
    setFound(null);
    setSeen((current) => (current.has(room) ? current : new Set([...current, room])));
    showPane();
  };
  const agree = () => setAgreed(true);
  const toggleMembers = () => {
    setMembers((current) => !current);
    setFound(null);
    showPane();
  };

  const inside = where !== 'outside';
  const here = inside ? PLAN_ROOMS.find((room) => room.id === where) : undefined;
  const hereName = here ? roomName(here, t(`plan.kinds.${here.kind}`)) : null;
  const foundRoom = found ? roomOf(found) : null;
  const lit = new Set<RoomId>([foundRoom ?? (inside ? where : 'entrance')]);

  const room = (() => {
    switch (where) {
      case 'outside':
        return <Invite onEnter={() => go('entrance')} />;
      case 'entrance':
        return <Welcome agreed={agreed} onAgree={agree} onGo={go} />;
      case 'general':
        // Kept below once it has been opened, so the conversation is still there on coming back.
        return null;
      case 'raid':
        return <ThreadRoom following={following} onFollow={setFollowing} />;
      case 'clips':
        return <ClipsRoom />;
      case 'patch':
        return <PollRoom agreed={agreed} onAgree={agree} vote={vote} onVote={setVote} />;
      case 'lounge':
        return <VoiceRoom agreed={agreed} onAgree={agree} voice={voice} onChange={setVoice} />;
      case 'movie':
        return <WatchRoom agreed={agreed} onAgree={agree} watching={watching} onWatch={setWatching} />;
      case 'events':
        return <EventRoom going={going} onGoing={setGoing} reminder={reminder} onReminder={setReminder} onGo={go} />;
    }
  })();

  return (
    <section aria-labelledby="landing-title" className="lp-stage">
      <div className="lp-light lp-light-rings" aria-hidden="true" />
      <div className="lp-wrap lp-stage-in">
        <div className="lp-stage-top">
          <p className="lp-sheet-meta">
            <span className="lp-mono">{t('plan.block.sheet')} {pad(1)}</span>
            <span className="lp-label">{t('hero.kicker')}</span>
          </p>
          <News />
        </div>
        <div className="lp-stage-head">
          <h1 id="landing-title" className="lp-stage-title lp-ink"><Lines text={t('hero.title')} /></h1>
          <div className="lp-stage-aside">
            <p className="lp-lead">{t('hero.lead')}</p>
            <div className="lp-actions">
              <MainButton href={registrationOpen ? '/register' : '/login'}>{registrationOpen ? t('nav.register') : t('nav.login')}</MainButton>
              {/* The one desktop app there is, on Windows; everyone else is offered the way back in.
                  Both are in the page's HTML and the stylesheet shows one (`data-lp-os`, set before the first paint). */}
              <a className="lp-btn lp-btn-quiet lp-btn-lg lp-for-windows" href="/download"><Glyph name="download" />{t('anywhere.desktop.link')}</a>
              {registrationOpen && <a className="lp-btn lp-btn-quiet lp-btn-lg lp-not-windows" href="/login">{t('nav.login')}</a>}
            </div>
          </div>
        </div>

        <div className="lp-app" role="group" aria-label={t('stage.label')} style={lookStyle(LOOKS[look])}>
          <div className="lp-app-bar">
            <i className="lp-plan-icon" aria-hidden="true">{PLAN_SPACE.initials}</i>
            <strong>{PLAN_SPACE.name}</strong>
            <button type="button" className="lp-app-button" aria-pressed={members} onClick={toggleMembers}>
              <Glyph name="people" />
              {t('stage.people', { count: PLAN_PEOPLE + (inside ? 1 : 0) })}
            </button>
            <span className="lp-app-address lp-mono">{PLAN_SPACE.invite}</span>
            <button type="button" className="lp-app-button lp-app-look" aria-expanded={looks} aria-controls="lp-looks" onClick={() => setLooks((current) => !current)}>
              <Glyph name="palette" />
              <span>{t('stage.looks')}</span>
            </button>
          </div>
          {looks && (
            <div className="lp-app-looks" id="lp-looks" role="radiogroup" aria-label={t('themes.pick')}>
              {LOOKS.map((entry, index) => (
                <button
                  key={entry.key}
                  ref={(element) => { swatches.current[index] = element; }}
                  type="button"
                  role="radio"
                  aria-checked={index === look}
                  tabIndex={index === look ? 0 : -1}
                  className="lp-chip lp-swatch"
                  style={{ '--swatch': entry.surface, '--swatch-accent': entry.accent } as CssVars}
                  onClick={() => setLook(index)}
                  onKeyDown={(event) => {
                    const next = nextChoice(event.key, look, LOOKS.length);
                    if (next === null) return;
                    event.preventDefault();
                    setLook(next);
                    swatches.current[next]?.focus();
                  }}
                >
                  <i aria-hidden="true" />
                  {t(`themes.names.${entry.key}`)}
                </button>
              ))}
            </div>
          )}
          <div className="lp-app-body">
            <div className="lp-app-map">
              <Plan
                lit={lit}
                found={found}
                locked={inside ? undefined : BEHIND_THE_DOOR}
                readOnly={inside && !agreed ? TEXT_ROOMS : undefined}
                says={roomsSay(where, voice.joined, watching, seen)}
                interactive={{ onActivate: go, current: inside ? where : null }}
                floorRef={floor}
                overlay={(
                  <span ref={marker} className="lp-you" aria-hidden="true">
                    <i />
                    <b>{t('stage.you')}</b>
                  </span>
                )}
              />
              <p className="lp-app-hint lp-label">{t('plan.hint')}</p>
            </div>
            <div className="lp-app-room" ref={pane}>
              <p className="sr-only" aria-live="polite">{hereName ? t('stage.where.in', { room: hereName }) : t('stage.where.outside')}</p>
              {members && <MembersPanel inside={inside} here={inside ? where : null} found={found} onFind={setFound} />}
              {seen.has('general') && (
                <div className="lp-room-view" hidden={members || where !== 'general'}>
                  <DemoChat compact locked={agreed ? undefined : { onAgree: agree }} onFirstMessage={() => setWrote(true)} />
                </div>
              )}
              {!members && room}
              {!members && where === 'general' && registrationOpen && wrote && (
                <a className="lp-btn lp-btn-quiet lp-btn-sm lp-demo-cta" href="/register">{t('demo.cta')}<Glyph name="arrow" /></a>
              )}
            </div>
          </div>
        </div>

        <ul className="lp-facts">
          {(chat === 'ok' || chat === 'down') && (
            <li><a href="/status" data-state={chat}><i aria-hidden="true" />{chat === 'ok' ? t('life.ok') : t('life.down')}</a></li>
          )}
          {version && <li><a className="lp-mono" href="/changelog">{t('life.version', { version })}</a></li>}
          <li><span className="lp-mono">{t('figures.value', { value: 0 })}</span> {t('figures.ads')}</li>
          <li><span className="lp-mono">{t('figures.value', { value: 0 })}</span> {t('figures.trackers')}</li>
        </ul>
      </div>
    </section>
  );
}
