import React from 'react';
import { useTranslation } from 'react-i18next';
import { LegalLinks } from '../legal/LegalLinks';

/**
 * The one card a public page is (an invite, a shared look): floating in the middle of the page,
 * as wide as a dialog.
 */
export const PUBLIC_CARD = 'modal-panel my-auto flex-shrink-0 w-full max-w-[440px] glass-modal rounded-lg p-6 desktop:p-8 z-10';

/**
 * The page around such a card, reached by a link before or without signing in: its light, where
 * you are with a way to the start, and the legal line every public page has.
 */
export function PublicPageFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common');
  return (
    <div className="stage-light isolate h-full overflow-y-auto flex flex-col items-center bg-surface-base relative px-4 py-6">
      <div aria-hidden="true" className="hero-light" />
      <a href="/" className="mb-6 flex w-fit items-center gap-2.5 self-start">
        <img src="/icons/logo-mark.svg" alt="" className="h-6 w-6" />
        <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('appName')}</span>
      </a>
      {children}
      <LegalLinks className="mt-6 justify-center" />
    </div>
  );
}
