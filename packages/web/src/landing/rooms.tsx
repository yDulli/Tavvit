import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Glyph, type CssVars } from './parts';
import { KIND_GLYPHS, roomName } from './Plan';
import { MEMBERS, PEOPLE, PLAN_PEOPLE, PLAN_ROOMS, PLAN_SPACE, ROLES, type PersonId, type RoomId } from './planData';

/**
 * The rooms of the opening's stage (Stage.tsx), each drawn as the app draws it, in this page's own code
 * (the page may not import the app, `landing.test.tsx`): the invite at the door, the welcome with the
 * space's rules, a voice room, and the pieces the other rooms are made of (a message, its reactions,
 * what holds a member back until they agree to the rules). Nothing here sends, records or plays
 * anything: the voice room uses no microphone and no camera, and says so.
 */

/** A room's bar, as the app heads a channel: its icon, its name, and its topic or what is going on. */
export function RoomBar({ room, children }: { room: RoomId; children?: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const data = PLAN_ROOMS.find((entry) => entry.id === room);
  if (!data) return <div className="lp-demo-bar" />;
  return (
    <div className="lp-demo-bar">
      <Glyph name={KIND_GLYPHS[data.kind]} />
      <strong>{roomName(data, t(`plan.kinds.${data.kind}`))}</strong>
      {children}
    </div>
  );
}

/** What stands in for writing, voting or joining until the visitor agrees to the space's rules, with the way to agree. */
export function Locked({ text, onAgree }: { text: string; onAgree: () => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <div className="lp-demo-locked">
      <Glyph name="lock" />
      <span>{text}</span>
      <button type="button" onClick={onAgree}>{t('stage.locked.agree')}</button>
    </div>
  );
}

/** A message as the app shows one: the avatar, the name in its role's colour with the role's icon, and what was said. */
export function Message({ who, children }: { who: PersonId; children: React.ReactNode }): React.JSX.Element {
  const member = MEMBERS[who];
  const role = member.role ? ROLES[member.role] : null;
  return (
    <div className="lp-demo-line">
      <span className="lp-demo-avatar" style={{ background: member.avatar }} aria-hidden="true">{PEOPLE[who].initial}</span>
      <div className="lp-demo-body">
        <p className="lp-demo-name" style={role ? { color: role.color } : undefined}>
          {member.name}
          {role?.icon && <span className="lp-demo-role-icon" aria-hidden="true">{role.icon}</span>}
        </p>
        {children}
      </div>
    </div>
  );
}

/** A message's reactions, each one the visitor may add or take back, as the app counts them. */
export function Reactions({ initial }: { initial: readonly { emoji: string; count: number }[] }): React.JSX.Element {
  const [mine, setMine] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className="lp-demo-reactions">
      {initial.map((reaction) => {
        const pressed = mine.has(reaction.emoji);
        return (
          <button
            key={reaction.emoji}
            type="button"
            aria-pressed={pressed}
            className="lp-demo-reaction"
            onClick={() => setMine((current) => {
              const next = new Set(current);
              if (pressed) next.delete(reaction.emoji);
              else next.add(reaction.emoji);
              return next;
            })}
          >
            {reaction.emoji} {reaction.count + (pressed ? 1 : 0)}
          </button>
        );
      })}
    </div>
  );
}

/** At the door: the invite a link opens, as the app's join page shows it. */
export function Invite({ onEnter }: { onEnter: () => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <div className="lp-room-view lp-invite">
      <div className="lp-invite-card">
        <p className="lp-label">{t('stage.invite.label')}</p>
        <i className="lp-invite-icon" aria-hidden="true">{PLAN_SPACE.initials}</i>
        <h3 className="lp-invite-name">{PLAN_SPACE.name}</h3>
        <p className="lp-invite-text">{t('stage.welcome.description')}</p>
        <p className="lp-invite-facts">
          <span className="lp-mono">{PLAN_SPACE.invite}</span>
          <span>{t('stage.people', { count: PLAN_PEOPLE })}</span>
        </p>
        <button type="button" className="lp-room-primary" onClick={onEnter}>
          {t('stage.invite.enter')}
          <Glyph name="arrow" />
        </button>
      </div>
      <p className="lp-room-note">{t('stage.invite.note')}</p>
    </div>
  );
}

