import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { SpaceEvent } from '@backspace/shared/src/events';
import type { User } from '@backspace/shared';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { useAuthStore } from '../../stores/authStore';
import { eventSpaceKey, useEventStore } from '../../stores/eventStore';
import { getApiForOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { saveEventToCalendar } from '../../utils/eventCalendar';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { joinVoiceChannel } from '../../utils/voice';
import { useVoiceStore } from '../../stores/voiceStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';
import { EventFormModal } from './EventFormModal';
import { ChannelIcon } from '../ui/ChannelIcon';

/** Which instance hosts a space, as the client knows it. */
export function useSpaceOrigin(spaceId: string): string {
  return useSpaceStore((state) => state.spaces.find((space) => space.id === spaceId)?._instanceOrigin ?? '');
}

interface EventCardProps {
  event: SpaceEvent;
  origin: string;
  canManage: boolean;
  past: boolean;
  onEdit: (event: SpaceEvent) => void;
}

function EventCard({ event, origin, canManage, past, onEdit }: EventCardProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatDateTime, formatTime, formatNumber, formatRelativeDay } = useFormatters();
  const navigate = useNavigate();
  const addToast = useUIStore((state) => state.addToast);
  const channel = useSpaceStore((state) => (event.channelId ? state.channels.find((item) => item.id === event.channelId) : undefined));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [attendees, setAttendees] = useState<User[] | null>(null);

  const answer = async (going: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const client = getApiForOrigin(origin);
      const updated = going ? await client.events.rsvp(event.id) : await client.events.unrsvp(event.id);
      useEventStore.getState().applyUpdate(origin, updated);
      setAttendees(null);
    } catch (err) {
      addToast(describeError(err), 'warning');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirming(false);
    try {
      await getApiForOrigin(origin).events.remove(event.id);
      useEventStore.getState().applyDelete(origin, event.spaceId, event.id);
    } catch (err) {
      addToast(describeError(err), 'warning');
    }
  };

  const showAttendees = async () => {
    if (attendees) {
      setAttendees(null);
      return;
    }
    try {
      const { attendees: list } = await getApiForOrigin(origin).events.attendees(event.id);
      setAttendees(list);
    } catch (err) {
      addToast(describeError(err), 'warning');
    }
  };

  const goToChannel = () => {
    if (!channel) return;
    const ui = useUIStore.getState();
    if (channel.type === 'voice') {
      const connectFn = useVoiceStore.getState().connectFn;
      joinVoiceChannel(channel.id, connectFn ?? undefined);
      if (ui.isMobile) {
        ui.pushMobileScreen('voice-full');
        return;
      }
    }
    if (ui.isMobile) {
      ui.pushMobileScreen('channel-chat', { channelId: channel.id, spaceId: event.spaceId });
      return;
    }
    navigate(`/channels/${event.spaceId}/${channel.id}`);
  };

  const sameDay = event.endsAt !== null && new Date(event.endsAt).toDateString() === new Date(event.startsAt).toDateString();
  const when = event.endsAt === null
    ? formatDateTime(event.startsAt)
    : t('spaces:events.range', { start: formatDateTime(event.startsAt), end: sameDay ? formatTime(event.endsAt) : formatDateTime(event.endsAt) });
  const place = event.location ?? channel?.name ?? null;

  return (
    <li className="surface-card p-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="label-mono mb-1">{past ? t('spaces:events.ended') : formatRelativeDay(event.startsAt)}</p>
          <h2 className="text-lead text-txt-primary break-words">{event.title}</h2>
          <p className="mt-1 text-ui text-txt-secondary">{when}</p>
          {event.location && <p className="mt-0.5 text-ui text-txt-secondary break-words">{event.location}</p>}
        </div>
        {!past && (
          <button
            type="button"
            onClick={() => void answer(!event.amGoing)}
            disabled={busy}
            aria-busy={busy}
            aria-pressed={event.amGoing === true}
            className={event.amGoing ? 'btn-outline btn-sm' : 'btn-primary btn-sm'}
          >
            {event.amGoing && <Icon name="check" size={14} />}
            {event.amGoing ? t('spaces:events.going') : t('spaces:events.iAmGoing')}
          </button>
        )}
      </div>

      {event.description && <p className="mt-3 whitespace-pre-wrap break-words text-body text-txt-secondary">{event.description}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => void showAttendees()} aria-expanded={attendees !== null} className="btn-quiet btn-sm">
          {t('spaces:events.goingCount', { count: event.going, formatted: formatNumber(event.going) })}
        </button>
        {channel && !past && (
          <button type="button" onClick={goToChannel} className="btn-quiet btn-sm">
            <ChannelIcon type={channel.type} icon={channel.icon} size={14} />
            {channel.type === 'voice' ? t('spaces:events.joinVoice', { channel: channel.name }) : t('spaces:events.openChannel', { channel: channel.name })}
          </button>
        )}
        {!past && (
          <button type="button" onClick={() => saveEventToCalendar(event, place)} className="btn-quiet btn-sm">
            <Icon name="download" size={14} />
            {t('spaces:events.addToCalendar')}
          </button>
        )}
        {canManage && (
          <span className="ml-auto flex items-center gap-1">
            {!past && (
              <button type="button" onClick={() => onEdit(event)} className="icon-btn" title={t('common:actions.edit')} aria-label={t('common:actions.edit')}>
                <Icon name="edit" size={14} />
              </button>
            )}
            <button type="button" onClick={() => setConfirming(true)} className="icon-btn" title={t('spaces:events.remove')} aria-label={t('spaces:events.remove')}>
              <Icon name="trash" size={14} />
            </button>
          </span>
        )}
      </div>

      {attendees && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border-soft pt-2 text-meta text-txt-secondary">
          {attendees.length === 0 && <li>{t('spaces:events.nobodyYet')}</li>}
          {attendees.map((person) => <li key={person.id}>{person.displayName ?? person.username}</li>)}
        </ul>
      )}

      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void remove()}
        title={t('spaces:events.removeTitle')}
        description={t('spaces:events.removeBody', { title: event.title })}
        confirmLabel={t('spaces:events.remove')}
        variant="danger"
      />
    </li>
  );
}

