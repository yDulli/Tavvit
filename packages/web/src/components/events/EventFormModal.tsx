import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EVENT_LIMITS, type SpaceEvent, type SpaceEventRequest } from '@backspace/shared/src/events';
import { describeError } from '../../i18n/errors';
import { getApiForOrigin, useSpaceStore } from '../../stores/spaceStore';
import { Modal } from '../ui/Modal';

/** A moment as the value of a `datetime-local` field: the reader's own clock, to the minute. */
function toFieldValue(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const NEXT_HOUR_MS = 3_600_000;

function nextFullHour(now: number): number {
  return Math.ceil(now / NEXT_HOUR_MS) * NEXT_HOUR_MS;
}

interface EventFormProps {
  origin: string;
  spaceId: string;
  event: SpaceEvent | null;
  onDone: () => void;
}

function EventForm({ origin, spaceId, event, onDone }: EventFormProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const fieldId = useId();
  const channels = useSpaceStore((state) => state.channels);
  const places = channels.filter((channel) => channel.spaceId === spaceId && channel.type !== 'thread');
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [channelId, setChannelId] = useState(event?.channelId ?? '');
  const [startsAt, setStartsAt] = useState(toFieldValue(event?.startsAt ?? nextFullHour(Date.now())));
  const [endsAt, setEndsAt] = useState(event?.endsAt ? toFieldValue(event.endsAt) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startMoment = new Date(startsAt).getTime();
  const endMoment = endsAt ? new Date(endsAt).getTime() : null;
  const startInvalid = !Number.isFinite(startMoment) || startMoment <= Date.now();
  const endInvalid = endMoment !== null && (!Number.isFinite(endMoment) || endMoment <= startMoment);

  const submit = async (submitted: React.FormEvent) => {
    submitted.preventDefault();
    if (!title.trim() || startInvalid || endInvalid || saving) return;
    setSaving(true);
    setError('');
    const body: SpaceEventRequest = {
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      channelId: channelId || null,
      startsAt: startMoment,
      endsAt: endMoment,
    };
    try {
      const client = getApiForOrigin(origin);
      if (event) await client.events.update(event.id, body);
      else await client.events.create(spaceId, body);
      onDone();
    } catch (err) {
      setError(describeError(err));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(submitted) => void submit(submitted)} className="flex flex-col gap-4">
      <div>
        <label htmlFor={`${fieldId}-title`} className="field-label">{t('spaces:events.form.name')}</label>
        <input
          id={`${fieldId}-title`}
          type="text"
          value={title}
          onChange={(change) => setTitle(change.target.value.slice(0, EVENT_LIMITS.TITLE_MAX_LENGTH))}
          autoFocus
          className="input-standard w-full"
        />
      </div>

      <div className="grid gap-4 desktop:grid-cols-2">
        <div>
          <label htmlFor={`${fieldId}-start`} className="field-label">{t('spaces:events.form.start')}</label>
          <input
            id={`${fieldId}-start`}
            type="datetime-local"
            value={startsAt}
            onChange={(change) => setStartsAt(change.target.value)}
            aria-invalid={startInvalid}
            className="input-standard w-full"
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-end`} className="field-label">{t('spaces:events.form.end')}</label>
          <input
            id={`${fieldId}-end`}
            type="datetime-local"
            value={endsAt}
            onChange={(change) => setEndsAt(change.target.value)}
            aria-invalid={endInvalid}
            className="input-standard w-full"
          />
        </div>
      </div>
      {startInvalid && <p className="text-meta text-txt-danger">{t('spaces:events.form.startPast')}</p>}
      {endInvalid && <p className="text-meta text-txt-danger">{t('spaces:events.form.endBeforeStart')}</p>}

      <div>
        <label htmlFor={`${fieldId}-channel`} className="field-label">{t('spaces:events.form.channel')}</label>
        <select
          id={`${fieldId}-channel`}
          value={channelId}
          onChange={(change) => setChannelId(change.target.value)}
          className="input-standard w-full"
        >
          <option value="">{t('spaces:events.form.noChannel')}</option>
          {places.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor={`${fieldId}-location`} className="field-label">{t('spaces:events.form.location')}</label>
        <input
          id={`${fieldId}-location`}
          type="text"
          value={location}
          onChange={(change) => setLocation(change.target.value.slice(0, EVENT_LIMITS.LOCATION_MAX_LENGTH))}
          className="input-standard w-full"
        />
      </div>

      <div>
        <label htmlFor={`${fieldId}-description`} className="field-label">{t('spaces:events.form.description')}</label>
        <textarea
          id={`${fieldId}-description`}
          value={description}
          rows={3}
          onChange={(change) => setDescription(change.target.value.slice(0, EVENT_LIMITS.DESCRIPTION_MAX_LENGTH))}
          className="input-standard w-full resize-y"
        />
      </div>

      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-quiet">{t('common:actions.cancel')}</button>
        <button type="submit" disabled={!title.trim() || startInvalid || endInvalid || saving} aria-busy={saving} className="btn-primary">
          {event ? t('common:actions.save') : t('spaces:events.form.create')}
        </button>
      </div>
    </form>
  );
}

interface EventFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  origin: string;
  spaceId: string;
  /** The event to change, or null for a new one. */
  event: SpaceEvent | null;
}

export function EventFormModal({ isOpen, onClose, origin, spaceId, event }: EventFormModalProps) {
  const { t } = useTranslation('spaces');
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={event ? t('events.form.editTitle') : t('events.form.title')} maxWidth="max-w-lg" mobileStyle="fullscreen">
      {isOpen && <EventForm key={event?.id ?? 'new'} origin={origin} spaceId={spaceId} event={event} onDone={onClose} />}
    </Modal>
  );
}
