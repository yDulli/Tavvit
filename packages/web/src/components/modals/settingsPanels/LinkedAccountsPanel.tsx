import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LINKED_ACCOUNT_PROVIDERS, type LinkedAccountProvider, type LinkedAccountView } from '@backspace/shared';
import { linkedAccountServiceName, linkedAccountUrl } from '@backspace/shared/src/linkedAccounts';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { isElectron } from '../../../platform/platform';
import { useActivityStore } from '../../../stores/activityStore';
import { useLinkedAccountsStore } from '../../../stores/linkedAccountsStore';
import { Icon } from '../../ui/Icon';
import { FormError, SettingsPage, SettingsSection, ToggleRow } from './_shared/SettingsControls';

/**
 * Send the person to sign in at the service. In a browser this tab goes there and the service
 * brings it back to `/linked-accounts/<provider>`; the desktop app hands the address to the
 * system browser, where the link is completed, and this panel hears of it over the socket.
 */
function openSignIn(url: string): 'here' | 'browser' {
  if (isElectron()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return 'browser';
  }
  window.location.assign(url);
  return 'here';
}

/** The service's mark in a quiet tile. */
function ServiceMark({ provider }: { provider: LinkedAccountProvider }) {
  return (
    <span aria-hidden="true" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border-soft bg-surface-input text-txt-primary">
      <Icon name={provider} size={18} />
    </span>
  );
}

function LinkedService({ provider, account, offered, sharing, onError }: {
  provider: LinkedAccountProvider;
  account: LinkedAccountView | undefined;
  offered: boolean;
  sharing: boolean;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(['settings']);
  const f = useFormatters();
  const [busy, setBusy] = useState<'link' | 'unlink' | 'change' | null>(null);
  const [inBrowser, setInBrowser] = useState(false);
  const service = linkedAccountServiceName(provider);

  // A link completed in the browser arrives over the socket; the note has done its work then.
  useEffect(() => {
    if (account) setInBrowser(false);
  }, [account]);

  const link = async () => {
    setBusy('link');
    onError('');
    try {
      const { url } = await api.users.startLinkedAccount(provider);
      // In this tab the page is leaving; it stays busy until it has.
      if (openSignIn(url) === 'browser') {
        setInBrowser(true);
        setBusy(null);
      }
    } catch (err) {
      onError(describeError(err));
      setBusy(null);
    }
  };

  const change = async (body: { showOnProfile?: boolean; showLive?: boolean }) => {
    setBusy('change');
    onError('');
    try {
      useLinkedAccountsStore.getState().apply(await api.users.updateLinkedAccount(provider, body));
    } catch (err) {
      onError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  const unlink = async () => {
    setBusy('unlink');
    onError('');
    try {
      useLinkedAccountsStore.getState().apply(await api.users.unlinkAccount(provider));
    } catch (err) {
      onError(describeError(err));
    } finally {
      setBusy(null);
    }
  };

  if (!account) {
    return (
      <SettingsSection title={service}>
        <div className="flex flex-wrap items-center gap-3">
          <ServiceMark provider={provider} />
          <div className="min-w-0 flex-1">
            <div className="text-ui font-medium text-txt-primary">{service}</div>
            <p className="mt-0.5 text-meta leading-snug text-txt-tertiary">{t('settings:linkedAccounts.twitch.offer')}</p>
          </div>
          <button
            type="button"
            onClick={() => { void link(); }}
            disabled={!offered || busy !== null}
            aria-busy={busy === 'link'}
            className="btn-primary btn-sm"
          >
            {busy === 'link' ? t('settings:linkedAccounts.linking', { service }) : t('settings:linkedAccounts.link', { service })}
          </button>
        </div>
        {inBrowser && (
          <p role="status" className="text-meta leading-snug text-txt-secondary">{t('settings:linkedAccounts.openedInBrowser', { service })}</p>
        )}
      </SettingsSection>
    );
  }

  const url = linkedAccountUrl(account);
  return (
    <SettingsSection title={service}>
      <div className="flex flex-wrap items-center gap-3">
        <ServiceMark provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-ui font-medium text-txt-primary">{account.name}</span>
            <Icon name="check" size={13} strokeWidth={2.25} className="flex-shrink-0 text-txt-tertiary" title={t('settings:linkedAccounts.verified')} />
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-meta text-txt-tertiary">
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="truncate font-mono hover:text-txt-secondary hover:underline">
                {url.replace(/^https:\/\/(www\.)?/, '')}
              </a>
            )}
            <span>{t('settings:linkedAccounts.linkedOn', { date: f.formatMediumDate(account.linkedAt) })}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void unlink(); }}
          disabled={busy !== null}
          aria-busy={busy === 'unlink'}
          className="btn-outline btn-sm"
        >
          {busy === 'unlink' ? t('settings:linkedAccounts.unlinking') : t('settings:linkedAccounts.unlink')}
        </button>
      </div>
      <ToggleRow
        label={t('settings:linkedAccounts.showOnProfile')}
        description={t('settings:linkedAccounts.showOnProfileDescription')}
        enabled={account.showOnProfile}
        disabled={busy !== null}
        onChange={(enabled) => { void change({ showOnProfile: enabled }); }}
      />
      <ToggleRow
        label={t('settings:linkedAccounts.showLive')}
        description={sharing ? t('settings:linkedAccounts.showLiveDescription') : t('settings:linkedAccounts.showLiveSharingOff')}
        enabled={account.showLive}
        disabled={busy !== null}
        onChange={(enabled) => { void change({ showLive: enabled }); }}
      />
    </SettingsSection>
  );
}

/**
 * Settings → Linked accounts (docs/systems/linked-accounts.md): accounts elsewhere the person
 * links by signing in there, so only their own. A service shows while this server offers it, and
 * also after its operator stopped offering it while something is still linked there, so it can
 * be unlinked.
 */
export function LinkedAccountsPanel() {
  const { t } = useTranslation(['settings']);
  const accounts = useLinkedAccountsStore((s) => s.accounts);
  const available = useLinkedAccountsStore((s) => s.available);
  const sharing = useActivityStore((s) => s.showActivity);
  const [error, setError] = useState('');

  useEffect(() => {
    useLinkedAccountsStore.getState().load().catch((err: unknown) => setError(describeError(err)));
  }, []);

  const services = LINKED_ACCOUNT_PROVIDERS.filter((provider) => available.includes(provider) || accounts?.some((account) => account.provider === provider));

  return (
    <SettingsPage title={t('settings:linkedAccounts.title')} intro={t('settings:linkedAccounts.intro')}>
      {error && <FormError>{error}</FormError>}
      {accounts !== null && services.length === 0 && (
        <p className="text-ui text-txt-secondary">{t('settings:linkedAccounts.noneOffered')}</p>
      )}
      {accounts !== null && services.map((provider) => (
        <LinkedService
          key={provider}
          provider={provider}
          account={accounts.find((account) => account.provider === provider)}
          offered={available.includes(provider)}
          sharing={sharing}
          onError={setError}
        />
      ))}
    </SettingsPage>
  );
}
