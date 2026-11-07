import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminSystemInfo } from '@backspace/shared/src/adminConsole';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { Icon } from '../ui/Icon';
import { LoadingSpinner } from '../ui/LoadingSpinner';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An uptime as one unit that reads at a glance. */
export function roundedUptime(seconds: number): number {
  const unit = seconds >= DAY ? DAY : seconds >= HOUR ? HOUR : seconds >= MINUTE ? MINUTE : 1;
  return Math.floor(seconds / unit) * unit;
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="surface-card min-w-0 rounded-lg px-4 py-3">
      <div className="truncate text-meta text-txt-tertiary">{label}</div>
      <div className="mt-1 truncate text-lead font-semibold tracking-[-0.01em] text-txt-primary">{value}</div>
      {note && <div className="mt-0.5 truncate text-meta text-txt-tertiary">{note}</div>}
    </div>
  );
}

function Service({ label, on, detail }: { label: string; on: boolean; detail: string }) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2 text-ui">
      <Icon name={on ? 'check' : 'x'} size={14} className={`flex-shrink-0 ${on ? 'text-status-online' : 'text-txt-tertiary'}`} />
      <span className="min-w-0 flex-1 truncate text-txt-primary">{label}</span>
      <span className="flex-shrink-0 text-meta text-txt-tertiary">{detail}</span>
    </li>
  );
}

/**
 * How the server itself is doing, and a backup when one is wanted before a big change.
 * Restoring one and fetching the database stay with the server's shell (`restore.sh`), so
 * that being signed in as an admin is not a way to take everything or to overwrite it.
 */
