import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH } from '@backspace/shared/src/constants';
import type { SecurityEventInfo, SecurityOverview, SessionInfo } from '@backspace/shared';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { useHomeInstanceInfo } from '../../../hooks/useHomeInstanceInfo';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Sensitive, useSensitiveText } from '../../ui/Sensitive';
import { EmailSection } from './EmailSection';
import { TwoFactorCodeField, TwoFactorSection } from './TwoFactorSection';
import { Icon } from '../../ui/Icon';
import { FormError, SettingsField, SettingsPage, SettingsSection } from './_shared/SettingsControls';

/** Shows or hides what is typed in a password field; sits at the field's far end. */
function RevealButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useTranslation('settings');
  const label = shown ? t('account.password.hide') : t('account.password.show');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className="icon-btn absolute right-[5px] top-1/2 -translate-y-1/2"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
        {shown ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
        ) : (
          <>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </>
        )}
      </svg>
    </button>
  );
}

function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation(['settings', 'common']);
  const sensitive = useSensitiveText();
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const username = useAuthStore((s) => s.user?.username ?? '');
  const changePassword = useAuthStore((s) => s.changePassword);
  const addToast = useUIStore((s) => s.addToast);
  const mailOn = useHomeInstanceInfo()?.email === true;
  const address = useAuthStore((s) => (s.user?.emailVerified ? s.user.email : null));
  const homeInstance = useAuthStore((s) => s.user?.homeInstance ?? null);
  const recovery = homeInstance
    ? undefined
    : !mailOn
      ? t('settings:security.passwordRecovery.noMail')
      : address
        ? t('settings:security.passwordRecovery.confirmed', { address: sensitive(address) })
        : t('settings:security.passwordRecovery.none');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  // The field the error is about, when it is about one field.
  const [passwordErrorField, setPasswordErrorField] = useState<'new' | 'confirm' | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordErrorField(null);

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPasswordError(t('settings:account.password.tooShort', { min: PASSWORD_MIN_LENGTH }));
      setPasswordErrorField('new');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(t('settings:account.password.mismatch'));
      setPasswordErrorField('confirm');
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword(currentPassword, newPassword, twoFactorCode.trim() || undefined);
      addToast(t('settings:account.password.changed'), 'success', 2000);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setTwoFactorCode('');
      onChanged();
    } catch (err) {
      setPasswordError(err instanceof Error ? describeError(err) : t('settings:account.password.changeFailed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <SettingsSection title={t('common:labels.password')} description={recovery}>
      <form onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }}>
        <input type="text" autoComplete="username" value={username} readOnly tabIndex={-1} className="sr-only" />
        <div className="space-y-4">
          <SettingsField label={t('settings:account.password.current.label')} htmlFor="password-current">
            <div className="relative">
              <input
                id="password-current"
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input-standard w-full pr-10"
                placeholder={t('settings:account.password.current.placeholder')}
                autoComplete="current-password"
              />
              <RevealButton shown={showCurrentPassword} onToggle={() => setShowCurrentPassword(!showCurrentPassword)} />
            </div>
          </SettingsField>
          <SettingsField label={t('settings:account.password.new.label')} htmlFor="password-new">
            <div className="relative">
              <input
                id="password-new"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={passwordErrorField === 'new'}
                className="input-standard w-full pr-10"
                placeholder={t('settings:account.password.new.placeholder', { min: PASSWORD_MIN_LENGTH })}
                autoComplete="new-password"
              />
              <RevealButton shown={showNewPassword} onToggle={() => setShowNewPassword(!showNewPassword)} />
            </div>
          </SettingsField>
          <SettingsField label={t('settings:account.password.confirm.label')} htmlFor="password-confirm">
            <input
              id="password-confirm"
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              aria-invalid={passwordErrorField === 'confirm'}
              className="input-standard w-full"
              placeholder={t('settings:account.password.confirm.placeholder')}
              autoComplete="new-password"
            />
          </SettingsField>
          <TwoFactorCodeField id="password-two-factor" value={twoFactorCode} onChange={setTwoFactorCode} />

          {passwordError && <FormError>{passwordError}</FormError>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={passwordLoading || !currentPassword || !newPassword || !confirmNewPassword}
              aria-busy={passwordLoading}
              className="btn-primary"
            >
              {passwordLoading ? t('settings:account.password.submitting') : t('settings:account.password.submit')}
            </button>
          </div>
        </div>
      </form>
    </SettingsSection>
  );
}

