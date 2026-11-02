import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';

/**
 * The way to the legal pages, on every surface a person reaches them from:
 * before signing in, in the settings and on About. They must be easy to find
 * from anywhere (DDG § 5), so this is one line and not a menu.
 *
 * They open beside the app: leaving it would end a call and close the socket,
 * and on the sign-up page lose what was typed. Only the legal pages themselves
 * move within the window (`sameWindow`).
 *
 * The last entry is the source offer AGPL § 13 asks of an instance, to everyone
 * who uses it over the network. It is a plain word beside the others, and the
 * server says where it leads (`GET /api/instance/info`, docs/systems/legal.md).
 */
export function LegalLinks({ sameWindow = false, className }: { sameWindow?: boolean; className?: string }) {
  const { t } = useTranslation('legal');
  const sourceCodeUrl = useHomeInstanceInfo()?.sourceCodeUrl;
  const links = [
    { to: '/terms', label: t('links.terms') },
    { to: '/privacy', label: t('links.privacy') },
    { to: '/imprint', label: t('links.imprint') },
    { to: '/report', label: t('links.report') },
  ];
  return (
    <nav aria-label={t('links.label')} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-txt-tertiary ${className ?? ''}`}>
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          {...(sameWindow ? {} : { target: '_blank', rel: 'noopener' })}
          className="hover:text-txt-secondary hover:underline transition-colors"
        >
          {link.label}
        </Link>
      ))}
      {sourceCodeUrl && (
        <a
          href={sourceCodeUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-txt-secondary hover:underline transition-colors"
        >
          {t('links.source')}
        </a>
      )}
    </nav>
  );
}
