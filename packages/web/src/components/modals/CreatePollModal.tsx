import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { POLL_DURATIONS_HOURS, POLL_LIMITS } from '@backspace/shared/src/polls';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { getApiForOrigin, getChannelOrigin } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Toggle } from '../ui/Toggle';

const DEFAULT_DURATION_HOURS = 24;

function CreatePollForm({ channelId, onDone }: { channelId: string; onDone: () => void }) {
  const { t } = useTranslation(['chat', 'common']);
  const { formatInterval } = useFormatters();
  const fieldId = useId();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [duration, setDuration] = useState<string>(String(DEFAULT_DURATION_HOURS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filled = options.map((option) => option.trim()).filter(Boolean);
  const repeated = new Set(filled.map((option) => option.toLowerCase())).size !== filled.length;
  const ready = question.trim().length > 0 && filled.length >= POLL_LIMITS.OPTIONS_MIN && !repeated;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      await getApiForOrigin(getChannelOrigin(channelId)).channels.createPoll(channelId, {
        question: question.trim(),
        options: filled,
        multiple,
        durationHours: duration === 'none' ? null : Number(duration),
      });
      onDone();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div>
        <label htmlFor={`${fieldId}-question`} className="field-label">{t('chat:poll.create.question')}</label>
        <input
          id={`${fieldId}-question`}
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value.slice(0, POLL_LIMITS.QUESTION_MAX_LENGTH))}
          autoFocus
          className="input-standard w-full"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="field-label">{t('chat:poll.create.options')}</legend>
        {options.map((option, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              type="text"
              value={option}
              aria-label={t('chat:poll.create.optionLabel', { number: index + 1 })}
              onChange={(event) => {
                const value = event.target.value.slice(0, POLL_LIMITS.OPTION_MAX_LENGTH);
                setOptions((current) => current.map((item, at) => (at === index ? value : item)));
              }}
              className="input-standard min-w-0 flex-1"
            />
            {options.length > POLL_LIMITS.OPTIONS_MIN && (
              <button
                type="button"
                onClick={() => setOptions((current) => current.filter((_, at) => at !== index))}
                aria-label={t('chat:poll.create.removeOption', { number: index + 1 })}
                className="icon-btn flex-shrink-0"
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        ))}
        {options.length < POLL_LIMITS.OPTIONS_MAX && (
          <button type="button" onClick={() => setOptions((current) => [...current, ''])} className="btn-quiet btn-sm self-start">
            {t('chat:poll.create.addOption')}
          </button>
        )}
        {repeated && <p className="text-meta text-txt-danger">{t('chat:poll.create.repeated')}</p>}
      </fieldset>

      <div>
        <label htmlFor={`${fieldId}-duration`} className="field-label">{t('chat:poll.create.duration')}</label>
        <select
          id={`${fieldId}-duration`}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          className="input-standard w-full"
        >
          {POLL_DURATIONS_HOURS.map((hours) => (
            <option key={hours} value={hours}>{formatInterval(hours * 3600)}</option>
          ))}
          <option value="none">{t('chat:poll.create.noEnd')}</option>
        </select>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-ui text-txt-primary">{t('chat:poll.create.allowMultiple')}</span>
        <Toggle enabled={multiple} onChange={setMultiple} ariaLabel={t('chat:poll.create.allowMultiple')} />
      </label>

      <p className="text-meta text-txt-tertiary">{t('chat:poll.publicVotes')}</p>
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-quiet">{t('common:actions.cancel')}</button>
        <button type="submit" disabled={!ready || busy} aria-busy={busy} className="btn-primary">{t('chat:poll.create.submit')}</button>
      </div>
    </form>
  );
}

/** Asking a channel something. The server holds the rules; the form only keeps to them. */
export function CreatePollModal() {
  const { t } = useTranslation('chat');
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const channelId = modalData.channelId as string | undefined;
  const isOpen = activeModal === 'createPoll' && channelId !== undefined;

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title={t('poll.create.title')} maxWidth="max-w-md">
      {isOpen && channelId && <CreatePollForm key={channelId} channelId={channelId} onDone={closeModal} />}
    </Modal>
  );
}
