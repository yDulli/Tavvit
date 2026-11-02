import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, HttpError } from '../../api/client';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { describeError } from '../../i18n/errors';
import { AUTH_LINK, AUTH_SUBMIT, AuthShell } from './AuthShell';
import { useLinkToken } from './linkToken';

/**
 * Where a confirmation link leads. It takes a click: mail scanners open links, and an
 * address must not count as confirmed because one of them did. Works signed out, because
 * the link itself names the account; it signs nobody in.
 */
export function VerifyEmailPage() {
  const { t } = useTranslation(['auth', 'common']);
  const instanceInfo = useHomeInstanceInfo();
  const token = useLinkToken();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [problem, setProblem] = useState(token === '' ? t('auth:verify.invalidBody') : '');

  const confirm = async () => {
    setBusy(true);
    try {
      setConfirmed((await api.auth.verifyEmail(token)).address);
    } catch (err) {
      setProblem(err instanceof HttpError && err.code === 'email_token_invalid' ? t('auth:verify.invalidBody') : describeError(err));
    } finally {
      setBusy(false);
    }
  };

  let title = t('auth:verify.title');
  let body: React.ReactNode;
  if (confirmed !== null) {
    title = t('auth:verify.doneTitle');
    body = (
      <>
        <p className="mb-5 break-words text-ui leading-5 text-txt-secondary">{t('auth:verify.doneBody', { address: confirmed })}</p>
        <Link to="/channels/@me" className={`${AUTH_SUBMIT} flex items-center justify-center`}>{t('auth:verify.continue')}</Link>
      </>
    );
  } else if (problem) {
    title = t('auth:verify.invalidTitle');
    body = (
      <>
        <p className="mb-5 text-ui leading-5 text-txt-secondary">{problem}</p>
        <Link to="/channels/@me" className={AUTH_LINK}>{t('auth:verify.continue')}</Link>
      </>
    );
  } else {
    body = (
      <>
        <p className="mb-5 text-ui leading-5 text-txt-secondary">{t('auth:verify.subtitle')}</p>
        <button type="button" onClick={() => { void confirm(); }} disabled={busy} aria-busy={busy} className={AUTH_SUBMIT}>
          {busy ? t('auth:verify.submitting') : t('auth:verify.submit')}
        </button>
      </>
    );
  }

  return (
    <AuthShell instanceInfo={instanceInfo}>
      <h1 className="mb-4 page-title">{title}</h1>
      {body}
    </AuthShell>
  );
}
