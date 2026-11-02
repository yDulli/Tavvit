import { LegalLinks } from '../legal/LegalLinks';
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { DesktopDownload } from './DesktopDownload';

/**
 * `/download`: the desktop app's page, open to everyone, signed in or not.
 * It is where the sign-in page's download block, the About page and every
 * installed app's "download the update" action lead.
 */
export function DownloadPage(): React.JSX.Element {
  const { t } = useTranslation(['desktop', 'common']);
  const signedIn = useAuthStore((s) => s.token !== null);

  return (
    <div className="stage-light relative isolate h-full overflow-y-auto bg-surface-base">
      <div aria-hidden="true" className="hero-light" />
      <header className="flex h-16 items-center justify-between px-4 desktop:px-6">
        {/* Plain link for a visitor: the product page at `/` is not one of the app's routes. */}
        <a href="/" className="flex items-center gap-2.5">
          <img src="/icons/logo-mark.svg" alt="" className="h-5 w-5" />
          <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('common:appName')}</span>
        </a>
        <Link to={signedIn ? '/channels/@me' : '/login'} className="btn-quiet">
          {signedIn ? t('desktop:download.backToApp') : t('desktop:download.signIn')}
        </Link>
      </header>

      <main className="rise-in mx-auto w-full max-w-[720px] px-4 py-8 desktop:px-6 desktop:py-14">
        <DesktopDownload variant="page" />
        <p className="mt-5 text-meta text-txt-tertiary">
          {t('desktop:download.browserNote')}{' '}
          <Link to={signedIn ? '/channels/@me' : '/login'} className="text-txt-link hover:underline">
            {t('desktop:download.openInBrowser')}
          </Link>
        </p>
        <LegalLinks className="mt-8" />
      </main>
    </div>
  );
}
