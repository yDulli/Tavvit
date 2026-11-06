import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Glyph, type CssVars } from './parts';
import { MEMBERS, PEOPLE, type RoomId } from './planData';
import { Locked, RoomBar } from './rooms';

/**
 * The rooms of the opening's stage (Stage.tsx) where a group does something together: movie night, a
 * voice room watching a video in step (docs/systems/watch-together.md), and the space's events. As in
 * the app, a video from another website loads only when one chooses to watch along, and a reaction
 * rises over the picture for a moment. Here no video loads at all, nothing plays, and the page says so.
 */

/** What Noor put on: an invented film, so the page names no one else's. */
const FILM = 'Fight Night: The Long Cut';

/** The reactions the watch bar offers, rising over the picture when chosen. */
const CHEERS = ['😂', '😮', '🔥', '👏'] as const;

/** How long a reaction stays over the picture, as the app lets one rise and fade. */
const RISE_MS = 1600;

/** movie-night: Noor is watching; the visitor may watch along, pause it for everyone and react. */
export function WatchRoom({ agreed, onAgree, watching, onWatch }: { agreed: boolean; onAgree: () => void; watching: boolean; onWatch: (watching: boolean) => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [playing, setPlaying] = useState(true);
  const [rising, setRising] = useState<readonly { id: number; emoji: string; x: number }[]>([]);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const cheer = (emoji: string) => {
    nextId.current += 1;
    const id = nextId.current;
    // Each a little to the side of the last, so several stay apart.
    const x = 18 + ((id * 37) % 64);
    setRising((current) => [...current, { id, emoji, x }]);
    timers.current.push(window.setTimeout(() => setRising((current) => current.filter((entry) => entry.id !== id)), RISE_MS));
  };

  const watchers: readonly { key: string; initial: string; colour: string; name: string }[] = [
    { key: 'noor', initial: PEOPLE.noor.initial, colour: MEMBERS.noor.avatar, name: MEMBERS.noor.name },
    ...(watching ? [{ key: 'you', initial: t('stage.you').charAt(0), colour: 'rgb(var(--violet))', name: t('stage.you') }] : []),
  ];

  return (
    <div className="lp-room-view">
      <RoomBar room="movie">
        {watching && <em className="lp-voice-connected">{t('stage.voice.connected')}</em>}
        <span>{t('stage.watch.label')}</span>
      </RoomBar>
      <div className="lp-room-body">
        <div className="lp-watch" data-playing={watching && playing ? 'true' : undefined}>
          <div className="lp-watch-screen">
            {watching ? (
              <>
                <p className="lp-watch-title">{FILM}</p>
                {!playing && <p className="lp-watch-paused lp-label">{t('stage.watch.paused')}</p>}
                {rising.map((entry) => (
                  <span key={entry.id} className="lp-watch-rise" style={{ '--x': `${entry.x}%` } as CssVars} aria-hidden="true">{entry.emoji}</span>
                ))}
              </>
            ) : (
              <div className="lp-watch-consent">
                <p className="lp-watch-title">{FILM}</p>
                <p>{t('stage.watch.consent')}</p>
                {agreed
                  ? <button type="button" className="lp-room-primary" onClick={() => onWatch(true)}><Glyph name="play" />{t('stage.watch.join')}</button>
                  : <Locked text={t('stage.locked.join')} onAgree={onAgree} />}
              </div>
            )}
          </div>
          {watching && (
            <div className="lp-watch-bar">
              <button type="button" className="lp-watch-play" onClick={() => setPlaying((current) => !current)} aria-label={playing ? t('stage.watch.pause') : t('stage.watch.play')}>
                <Glyph name={playing ? 'pause' : 'play'} />
              </button>
              <span className="lp-watch-state">{playing ? t('stage.watch.playing') : t('stage.watch.pausedBy')}</span>
              <span className="lp-watch-cheers">
                {CHEERS.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => cheer(emoji)} aria-label={t('stage.watch.react', { emoji })}>{emoji}</button>
                ))}
              </span>
            </div>
          )}
        </div>
        <ul className="lp-watchers" aria-label={t('stage.watch.label')}>
          {watchers.map((person) => (
            <li key={person.key}>
              <i style={{ background: person.colour }} aria-hidden="true">{person.initial}</i>
              {person.name}
            </li>
          ))}
        </ul>
      </div>
      {watching && (
        <div className="lp-room-foot">
          <button type="button" className="lp-voice-button lp-voice-leave" onClick={() => onWatch(false)}><Glyph name="leave" />{t('stage.voice.leave')}</button>
        </div>
      )}
      <p className="lp-room-note">{t('stage.watch.note')}</p>
    </div>
  );
}

/** The events: Saturday's raid, with going, a reminder, and the way to the voice room it meets in. */
export function EventRoom({ going, onGoing, reminder, onReminder, onGo }: { going: boolean; onGoing: (going: boolean) => void; reminder: boolean; onReminder: (reminder: boolean) => void; onGo: (room: RoomId) => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <div className="lp-room-view">
      <RoomBar room="events"><span>{t('stage.event.upcoming', { count: 1 })}</span></RoomBar>
      <div className="lp-room-body">
        <article className="lp-event">
          <p className="lp-label">{t('stage.event.soon')}</p>
          <h3 className="lp-event-title">{t('stage.event.title')}</h3>
          <p className="lp-event-when">{t('stage.event.when')}</p>
          <p className="lp-event-text">{t('stage.event.text')}</p>
          <p className="lp-event-count">{t('stage.event.going', { count: 6 + (going ? 1 : 0) })}</p>
          <div className="lp-event-actions">
            <button type="button" className="lp-voice-button" aria-pressed={going} onClick={() => onGoing(!going)}>
              <Glyph name="check" />
              {going ? t('stage.event.rsvped') : t('stage.event.rsvp')}
            </button>
            <button type="button" className="lp-voice-button" aria-pressed={reminder} onClick={() => onReminder(!reminder)}>
              <Glyph name="bell" />
              {reminder ? t('stage.event.reminded') : t('stage.event.remind')}
            </button>
            <button type="button" className="lp-voice-button" onClick={() => onGo('lounge')}>
              <Glyph name="speaker" />
              {t('stage.event.lounge')}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