/** The way in: the space's welcome, its rules, where to start, and agreeing, which opens the rooms to writing. */
export function Welcome({ agreed, onAgree, onGo }: { agreed: boolean; onAgree: () => void; onGo: (room: RoomId) => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const rules = [t('stage.welcome.rule1'), t('stage.welcome.rule2'), t('stage.welcome.rule3')];
  const start: readonly RoomId[] = ['general', 'raid'];
  return (
    <div className="lp-room-view">
      <RoomBar room="entrance"><span>{t('plan.states.rules')}</span></RoomBar>
      <div className="lp-room-body lp-welcome">
        <h3 className="lp-welcome-title">{t('stage.welcome.title')}</h3>
        <p className="lp-welcome-text">{t('stage.welcome.description')}</p>
        <p className="lp-label">{t('stage.welcome.rules')}</p>
        <ol className="lp-welcome-rules">
          {rules.map((rule) => <li key={rule}>{rule}</li>)}
        </ol>
        <p className="lp-label">{t('stage.welcome.start')}</p>
        <div className="lp-welcome-start">
          {start.map((id) => {
            const room = PLAN_ROOMS.find((entry) => entry.id === id);
            if (!room) return null;
            return (
              <button key={id} type="button" className="nav-item" onClick={() => onGo(id)}>
                <Glyph name={KIND_GLYPHS[room.kind]} />
                {roomName(room, t(`plan.kinds.${room.kind}`))}
              </button>
            );
          })}
        </div>
      </div>
      <div className="lp-room-foot">
        {agreed ? (
          <p className="lp-welcome-agreed" role="status"><Glyph name="check" />{t('stage.welcome.agreed')}</p>
        ) : (
          <button type="button" className="lp-room-primary" onClick={onAgree}>{t('stage.welcome.agree')}</button>
        )}
      </div>
    </div>
  );
}

/** The two in the lounge before the visitor, as the pictures' seed has them: Diego listening, Mara speaking. */
const LOUNGE: readonly { who: PersonId; name: string; speaking?: boolean }[] = [
  { who: 'diego', name: 'Diego Ramos' },
  { who: 'mara', name: 'Mara Lindqvist', speaking: true },
];

export interface VoiceState {
  joined: boolean;
  muted: boolean;
  camera: boolean;
}

/** The lounge: a voice room to drop into, with the call's own controls. No microphone or camera is touched. */
export function VoiceRoom({ agreed, onAgree, voice, onChange }: { agreed: boolean; onAgree: () => void; voice: VoiceState; onChange: (next: VoiceState) => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const count = LOUNGE.length + (voice.joined ? 1 : 0);
  return (
    <div className="lp-room-view">
      <RoomBar room="lounge">
        {voice.joined && <em className="lp-voice-connected">{t('stage.voice.connected')}</em>}
        <span>{t('stage.voice.inRoom', { count })}</span>
      </RoomBar>
      <div className="lp-room-body">
        <ul className="lp-voice-tiles">
          {LOUNGE.map((person) => (
            <li key={person.who} className="lp-voice-tile" data-speaking={person.speaking ? 'true' : undefined}>
              <i style={{ '--who': PEOPLE[person.who].color } as CssVars} aria-hidden="true">{PEOPLE[person.who].initial}</i>
              <span>{person.name}{person.speaking && <span className="sr-only">, {t('stage.voice.speaking')}</span>}</span>
            </li>
          ))}
          {voice.joined && (
            <li className="lp-voice-tile lp-voice-you" data-camera={voice.camera ? 'true' : undefined}>
              <i aria-hidden="true">{t('stage.you').charAt(0)}</i>
              <span>{t('stage.you')}</span>
              {voice.camera && <em className="lp-voice-badge"><Glyph name="camera" />{t('stage.voice.camera')}</em>}
              {voice.muted && <em className="lp-voice-muted" title={t('stage.voice.muted')}><Glyph name="micOff" /><span className="sr-only">{t('stage.voice.muted')}</span></em>}
            </li>
          )}
        </ul>
      </div>
      <div className="lp-room-foot lp-voice-controls">
        {!agreed ? (
          <Locked text={t('stage.locked.join')} onAgree={onAgree} />
        ) : !voice.joined ? (
          <button type="button" className="lp-room-primary" onClick={() => onChange({ ...voice, joined: true })}>
            <Glyph name="speaker" />
            {t('stage.voice.join')}
          </button>
        ) : (
          <>
            <button type="button" className="lp-voice-button" aria-pressed={voice.muted} onClick={() => onChange({ ...voice, muted: !voice.muted })}>
              <Glyph name={voice.muted ? 'micOff' : 'mic'} />
              {voice.muted ? t('stage.voice.unmute') : t('stage.voice.mute')}
            </button>
            <button type="button" className="lp-voice-button" aria-pressed={voice.camera} onClick={() => onChange({ ...voice, camera: !voice.camera })}>
              <Glyph name="camera" />
              {voice.camera ? t('stage.voice.cameraOff') : t('stage.voice.cameraOn')}
            </button>
            <button type="button" className="lp-voice-button lp-voice-leave" onClick={() => onChange({ joined: false, muted: false, camera: false })}>
              <Glyph name="leave" />
              {t('stage.voice.leave')}
            </button>
          </>
        )}
      </div>
      <p className="lp-room-note">{t('stage.voice.note')}</p>
    </div>
  );
}
