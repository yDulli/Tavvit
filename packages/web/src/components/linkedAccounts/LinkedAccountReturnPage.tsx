import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isLinkedAccountProvider, type LinkedAccountProvider } from '@backspace/shared';
import { linkedAccountReturnPath, linkedAccountServiceName } from '@backspace/shared/src/linkedAccounts';
import { api } from '../../api/client';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { describeError } from '../../i18n/errors';
import { useAuthStore } from '../../stores/authStore';
import { useLinkedAccountsStore } from '../../stores/linkedAccountsStore';
import { openUserSettings } from '../../utils/openUserSettings';
import { AUTH_SUBMIT, AuthShell } from '../auth/AuthShell';
import { LoadingSpinner } from '../ui/LoadingSpinner';

/** What the service handed back, kept across a sign-in in this tab and nowhere else. */
const STASH_KEY = 'tavvit-linked-account-return';

interface Returned {
  provider: LinkedAccountProvider;
  code: string | null;
  state: string | null;
  /** The service's own word for why it sent the person back without a code (`access_denied`: they cancelled). */
  error: string | null;
}

function readStash(provider: LinkedAccountProvider): Returned | null {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STASH_KEY) ?? 'null') as Partial<Returned> | null;
    if (!stored || stored.provider !== provider) return null;
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    return { provider, code: text(stored.code), state: text(stored.state), error: text(stored.error) };
  } catch {
    return null;
  }
}

function writeStash(returned: Returned | null): void {
  try {
    if (returned) window.sessionStorage.setItem(STASH_KEY, JSON.stringify(returned));
    else window.sessionStorage.removeItem(STASH_KEY);
  } catch {
    // Without storage the person signs in and starts the link again.
  }
}

/** What the service put in this page's address, or what was kept from it across a sign-in. */
function returnedOf(provider: LinkedAccountProvider): Returned | null {
  const params = new URLSearchParams(window.location.search);
  if (params.has('code') || params.has('state') || params.has('error')) {
    return { provider, code: params.get('code'), state: params.get('state'), error: params.get('error') };
  }
  return readStash(provider);
}

type Outcome =
  | { kind: 'working' }
  | { kind: 'linked'; name: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string }
  | { kind: 'nothing' };

/**
 * Where a service sends a person back after they signed in there to link their account
 * (docs/systems/linked-accounts.md). It completes the link with the session of whoever is signed
 * in in this browser, which is what makes a link sent to somebody else useless: the server takes
 * it only from the account that started it. Signed out, it keeps what the service handed back for
 * this tab, has the person sign in, and goes on. The code leaves the address bar at once.
 */
export function LinkedAccountReturnPage() {
  const { t } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const instanceInfo = useHomeInstanceInfo();
  const token = useAuthStore((s) => s.token);
  const params = useParams<{ provider: string }>();
  const provider = isLinkedAccountProvider(params.provider) ? params.provider : null;
  const [returned] = useState<Returned | null>(() => (provider ? returnedOf(provider) : null));
  const [outcome, setOutcome] = useState<Outcome>(() => (returned ? { kind: 'working' } : { kind: 'nothing' }));
  // A state is good once: React may run the effect below twice, and the second must not ask again.
  const asked = useRef(false);

  // Out of the address bar and the history: the code is for this page only.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (!returned || !token || asked.current) return;
    asked.current = true;
    writeStash(null);
    if (returned.error !== null || !returned.code || !returned.state) {
      setOutcome(returned.error === 'access_denied' ? { kind: 'cancelled' } : { kind: 'failed', message: t('settings:linkedAccounts.return.incomplete') });
      return;
    }
    const { code, state } = returned;
    void (async () => {
      try {
        const response = await api.users.completeLinkedAccount(returned.provider, { code, state });
        useLinkedAccountsStore.getState().apply(response);
        const account = response.accounts.find((entry) => entry.provider === returned.provider);
        setOutcome({ kind: 'linked', name: account?.name ?? linkedAccountServiceName(returned.provider) });
      } catch (err) {
        setOutcome({ kind: 'failed', message: describeError(err) });
      }
    })();
  }, [returned, token, t]);

  // Signed out: keep what the service handed back for this tab, sign in, come back here.
  if (provider && returned && !token) {
    writeStash(returned);
    return <Navigate to={`/login?redirect=${encodeURIComponent(linkedAccountReturnPath(provider))}`} replace />;
  }

  const service = provider ? linkedAccountServiceName(provider) : '';
  const backToSettings = () => {
    navigate('/channels/@me', { replace: true });
    openUserSettings('linkedAccounts');
  };

  let title: string;
  let body: ReactNode;
  switch (outcome.kind) {
    case 'working':
      title = t('settings:linkedAccounts.return.working', { service });
      body = <div className="flex justify-center py-4"><LoadingSpinner /></div>;
      break;
    case 'linked':
      title = t('settings:linkedAccounts.return.linkedTitle', { service });
      body = (
        <>
          <p className="mb-2 break-words text-ui leading-5 text-txt-secondary">{t('settings:linkedAccounts.return.linkedBody', { name: outcome.name })}</p>
          <p className="mb-5 text-meta leading-5 text-txt-tertiary">{t('settings:linkedAccounts.return.desktopNote')}</p>
          <button type="button" onClick={backToSettings} className={AUTH_SUBMIT}>{t('settings:linkedAccounts.return.back')}</button>
        </>
      );
      break;
    case 'cancelled':
    case 'failed':
    case 'nothing':
      title = t('settings:linkedAccounts.return.notLinkedTitle');
      body = (
        <>
          <p className="mb-5 break-words text-ui leading-5 text-txt-secondary">
            {outcome.kind === 'cancelled'
              ? t('settings:linkedAccounts.return.cancelled', { service })
              : outcome.kind === 'failed'
                ? outcome.message
                : t('settings:linkedAccounts.return.nothing')}
          </p>
          <button type="button" onClick={backToSettings} className={AUTH_SUBMIT}>{t('settings:linkedAccounts.return.back')}</button>
        </>
      );
      break;
  }

  return (
    <AuthShell instanceInfo={instanceInfo}>
      <h1 className="mb-4 page-title">{title}</h1>
      {body}
    </AuthShell>
  );
}