/**
 * Where this account is signed in, on this server. Signing a device out ends its session at
 * once: its next request is refused and its socket closes. Someone with accounts
 * on other servers has sessions there too, and signs out of those there.
 */
function SessionsSection({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation(['settings']);
  const f = useFormatters();
  const logout = useAuthStore((s) => s.logout);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingOthers, setConfirmingOthers] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions((await api.auth.sessions()).sessions);
      setError('');
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const end = async (session: SessionInfo) => {
    if (session.current) {
      logout();
      return;
    }
    setBusy(true);
    try {
      setSessions((await api.auth.endSession(session.id)).sessions);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const endOthers = async () => {
    setBusy(true);
    try {
      setSessions((await api.auth.endOtherSessions()).sessions);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      setConfirmingOthers(false);
    }
  };

  const endAll = async () => {
    setBusy(true);
    try {
      await api.auth.endAllSessions();
      logout();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
      setConfirmingAll(false);
    }
  };

  const others = (sessions ?? []).filter((session) => !session.current).length;

  return (
    <SettingsSection
      title={t('settings:security.sessions.title')}
      description={t('settings:security.sessions.description')}
      flush
    >
      {error && <div className="px-4 pt-3"><FormError>{error}</FormError></div>}
      {sessions === null && !error && <p className="px-4 py-3 text-ui text-txt-tertiary">{t('settings:security.sessions.loading')}</p>}
      {sessions !== null && (
        <ul className="divide-y divide-border-hard">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
              <span aria-hidden="true" className="flex-shrink-0 text-txt-tertiary"><Icon name="monitor" size={18} /></span>
              <div className="min-w-0 flex-1 basis-48">
                <div className="flex items-center gap-2">
                  <span className="truncate text-ui font-medium text-txt-primary">{session.clientLabel ?? t('settings:security.sessions.unknownDevice')}</span>
                  {session.current && <span className="label-mono flex-shrink-0">{t('settings:security.sessions.thisDevice')}</span>}
                </div>
                <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">
                  {session.addressHint && <><Sensitive>{session.addressHint}</Sensitive>{' · '}</>}
                  {t('settings:security.sessions.signedIn', { date: f.formatDateTime(session.createdAt) })}{' · '}
                  {t('settings:security.sessions.lastActive', { date: f.formatDateTime(session.lastActiveAt) })}
                </p>
              </div>
              <button type="button" onClick={() => { void end(session); }} disabled={busy} className="btn-quiet btn-sm">
                {t('settings:security.sessions.signOut')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {sessions !== null && (
        <div className="flex flex-wrap gap-2 border-t border-border-hard px-4 py-3">
          {others > 0 && (
            <button type="button" onClick={() => setConfirmingOthers(true)} disabled={busy} className="btn-outline">
              {t('settings:security.sessions.signOutOthers')}
            </button>
          )}
          <button type="button" onClick={() => setConfirmingAll(true)} disabled={busy} className="btn-quiet">
            {t('settings:security.sessions.signOutAll')}
          </button>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmingAll}
        onClose={() => setConfirmingAll(false)}
        onConfirm={() => { void endAll(); }}
        title={t('settings:security.sessions.signOutAllConfirm.title')}
        description={t('settings:security.sessions.signOutAllConfirm.description')}
        variant="danger"
        confirmLabel={t('settings:security.sessions.signOutAll')}
        loading={busy}
      />
      <ConfirmDialog
        isOpen={confirmingOthers}
        onClose={() => setConfirmingOthers(false)}
        onConfirm={() => { void endOthers(); }}
        title={t('settings:security.sessions.signOutOthersConfirm.title')}
        description={t('settings:security.sessions.signOutOthersConfirm.description')}
        variant="danger"
        confirmLabel={t('settings:security.sessions.signOutOthers')}
        loading={busy}
      />
    </SettingsSection>
  );
}

/** At a glance: what protects this account, and how much of it is on. */
function OverviewSection({ overview }: { overview: SecurityOverview | null }) {
  const { t } = useTranslation(['settings', 'common']);
  const f = useFormatters();
  const mailOn = useHomeInstanceInfo()?.email === true;
  const email = useAuthStore((s) => s.user?.email ?? null);
  const verified = useAuthStore((s) => s.user?.emailVerified === true);
  const homeInstance = useAuthStore((s) => s.user?.homeInstance ?? null);
  if (!overview) return null;
  const rows: { label: string; value: string; good: boolean }[] = [
    ...(mailOn && !homeInstance ? [{
      label: t('settings:security.email.title'),
      value: verified ? t('settings:security.email.confirmed') : email ? t('settings:security.email.unconfirmed') : t('settings:security.overview.none'),
      good: verified,
    }] : []),
    ...(!homeInstance ? [{
      label: t('settings:security.twoFactor.title'),
      value: overview.twoFactor.enabled ? t('settings:security.overview.on') : t('settings:security.overview.off'),
      good: overview.twoFactor.enabled,
    }] : []),
    {
      label: t('common:labels.password'),
      value: overview.passwordChangedAt ? t('settings:security.overview.changed', { date: f.formatDateTime(overview.passwordChangedAt) }) : t('settings:security.overview.neverChanged'),
      good: true,
    },
    {
      label: t('settings:security.sessions.title'),
      value: t('settings:security.overview.devices', { count: overview.sessionCount }),
      good: true,
    },
  ];
  return (
    <SettingsSection title={t('settings:security.overview.title')} flush>
      <dl className="divide-y divide-border-hard">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="min-w-0 text-ui text-txt-secondary">{row.label}</dt>
            <dd className={`flex-shrink-0 text-right text-ui ${row.good ? 'text-txt-primary' : 'text-txt-warning'}`}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  );
}

/** What happened to this account's security, newest first. Kept for 90 days. */
function ActivitySection({ events }: { events: SecurityEventInfo[] }) {
  const { t } = useTranslation(['settings']);
  const f = useFormatters();
  return (
    <SettingsSection title={t('settings:security.activity.title')} description={t('settings:security.activity.description')} flush>
      {events.length === 0 && <p className="px-4 py-3 text-ui text-txt-tertiary">{t('settings:security.activity.empty')}</p>}
      {events.length > 0 && (
        <ul className="divide-y divide-border-hard">
          {events.map((event) => (
            <li key={event.id} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-ui text-txt-primary">
                  {t(`settings:security.activity.kinds.${event.kind}`)}
                  {event.count > 1 && <span className="ml-1.5 font-mono text-meta text-txt-tertiary">{`×${f.formatNumber(event.count)}`}</span>}
                </span>
                <time className="flex-shrink-0 font-mono text-meta text-txt-tertiary">{f.formatDateTime(event.createdAt)}</time>
              </div>
              {(event.clientLabel || event.addressHint) && (
                <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">
                  {event.clientLabel}
                  {event.clientLabel && event.addressHint && ' · '}
                  {event.addressHint && <Sensitive>{event.addressHint}</Sensitive>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

/** How this account is protected: its address, a second factor, the password, where it is signed in, and what happened. */
export function SecurityPanel() {
  const { t } = useTranslation(['settings']);
  const [overview, setOverview] = useState<SecurityOverview | null>(null);

  const reload = useCallback(async () => {
    try {
      setOverview(await api.auth.security());
    } catch {
      // The sections below have their own errors; the overview simply stays as it was.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <SettingsPage title={t('settings:nav.tabs.security')}>
      <OverviewSection overview={overview} />
      <TwoFactorSection overview={overview} onChanged={() => { void reload(); }} />
      <EmailSection />
      <PasswordSection onChanged={() => { void reload(); }} />
      <SessionsSection onChanged={() => { void reload(); }} />
      <ActivitySection events={overview?.events ?? []} />
    </SettingsPage>
  );
}
