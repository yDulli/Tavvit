import { useTranslation } from 'react-i18next';
import { hasStoredSession } from '../landing/entry';
import { LegalLinks } from './legal/LegalLinks';
import { Icon } from './ui/Icon';

/**
 * An address no route knows. Someone signed in gets back to the app; a visitor
 * to the product page, which is not one of the app's routes, so both are plain links.
 */
export function NotFoundPage() {
  const { t } = useTranslation('common');
  const signedIn = hasStoredSession();
  return (
    <div className="stage-light relative isolate h-full overflow-y-auto flex flex-col items-center bg-surface-base px-4 py-6">
      <div aria-hidden="true" className="hero-light" />
      <a href="/" className="flex w-fit items-center gap-2.5 self-start">
        <img src="/icons/logo-mark.svg" alt="" className="h-6 w-6" />
        <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('appName')}</span>
      </a>
      <main className="rise-in my-auto flex flex-col items-center text-center">
        <span aria-hidden="true" className="empty-state-icon mb-8">
          <Icon name="alert" size={18} />
        </span>
        <h1 className="display-title ink">{t('notFound.title')}</h1>
        <p className="mt-3 max-w-[440px] text-lead text-txt-secondary">{t('notFound.body')}</p>
        <a href={signedIn ? '/channels/@me' : '/'} className="btn-hero btn-lg mt-8">
          {signedIn ? t('notFound.toApp') : t('notFound.toHome')}
        </a>
      </main>
      <LegalLinks className="justify-center" />
    </div>
  );
}
