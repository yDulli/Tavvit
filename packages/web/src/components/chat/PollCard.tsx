import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MessageWithUser, User } from '@backspace/shared';
import { pollClosed } from '@backspace/shared/src/polls';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { getApiForOrigin, getChannelOrigin } from '../../stores/spaceStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { userDisplayName } from '../../utils/identity';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { MarkdownRenderer } from './MarkdownRenderer';

/** Time left in the unit that reads naturally: days, then hours, then minutes. */
function roughly(seconds: number): number {
  if (seconds >= 86_400) return Math.round(seconds / 86_400) * 86_400;
  if (seconds >= 3_600) return Math.round(seconds / 3_600) * 3_600;
  return Math.max(60, Math.round(seconds / 60) * 60);
}

function VotersDialog({ messageId, channelId, option, onClose }: {
  messageId: string;
  channelId: string;
  option: { id: string; label: string };
  onClose: () => void;
}) {
  const { t } = useTranslation('chat');
  const [voters, setVoters] = useState<User[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    getApiForOrigin(getChannelOrigin(channelId)).messages.pollVoters(messageId, option.id)
      .then((response) => { if (!stale) setVoters(response.voters); })
      .catch((err: unknown) => { if (!stale) setError(describeError(err)); });
    return () => { stale = true; };
  }, [messageId, channelId, option.id]);

  return (
    <Modal isOpen onClose={onClose} title={option.label} maxWidth="max-w-sm">
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      {voters?.length === 0 && <p className="py-4 text-center text-ui text-txt-tertiary">{t('poll.noVoters')}</p>}
      {voters && voters.length > 0 && (
        <ul className="max-h-[320px] overflow-y-auto scrollbar-thin">
          {voters.map((voter) => (
            <li key={voter.id} className="flex items-center gap-2.5 py-1.5">
              <Avatar src={voter.avatar} name={userDisplayName(voter)} size={24} user={voter} />
              <span className="min-w-0 truncate text-ui text-txt-primary">{userDisplayName(voter)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * A poll in the timeline. The count stays hidden until the reader has voted or the poll is
 * over, so the first votes do not steer the rest; who chose what is open to the channel,
 * which the card says before anyone votes.
 */
export function PollCard({ message, canEnd }: { message: MessageWithUser; canEnd: boolean }) {
  const { t } = useTranslation('chat');
  const { formatInterval, formatPercent, formatNumber } = useFormatters();
  const poll = message.poll;
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [votersOf, setVotersOf] = useState<{ id: string; label: string } | null>(null);
  const [, setTick] = useState(0);
  const endsAt = poll?.endsAt ?? null;

  // The card closes by itself at the end, for anyone looking at it then.
  useEffect(() => {
    if (endsAt === null) return;
    const wait = endsAt - Date.now();
    if (wait <= 0 || wait > 2_000_000_000) return;
    const timer = setTimeout(() => setTick((tick) => tick + 1), wait + 50);
    return () => clearTimeout(timer);
  }, [endsAt]);

  if (!poll) return null;

  const now = Date.now();
  const closed = pollClosed(poll, now);
  const myVotes = poll.myVotes ?? [];
  const showResults = closed || myVotes.length > 0;
  const client = () => getApiForOrigin(getChannelOrigin(message.channelId));

  const choose = async (optionId: string) => {
    if (closed || busy) return;
    let next: string[];
    if (myVotes.includes(optionId)) next = myVotes.filter((id) => id !== optionId);
    else next = poll.multiple ? [...myVotes, optionId] : [optionId];
    setBusy(true);
    try {
      const updated = await client().messages.votePoll(message.id, next);
      useChatStore.getState().applyPoll(message.channelId, message.id, updated);
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    setBusy(true);
    try {
      const updated = await client().messages.endPoll(message.id);
      useChatStore.getState().applyPoll(message.channelId, message.id, updated);
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
    } finally {
      setBusy(false);
      setConfirmEnd(false);
    }
  };

  const status = closed
    ? t('poll.ended')
    : poll.endsAt !== null
      ? t('poll.endsIn', { time: formatInterval(roughly((poll.endsAt - now) / 1000)) })
      : null;

  return (
    <div className="surface-card mt-1 max-w-[440px] rounded-lg p-3" data-poll="true">
      <div className="text-ui font-medium text-txt-primary [overflow-wrap:anywhere]">
        <MarkdownRenderer content={message.content ?? ''} channelId={message.channelId} />
      </div>
      {poll.multiple && !closed && <p className="mt-0.5 text-meta text-txt-tertiary">{t('poll.multiple')}</p>}

      <ul className="mt-2.5 flex flex-col gap-1.5">
        {poll.options.map((option) => {
          const mine = myVotes.includes(option.id);
          const percent = poll.voters > 0 ? (option.votes / poll.voters) * 100 : 0;
          return (
            <li key={option.id} className="group/option relative">
              <button
                type="button"
                onClick={() => void choose(option.id)}
                disabled={closed || busy}
                aria-pressed={mine}
                className="poll-option"
                data-mine={mine ? 'true' : undefined}
                style={showResults ? ({ '--poll-share': `${percent}%` } as React.CSSProperties) : undefined}
              >
                {mine && <Icon name="check" size={14} className="relative flex-shrink-0 text-accent-soft" />}
                <span className="relative min-w-0 flex-1 text-left text-ui text-txt-primary [overflow-wrap:anywhere]">{option.label}</span>
                {showResults && (
                  <span className="tabular relative flex-shrink-0 font-mono text-label text-txt-secondary">
                    {formatPercent(percent)}
                  </span>
                )}
              </button>
              {showResults && option.votes > 0 && (
                <button
                  type="button"
                  onClick={() => setVotersOf({ id: option.id, label: option.label })}
                  className="tabular mt-0.5 block font-mono text-label text-txt-tertiary hover:text-txt-primary"
                >
                  {t('poll.voteCount', { count: option.votes, value: formatNumber(option.votes) })}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-meta text-txt-tertiary">
          {t('poll.voters', { count: poll.voters, value: formatNumber(poll.voters) })}
          {status ? ` · ${status}` : ''}
        </p>
        {canEnd && !closed && (
          <button type="button" onClick={() => setConfirmEnd(true)} className="btn-quiet btn-sm">{t('poll.end')}</button>
        )}
      </div>
      {!closed && !showResults && <p className="mt-1 text-meta text-txt-tertiary">{t('poll.publicVotes')}</p>}

      {votersOf && (
        <VotersDialog messageId={message.id} channelId={message.channelId} option={votersOf} onClose={() => setVotersOf(null)} />
      )}
      <ConfirmDialog
        isOpen={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        onConfirm={end}
        title={t('poll.endTitle')}
        description={t('poll.endBody')}
        confirmLabel={t('poll.end')}
        variant="warning"
        loading={busy}
      />
    </div>
  );
}
