import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SecurityOverview, TwoFactorSetupResponse } from '@backspace/shared';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { FormError, SettingsField, SettingsSection } from './_shared/SettingsControls';

/** The field for a second factor, on the forms that need one. An account without 2FA never sees it. */
export function TwoFactorCodeField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation(['settings']);
  const enabled = useAuthStore((s) => s.user?.twoFactorEnabled === true);
  if (!enabled) return null;
  return (
    <SettingsField label={t('settings:security.twoFactor.codeLabel')} hint={t('settings:security.twoFactor.codeHint')} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-standard w-full font-mono"
        autoComplete="one-time-code"
        spellCheck={false}
        maxLength={32}
      />
    </SettingsField>
  );
}

/** The QR code, drawn here: the secret in it must not go anywhere else, not even to an image service. */
function QrCode({ text, label }: { text: string; label: string }) {
  const [matrix, setMatrix] = useState<{ size: number; path: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('qrcode-generator').then(({ default: qrcode }) => {
      if (cancelled) return;
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const size = qr.getModuleCount();
      let path = '';
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          if (qr.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`;
        }
      }
      setMatrix({ size, path });
    });
    return () => { cancelled = true; };
  }, [text]);

  const quiet = 4;
  const box = (matrix?.size ?? 0) + quiet * 2;
  return (
    <div className="flex h-[196px] w-[196px] flex-shrink-0 items-center justify-center rounded-md bg-white">
      {matrix && (
        <svg role="img" aria-label={label} viewBox={`${-quiet} ${-quiet} ${box} ${box}`} className="h-full w-full" shapeRendering="crispEdges">
          <path d={matrix.path} fill="#000" />
        </svg>
      )}
    </div>
  );
}

/** Shown once, and never again: only their hashes stay on the server. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation(['settings', 'common']);
  const addToast = useUIStore((s) => s.addToast);
  const [saved, setSaved] = useState(false);
  const text = useMemo(() => `${codes.join('\n')}\n`, [codes]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      addToast(t('settings:security.twoFactor.recovery.copied'), 'success', 2000);
    } catch {
      addToast(t('settings:security.twoFactor.recovery.copyFailed'), 'warning', 3000);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-ui leading-5 text-txt-secondary">{t('settings:security.twoFactor.recovery.intro')}</p>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-md bg-surface-input p-3 font-mono text-ui text-txt-primary desktop:grid-cols-2">
        {codes.map((code) => <li key={code} className="select-all">{code}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { void copy(); }} className="btn-outline btn-sm">{t('settings:security.twoFactor.recovery.copy')}</button>
        <button type="button" onClick={download} className="btn-outline btn-sm">{t('settings:security.twoFactor.recovery.download')}</button>
      </div>
      <label className="flex items-start gap-2 text-ui leading-5 text-txt-secondary">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5 flex-shrink-0" />
        <span>{t('settings:security.twoFactor.recovery.saved')}</span>
      </label>
      <div className="flex justify-end">
        <button type="button" onClick={onDone} disabled={!saved} className="btn-primary">{t('settings:security.twoFactor.recovery.done')}</button>
      </div>
    </div>
  );
}

type Step =
  | { name: 'idle' }
  | { name: 'password' }
  | { name: 'scan'; setup: TwoFactorSetupResponse }
  | { name: 'codes'; codes: string[] }
  | { name: 'disable' }
  | { name: 'regenerate' };

/**
 * Turning two-factor authentication on and off. It comes on only when a code made from the new
 * secret comes back, and off only with the password and a code, so neither a token left on a
 * device nor a mailbox is enough.
 */
export function TwoFactorSection({ overview, onChanged }: { overview: SecurityOverview | null; onChanged: () => void }) {
  const { t } = useTranslation(['settings', 'common']);
  const f = useFormatters();
  const homeInstance = useAuthStore((s) => s.user?.homeInstance ?? null);
  const [step, setStep] = useState<Step>({ name: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (homeInstance) return null;

  const status = overview?.twoFactor;
  const go = (next: Step) => {
    setStep(next);
    setPassword('');
    setCode('');
    setError('');
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(describeError(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const passwordField = (
    <SettingsField label={t('settings:account.password.current.label')} htmlFor="two-factor-password">
      <input
        id="two-factor-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="input-standard w-full"
        autoComplete="current-password"
        autoFocus
      />
    </SettingsField>
  );

  const codeField = (
    <SettingsField label={t('settings:security.twoFactor.codeLabel')} hint={t('settings:security.twoFactor.codeHint')} htmlFor="two-factor-code">
      <input
        id="two-factor-code"
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="input-standard w-full font-mono"
        autoComplete="one-time-code"
        spellCheck={false}
        maxLength={32}
      />
    </SettingsField>
  );

  let body;
  if (step.name === 'password') {
    body = (
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        void run(async () => go({ name: 'scan', setup: await api.auth.twoFactorSetup(password) }));
      }}>
        <p className="text-ui leading-5 text-txt-secondary">{t('settings:security.twoFactor.confirmPassword')}</p>
        {passwordField}
        {error && <FormError>{error}</FormError>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => go({ name: 'idle' })} className="btn-quiet">{t('common:actions.cancel')}</button>
          <button type="submit" disabled={busy || !password} aria-busy={busy} className="btn-primary">{t('common:actions.continue')}</button>
        </div>
      </form>
    );
  } else if (step.name === 'scan') {
    body = (
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const { recoveryCodes } = await api.auth.twoFactorEnable(code.trim());
          go({ name: 'codes', codes: recoveryCodes });
          onChanged();
        });
      }}>
        <p className="text-ui leading-5 text-txt-secondary">{t('settings:security.twoFactor.scan')}</p>
        <div className="flex flex-col gap-4 desktop:flex-row desktop:items-start">
          <QrCode text={step.setup.otpauthUrl} label={t('settings:security.twoFactor.qrLabel')} />
          <div className="min-w-0 space-y-1.5">
            <p className="text-meta leading-relaxed text-txt-tertiary">{t('settings:security.twoFactor.manual')}</p>
            <p className="select-all break-all font-mono text-ui text-txt-primary">{step.setup.secret.replace(/(.{4})(?=.)/g, '$1 ')}</p>
          </div>
        </div>
        <SettingsField label={t('settings:security.twoFactor.firstCode')} htmlFor="two-factor-first-code">
          <input
            id="two-factor-first-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="input-standard w-full font-mono"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            spellCheck={false}
          />
        </SettingsField>
        {error && <FormError>{error}</FormError>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => go({ name: 'idle' })} className="btn-quiet">{t('common:actions.cancel')}</button>
          <button type="submit" disabled={busy || code.trim().length !== 6} aria-busy={busy} className="btn-primary">{t('settings:security.twoFactor.activate')}</button>
        </div>
      </form>
    );
  } else if (step.name === 'codes') {
    body = <RecoveryCodes codes={step.codes} onDone={() => go({ name: 'idle' })} />;
  } else if (step.name === 'disable' || step.name === 'regenerate') {
    const disabling = step.name === 'disable';
    body = (
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          if (disabling) {
            await api.auth.twoFactorDisable(password, code.trim());
            go({ name: 'idle' });
          } else {
            const { recoveryCodes } = await api.auth.twoFactorRecoveryCodes(password, code.trim());
            go({ name: 'codes', codes: recoveryCodes });
          }
          onChanged();
        });
      }}>
        <p className="text-ui leading-5 text-txt-secondary">
          {disabling ? t('settings:security.twoFactor.disableIntro') : t('settings:security.twoFactor.regenerateIntro')}
        </p>
        {passwordField}
        {codeField}
        {error && <FormError>{error}</FormError>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => go({ name: 'idle' })} className="btn-quiet">{t('common:actions.cancel')}</button>
          <button type="submit" disabled={busy || !password || !code.trim()} aria-busy={busy} className={disabling ? 'btn-danger' : 'btn-primary'}>
            {disabling ? t('settings:security.twoFactor.disable') : t('settings:security.twoFactor.regenerate')}
          </button>
        </div>
      </form>
    );
  } else if (!status) {
    body = <p className="text-ui text-txt-tertiary">{t('settings:security.sessions.loading')}</p>;
  } else if (status.enabled) {
    body = (
      <div className="space-y-3">
        <p className="text-ui leading-5 text-txt-secondary">
          {t('settings:security.twoFactor.enabledSince', { date: f.formatDateTime(status.enabledAt ?? 0) })}{' '}
          {t('settings:security.twoFactor.codesLeft', { count: status.recoveryCodesLeft })}
        </p>
        {status.recoveryCodesLeft <= 3 && <FormError>{t('settings:security.twoFactor.codesLow')}</FormError>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => go({ name: 'regenerate' })} className="btn-outline btn-sm">{t('settings:security.twoFactor.regenerate')}</button>
          <button type="button" onClick={() => go({ name: 'disable' })} className="btn-quiet btn-sm">{t('settings:security.twoFactor.disable')}</button>
        </div>
      </div>
    );
  } else if (!status.available) {
    body = <p className="text-ui leading-5 text-txt-secondary">{t('settings:security.twoFactor.unavailable')}</p>;
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-ui leading-5 text-txt-secondary">{t('settings:security.twoFactor.off')}</p>
        <button type="button" onClick={() => go({ name: 'password' })} className="btn-primary btn-sm">{t('settings:security.twoFactor.enable')}</button>
      </div>
    );
  }

  return (
    <SettingsSection title={t('settings:security.twoFactor.title')} description={t('settings:security.twoFactor.description')}>
      {body}
    </SettingsSection>
  );
}
