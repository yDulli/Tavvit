import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { getLanguage } from '../../i18n';
import { describeError } from '../../i18n/errors';
import { AUTH_FIELD, AUTH_LINK, AUTH_SUBMIT, AuthNotice, AuthShell } from './AuthShell';

/**
 * Asks for a link to choose a new password. The answer is the same whether the address
 * belongs to anyone, so the page cannot say more than that a link is on its way if it does.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'common']);
  const instanceInfo = useHomeInstanceInfo();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.auth.forgotPassword(email.trim(), getLanguage());
      setSent(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const back = <Link to="/login" className={AUTH_LINK}>{t('auth:forgot.back')}</Link>;
  const noMail = instanceInfo !== null && !instanceInfo.email;

  return (
    <AuthShell instanceInfo={instanceInfo}>
      <div className="mb-8">
        <h1 className="page-title">{t('auth:forgot.title')}</h1>
        {!sent && !noMail && <p className="mt-1 text-body text-txt-tertiary">{t('auth:forgot.subtitle')}</p>}
      </div>

      {noMail ? (
        <>
          <AuthNotice tone="warning" role="note" title={t('auth:forgot.noMail')} />
          <p className="text-ui leading-5">{back}</p>
        </>
      ) : sent ? (
        <>
          <p className="mb-2 text-body font-medium text-txt-primary">{t('auth:forgot.sentTitle')}</p>
          <p className="mb-5 text-ui leading-5 text-txt-secondary">{t('auth:forgot.sentBody')}</p>
          <p className="text-ui leading-5">{back}</p>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && <AuthNotice tone="danger" role="alert" title={error} />}
          <div className="mb-5">
            <label htmlFor="forgot-email" className="field-label">{t('auth:fields.email')}</label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={AUTH_FIELD}
              autoFocus
              autoComplete="email"
              required
            />
          </div>
          <button type="submit" disabled={busy || !email.trim()} aria-busy={busy} className={AUTH_SUBMIT}>
            {busy ? t('auth:forgot.submitting') : t('auth:forgot.submit')}
          </button>
          <p className="mt-4 text-ui leading-5">{back}</p>
        </form>
      )}
    </AuthShell>
  );
}
