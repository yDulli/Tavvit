import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANNOUNCEMENT_LIMITS, type Announcement, type AnnouncementTone } from '@backspace/shared/src/adminConsole';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { useAnnouncementStore } from '../../stores/announcementStore';
import { announcementClass } from '../ui/AnnouncementBar';
import { Icon } from '../ui/Icon';
import { LoadingSpinner } from '../ui/LoadingSpinner';

/** How long one may be set to run by itself, in hours; null runs until it is ended. */
const DURATIONS = [null, 1, 24, 168] as const;
type Duration = (typeof DURATIONS)[number];

function isRunning(announcement: Announcement, now: number): boolean {
  return announcement.endedAt === null && (announcement.endsAt === null || announcement.endsAt > now);
}

/**
 * What the operator says to everyone signed in, on a banner above the app (maintenance, a
 * change people should know about). It goes out at once to whoever is connected, and is in
 * the audit log with its words.
 */
export function AnnouncementsSection() {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const formId = useId();
  const reload = useAnnouncementStore((s) => s.load);
  const [list, setList] = useState<Announcement[] | null>(null);
  const [body, setBody] = useState('');
  const [tone, setTone] = useState<AnnouncementTone>('info');
  const [duration, setDuration] = useState<Duration>(null);
  const [onStatusPage, setOnStatusPage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setList((await api.admin.announcements()).announcements);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  const running = list?.filter((entry) => isRunning(entry, now)) ?? [];
  const past = list?.filter((entry) => !isRunning(entry, now)) ?? [];
  const valid = body.trim().length >= ANNOUNCEMENT_LIMITS.BODY_MIN_LENGTH;

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api.admin.createAnnouncement({ body: body.trim(), tone, durationHours: duration, onStatusPage });
      setBody('');
      setOnStatusPage(false);
      await load();
      void reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const end = async (id: string) => {
    setError('');
    try {
      await api.admin.endAnnouncement(id);
      await load();
      void reload();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const durationLabel = (entry: Duration) => (entry === null ? t('admin:console.announcements.untilEnded') : f.formatInterval(entry * 3600));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t('admin:console.sections.announcements')}</h2>
        <p className="mt-1 max-w-[640px] text-meta leading-snug text-txt-tertiary">{t('admin:console.announcements.description')}</p>
      </div>

      <section className="surface-card space-y-3 rounded-lg p-4" aria-label={t('admin:console.announcements.new')}>
        <div>
          <label htmlFor={`${formId}-body`} className="field-label">{t('admin:console.announcements.message')}</label>
          <textarea
            id={`${formId}-body`}
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, ANNOUNCEMENT_LIMITS.BODY_MAX_LENGTH))}
            rows={3}
            placeholder={t('admin:console.announcements.placeholder')}
            className="input-standard w-full resize-none"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={`${formId}-tone`} className="field-label">{t('admin:console.announcements.tone')}</label>
            <select id={`${formId}-tone`} value={tone} onChange={(event) => setTone(event.target.value === 'warning' ? 'warning' : 'info')} className="input-standard">
              <option value="info">{t('admin:console.announcements.tones.info')}</option>
              <option value="warning">{t('admin:console.announcements.tones.warning')}</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${formId}-duration`} className="field-label">{t('admin:console.announcements.duration')}</label>
            <select
              id={`${formId}-duration`}
              value={duration === null ? '' : String(duration)}
              onChange={(event) => {
                const next = DURATIONS.find((entry) => (entry === null ? '' : String(entry)) === event.target.value);
                if (next !== undefined) setDuration(next);
              }}
              className="input-standard"
            >
              {DURATIONS.map((entry) => <option key={entry ?? 'open'} value={entry === null ? '' : String(entry)}>{durationLabel(entry)}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-ui text-txt-secondary">
            <input type="checkbox" checked={onStatusPage} onChange={(event) => setOnStatusPage(event.target.checked)} />
            {t('admin:console.announcements.onStatusPage')}
          </label>
          <button type="button" onClick={() => void send()} disabled={!valid || busy} aria-busy={busy} className="btn-primary ml-auto">
            {t('admin:console.announcements.send')}
          </button>
        </div>
        {valid && (
          <div>
            <p className="field-label">{t('admin:console.announcements.preview')}</p>
            <div className={`${announcementClass(tone)} rounded-md`}>
              <Icon name={tone === 'warning' ? 'alert' : 'info'} size={14} className="flex-shrink-0" />
              <span className="min-w-0 break-words">{body.trim()}</span>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      </section>

      {!list && !error && <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>}

      {list && (
        <section aria-label={t('admin:console.announcements.running')}>
          <h3 className="label-mono mb-2">{t('admin:console.announcements.running')}</h3>
          {running.length === 0 ? (
            <p className="text-ui text-txt-tertiary">{t('admin:console.announcements.noneRunning')}</p>
          ) : (
            <ul className="surface-card divide-y divide-border-hard rounded-lg">
              {running.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 px-3 py-2.5">
                  <Icon name={entry.tone === 'warning' ? 'alert' : 'info'} size={15} className="mt-0.5 flex-shrink-0 text-txt-secondary" />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-ui text-txt-primary">{entry.body}</p>
                    <p className="mt-0.5 text-meta text-txt-tertiary">
                      {entry.endsAt === null
                        ? t('admin:console.announcements.sinceOpen', { date: f.formatDateTime(entry.createdAt) })
                        : t('admin:console.announcements.sinceUntil', { date: f.formatDateTime(entry.createdAt), until: f.formatDateTime(entry.endsAt) })}
                    </p>
                    {entry.onStatusPage && <p className="mt-0.5 text-meta text-txt-tertiary">{t('admin:console.announcements.onStatusPage')}</p>}
                  </div>
                  <button type="button" onClick={() => void end(entry.id)} className="btn-outline btn-sm flex-shrink-0">
                    {t('admin:console.announcements.end')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {past.length > 0 && (
        <section aria-label={t('admin:console.announcements.past')}>
          <h3 className="label-mono mb-2">{t('admin:console.announcements.past')}</h3>
          <ul className="surface-card divide-y divide-border-hard rounded-lg">
            {past.map((entry) => (
              <li key={entry.id} className="px-3 py-2.5">
                <p className="whitespace-pre-wrap break-words text-ui text-txt-secondary">{entry.body}</p>
                <p className="mt-0.5 text-meta text-txt-tertiary">{f.formatDateTime(entry.createdAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
