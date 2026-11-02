import React, { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { useSettingsStore } from '../../stores/settingsStore';
import { MemberListToggleButton } from '../layout/MemberListToggleButton';
import { Icon } from '../ui/Icon';
import { DesktopDownload } from '../download/DesktopDownload';
import { LegalLinks } from '../legal/LegalLinks';
import { NoticeBody } from '../legal/LegalController';
import { useLegalStore } from '../../stores/legalStore';

/**
 * The page behind "About" in the sidebar and on the You tab: which server
 * this is (its name, address and version), the desktop app and the way to the
 * developer docs.
 *
 * The one line under the server's details is the source offer the AGPL
 * requires of a modified build served over a network (section 13); it is the
 * only place besides the settings footer that mentions it. When the operator
 * has not published the source yet, only an administrator is told, because
 * publishing it is theirs to do.
 *
 * `showTopBar` is false on the mobile screen, which brings its own header.
 */
export function AboutPage({ showTopBar = true }: { showTopBar?: boolean }): JSX.Element {
  const { t } = useTranslation(['home', 'common', 'legal']);
  const info = useHomeInstanceInfo();
  const notices = useLegalStore((s) => s.notices);
  const isAdmin = useSettingsStore((s) => s.isAdmin);

  return (
    <div className="lit-phone flex h-full min-w-0 flex-1 flex-col bg-surface-chat desktop:bg-transparent">
      {showTopBar && (
        <div className="panel-bar flex items-center gap-2 px-4">
          <Icon name="info" size={17} className="text-txt-tertiary" />
          <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('home:nav.about')}</span>
          <div className="ml-auto flex items-center gap-1">
            <MemberListToggleButton />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="stagger mx-auto w-full max-w-2xl space-y-8 px-4 py-6 desktop:px-5 desktop:py-8">
          <header className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-border-soft bg-surface-channel">
              <img src="/icons/logo-mark.svg" alt="" className="h-5 w-auto" />
            </div>
            <div className="min-w-0">
              <h1 className="page-title">{t('home:about.title')}</h1>
              <p className="mt-0.5 text-ui text-txt-secondary">{t('home:about.tagline')}</p>
            </div>
          </header>

          <section aria-labelledby="about-server">
            <h2 id="about-server" className="mb-2 label-mono">
              {t('home:about.server.title')}
            </h2>
            <div className="surface-card rounded-lg p-4">
              {info && <p className="break-words text-ui font-semibold text-txt-primary">{info.name}</p>}
              <p className="mt-1 break-all text-ui text-txt-secondary">
                <span className="text-txt-tertiary">{t('home:about.server.address')}: </span>
                {window.location.host}
              </p>
              {info && (
                <p className="mt-1 break-all text-ui text-txt-secondary">
                  <span className="text-txt-tertiary">{t('home:about.server.version')}: </span>
                  {info.commit ? `${info.version} (${info.commit})` : info.version}
                </p>
              )}
              {isAdmin && info?.sourceCodeConfigured === false && (
                <p className="mt-3 text-ui leading-relaxed text-txt-warning">{t('home:about.server.sourceMissing')}</p>
              )}
            </div>
          </section>

          <DesktopDownload variant="page" />

          <section aria-labelledby="about-developers">
            <h2 id="about-developers" className="mb-2 label-mono">{t('home:about.developers.title')}</h2>
            <div className="surface-card rounded-lg p-4">
              <p className="text-ui text-txt-secondary">{t('home:about.developers.body')}</p>
              {/* A page of its own, not the app's: it opens beside it, and the desktop app hands it to the browser. */}
              <a href="/developers" target="_blank" rel="noopener noreferrer" className="btn-outline btn-sm mt-3 inline-flex">{t('home:about.developers.link')}</a>
            </div>
          </section>

          <section aria-labelledby="about-help">
            <h2 id="about-help" className="mb-2 label-mono">{t('home:about.help.title')}</h2>
            <nav className="surface-card flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg p-4 text-meta text-txt-tertiary">
              <a href="/help" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-txt-secondary hover:underline">{t('home:about.help.help')}</a>
              <a href="/changelog" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-txt-secondary hover:underline">{t('home:about.help.changelog')}</a>
              <a href="/status" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-txt-secondary hover:underline">{t('home:about.help.status')}</a>
            </nav>
          </section>

          <section aria-labelledby="about-legal">
            <h2 id="about-legal" className="mb-2 label-mono">{t('legal:links.label')}</h2>
            <div className="surface-card rounded-lg p-4">
              <LegalLinks />
            </div>
          </section>

          {notices.length > 0 && (
            <section aria-labelledby="about-notices">
              <h2 id="about-notices" className="mb-2 label-mono">{t('legal:notices.listTitle')}</h2>
              <ul className="space-y-2">
                {notices.map((notice) => (
                  <li key={notice.id} className="surface-card rounded-lg p-4">
                    <p className="mb-2 text-ui font-medium text-txt-primary">{t(`legal:notices.${notice.kind}.title`)}</p>
                    <NoticeBody notice={notice} />
                  </li>
                ))}
              </ul>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
