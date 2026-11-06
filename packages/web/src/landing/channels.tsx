import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Glyph, type CssVars } from './parts';
import { PLAN_SPACE, type PersonId } from './planData';
import { Locked, Message, Reactions, RoomBar } from './rooms';

/**
 * The text rooms of the opening's stage (Stage.tsx) beside #general, each drawn as the app draws it and
 * each with what it is there for: raid-planning and the thread its fight notes went into, clips with an
 * upload hidden behind a spoiler, and patch-notes with a poll whose results stay hidden until one has
 * voted, as the app keeps them. Nothing is sent anywhere; a vote, a reaction or following the thread
 * lives in this page alone.
 */

/** The fight notes, as the thread of the pictures has them: seven replies to Jonas's plan. */
const REPLIES: readonly { who: PersonId; key: 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' }[] = [
  { who: 'lena', key: 'r1' },
  { who: 'sam', key: 'r2' },
  { who: 'lena', key: 'r3' },
  { who: 'diego', key: 'r4' },
  { who: 'lena', key: 'r5' },
  { who: 'noor', key: 'r6' },
  { who: 'mara', key: 'r7' },
];

/** Jonas's plan for Saturday, the message the thread grew out of. */
function RaidPlan(): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <>
      <p className="lp-demo-text"><strong>{t('stage.raid.title')}</strong></p>
      <ul className="lp-demo-bullets">
        <li>{t('stage.raid.tanks')}</li>
        <li>{t('stage.raid.healers')}</li>
        <li>{t('stage.raid.rest')}</li>
      </ul>
    </>
  );
}

