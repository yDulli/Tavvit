import { storageBytesToGb } from '@backspace/shared/src/accountLimits';
import type { AdminAccountStorage } from '@backspace/shared/src/platform';
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SecurityEventInfo, SessionInfo } from '@backspace/shared';
import { ADMIN_NOTE_LIMITS, WARNING_LIMITS, type AdminNote } from '@backspace/shared/src/adminConsole';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';

/**
 * Where this account is signed in, and the way to end that. It signs them out and shows in
 * their own security activity; what keeps someone out is a suspension. An admin's own
 * sessions are ended from their own settings, not from here.
 */
export function AccountSessionsSection({ userId, isSelf, onChanged }: { userId: string; isSelf: boolean; onChanged: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    setSessions(null);
    setError('');
    api.admin.userSessions(userId)
      .then((response) => { if (!stale) setSessions(response.sessions); })
      .catch((err: unknown) => { if (!stale) setError(describeError(err)); });
    return () => { stale = true; };
  }, [userId]);

  const run = async (action: () => Promise<{ sessions: SessionInfo[] }>) => {
    setBusy(true);
    setError('');
    try {
      setSessions((await action()).sessions);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="label-mono">{t('admin:console.account.sessions')}</h3>
        {!isSelf && sessions !== null && sessions.length > 0 && (
          <button type="button" onClick={() => setConfirmAll(true)} disabled={busy} className="btn-outline btn-sm">
            {t('admin:console.account.endAll')}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      {sessions !== null && sessions.length === 0 && <p className="text-ui text-txt-tertiary">{t('admin:console.account.noSessions')}</p>}
      {sessions !== null && sessions.length > 0 && (
        <ul className="surface-card divide-y divide-border-hard rounded-lg">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui text-txt-primary">{session.clientLabel ?? t('admin:console.account.unknownDevice')}</span>
                <span className="block truncate text-meta text-txt-tertiary">
                  {t('admin:console.account.lastActive', { date: f.formatDateTime(session.lastActiveAt) })}
                  {session.addressHint ? ` · ${session.addressHint}` : ''}
                </span>
              </span>
              {!isSelf && (
                <button
                  type="button"
                  onClick={() => void run(() => api.admin.endUserSession(userId, session.id))}
                  disabled={busy}
                  className="btn-quiet btn-sm flex-shrink-0"
                >
                  {t('admin:console.account.end')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        isOpen={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={() => run(() => api.admin.endUserSessions(userId))}
        title={t('admin:console.account.endAllTitle')}
        description={t('admin:console.account.endAllBody')}
        confirmLabel={t('admin:console.account.endAll')}
        variant="warning"
        loading={busy}
      />
    </section>
  );
}

/** What happened around this account's sign-ins, as its owner sees it in their settings. */
export function AccountSecuritySection({ userId }: { userId: string }) {
  const { t } = useTranslation(['admin', 'settings']);
  const f = useFormatters();
  const [events, setEvents] = useState<SecurityEventInfo[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    setEvents(null);
    api.admin.userSecurity(userId)
      .then((response) => { if (!stale) setEvents(response.events); })
      .catch((err: unknown) => { if (!stale) setError(describeError(err)); });
    return () => { stale = true; };
  }, [userId]);

  return (
    <section className="space-y-2">
      <h3 className="label-mono">{t('admin:console.account.security')}</h3>
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      {events !== null && events.length === 0 && <p className="text-ui text-txt-tertiary">{t('admin:console.account.noEvents')}</p>}
      {events !== null && events.length > 0 && (
        <ul className="surface-card max-h-[220px] divide-y divide-border-hard overflow-y-auto rounded-lg scrollbar-thin">
          {events.map((event) => (
            <li key={event.id} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-ui text-txt-primary">{t(`settings:security.activity.kinds.${event.kind}`)}</span>
                <span className="flex-shrink-0 font-mono text-label text-txt-tertiary">{f.formatDateTime(event.createdAt)}</span>
              </div>
              {(event.clientLabel || event.addressHint) && (
                <p className="truncate text-meta text-txt-tertiary">{[event.clientLabel, event.addressHint].filter(Boolean).join(' · ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What an account's files take up, and its own limit if it needs one other than the
 * instance's (docs/systems/uploads.md, "Limits per account"). An admin has no limit, and a
 * deleted account has nothing left to set.
 */
export function AccountStorageSection({ userId, isAdmin, isDeleted, storage, onChanged }: {
  userId: string;
  isAdmin: boolean;
  isDeleted: boolean;
  storage: AdminAccountStorage;
  onChanged: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const fieldId = useId();
  const own = storage.ownLimitBytes;
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInput(own === null ? '' : String(storageBytesToGb(own)));
  }, [own]);

  const typed = input.trim() === '' ? null : Number(input);
  const valid = typed !== null && Number.isFinite(typed) && typed >= 0;

  const save = async (limitGb: number | null) => {
    setBusy(true);
    setError('');
    try {
      await api.admin.setStorageLimit(userId, limitGb);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2.5">
      <h3 className="label-mono">{t('admin:console.account.storage.title')}</h3>
      <div className="surface-card space-y-3 rounded-lg p-4">
        <p className="tabular text-ui text-txt-primary">
          {storage.limitBytes === null
            ? t('admin:console.account.storage.usedNoLimit', { used: f.formatBytes(storage.usedBytes) })
            : t('admin:console.account.storage.used', { used: f.formatBytes(storage.usedBytes), limit: f.formatBytes(storage.limitBytes) })}
        </p>
        {!isAdmin && !isDeleted && (
          <>
            <div>
              <label htmlFor={fieldId} className="field-label">{t('admin:console.account.storage.ownLimit')}</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={fieldId}
                  type="number"
                  min={0}
                  step={0.5}
                  value={input}
                  placeholder={t('admin:console.account.storage.instanceDefault')}
                  onChange={(e) => setInput(e.target.value)}
                  className="input-standard tabular h-8 w-40 px-2 py-0 font-mono text-ui"
                />
                <button type="button" onClick={() => { void save(typed); }} disabled={busy || !valid} aria-busy={busy} className="btn-outline btn-sm">
                  {t('common:actions.save')}
                </button>
                {own !== null && (
                  <button type="button" onClick={() => { void save(null); }} disabled={busy} className="btn-quiet btn-sm">
                    {t('admin:console.account.storage.reset')}
                  </button>
                )}
              </div>
            </div>
            <p className="text-meta leading-snug text-txt-tertiary">{t('admin:console.account.storage.hint')}</p>
          </>
        )}
        {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      </div>
    </section>
  );
}


/** What the admins keep for each other about this account. The person can read it in their data export. */
export function AccountNotesSection({ userId, isDeleted, onChanged }: { userId: string; isDeleted: boolean; onChanged: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const fieldId = useId();
  const [notes, setNotes] = useState<AdminNote[] | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotes((await api.admin.userNotes(userId)).notes);
    } catch (err) {
      setError(describeError(err));
    }
  }, [userId]);

  useEffect(() => {
    setNotes(null);
    setBody('');
    setError('');
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      setNotes((await api.admin.addUserNote(userId, body.trim())).notes);
      setBody('');
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (noteId: string) => {
    setError('');
    try {
      setNotes((await api.admin.deleteUserNote(userId, noteId)).notes);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="label-mono">{t('admin:console.account.notes')}</h3>
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      {notes !== null && notes.length > 0 && (
        <ul className="surface-card divide-y divide-border-hard rounded-lg">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-ui text-txt-primary">{note.body}</p>
                <p className="mt-0.5 text-meta text-txt-tertiary">
                  {note.author ? `${note.author.displayName || `@${note.author.username}`} · ` : ''}
                  {f.formatDateTime(note.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(note.id)}
                aria-label={t('admin:console.account.deleteNote')}
                className="icon-btn flex-shrink-0"
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isDeleted && (
        <div className="space-y-2">
          <label htmlFor={fieldId} className="sr-only">{t('admin:console.account.notes')}</label>
          <textarea
            id={fieldId}
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, ADMIN_NOTE_LIMITS.BODY_MAX_LENGTH))}
            rows={2}
            placeholder={t('admin:console.account.notePlaceholder')}
            className="input-standard w-full resize-none"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-meta text-txt-tertiary">{t('admin:console.account.notesHint')}</p>
            <button type="button" onClick={() => void add()} disabled={!body.trim() || busy} aria-busy={busy} className="btn-outline btn-sm flex-shrink-0">
              {t('admin:console.account.addNote')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** A warning: a notice from the operator with its reason and the way to object. It changes nothing about the account. */
export function AccountWarningSection({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const fieldId = useId();
  const [note, setNote] = useState('');
  const [ground, setGround] = useState<'terms' | 'illegal'>('terms');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const valid = note.trim().length >= WARNING_LIMITS.NOTE_MIN_LENGTH;

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api.admin.warnUser(userId, { note: note.trim(), ground });
      setNote('');
      setSent(true);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <section className="space-y-2.5">
      <h3 className="label-mono">{t('admin:console.account.warning')}</h3>
      <div className="surface-card space-y-3 rounded-lg p-4">
        <p className="text-meta text-txt-tertiary">{t('admin:console.account.warningHint')}</p>
        <div>
          <label htmlFor={`${fieldId}-ground`} className="field-label">{t('admin:console.account.ground')}</label>
          <select id={`${fieldId}-ground`} value={ground} onChange={(event) => setGround(event.target.value === 'illegal' ? 'illegal' : 'terms')} className="input-standard w-full max-w-xs">
            <option value="terms">{t('admin:console.account.grounds.terms')}</option>
            <option value="illegal">{t('admin:console.account.grounds.illegal')}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${fieldId}-note`} className="field-label">{t('admin:console.account.warningReason')}</label>
          <textarea
            id={`${fieldId}-note`}
            value={note}
            onChange={(event) => { setNote(event.target.value.slice(0, WARNING_LIMITS.NOTE_MAX_LENGTH)); setSent(false); }}
            rows={3}
            className="input-standard w-full resize-none"
          />
        </div>
        {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
        {sent && <p role="status" className="text-meta text-txt-positive">{t('admin:console.account.warningSent')}</p>}
        <button type="button" onClick={() => setConfirming(true)} disabled={!valid || busy} className="btn-outline btn-sm">
          {t('admin:console.account.warn')}
        </button>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={send}
        title={t('admin:console.account.warnTitle')}
        description={t('admin:console.account.warnBody')}
        confirmLabel={t('admin:console.account.warn')}
        variant="warning"
        loading={busy}
      />
    </section>
  );
}
