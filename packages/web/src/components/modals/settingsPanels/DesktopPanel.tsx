import { useState, useEffect } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SettingsPage, ToggleRow } from './_shared/SettingsControls';
import { useUpdateStore } from '../../../stores/updateStore';
import { useFormatters, type Formatters } from '../../../i18n/formatters';

function AutoLaunchSettings() {
  const { t } = useTranslation('settings');
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [startMinimized, setStartMinimized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.backspace?.getAutoLaunchSettings().then((settings) => {
      setOpenAtLogin(settings.openAtLogin);
      setStartMinimized(settings.startMinimized);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleOpenAtLoginChange = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.backspace!.setAutoLaunchSettings({ openAtLogin: enabled });
      setOpenAtLogin(result.openAtLogin);
      setStartMinimized(result.startMinimized);
    } catch (err) {
      console.error('[autoLaunch] setAutoLaunchSettings(openAtLogin) failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleStartMinimizedChange = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.backspace!.setAutoLaunchSettings({ startMinimized: enabled });
      setOpenAtLogin(result.openAtLogin);
      setStartMinimized(result.startMinimized);
    } catch (err) {
      console.error('[autoLaunch] setAutoLaunchSettings(startMinimized) failed:', err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  return (
    <>
      <ToggleRow
        label={t('desktop.autoLaunch.openAtLogin.label')}
        description={t('desktop.autoLaunch.openAtLogin.description')}
        enabled={openAtLogin}
        disabled={busy}
        onChange={handleOpenAtLoginChange}
      />
      <ToggleRow
        label={t('desktop.autoLaunch.startMinimized.label')}
        description={t('desktop.autoLaunch.startMinimized.description')}
        enabled={startMinimized}
        disabled={busy || !openAtLogin}
        onChange={handleStartMinimizedChange}
      />
    </>
  );
}

/**
 * Formats a byte-per-second rate for the download line. Deliberately coarse:
 * this is reassurance that something is happening, not a benchmark.
 */
function formatRate(t: TFunction<'settings'>, formatters: Formatters, bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '';
  const mb = bytesPerSecond / 1_048_576;
  if (mb >= 1) return t('desktop.updates.rateMegabytes', { value: formatters.formatNumber(Math.round(mb * 10) / 10) });
  return t('desktop.updates.rateKilobytes', { value: formatters.formatNumber(Math.round(bytesPerSecond / 1024)) });
}

/**
 * Desktop version and update state.
 *
 * This panel deliberately ignores whether the user dismissed the update. It is
 * the place a dismissed update stays reachable, which is the thing that makes
 * "Later" safe to offer in the toast at all.
 *
 * Every state here comes from a real updater event. The previous version faked
 * a "Checking..." state with a five second timer and a comment claiming
 * electron-updater has no no-update callback. It emits `update-not-available`
 * and `download-progress`; both are now wired.
 */
function UpdateSettings() {
  const { t } = useTranslation('settings');
  const formatters = useFormatters();
  const initialize = useUpdateStore((s) => s.initialize);
  const snapshot = useUpdateStore((s) => s.snapshot);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const install = useUpdateStore((s) => s.install);
  const openDownloadPage = useUpdateStore((s) => s.openDownloadPage);

  useEffect(() => initialize(), [initialize]);

  const status = snapshot?.status ?? { phase: 'idle' as const };
  const capability = snapshot?.capability ?? 'auto';
  const busy = status.phase === 'checking' || status.phase === 'downloading';

  let detail: string;
  let tone = 'text-txt-tertiary';
  let action: { label: string; onClick: () => void } | null = null;

  switch (status.phase) {
    case 'checking':
      detail = t('desktop.updates.checking');
      break;
    case 'downloading': {
      const percent = formatters.formatNumber(status.percent);
      detail = status.bytesPerSecond > 0
        ? t('desktop.updates.downloadingWithRate', {
            version: status.version,
            percent,
            rate: formatRate(t, formatters, status.bytesPerSecond),
          })
        : t('desktop.updates.downloading', { version: status.version, percent });
      break;
    }
    case 'up-to-date':
      detail = t('desktop.updates.upToDate');
      tone = 'text-accent-mint';
      break;
    case 'available':
      detail = t('desktop.updates.available', { version: status.version });
      action = { label: t('desktop.updates.download'), onClick: openDownloadPage };
      break;
    case 'ready':
      if (capability === 'auto') {
        detail = t('desktop.updates.readyToInstall', { version: status.version });
        action = { label: t('desktop.updates.restart'), onClick: install };
      } else {
        detail = t('desktop.updates.available', { version: status.version });
        action = { label: t('desktop.updates.download'), onClick: openDownloadPage };
      }
      break;
    case 'failed':
      if (status.version) {
        detail = t('desktop.updates.installFailed', { version: status.version });
        tone = 'text-accent-rose';
        action = { label: t('desktop.updates.download'), onClick: openDownloadPage };
      } else {
        detail = t('desktop.updates.checkFailed');
        tone = 'text-accent-rose';
      }
      break;
    default:
      detail = t('desktop.updates.idle');
  }

  if (capability === 'external') {
    detail = t('desktop.updates.external');
    tone = 'text-txt-tertiary';
    action = null;
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-ui font-medium text-txt-primary">
            {currentVersion ? t('desktop.updates.versionLabel', { version: currentVersion }) : t('desktop.updates.appName')}
          </div>
          <div className={`mt-0.5 text-meta leading-snug ${tone}`}>{detail}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action && (
            <button type="button" onClick={action.onClick} className="btn-primary btn-sm">
              {action.label}
            </button>
          )}
          {capability !== 'external' && (
            <button
              type="button"
              onClick={checkNow}
              disabled={busy}
              aria-busy={status.phase === 'checking'}
              className="btn-outline btn-sm"
            >
              {status.phase === 'checking' ? t('desktop.updates.checkingShort') : t('desktop.updates.checkNow')}
            </button>
          )}
        </div>
      </div>

      {status.phase === 'downloading' && (
        <div className="h-1 overflow-hidden rounded-sm bg-interactive-muted" role="progressbar" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100}>
          <div
            className="h-full bg-accent-primary transition-[width] duration-300"
            style={{ width: `${status.percent}%` }}
          />
        </div>
      )}

      {capability === 'auto' && (
        <p className="text-meta leading-snug text-txt-tertiary">
          {t('desktop.updates.autoNote')}
        </p>
      )}
      {capability === 'manual' && (
        <p className="text-meta leading-snug text-txt-tertiary">
          {t('desktop.updates.manualNote')}
        </p>
      )}
      {capability === 'external' && (
        <p className="text-meta leading-snug text-txt-tertiary">
          <Trans t={t} i18nKey="desktop.updates.externalNote" components={{ code: <code /> }} />
        </p>
      )}
    </div>
  );
}

export function DesktopPanel() {
  const { t } = useTranslation('settings');
  const initialize = useUpdateStore((s) => s.initialize);
  const [sandboxed, setSandboxed] = useState<boolean | null>(null);

  useEffect(() => initialize(), [initialize]);
  useEffect(() => {
    const probe = window.backspace?.isSandboxed;
    if (!probe) {
      // Older desktop builds predate sandbox support and are ordinary native
      // packages, so preserving the existing controls is the compatible path.
      setSandboxed(false);
      return;
    }
    probe().then(setSandboxed).catch(() => setSandboxed(false));
  }, []);

  return (
    <SettingsPage title={t('desktop.title')}>
      <div className="surface-card space-y-5 rounded-lg p-4">
        {sandboxed === false && <AutoLaunchSettings />}
        <UpdateSettings />
      </div>
    </SettingsPage>
  );
}