/** raid-planning, and the thread the fight notes went into, which opens over the channel as the app's panel does. */
export function ThreadRoom({ following, onFollow }: { following: boolean; onFollow: (following: boolean) => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="lp-room-view">
        <div className="lp-demo-bar">
          <button type="button" className="lp-room-back" onClick={() => setOpen(false)} aria-label={t('stage.thread.back')}>
            <Glyph name="back" />
          </button>
          <Glyph name="thread" />
          <strong>{PLAN_SPACE.thread.name}</strong>
          <span>{t('stage.thread.replies', { count: REPLIES.length })}</span>
          <button type="button" className="lp-room-toggle" aria-pressed={following} onClick={() => onFollow(!following)}>
            <Glyph name={following ? 'check' : 'bell'} />
            {following ? t('stage.thread.following') : t('stage.thread.follow')}
          </button>
        </div>
        <div className="lp-room-body lp-room-feed">
          <Message who="jonas"><RaidPlan /></Message>
          <p className="lp-thread-divider lp-label">{t('stage.thread.replies', { count: REPLIES.length })}</p>
          {REPLIES.map((reply) => (
            <Message key={reply.key} who={reply.who}><p className="lp-demo-text">{t(`stage.thread.${reply.key}`)}</p></Message>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="lp-room-view">
      <RoomBar room="raid"><span>{t('stage.topics.raid')}</span></RoomBar>
      <div className="lp-room-body lp-room-feed">
        <Message who="jonas">
          <RaidPlan />
          {/* Signing up with a reaction is the space's third rule. */}
          <Reactions initial={[{ emoji: '✅', count: 6 }]} />
          <button type="button" className="lp-thread-chip" onClick={() => setOpen(true)}>
            <Glyph name="thread" />
            <strong>{PLAN_SPACE.thread.name}</strong>
            <span>{t('stage.thread.replies', { count: REPLIES.length })}</span>
          </button>
        </Message>
        <Message who="lena"><p className="lp-demo-text">{t('stage.raid.timeline')}</p></Message>
        <Message who="diego"><p className="lp-demo-text">{t('stage.raid.first')}</p></Message>
        <Message who="lena"><p className="lp-demo-text">{t('stage.raid.answer')}</p></Message>
      </div>
    </div>
  );
}

/** An upload as the app shows a video in a conversation: its frame and length, its name and size, and a spoiler's veil. */
function Clip({ name, megabytes, length, veiled, onReveal }: { name: string; megabytes: number; length: string; veiled?: boolean; onReveal?: () => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  return (
    <figure className="lp-clip" data-veiled={veiled ? 'true' : undefined}>
      <div className="lp-clip-frame" role="img" aria-label={t('stage.clips.video', { name })}>
        <i aria-hidden="true"><Glyph name="play" /></i>
        <span className="lp-mono" aria-hidden="true">{length}</span>
      </div>
      <figcaption>
        <span className="lp-mono">{name}</span>
        <span>{t('stage.clips.size', { value: megabytes })}</span>
      </figcaption>
      {veiled && onReveal && (
        <button type="button" className="lp-clip-veil" onClick={onReveal}>{t('stage.clips.spoiler')}</button>
      )}
    </figure>
  );
}

/** clips: what people uploaded, one of them behind a spoiler until the visitor lifts it. */
export function ClipsRoom(): React.JSX.Element {
  const { t } = useTranslation('landing');
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="lp-room-view">
      <RoomBar room="clips"><span>{t('stage.topics.clips')}</span></RoomBar>
      <div className="lp-room-body lp-room-feed">
        <Message who="sam">
          <p className="lp-demo-text">{t('stage.clips.sam')}</p>
          <Clip name="clutch-1v3.mp4" megabytes={18.4} length="0:42" />
          <Reactions initial={[{ emoji: '🔥', count: 4 }, { emoji: '😂', count: 2 }]} />
        </Message>
        <Message who="theo"><p className="lp-demo-text">{t('stage.clips.theo')}</p></Message>
        <Message who="yuki">
          <p className="lp-demo-text">{t('stage.clips.yuki')}</p>
          <Clip name="boss-phase-2.mp4" megabytes={31} length="1:15" veiled={!revealed} onReveal={() => setRevealed(true)} />
          <Reactions initial={[{ emoji: '👀', count: 3 }]} />
        </Message>
      </div>
    </div>
  );
}

/** The poll's answers and the votes they had before the visitor came, as the pictures' poll has them. */
export const POLL_OPTIONS = [
  { key: 'completely', votes: 1 },
  { key: 'little', votes: 2 },
  { key: 'skill', votes: 4 },
] as const;

export type PollChoice = (typeof POLL_OPTIONS)[number]['key'];

/** patch-notes and Lena's poll: the results stay hidden until the visitor has voted, so the first votes steer nobody. */
export function PollRoom({ agreed, onAgree, vote, onVote }: { agreed: boolean; onAgree: () => void; vote: PollChoice | null; onVote: (choice: PollChoice) => void }): React.JSX.Element {
  const { t } = useTranslation('landing');
  const question = useId();
  const total = POLL_OPTIONS.reduce((sum, option) => sum + option.votes, 0) + (vote ? 1 : 0);
  return (
    <div className="lp-room-view">
      <RoomBar room="patch"><span>{t('stage.topics.patch')}</span></RoomBar>
      <div className="lp-room-body lp-room-feed">
        <Message who="lena">
          <div className="lp-poll" role="group" aria-labelledby={question}>
            <p className="lp-poll-question" id={question}>{t('stage.poll.question')}</p>
            {POLL_OPTIONS.map((option) => {
              const label = t(`stage.poll.${option.key}`);
              if (!vote) {
                return <button key={option.key} type="button" className="lp-poll-option" disabled={!agreed} onClick={() => onVote(option.key)}>{label}</button>;
              }
              const count = option.votes + (vote === option.key ? 1 : 0);
              const share = count / total;
              return (
                <div key={option.key} className="lp-poll-result" data-mine={vote === option.key ? 'true' : undefined} style={{ '--share': `${Math.round(share * 100)}%` } as CssVars}>
                  <p>
                    <span>{vote === option.key && <Glyph name="check" />}{label}</span>
                    <span className="lp-mono">{t('stage.poll.share', { value: share })}</span>
                  </p>
                  <span className="lp-poll-votes lp-mono">{t('stage.poll.votes', { count })}</span>
                </div>
              );
            })}
            <p className="lp-poll-foot">
              {vote ? t('stage.poll.total', { count: total }) : t('stage.poll.hidden')}
              <span>{t('stage.poll.left')}</span>
            </p>
          </div>
        </Message>
      </div>
      {!agreed && <div className="lp-room-foot"><Locked text={t('stage.locked.vote')} onAgree={onAgree} /></div>}
    </div>
  );
}
