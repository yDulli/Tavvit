import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH } from '@backspace/shared/src/constants';
import { api, HttpError } from '../../api/client';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { describeError } from '../../i18n/errors';
import { AUTH_FIELD, AUTH_LINK, AUTH_SUBMIT, AuthNotice, AuthShell } from './AuthShell';
import { useLinkToken } from './linkToken';

/**
 * Where a reset link leads. The link only lets its holder choose a password: nobody is signed
 * in by it, and every device has to sign in again afterwards.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation(['auth', 'common']);
  const instanceInfo = useHomeInstanceInfo();
  const token = useLinkToken();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [linkDead, setLinkDead] = useState(token === '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(t('auth:validation.passwordMinLength', { min: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t('auth:validation.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      if (err instanceof HttpError && err.code === 'email_token_invalid') setLinkDead(true);
      else setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (done) {
    body = (
      <>
        <p className="mb-5 text-ui leading-5 text-txt-secondary">{t('auth:reset.doneBody')}</p>
        <Link to="/login" className={`${AUTH_SUBMIT} flex items-center justify-center`}>{t('auth:reset.toLogin')}</Link>
      </>
    );
  } else if (linkDead) {
    body = (
      <>
        <p className="mb-5 text-ui leading-5 text-txt-secondary">{t('auth:reset.invalidBody')}</p>
        <Link to="/forgot-password" className={AUTH_LINK}>{t('auth:reset.requestNew')}</Link>
      </>
    );
  } else {
    body = (
      <form onSubmit={handleSubmit}>
        {error && <AuthNotice tone="danger" role="alert" title={error} />}
        <div className="mb-4">
          <label htmlFor="reset-password" className="field-label">{t('auth:reset.newPassword')}</label>
          <input
            id="reset-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_FIELD}
            autoFocus
            autoComplete="new-password"
          />
        </div>
        <div className="mb-5">
          <label htmlFor="reset-confirm" className="field-label">{t('auth:fields.confirmPassword')}</label>
          <input
            id="reset-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={AUTH_FIELD}
            autoComplete="new-password"
          />
        </div>
        <button type="submit" disabled={busy || !password || !confirm} aria-busy={busy} className={AUTH_SUBMIT}>
          {busy ? t('auth:reset.submitting') : t('auth:reset.submit')}
        </button>
      </form>
    );
  }

  const title = done ? t('auth:reset.doneTitle') : linkDead ? t('auth:reset.invalidTitle') : t('auth:reset.title');
  return (
    <AuthShell instanceInfo={instanceInfo}>
      <div className="mb-8">
        <h1 className="page-title">{title}</h1>
        {!done && !linkDead && <p className="mt-1 text-body text-txt-tertiary">{t('auth:reset.subtitle')}</p>}
      </div>
      {body}
    </AuthShell>
  );
}
