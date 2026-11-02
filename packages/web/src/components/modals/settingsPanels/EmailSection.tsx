import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccountEmailStatus } from '@backspace/shared';
import { api } from '../../../api/client';
import { useHomeInstanceInfo } from '../../../hooks/useHomeInstanceInfo';
import { getLanguage } from '../../../i18n';
import { describeError } from '../../../i18n/errors';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FormError, SettingsField, SettingsSection } from './_shared/SettingsControls';
import { TwoFactorCodeField } from './TwoFactorSection';

/**
 * This account's address (docs/systems/email.md). Hidden on a server that sends no mail, and
 * for an account whose home is another server. "Sent" here only ever means handed to the
 * mail provider; a mail's arrival is the one thing this page cannot know.
 */
export function EmailSection() {
  const { t } = useTranslation(['settings', 'common']);
  const info = useHomeInstanceInfo();
  const addToast = useUIStore((s) => s.addToast);
  const homeInstance = useAuthStore((s) => s.user?.homeInstance ?? null);
  // A link used in another tab or on a phone comes back as `user_updated`.
  const verified = useAuthStore((s) => s.user?.emailVerified);
  const email = useAuthStore((s) => s.user?.email);
  const pendingEmail = useAuthStore((s) => s.user?.pendingEmail);
  const [status, setStatus] = useState<AccountEmailStatus | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removePassword, setRemovePassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const mailOn = info?.email === true && !homeInstance;

  const load = useCallback(async () => {
    try {
      setStatus(await api.users.email());
      setError('');
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    if (mailOn) void load();
  }, [mailOn, load, verified, email, pendingEmail]);

  if (!mailOn) return null;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const code = twoFactorCode.trim();
      const updated = await api.users.changeEmail({ address: address.trim(), password, locale: getLanguage(), ...(code ? { twoFactorCode: code } : {}) });
      setStatus(updated);
      setEditing(false);
      setAddress('');
      setPassword('');
      setTwoFactorCode('');
      if (updated.pendingAddress || !updated.verified) addToast(t('settings:security.email.sent'), 'success', 3000);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await api.users.resendEmail());
      addToast(t('settings:security.email.sent'), 'success', 3000);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelPending = async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await api.users.cancelPendingEmail());
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await api.users.removeEmail(removePassword, twoFactorCode.trim() || undefined));
      setRemoving(false);
      setRemovePassword('');
      setTwoFactorCode('');
    } catch (err) {
      setRemoving(false);
      setRemovePassword('');
      setTwoFactorCode('');
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const hasAddress = Boolean(status?.address);
  const waiting = status?.pendingAddress ?? (status && !status.verified ? status.address : null);
  const showForm = status !== null && (editing || !hasAddress);

  return (
    <SettingsSection title={t('settings:security.email.title')} description={t('settings:security.email.description')}>
      {status === null && !error && <p className="text-ui text-txt-tertiary">{t('settings:security.sessions.loading')}</p>}

      {status !== null && hasAddress && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="break-all text-ui font-medium text-txt-primary">{status.address}</span>
            <span className={`label-mono flex-shrink-0 ${status.verified ? '' : 'text-txt-warning'}`}>
              {status.verified ? t('settings:security.email.confirmed') : t('settings:security.email.unconfirmed')}
            </span>
          </div>
          {!editing && (
            <div className="flex flex-shrink-0 gap-2">
              <button type="button" onClick={() => setEditing(true)} disabled={busy} className="btn-quiet btn-sm">{t('settings:security.email.change')}</button>
              <button type="button" onClick={() => setRemoving(true)} disabled={busy} className="btn-quiet btn-sm">{t('settings:security.email.remove')}</button>
            </div>
          )}
        </div>
      )}

      {status !== null && !hasAddress && !editing && <p className="text-ui leading-5 text-txt-secondary">{t('settings:security.email.none')}</p>}

      {waiting && (
        <div className="space-y-2">
          <p className="break-words text-ui leading-5 text-txt-secondary">
            {status?.pendingAddress
              ? t('settings:security.email.pending', { address: waiting })
              : t('settings:security.email.waiting', { address: waiting })}
          </p>
          {status?.undeliverable && <FormError>{t('settings:security.email.undeliverable')}</FormError>}
          {!status?.undeliverable && (status?.lastSend === 'failed' || status?.lastSend === 'expired') && (
            <FormError>{t('settings:security.email.sendFailed')}</FormError>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { void resend(); }} disabled={busy || status?.undeliverable} className="btn-outline btn-sm">
              {t('settings:security.email.resend')}
            </button>
            {status?.pendingAddress && (
              <button type="button" onClick={() => { void cancelPending(); }} disabled={busy} className="btn-quiet btn-sm">
                {t('settings:security.email.cancel')}
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
          <SettingsField label={t('settings:security.email.newAddress')} htmlFor="email-address">
            <input
              id="email-address"
              type="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="input-standard w-full"
              autoComplete="email"
              required
            />
          </SettingsField>
          <SettingsField label={t('settings:account.password.current.label')} htmlFor="email-password">
            <input
              id="email-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-standard w-full"
              autoComplete="current-password"
              required
            />
          </SettingsField>
          <TwoFactorCodeField id="email-two-factor" value={twoFactorCode} onChange={setTwoFactorCode} />
          <div className="flex justify-end gap-2">
            {hasAddress && (
              <button type="button" onClick={() => { setEditing(false); setError(''); }} className="btn-quiet">
                {t('common:actions.cancel')}
              </button>
            )}
            <button type="submit" disabled={busy || !address.trim() || !password} aria-busy={busy} className="btn-primary">
              {t('settings:security.email.submit')}
            </button>
          </div>
        </form>
      )}

      {error && <FormError>{error}</FormError>}

      <ConfirmDialog
        isOpen={removing}
        onClose={() => { setRemoving(false); setRemovePassword(''); setTwoFactorCode(''); }}
        onConfirm={() => { void remove(); }}
        title={t('settings:security.email.removeConfirm.title')}
        description={(
          <div className="space-y-3">
            <p>{t('settings:security.email.removeConfirm.description')}</p>
            <SettingsField label={t('settings:account.password.current.label')} htmlFor="email-remove-password">
              <input
                id="email-remove-password"
                type="password"
                value={removePassword}
                onChange={(e) => setRemovePassword(e.target.value)}
                className="input-standard w-full"
                autoComplete="current-password"
              />
            </SettingsField>
            <TwoFactorCodeField id="email-remove-two-factor" value={twoFactorCode} onChange={setTwoFactorCode} />
          </div>
        )}
        variant="danger"
        confirmLabel={t('settings:security.email.remove')}
        loading={busy}
      />
    </SettingsSection>
  );
}
