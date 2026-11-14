import React from 'react';
import { useTranslation } from 'react-i18next';
import type { InstanceInfoResponse } from '@backspace/shared';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';
import { DesktopDownload } from '../download/DesktopDownload';
import { LegalLinks } from '../legal/LegalLinks';
import { ChromeWord } from '../ui/ChromeWord';
import { LightField } from '../ui/LightField';
import { LanguageSelect } from '../ui/LanguageSelect';

/** The fields and the main button of these pages: one height, and a thumb's on a phone. */
export const AUTH_FIELD = 'input-standard h-11 w-full desktop:h-10';
export const AUTH_SUBMIT = 'btn-hero btn-lg h-11 w-full desktop:h-10';

/** A link in the running text of these pages. */
export const AUTH_LINK = 'text-txt-link hover:underline';

/**
 * A message above a form. `danger` says what went wrong, `warning` what stands in
 * the way for now. The title is the message; what follows it are the details.
 */
export function AuthNotice({ tone, title, role, children }: {
  tone: 'danger' | 'warning';
  title: string;
  role?: 'alert' | 'note';
  children?: React.ReactNode;
}): React.JSX.Element {
  const edge = tone === 'danger' ? 'border-accent-rose/30 bg-accent-rose/[0.06]' : 'border-accent-amber/30 bg-accent-amber/[0.06]';
  return (
    <div role={role} className={`mb-4 rounded-md border px-3 py-2.5 text-ui leading-5 ${edge}`}>
      <p className={`font-medium ${tone === 'danger' ? 'text-txt-danger' : 'text-txt-warning'}`}>{title}</p>
      {children}
    </div>
  );
}

/**
 * The frame of the sign-in and the sign-up page, in the product page's look: its
 * light, its rings and its type. On the left, which place this is (the server's
 * name and address) and the desktop app's download; on the right, the form, on a
 * card that floats in the light. On a phone the two stack.
 *
 * A server's own name is the largest thing on the page, because it is what a
 * person needs to recognise before they type a password into it. One that kept
 * the product's name would only repeat the logo above it, so a line about what
 * this is stands there instead; the address below is shown either way.
 */
export function AuthShell({ instanceInfo, children }: {
  instanceInfo: InstanceInfoResponse | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation(['auth', 'common']);
  const name = instanceInfo?.name ?? DEFAULT_INSTANCE_NAME;
  return (
    <div className="stage-light relative isolate h-full overflow-y-auto bg-surface-base">
      <LightField intensity="hero" className="light-field-window" />
      <div className="mx-auto flex min-h-full w-full max-w-[1240px] flex-col px-5 desktop:px-10">
        <header className="flex h-16 flex-shrink-0 items-center justify-between gap-4">
          <a href="/" className="flex w-fit items-center gap-2.5">
            <img src="/icons/logo-mark.svg" alt="" className="h-6 w-6" />
            <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('common:appName')}</span>
          </a>
          <LanguageSelect className="input-standard h-8 w-full max-w-[160px] py-0 text-meta" />
        </header>

        <div className="flex flex-1 flex-col justify-center gap-8 py-4 desktop:flex-row desktop:items-center desktop:gap-16 desktop:py-8">
          <aside className="min-w-0 desktop:flex-1">
            {name !== DEFAULT_INSTANCE_NAME && <p className="eyebrow rise mb-4">{t('auth:shell.server')}</p>}
            {/* A server that kept the product's name shows it in chrome, as the product page does;
                the line under it says what this is. One with a name of its own shows that name. */}
            {name === DEFAULT_INSTANCE_NAME && <ChromeWord word={DEFAULT_INSTANCE_NAME} className="mb-7 text-[clamp(3.25rem,calc(9*var(--app-vw)),7.5rem)]" />}
            <p className="display-title display-hero ink kinetic break-words pb-2">
              {name === DEFAULT_INSTANCE_NAME ? t('auth:shell.tagline') : name}
            </p>
            <p className="rise rise-2 mt-4 break-all font-mono text-meta uppercase tracking-[0.14em] text-txt-tertiary">{window.location.host}</p>
            <div className="mt-8 hidden max-w-[420px] desktop:block">
              <DesktopDownload variant="aside" />
            </div>
          </aside>

          <main className="modal-panel glass-modal w-full flex-shrink-0 rounded-lg p-5 desktop:w-[440px] desktop:p-8">
            {children}
          </main>
        </div>

        <footer className="flex-shrink-0 py-5">
          <LegalLinks />
        </footer>
      </div>
    </div>
  );
}
