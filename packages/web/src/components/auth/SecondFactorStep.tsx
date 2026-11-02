import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthResponse } from '@backspace/shared';
import { api, HttpError, RateLimitError } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { AUTH_FIELD, AUTH_LINK, AUTH_SUBMIT, AuthNotice } from './AuthShell';

/**
 * The sign-in's second step. Holding the ticket opens nothing by itself: only a right code
 * here gets a session. The way out for a lost phone is a recovery code, never a mail.
 */
export function SecondFactorStep({ ticket, onSignedIn, onExpired }: {
  ticket: string;
  onSignedIn: (response: AuthResponse) => void | Promise<void>;
  /** The ticket ran out or was used up: back to the password. */
  onExpired: () => void;
}): React.JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  const [code, setCode] = useState('');
  const [usingRecovery, setUsingRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSignedIn(await api.auth.loginSecondFactor({ ticket, code: code.trim() }));
    } catch (err) {
      if (err instanceof HttpError && err.code === 'mfa_ticket_invalid') {
        onExpired();
        return;
      }
      setError(err instanceof RateLimitError ? t('auth:mfa.locked', { seconds: err.retryAfter }) : describeError(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    setUsingRecovery(!usingRecovery);
    setCode('');
    setError('');
  };

  return (
    <form onSubmit={submit}>
      <div className="mb-8">
        <h1 className="page-title">{t('auth:mfa.title')}</h1>
        <p className="mt-1 text-body text-txt-tertiary">{usingRecovery ? t('auth:mfa.subtitleRecovery') : t('auth:mfa.subtitle')}</p>
      </div>
      {error && <AuthNotice tone="danger" role="alert" title={error} />}
      <div className="mb-5">
        <label htmlFor="login-code" className="field-label">{usingRecovery ? t('auth:mfa.recoveryLabel') : t('auth:mfa.codeLabel')}</label>
        <input
          id="login-code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${AUTH_FIELD} font-mono`}
          autoFocus
          autoComplete={usingRecovery ? 'off' : 'one-time-code'}
          inputMode={usingRecovery ? 'text' : 'numeric'}
          maxLength={usingRecovery ? 32 : 6}
          spellCheck={false}
        />
      </div>
      <button type="submit" disabled={busy || !code.trim()} aria-busy={busy} className={AUTH_SUBMIT}>
        {busy ? t('auth:login.submitting') : t('auth:mfa.submit')}
      </button>
      <p className="mt-4 text-ui leading-5">
        <button type="button" onClick={toggle} className={AUTH_LINK}>
          {usingRecovery ? t('auth:mfa.useCode') : t('auth:mfa.useRecovery')}
        </button>
      </p>
      <p className="mt-2 text-meta leading-4 text-txt-tertiary">{t('auth:mfa.lost')}</p>
    </form>
  );
}
