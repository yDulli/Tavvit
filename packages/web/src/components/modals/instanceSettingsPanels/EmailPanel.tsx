import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminEmailStatus } from '@backspace/shared';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { invalidateHomeInstanceInfo } from '../../../hooks/useHomeInstanceInfo';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useUIStore } from '../../../stores/uiStore';
import { FormError, SettingsField, SettingsPage, SettingsSection, ToggleRow } from '../settingsPanels/_shared/SettingsControls';

/** Shares of the provider's limits from which an admin hears about it. */
const WARN_DAY_SHARE = 0.8;
const WARN_MONTH_SHARE = 0.9;
/** What Resend names as the line for pausing a whole account. */
const WARN_BOUNCE_RATE = 0.04;
const WARN_COMPLAINT_RATE = 0.0008;

function usedOf(used: number, limit: number): number {
  return limit > 0 ? used / limit : 0;
}

/** How mail is doing on this instance (docs/systems/email.md). Holds no address and no credential. */
export function EmailPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const addToast = useUIStore((s) => s.addToast);
  const instanceSettings = useSettingsStore((s) => s.instanceSettings);
  const updateInstanceSettings = useSettingsStore((s) => s.updateInstanceSettings);
  const [status, setStatus] = useState<AdminEmailStatus | null>(null);
  const [error, setError] = useState('');
  const [testAddress, setTestAddress] = useState('');
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.admin.emailStatus());
      setError('');
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendTest = async () => {
    setSending(true);
    setError('');
    try {
      await api.admin.sendTestEmail(testAddress.trim());
      addToast(t('admin:email.test.queued'), 'success', 3000);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  };

  const save = async (patch: { emailRequired?: boolean; blockThrowawayEmail?: boolean }) => {
    setSaving(true);
    setError('');
    try {
      await updateInstanceSettings(patch);
      invalidateHomeInstanceInfo();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  if (status === null) {
    return (
      <SettingsPage title={t('admin:email.title')}>
        {error ? <FormError>{error}</FormError> : <p className="text-ui text-txt-tertiary">{t('common:states.loading')}</p>}
      </SettingsPage>
    );
  }

  if (status.state === 'off') {
    return (
      <SettingsPage title={t('admin:email.title')}>
        <SettingsSection title={t('admin:email.off.title')}>
          <p className="text-ui leading-5 text-txt-secondary">{t('admin:email.off.body')}</p>
        </SettingsSection>
      </SettingsPage>
    );
  }

  const warnings = [
    status.state === 'blocked' && t('admin:email.warnings.blocked'),
    status.state === 'held' && (status.heldUntil
      ? t('admin:email.warnings.heldUntil', { date: f.formatDateTime(status.heldUntil) })
      : t('admin:email.warnings.held')),
    usedOf(status.today.accepted, status.today.limit) >= WARN_DAY_SHARE && t('admin:email.warnings.day'),
    usedOf(status.month.accepted, status.month.limit) >= WARN_MONTH_SHARE && t('admin:email.warnings.month'),
    status.bounceRate >= WARN_BOUNCE_RATE && t('admin:email.warnings.bounces'),
    status.complaintRate >= WARN_COMPLAINT_RATE && t('admin:email.warnings.complaints'),
    status.transport === 'resend' && !status.webhookConfigured && t('admin:email.warnings.noWebhook'),
  ].filter((warning): warning is string => typeof warning === 'string');

  const count = (used: number, limit: number): string => (limit > 0 ? `${f.formatNumber(used)} / ${f.formatNumber(limit)}` : f.formatNumber(used));
  const rows: { label: string; value: string }[] = [
    { label: t('admin:email.rows.transport'), value: status.transport },
    { label: t('admin:email.rows.from'), value: status.from },
    { label: t('admin:email.rows.today'), value: count(status.today.accepted, status.today.limit) },
    { label: t('admin:email.rows.month'), value: count(status.month.accepted, status.month.limit) },
    { label: t('admin:email.rows.queued'), value: f.formatNumber(status.queued) },
    { label: t('admin:email.rows.failed'), value: f.formatNumber(status.today.failed) },
    { label: t('admin:email.rows.bounced'), value: f.formatNumber(status.today.bounced) },
    { label: t('admin:email.rows.complained'), value: f.formatNumber(status.today.complained) },
    ...(status.lastError ? [{ label: t('admin:email.rows.lastError'), value: status.lastError }] : []),
  ];

  return (
    <SettingsPage title={t('admin:email.title')} intro={t('admin:email.intro')}>
      {warnings.length > 0 && (
        <SettingsSection title={t('admin:email.warnings.title')}>
          <ul className="space-y-1.5 text-ui leading-5 text-txt-warning">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </SettingsSection>
      )}

      <SettingsSection title={t('admin:email.rows.title')} flush>
        <dl className="divide-y divide-border-hard">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <dt className="text-ui text-txt-secondary">{row.label}</dt>
              <dd className="min-w-0 break-all text-right font-mono text-meta text-txt-primary">{row.value}</dd>
            </div>
          ))}
        </dl>
      </SettingsSection>

      <SettingsSection title={t('admin:email.required.title')}>
        <ToggleRow
          label={t('admin:email.required.label')}
          description={t('admin:email.required.description')}
          enabled={instanceSettings?.emailRequired === true}
          disabled={saving || instanceSettings === null}
          onChange={(enabled) => { void save({ emailRequired: enabled }); }}
        />
        <ToggleRow
          label={t('admin:email.throwaway.label')}
          description={t('admin:email.throwaway.description')}
          enabled={instanceSettings?.blockThrowawayEmail === true}
          disabled={saving || instanceSettings === null}
          onChange={(enabled) => { void save({ blockThrowawayEmail: enabled }); }}
        />
      </SettingsSection>

      <SettingsSection title={t('admin:email.test.title')} description={t('admin:email.test.description')}>
        <form onSubmit={(e) => { e.preventDefault(); void sendTest(); }} className="space-y-3">
          <SettingsField label={t('admin:email.test.address')} htmlFor="email-test-address">
            <input
              id="email-test-address"
              type="email"
              value={testAddress}
              onChange={(e) => setTestAddress(e.target.value)}
              className="input-standard w-full"
              required
            />
          </SettingsField>
          <div className="flex justify-end">
            <button type="submit" disabled={sending || !testAddress.trim()} aria-busy={sending} className="btn-outline">{t('admin:email.test.submit')}</button>
          </div>
        </form>
      </SettingsSection>

      {error && <FormError>{error}</FormError>}
    </SettingsPage>
  );
}
