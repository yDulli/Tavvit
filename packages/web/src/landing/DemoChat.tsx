import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MEMBERS, ROLES } from './planData';
import { Locked } from './rooms';

/**
 * A channel to try on the product page: the visitor types, invented people answer. It runs in
 * this component alone, and that is what the page's note says: nothing is sent, nothing is kept
 * and no link is made of what someone types. It is drawn here and is no piece of the app, since
 * this page may not import the app (`landing.test.tsx`), so a change of the app's look has to
 * be followed here by hand.
 *
 * On the opening's stage (Stage.tsx) it is the room #general of the plan: `compact`, with no list of
 * channels or people of its own, since the plan and the frame around it are those, and `locked` until
 * the visitor has agreed to the space's rules, as the app holds back someone who has not
 * (`rules_not_accepted`): they may read, and the composer gives way to the rules.
 */

const SPACE_NAME = 'Night Shift';
const CHANNEL_NAME = 'general';
const TEXT_CHANNELS = [CHANNEL_NAME, 'clips', 'raid-planning'];
const MAX_LENGTH = 200;
/** What a long visit keeps: the oldest messages go, as they scroll out of sight anyway. */
const MAX_MESSAGES = 40;
const TYPING_AFTER_MS = 500;
const ANSWER_AFTER_MS = 1700;

/** Who speaks here: the demo community of the page's pictures (`scripts/landing-shots/seed.mjs`, planData.ts). */
const SPEAKERS = ['lena', 'sam', 'noor', 'theo', 'yuki'] as const;
type Person = (typeof SPEAKERS)[number];

function personOf(who: Person): { name: string; colour: string; role: string | undefined } {
  const member = MEMBERS[who];
  return { name: member.name, colour: member.avatar, role: member.role ? ROLES[member.role].color : undefined };
}

const SEED_KEYS = { sam: 'demo.seed.sam', lena: 'demo.seed.lena', noor: 'demo.seed.noor' } as const;
const ANSWERS = [
  { who: 'lena', key: 'demo.replies.lena', reaction: '👋' },
  { who: 'sam', key: 'demo.replies.sam', reaction: '🔥' },
  { who: 'noor', key: 'demo.replies.noor', reaction: '❤️' },
  { who: 'theo', key: 'demo.replies.theo', reaction: '😂' },
  { who: 'yuki', key: 'demo.replies.yuki', reaction: '📈' },
  { who: 'lena', key: 'demo.replies.end', reaction: '🙌' },
] as const;
type TextKey = (typeof SEED_KEYS)[keyof typeof SEED_KEYS] | (typeof ANSWERS)[number]['key'];

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/** A line of the demo: by a person with a key to the catalog, so it follows the language, or by the visitor. */
type Line = { id: number; reactions: Reaction[] } & ({ who: Person; key: TextKey } | { who: 'you'; text: string });

const SEED: readonly Line[] = [
  { id: 1, who: 'sam', key: SEED_KEYS.sam, reactions: [] },
  { id: 2, who: 'lena', key: SEED_KEYS.lena, reactions: [{ emoji: '👀', count: 2, mine: false }] },
  { id: 3, who: 'noor', key: SEED_KEYS.noor, reactions: [{ emoji: '👋', count: 3, mine: false }] },
];

const HEADER_ICON = 'M9 3 7 21M17 3l-2 18M4 8h17M3 16h17';

export interface DemoChatProps {
  onFirstMessage: () => void;
  /** Without its own list of channels and of people. */
  compact?: boolean;
  /** The visitor may read and not write until they agree; `onAgree` agrees for them. */
  locked?: { onAgree: () => void };
}

