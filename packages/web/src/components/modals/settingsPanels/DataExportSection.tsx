import { TwoFactorCodeField } from './TwoFactorSection';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataExportStatus } from '@backspace/shared';
import { api } from '../../../api/client';
import { saveBlob } from '../../../utils/saveBlob';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { FormError, SettingsSection } from './_shared/SettingsControls';

const POLL_MS = 5000;

/**
 * A copy of what this server holds about the account (GDPR Art. 15 and 20). The server
 * builds it in the background and keeps it for a week (utils/dataExport.ts), so this
 * asks for the password once, waits, and offers the file.
 */
export function DataExportSection() {
  const { t } = useTranslation(['settings']);
  const f = useFormatters();
  const [state, setState] = useState<DataExportStatus | null>(null);
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const passwordId = useId();

  const read = useCallback(async () => {
    try {
      setState(await api.users.dataExportStatus());
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const pending = state?.status === 'pending';
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => { void read(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, read]);

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setState(await api.users.requestDataExport(password, twoFactorCode.trim() || undefined));
      setPassword('');
      setTwoFactorCode('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      saveBlob(await api.users.downloadDataExport(), 'tavvit-data.zip');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title={t('settings:account.dataExport.title')}>
      <p className="text-ui leading-relaxed text-txt-secondary">{t('settings:account.dataExport.description')}</p>
      {pending && <p role="status" className="text-ui text-txt-secondary">{t('settings:account.dataExport.pending')}</p>}
      {state?.status === 'ready' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="min-w-0 flex-1 basis-60 text-ui text-txt-secondary">
            {t('settings:account.dataExport.ready', { date: f.formatDateTime(state.expiresAt ?? 0) })}
          </p>
          <button type="button" onClick={() => { void download(); }} disabled={busy} aria-busy={busy} className="btn-primary">
            {t('settings:account.dataExport.download')}
          </button>
        </div>
      )}
      {state?.status === 'failed' && <p role="alert" className="text-ui text-txt-danger">{t('settings:account.dataExport.failed')}</p>}
      {(state?.status === 'none' || state?.status === 'failed') && (
        <form onSubmit={(event) => { void ask(event); }} className="space-y-3">
          <div>
            <label htmlFor={passwordId} className="field-label">{t('settings:account.dataExport.password')}</label>
            <input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="input-standard w-full"
            />
          </div>
          <TwoFactorCodeField id="data-export-two-factor" value={twoFactorCode} onChange={setTwoFactorCode} />
          <button type="submit" disabled={busy || password === ''} aria-busy={busy} className="btn-outline">
            {t('settings:account.dataExport.request')}
          </button>
        </form>
      )}
      {error && <FormError>{error}</FormError>}
    </SettingsSection>
  );
}