export function SystemSection() {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const [info, setInfo] = useState<AdminSystemInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setInfo(await api.admin.system());
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const backUp = async () => {
    setBusy(true);
    setError('');
    setDone(false);
    try {
      await api.admin.createBackup();
      setDone(true);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const onOff = (on: boolean) => (on ? t('admin:console.system.on') : t('admin:console.system.off'));
  const diskUsed = info?.disk ? Math.round(((info.disk.totalBytes - info.disk.freeBytes) / info.disk.totalBytes) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="page-title">{t('admin:console.sections.system')}</h2>
          <p className="mt-1 max-w-[640px] text-meta leading-snug text-txt-tertiary">{t('admin:console.system.description')}</p>
        </div>
        <button type="button" onClick={() => void load()} className="btn-quiet btn-sm flex-shrink-0">{t('common:actions.refresh')}</button>
      </div>

      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      {!info && !error && <div className="flex h-32 items-center justify-center"><LoadingSpinner /></div>}

      {info && (
        <>
          {info.alerts.length > 0 && (
            <section className="space-y-2" aria-label={t('admin:console.system.alerts.title')}>
              {info.alerts.map((alert) => (
                <div key={alert.cause} role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">
                  <p className="font-medium">{t(`admin:console.system.alerts.${alert.cause}`, { detail: alert.detail ?? '' })}</p>
                  <p className="mt-0.5 text-meta">{t('admin:console.system.alerts.since', { date: f.formatDateTime(alert.since) })}</p>
                </div>
              ))}
            </section>
          )}

          <section className="grid grid-cols-2 gap-3 desktop:grid-cols-4" aria-label={t('admin:console.sections.system')}>
            <Fact label={t('admin:console.system.version')} value={info.version} note={info.commit ?? undefined} />
            <Fact label={t('admin:console.system.uptime')} value={f.formatInterval(roundedUptime(info.uptimeSeconds))} note={info.nodeVersion} />
            <Fact label={t('admin:console.system.memory')} value={f.formatBytes(info.memory.rssBytes)} />
            <Fact label={t('admin:console.system.database')} value={f.formatBytes(info.database.bytes)} />
            <Fact
              label={t('admin:console.system.eventLoop')}
              value={info.eventLoop ? t('admin:console.system.milliseconds', { n: f.formatNumber(info.eventLoop.p99Ms) }) : t('admin:console.system.notYet')}
              note={info.eventLoop ? t('admin:console.system.eventLoopWorst', { n: f.formatNumber(info.eventLoop.maxMs) }) : undefined}
            />
            <Fact
              label={t('admin:console.system.sockets')}
              value={f.formatNumber(info.sockets.open)}
              note={t('admin:console.system.socketPeople', { n: f.formatNumber(info.sockets.people) })}
            />
          </section>

          {info.disk && (
            <section className="surface-card rounded-lg p-4" aria-label={t('admin:console.system.disk')}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-ui font-medium text-txt-primary">{t('admin:console.system.disk')}</h3>
                <span className="tabular font-mono text-meta text-txt-secondary">{f.formatPercent(diskUsed)}</span>
              </div>
              <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-sm bg-white/[0.06]">
                <div className={`h-full rounded-sm ${diskUsed >= 90 ? 'bg-accent-rose' : 'bg-accent-primary'}`} style={{ width: `${diskUsed}%` }} />
              </div>
              <p className="mt-1.5 text-meta text-txt-tertiary">
                {t('admin:console.system.diskFree', { free: f.formatBytes(info.disk.freeBytes), total: f.formatBytes(info.disk.totalBytes) })}
              </p>
            </section>
          )}

          <section aria-label={t('admin:console.system.services')}>
            <h3 className="label-mono mb-2">{t('admin:console.system.services')}</h3>
            <ul className="surface-card divide-y divide-border-hard rounded-lg">
              <Service label={t('admin:console.system.mail')} on={info.services.email === 'ok'} detail={t(`admin:console.system.mailStates.${info.services.email === 'held' || info.services.email === 'blocked' || info.services.email === 'ok' ? info.services.email : 'off'}`)} />
              <Service label={t('admin:console.system.twoFactor')} on={info.services.twoFactor} detail={onOff(info.services.twoFactor)} />
              <Service label={t('admin:console.system.translation')} on={info.services.translation !== null} detail={info.services.translation === 'deepl' ? 'DeepL' : info.services.translation === 'libretranslate' ? 'LibreTranslate' : onOff(false)} />
              <Service label={t('admin:console.system.twitchLive')} on={info.services.twitchLive === 'ok'} detail={t(`admin:console.system.twitchLiveStates.${info.services.twitchLive === 'ok' || info.services.twitchLive === 'failing' ? info.services.twitchLive : 'off'}`)} />
              <Service label={t('admin:console.system.voice')} on={info.services.voice} detail={onOff(info.services.voice)} />
              <Service label={t('admin:console.system.federation')} on={info.services.federation} detail={onOff(info.services.federation)} />
            </ul>
          </section>

          <section aria-label={t('admin:console.system.backups')}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h3 className="label-mono">{t('admin:console.system.backups')}</h3>
              <button type="button" onClick={() => void backUp()} disabled={busy} aria-busy={busy} className="btn-outline btn-sm">
                <Icon name="download" size={13} />
                {t('admin:console.system.backUpNow')}
              </button>
            </div>
            <p className="mb-2 max-w-[640px] text-meta leading-snug text-txt-tertiary">
              {info.backupIntervalHours > 0
                ? t('admin:console.system.backupsEvery', { interval: f.formatInterval(info.backupIntervalHours * 3600) })
                : t('admin:console.system.backupsManual')}
              {' '}
              {t('admin:console.system.restoreHint')}
            </p>
            {done && <p role="status" className="mb-2 text-meta text-txt-positive">{t('admin:console.system.backupDone')}</p>}
            {info.backups.length === 0 ? (
              <p className="text-ui text-txt-tertiary">{t('admin:console.system.noBackups')}</p>
            ) : (
              <ul className="surface-card divide-y divide-border-hard rounded-lg">
                {info.backups.map((backup) => (
                  <li key={backup.name} className="flex items-center gap-3 px-3 py-2 text-ui">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-txt-primary">{f.formatDateTime(backup.createdAt)}</span>
                      <span className="block truncate font-mono text-label text-txt-tertiary">{backup.name}</span>
                    </span>
                    <span className="flex-shrink-0 text-meta text-txt-tertiary">{t(`admin:console.system.reasons.${backup.reason}`)}</span>
                    <span className="tabular flex-shrink-0 font-mono text-meta text-txt-secondary">{f.formatBytes(backup.bytes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
