import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProfileLink } from '@backspace/shared';
import { normalizeProfileLinks, profileLinkText } from '@backspace/shared/src/profileFields';
import { Icon } from './Icon';

/**
 * The links a profile shows, as chips on the card and as a list on the full
 * profile. Every link is checked again by the rule its instance stores it by
 * (`normalizeProfileLinks`, docs/systems/auth.md "Profile fields"): a profile
 * from another instance carries whatever that instance sent, and only a plain
 * web address may become a link. One that fails is left out, the rest stay.
 */
export function ProfileLinks({ links, variant }: { links: readonly ProfileLink[] | undefined; variant: 'chips' | 'list' }) {
  const { t } = useTranslation(['social']);
  const headingId = useId();

  // Each link on its own, so one bad entry hides only itself; each address
  // once. A host that sends something other than a list sends no links.
  const shown: ProfileLink[] = [];
  const given: readonly unknown[] = Array.isArray(links) ? links : [];
  for (const link of given) {
    const checked = normalizeProfileLinks([link])?.[0];
    if (checked && !shown.some((other) => other.url === checked.url)) shown.push(checked);
  }
  if (shown.length === 0) return null;

  return (
    <div>
      <span id={headingId} className="label-mono">{t('social:profile.links')}</span>
      <ul aria-labelledby={headingId} className={variant === 'chips' ? 'mt-1.5 flex flex-wrap gap-1.5' : 'mt-1.5 space-y-1'}>
        {shown.map((link) => (
          <li key={link.url} className="min-w-0 max-w-full">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={link.url}
              className={variant === 'chips'
                ? 'inline-flex max-w-full items-center gap-1.5 rounded-md bg-interactive-hover px-2 py-[3px] text-meta leading-[1.35] text-txt-secondary transition-colors hover:bg-interactive-selected hover:text-txt-primary active:bg-interactive-active'
                : 'flex min-w-0 items-center gap-2 text-ui text-txt-link hover:underline'}
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
