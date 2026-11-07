import { isLinkedAccountProvider, LINKED_ACCOUNT_PROVIDERS, type LinkedAccountProvider, type ProfileLinkedAccount } from './types.js';
import { withoutUnsafeCharacters } from './profileFields.js';
import { isTwitchLogin, twitchChannelUrl } from './twitch.js';

/**
 * Linked accounts as a profile shows them (docs/systems/linked-accounts.md).
 * The instance that stores one and every client that shows one read it by the
 * rules here, so a profile from another instance cannot carry anything a
 * service would not name, nor a link anywhere but the account's own page.
 */

/** The longest name a service gives an account that a profile shows. */
export const LINKED_ACCOUNT_NAME_MAX = 64;

/** A service's own name, which no language translates. */
const SERVICE_NAMES: Record<LinkedAccountProvider, string> = { twitch: 'Twitch' };

export function linkedAccountServiceName(provider: LinkedAccountProvider): string {
  return SERVICE_NAMES[provider];
}

/** Where a service sends a person back after they signed in there: a page of this app. */
export function linkedAccountReturnPath(provider: LinkedAccountProvider): string {
  return `/linked-accounts/${provider}`;
}

/** Whether a value is a handle the service would give an account. */
export function isLinkedAccountLogin(provider: LinkedAccountProvider, value: unknown): value is string {
  switch (provider) {
    case 'twitch': return isTwitchLogin(value);
  }
}

/** The address of a linked account's own page, or null for a handle the service would not give. */
export function linkedAccountUrl(account: Pick<ProfileLinkedAccount, 'provider' | 'login'>): string | null {
  if (!isLinkedAccountLogin(account.provider, account.login)) return null;
  switch (account.provider) {
    case 'twitch': return twitchChannelUrl(account.login);
  }
}

/** The name a service gave an account, as a profile may show it: without the characters that disguise a name, within the limit. */
export function linkedAccountName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = withoutUnsafeCharacters(value).trim();
  return name.length > 0 && name.length <= LINKED_ACCOUNT_NAME_MAX ? name : null;
}

/** One linked account as a profile may show it, or null when anything in it is not what the service would name. */
export function normalizeProfileLinkedAccount(value: unknown): ProfileLinkedAccount | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  if (!isLinkedAccountProvider(entry.provider) || !isLinkedAccountLogin(entry.provider, entry.login)) return null;
  const name = linkedAccountName(entry.name);
  if (name === null) return null;
  return { provider: entry.provider, login: entry.login, name };
}

/** A profile's linked accounts, one per service at most; what is not one is left out. */
export function normalizeProfileLinkedAccounts(value: unknown): ProfileLinkedAccount[] {
  if (!Array.isArray(value)) return [];
  const shown: ProfileLinkedAccount[] = [];
  for (const item of value.slice(0, LINKED_ACCOUNT_PROVIDERS.length)) {
    const account = normalizeProfileLinkedAccount(item);
    if (account && !shown.some((other) => other.provider === account.provider)) shown.push(account);
  }
  return shown;
}

/** The stored list (`users.profile_linked_accounts`), as a profile shows it. */
export function parseStoredProfileLinkedAccounts(stored: string | null | undefined): ProfileLinkedAccount[] {
  if (!stored) return [];
  try {
    return normalizeProfileLinkedAccounts(JSON.parse(stored));
  } catch {
    return [];
  }
}