/** A space's events: what is coming up, who is going, and what ended in the last day. */
export function SpaceEventsView({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces']);
  const origin = useSpaceOrigin(spaceId);
  const events = useEventStore((state) => state.bySpace.get(eventSpaceKey(origin, spaceId)));
  const permissions = useSpaceStore((state) => state.spacePermissions.get(spaceId));
  const myRowId = useAuthStore((state) => state.user?.id);
  const canManageEvents = hasPermissionBit(permissions, PermissionBits.MANAGE_EVENTS);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ open: boolean; event: SpaceEvent | null }>({ open: false, event: null });

  useEffect(() => {
    setError('');
    useEventStore.getState().load(origin, spaceId).catch((err: unknown) => setError(describeError(err)));
  }, [origin, spaceId]);

  const now = Date.now();
  const hasEnded = (event: SpaceEvent) => (event.endsAt ?? event.startsAt) < now;
  const upcoming = (events ?? []).filter((event) => !hasEnded(event));
  const past = (events ?? []).filter(hasEnded);
  const canManage = (event: SpaceEvent) => canManageEvents || (origin === '' && event.createdBy === myRowId);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-ui text-txt-secondary">{t('spaces:events.intro')}</p>
          {canManageEvents && (
            <button type="button" onClick={() => setForm({ open: true, event: null })} className="btn-primary btn-sm flex-shrink-0">
              <Icon name="plus" size={14} />
              {t('spaces:events.create')}
            </button>
          )}
        </div>

        {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

        {events && upcoming.length === 0 && past.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon name="calendar" size={20} /></div>
            <p className="empty-state-title">{t('spaces:events.emptyTitle')}</p>
            <p className="empty-state-body">{canManageEvents ? t('spaces:events.emptyManage') : t('spaces:events.emptyBody')}</p>
          </div>
        )}

        {upcoming.length > 0 && (
          <ul className="flex flex-col gap-3">
            {upcoming.map((event) => (
              <EventCard key={event.id} event={event} origin={origin} canManage={canManage(event)} past={false} onEdit={(item) => setForm({ open: true, event: item })} />
            ))}
          </ul>
        )}

        {past.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="label-mono">{t('spaces:events.pastHeading')}</h2>
            <ul className="flex flex-col gap-3">
              {past.map((event) => (
                <EventCard key={event.id} event={event} origin={origin} canManage={canManage(event)} past onEdit={(item) => setForm({ open: true, event: item })} />
              ))}
            </ul>
          </section>
        )}
      </div>

      <EventFormModal
        isOpen={form.open}
        onClose={() => setForm({ open: false, event: null })}
        origin={origin}
        spaceId={spaceId}
        event={form.event}
      />
    </div>
  );
}

/** The events as a page of the space, in place of a channel. */
export function SpaceEventsPage({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation('spaces');
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="panel-bar flex h-12 flex-shrink-0 items-center gap-2 px-4">
        <Icon name="calendar" size={16} className="text-txt-tertiary" />
        <h1 className="truncate text-body text-txt-primary">{t('events.title')}</h1>
      </header>
      <SpaceEventsView spaceId={spaceId} />
    </div>
  );
}