export function DemoChat({ onFirstMessage, compact = false, locked }: DemoChatProps): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [lines, setLines] = useState<readonly Line[]>(SEED);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState<Person | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const nextId = useRef(SEED.length + 1);
  const sent = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  // The list scrolls inside itself. `scrollIntoView` would move the page under someone reading it.
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines, typing]);

  const later = (ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  };

  const addLine = (line: Line) => {
    setLines((current) => [...current, line].slice(-MAX_MESSAGES));
  };

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const yours = nextId.current;
    nextId.current += 1;
    addLine({ id: yours, who: 'you', text, reactions: [] });
    setDraft('');
    if (sent.current === 0) onFirstMessage();
    const turn = sent.current;
    sent.current += 1;
    const react = (emoji: string) => {
      setLines((current) => current.map((line) => (line.id === yours ? { ...line, reactions: [{ emoji, count: 1, mine: false }] } : line)));
    };
    const answer = ANSWERS[turn];
    if (!answer) {
      // Everyone has had their say, and a welcome said twice would give the game away. They still listen.
      later(TYPING_AFTER_MS, () => react(ANSWERS[turn % ANSWERS.length]!.reaction));
      return;
    }
    later(TYPING_AFTER_MS, () => setTyping(answer.who));
    later(ANSWER_AFTER_MS, () => {
      setTyping(null);
      const id = nextId.current;
      nextId.current += 1;
      addLine({ id, who: answer.who, key: answer.key, reactions: [] });
      react(answer.reaction);
    });
  };

  const toggle = (lineId: number, emoji: string) => {
    setLines((current) => current.map((line) => (line.id !== lineId ? line : {
      ...line,
      reactions: line.reactions.map((reaction) => (reaction.emoji !== emoji ? reaction : {
        ...reaction,
        mine: !reaction.mine,
        count: reaction.count + (reaction.mine ? -1 : 1),
      })),
    })));
  };

  const side = (
    <div className="lp-demo-side" aria-hidden="true">
      <p className="lp-demo-space">{SPACE_NAME}</p>
      <p className="lp-demo-heading">{t('demo.channels')}</p>
      {TEXT_CHANNELS.map((channel) => (
        <p key={channel} className={channel === CHANNEL_NAME ? 'lp-demo-channel lp-demo-channel-on' : 'lp-demo-channel'}>
          <span>#</span>{channel}
        </p>
      ))}
    </div>
  );

  const people = (
    <div className="lp-demo-people" aria-hidden="true">
      <p className="lp-demo-heading">{t('demo.online')}</p>
      {SPEAKERS.map((key) => {
        const person = personOf(key);
        return (
          <p key={key} className="lp-demo-person">
            <span className="lp-demo-avatar" style={{ background: person.colour }}>{person.name.charAt(0)}<i /></span>
            <span style={{ color: person.role }}>{person.name}</span>
          </p>
        );
      })}
    </div>
  );

  const composer = locked ? (
    <Locked text={t('stage.locked.write')} onAgree={locked.onAgree} />
  ) : (
    <form className="lp-demo-form" onSubmit={send}>
      <input
        type="text"
        value={draft}
        maxLength={MAX_LENGTH}
        autoComplete="off"
        enterKeyHint="send"
        aria-label={t('demo.placeholder')}
        placeholder={t('demo.placeholder')}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" disabled={!draft.trim()} aria-label={t('demo.send')}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" /></svg>
      </button>
    </form>
  );

  return (
    <div className={compact ? 'lp-demo-app lp-demo-app-compact' : 'lp-demo-app'} role="group" aria-label={t('demo.label')}>
      {!compact && side}
      <div className="lp-demo-main">
        <div className="lp-demo-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d={HEADER_ICON} /></svg>
          <strong>{CHANNEL_NAME}</strong>
          <span>{t('demo.topic')}</span>
        </div>
        <div ref={list} className="lp-demo-list" role="log" aria-live="polite">
          {lines.map((line) => {
            const person = line.who === 'you' ? null : personOf(line.who);
            const name = person ? person.name : t('demo.you');
            return (
              <div key={line.id} className="lp-demo-line">
                <span className={person ? 'lp-demo-avatar' : 'lp-demo-avatar lp-demo-avatar-you'} style={person ? { background: person.colour } : undefined} aria-hidden="true">
                  {name.charAt(0)}
                </span>
                <div className="lp-demo-body">
                  <p className="lp-demo-name" style={person ? { color: person.role } : undefined}>{name}</p>
                  <p className="lp-demo-text">{line.who === 'you' ? line.text : t(line.key)}</p>
                  {line.reactions.length > 0 && (
                    <div className="lp-demo-reactions">
                      {line.reactions.map((reaction) => (
                        <button key={reaction.emoji} type="button" aria-pressed={reaction.mine} className="lp-demo-reaction" onClick={() => toggle(line.id, reaction.emoji)}>
                          {reaction.emoji} {reaction.count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="lp-demo-typing" aria-live="polite">{typing ? t('demo.typing', { name: MEMBERS[typing].name.split(' ')[0] }) : ''}</p>
        {composer}
      </div>
      {!compact && people}
    </div>
  );
}
