import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProfileLink, ProfileLinkedAccount } from '@backspace/shared';
import { linkedAccountServiceName, linkedAccountUrl, normalizeProfileLinkedAccounts } from '@backspace/shared/src/linkedAccounts';
import { normalizeProfileLinks, profileLinkText } from '@backspace/shared/src/profileFields';
import { Icon } from './Icon';

const CHIP = 'inline-flex max-w-full items-center gap-1.5 rounded-md bg-interactive-hover px-2 py-[3px] text-meta leading-[1.35] text-txt-secondary transition-colors hover:bg-interactive-selected hover:text-txt-primary active:bg-interactive-active';
const LIST_ROW = 'flex min-w-0 items-center gap-2 text-ui text-txt-link hover:underline';

/**
 * The links a profile shows, as chips on the card and as a list on the full
 * profile: first the accounts elsewhere the person linked by signing in there
 * (docs/systems/linked-accounts.md), marked as such, then the links they typed.
 *
 * Everything is checked again by the rule its instance stores it by: a profile
 * from another instance carries whatever that instance sent. A linked account
 * leads only to its own page at the service, built here from its handle; a
 * typed link only to a plain web address (`normalizeProfileLinks`,
 * docs/systems/auth.md "Profile fields"). One that fails is left out, the rest stay.
 */
export function ProfileLinks({ links, linkedAccounts, variant }: {
  links: readonly ProfileLink[] | undefined;
  linkedAccounts?: readonly ProfileLinkedAccount[] | undefined;
  variant: 'chips' | 'list';
}) {
  const { t } = useTranslation(['social']);
  const headingId = useId();

  const accounts = normalizeProfileLinkedAccounts(linkedAccounts)
    .map((account) => ({ account, url: linkedAccountUrl(account) }))
    .filter((entry): entry is { account: ProfileLinkedAccount; url: string } => entry.url !== null);

  // Each link on its own, so one bad entry hides only itself; each address
  // once. A host that sends something other than a list sends no links.
  const shown: ProfileLink[] = [];
  const given: readonly unknown[] = Array.isArray(links) ? links : [];
  for (const link of given) {
    const checked = normalizeProfileLinks([link])?.[0];
    if (checked && !shown.some((other) => other.url === checked.url) && !accounts.some((entry) => entry.url === checked.url)) shown.push(checked);
  }
  if (shown.length === 0 && accounts.length === 0) return null;

  return (
    <div>
      <span id={headingId} className="label-mono">{t('social:profile.links')}</span>
      <ul aria-labelledby={headingId} className={variant === 'chips' ? 'mt-1.5 flex flex-wrap gap-1.5' : 'mt-1.5 space-y-1'}>
        {accounts.map(({ account, url }) => {
          const service = linkedAccountServiceName(account.provider);
          const label = t('social:profile.linkedAccount', { service, name: account.name });
          return (
            <li key={`${account.provider}:${account.login}`} className="min-w-0 max-w-full">
              <a href={url} target="_blank" rel="noopener noreferrer nofollow" title={label} aria-label={label} className={variant === 'chips' ? CHIP : LIST_ROW}>
                <Icon name={account.provider} size={variant === 'chips' ? 12 : 14} className="flex-shrink-0" />
                <span className="truncate">{account.name}</span>
                <Icon name="check" size={11} strokeWidth={2.25} className="flex-shrink-0 text-txt-tertiary" />
              </a>
            </li>
          );
        })}
        {shown.map((link) => (
          <li key={link.url} className="min-w-0 max-w-full">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={link.url}
              className={variant === 'chips' ? CHIP : LIST_ROW}
            >
              <Icon name="link" size={12} className="flex-shrink-0 text-txt-tertiary" />
              <span className="truncate">{profileLinkText(link)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
