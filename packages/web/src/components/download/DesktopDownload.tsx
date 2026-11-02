import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesktopReleaseFile, DesktopReleaseResponse } from '@backspace/shared';
import { api } from '../../api/client';
import { useFormatters } from '../../i18n/formatters';
import { detectClientArch, detectClientOs, type ClientArch, type ClientOs } from '../../platform/clientSystem';
import { isElectron } from '../../platform/platform';
import { Icon } from '../ui/Icon';

type Load =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; release: DesktopReleaseResponse['release'] };

/** The published desktop release, as the server can serve it right now. */
export function useDesktopRelease(): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoad({ state: 'loading' });
    api.desktop.release()
      .then((res) => { if (active) setLoad({ state: 'ready', release: res.release }); })
      .catch(() => { if (active) setLoad({ state: 'failed' }); });
    return () => { active = false; };
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { load, retry };
}

/** The visitor's system, with the processor once Client Hints answer. */
function useClientSystem(): { os: ClientOs; arch: ClientArch | null } {
  const [os] = useState<ClientOs>(() => detectClientOs());
  const [arch, setArch] = useState<ClientArch | null>(null);
  useEffect(() => {
    let active = true;
    void detectClientArch().then((value) => { if (active) setArch(value); });
    return () => { active = false; };
  }, []);
  return { os, arch };
}

/** The installer the main button offers: the visitor's processor, x64 otherwise (it runs on ARM too). */
export function pickInstaller(files: readonly DesktopReleaseFile[], arch: ClientArch | null): DesktopReleaseFile | null {
  return files.find((f) => f.arch === (arch ?? 'x64')) ?? files.find((f) => f.arch === 'x64') ?? files[0] ?? null;
}

interface DesktopDownloadProps {
  /** `page`: the full block of the download page. `aside`: the short form beside the sign-in. */
  variant: 'page' | 'aside';
}

/**
 * The desktop app's download: what it is, the one button for this computer,
 * and every other installer underneath. It never offers a file the server
 * does not have (GET /api/desktop/release lists only files on disk), and it
 * says plainly when there is nothing to download or nothing for this system.
 *
 * Inside the desktop app itself it renders nothing.
 */
export function DesktopDownload({ variant }: DesktopDownloadProps): React.JSX.Element | null {
  const { t } = useTranslation('desktop');
  const { formatBytes, formatMediumDate } = useFormatters();
  const { load, retry } = useDesktopRelease();
  const { os, arch } = useClientSystem();
  const [showAll, setShowAll] = useState(false);

  if (isElectron()) return null;

  const release = load.state === 'ready' ? load.release : null;
  // Beside the sign-in, an absent or unreachable release is simply not mentioned,
  // and neither is a Windows installer to someone signing in on a phone.
  if (variant === 'aside' && (!release || os === 'android' || os === 'ios')) return null;

  const primary = release ? pickInstaller(release.files, arch) : null;
  const systemName = t(`download.system.${os}`);
  const onWindows = os === 'windows';

  return (
    <section aria-labelledby={`desktop-download-${variant}`} className={variant === 'page' ? 'surface-card rounded-lg' : ''}>
      <div className={variant === 'page' ? 'border-b border-border-hard px-5 py-4' : ''}>
        <p className="label-mono">{t('download.kicker')}</p>
        <h2
          id={`desktop-download-${variant}`}
          className={`mt-1.5 font-semibold text-txt-primary ${variant === 'page' ? 'text-title' : 'text-lead'}`}
        >
          {t('download.title')}
        </h2>
        <p className={`mt-1 text-txt-secondary ${variant === 'page' ? 'text-ui max-w-[560px]' : 'text-meta'}`}>
          {t('download.description')}
        </p>
      </div>

      <div className={variant === 'page' ? 'px-5 py-4' : 'mt-4'}>
        {load.state === 'loading' && (
          <div className="skeleton h-8 w-[220px] rounded-md" aria-hidden="true" />
        )}

        {load.state === 'failed' && (
          <div className="flex flex-wrap items-center gap-3 text-ui text-txt-secondary">
            <span>{t('download.failed')}</span>
            <button type="button" onClick={retry} className="btn-outline">{t('download.retry')}</button>
          </div>
        )}

        {load.state === 'ready' && !release && (
          <p className="text-ui text-txt-tertiary">{t('download.none')}</p>
        )}

        {release && primary && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <a href={primary.url} download={primary.fileName} className="btn-primary">
                <Icon name="download" size={15} />
                {t('download.button')}
              </a>
              <span className="font-mono text-label text-txt-tertiary">
                {t('download.meta', { version: release.version, size: formatBytes(primary.size) })}
              </span>
            </div>

            <p className="mt-2.5 text-meta text-txt-tertiary">
              {onWindows
                ? t('download.detected', { system: arch === 'arm64' ? t('download.arch.arm64') : systemName })
                : t('download.unsupported', { system: systemName })}
            </p>

            {variant === 'page' && (
              <div className="mt-4 border-t border-border-hard pt-3">
                <button
                  type="button"
                  onClick={() => setShowAll((open) => !open)}
                  aria-expanded={showAll}
                  className="btn-quiet btn-sm -ml-2.5"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`transition-transform ${showAll ? 'rotate-90' : ''}`} aria-hidden="true">
                    <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t('download.otherVersions')}
                </button>
                {showAll && (
                  <ul className="mt-2 divide-y divide-border-hard rounded-lg border border-border-hard">
                    {release.files.map((file) => (
                      <li key={file.fileName} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-ui text-txt-primary">{t(`download.arch.${file.arch}`)}</div>
                          <div className="truncate font-mono text-label text-txt-tertiary" title={`${t('download.checksum')} ${file.sha512}`}>
                            {file.fileName} · {formatBytes(file.size)}
                          </div>
                        </div>
                        <a href={file.url} download={file.fileName} className="btn-outline btn-sm flex-shrink-0">
                          {t('download.short')}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {release.releasedAt && (
                  <p className="mt-3 font-mono text-label text-txt-tertiary">
                    {t('download.releasedOn', { date: formatMediumDate(Date.parse(release.releasedAt)) })}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
