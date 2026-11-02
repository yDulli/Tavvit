import { useLegalStore } from '../../stores/legalStore';
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { api, HttpError, RateLimitError } from '../../api/client';
import type { InstanceInfoResponse } from '@backspace/shared';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';
import { AUTH_FIELD, AUTH_LINK, AUTH_SUBMIT, AuthNotice, AuthShell } from './AuthShell';
import { SecondFactorStep } from './SecondFactorStep';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';

/** What the operator types on the server to make the first account (docs/tavvit/FIRST-ADMIN.md). */
const FIRST_ADMIN_COMMAND = './tavvit-admin.sh create <username> --admin';

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common', 'legal']);
  const operatorEmail = useLegalStore((s) => s.info?.operator?.email);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // The fields a refused sign-in is about, until they are changed.
  const [invalid, setInvalid] = useState({ username: false, password: false });
  // A suspension (admin.md, "Suspensions"): the instance tells the account's
  // owner its reason and end once the password was right.
  const [suspension, setSuspension] = useState<{ reason: string; until: number | null } | null>(null);
  const f = useFormatters();
  const [retryAfter, setRetryAfter] = useState(0);
  // The password was right and the account has a second factor: this is what the next step takes.
  const [ticket, setTicket] = useState<string | null>(null);
  const login = useAuthStore((s) => s.login);
  const initSession = useAuthStore((s) => s.initSession);
  const isLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');

  // The public info says which server this is and whether anyone can sign in
  // yet, so it is fetched without a login. Still asking and unable to ask are
  // both different from an answer: neither says how this server takes accounts.
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfoResponse | null>(null);
  const [instanceInfoFailed, setInstanceInfoFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.instance.info()
      .then((info) => { if (!cancelled) setInstanceInfo(info); })
      .catch(() => { if (!cancelled) setInstanceInfoFailed(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(() => {
      setRetryAfter((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter]);

  const proceed = () => {
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      navigate(redirect);
    } else {
      navigate('/channels/@me');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuspension(null);
    setInvalid({ username: false, password: false });

    if (!username.trim()) {
      setInvalid({ username: true, password: false });
      setError(t('auth:validation.usernameRequired'));
      return;
    }
    if (!password) {
      setInvalid({ username: false, password: true });
      setError(t('auth:validation.passwordRequired'));
      return;
    }

    try {
      await login(username.trim(), password);
      proceed();
    } catch (err) {
      const offered = err instanceof HttpError && err.code === 'mfa_required'
        ? (err.body as { ticket?: unknown } | undefined)?.ticket
        : undefined;
      if (typeof offered === 'string') {
        setTicket(offered);
        setPassword('');
      } else if (err instanceof RateLimitError) {
        setRetryAfter(err.retryAfter);
        setError('');
      } else if (err instanceof HttpError && err.code === 'account_suspended') {
        setError('');
        setSuspension({
          reason: typeof err.details?.reason === 'string' ? err.details.reason : '',
          until: typeof err.details?.until === 'number' ? err.details.until : null,
        });
      } else {
        if (err instanceof HttpError && err.code === 'invalid_credentials') setInvalid({ username: true, password: true });
        setError(err instanceof Error ? describeError(err) : t('auth:login.failed'));
      }
    }
  };

  const isDisabled = isLoading || retryAfter > 0;
  const setupRequired = instanceInfo?.setupRequired === true;
  const inviteOnly = instanceInfo?.registrationOpen === false;
  const registerLink = (
    <Link
      to={`/register${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
      className={AUTH_LINK}
    />
  );

  if (ticket !== null) {
    return (
      <AuthShell instanceInfo={instanceInfo}>
        <SecondFactorStep
          ticket={ticket}
          onSignedIn={(response) => {
            initSession(response.token, response.user);
            proceed();
          }}
          onExpired={() => {
            setTicket(null);
            setError(t('auth:mfa.expired'));
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell instanceInfo={instanceInfo}>
      <div className="mb-8">
        <h1 className="page-title">{t('auth:login.title')}</h1>
        <p className="mt-1 text-body text-txt-tertiary">
          {t('auth:login.subtitle', { instance: instanceInfo?.name ?? DEFAULT_INSTANCE_NAME })}
        </p>
      </div>

      {setupRequired && (
        <AuthNotice tone="warning" role="note" title={t('auth:login.setup.title')}>
          <p className="mt-1 text-txt-secondary">{t('auth:login.setup.body')}</p>
          <pre className="mt-2 overflow-x-auto rounded bg-surface-input px-3 py-2 font-mono text-ui text-txt-primary select-all">{FIRST_ADMIN_COMMAND}</pre>
          <p className="mt-2 text-meta text-txt-tertiary">{t('auth:login.setup.hint')}</p>
        </AuthNotice>
      )}

      <form onSubmit={handleSubmit}>
        {retryAfter > 0 && (
          <AuthNotice tone="warning" title={t('auth:login.rateLimited.title')}>
            <p className="mt-0.5 text-txt-secondary">{t('auth:login.rateLimited.retryIn', { seconds: retryAfter })}</p>
          </AuthNotice>
        )}

        {error && <AuthNotice tone="danger" role="alert" title={error} />}

        {suspension && (
          <AuthNotice tone="danger" role="alert" title={t('auth:login.suspended.title')}>
            <p className="mt-1 text-txt-secondary">
              {suspension.until === null
                ? t('auth:login.suspended.untilLifted')
                : t('auth:login.suspended.until', { date: f.formatDateTime(suspension.until) })}
            </p>
            {suspension.reason && (
              <p className="mt-1 whitespace-pre-wrap break-words text-txt-secondary">{t('auth:login.suspended.reason', { reason: suspension.reason })}</p>
            )}
            <p className="mt-1 text-meta text-txt-tertiary">{t('legal:notices.redress')}</p>
            {operatorEmail && <p className="mt-1 text-meta text-txt-tertiary">{t('legal:notices.contact', { email: operatorEmail })}</p>}
          </AuthNotice>
        )}

        <div className="mb-4">
          <label htmlFor="login-username" className="field-label">
            {instanceInfo?.email ? t('auth:login.usernameOrEmail') : t('common:labels.username')} <span className="text-txt-danger">*</span>
          </label>
          <input
            id="login-username"
            type="text"
            value={username}
            onChange={(e) => { setUsername(e.target.value); setInvalid((fields) => ({ ...fields, username: false })); }}
            aria-invalid={invalid.username}
            className={AUTH_FIELD}
            autoFocus
            autoComplete="username"
          />
        </div>

        <div className="mb-5">
          <label htmlFor="login-password" className="field-label">
            {t('common:labels.password')} <span className="text-txt-danger">*</span>
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setInvalid((fields) => ({ ...fields, password: false })); }}
            aria-invalid={invalid.password}
            className={AUTH_FIELD}
            autoComplete="current-password"
          />
          {instanceInfo?.email && (
            <p className="mt-1.5 text-meta">
              <Link to="/forgot-password" className={AUTH_LINK}>{t('auth:login.forgot')}</Link>
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isDisabled}
          aria-busy={isLoading}
          className={AUTH_SUBMIT}
        >
          {retryAfter > 0
            ? t('auth:login.rateLimited.retryIn', { seconds: retryAfter })
            : isLoading
              ? t('auth:login.submitting')
              : t('common:actions.logIn')}
        </button>

        {/* Nobody can register while the server is empty and closed, so there is
            nothing to offer then. Otherwise the line says only what is known.
            Until the server answers it stays empty and keeps room for two
            lines, so the form does not jump when the answer arrives. If the
            server cannot answer, the plain prompt stands, as on the landing and
            registration pages: /register asks again, and the server is the gate
            there. */}
        {!setupRequired && (
          <p className="mt-4 min-h-10 text-ui leading-5 text-txt-tertiary">
            {(instanceInfo !== null || instanceInfoFailed) && (
              <Trans
                t={t}
                i18nKey={inviteOnly ? 'auth:login.inviteOnlyPrompt' : 'auth:login.registerPrompt'}
                components={{ actionLink: registerLink }}
              />
            )}
          </p>
        )}
      </form>
    </AuthShell>
  );
}
