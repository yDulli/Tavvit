import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { AdminDashboard as Dashboard } from '@backspace/shared/src/adminConsole';
import { api } from '../../api/client';
import { useHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { openReviewTotal, useReviewStore } from '../../stores/reviewStore';
import { CountBadge } from '../ui/CountBadge';
import { Icon, type IconName } from '../ui/Icon';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { DayChart, Sparkline } from './DayChart';

const WEEK = 7;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

type WeekChange =
  | { kind: 'up' | 'down'; percent: number }
  | { kind: 'same' | 'new' };

/** The last seven days against the seven before them; null with nothing in either. */
export function weekChange(values: readonly number[]): WeekChange | null {
  const last = sum(values.slice(-WEEK));
  const before = sum(values.slice(-2 * WEEK, -WEEK));
  if (last === 0 && before === 0) return null;
  if (before === 0) return { kind: 'new' };
  if (last === before) return { kind: 'same' };
  return { kind: last > before ? 'up' : 'down', percent: Math.round((Math.abs(last - before) / before) * 100) };
}

function StatTile({ label, value, note, trend }: {
  label: string;
  value: string;
  note?: string | null;
  trend?: readonly number[];
}) {
  return (
    <div className="surface-card spotlight flex min-w-0 flex-col rounded-lg p-4">
      <span className="truncate text-meta text-txt-tertiary">{label}</span>
      <span className="stat-value mt-1">{value}</span>
      <span className="mt-1 min-h-[1.25em] text-meta leading-snug text-txt-secondary">{note ?? ''}</span>
      {trend && <div className="mt-2"><Sparkline values={trend} /></div>}
    </div>
  );
}

/** How much of the accounts have something on: a share, with the words that say it. */
function Meter({ label, count, total }: { label: string; count: number; total: number }) {
  const { t } = useTranslation('admin');
  const f = useFormatters();
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-ui text-txt-primary">{label}</span>
        <span className="tabular flex-shrink-0 font-mono text-meta text-txt-secondary">{f.formatPercent(percent)}</span>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-white/[0.06]">
        <div className="h-full rounded-sm bg-accent-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-meta text-txt-tertiary">{t('console.dashboard.ofAccounts', { n: f.formatNumber(count), total: f.formatNumber(total) })}</p>
    </div>
  );
}

function AttentionRow({ icon, label, count, to }: { icon: IconName; label: string; count: number; to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)} className="surface-card lift spotlight flex min-w-0 items-center gap-3 rounded-lg px-4 py-3 text-left">
      <Icon name={icon} size={16} className="flex-shrink-0 text-txt-secondary" />
      <span className="min-w-0 flex-1 truncate text-ui font-medium text-txt-primary">{label}</span>
      <CountBadge count={count} />
      <Icon name="chevron-right" size={15} className="flex-shrink-0 text-txt-tertiary" />
    </button>
  );
}

/**
 * The console's opening (docs/systems/admin.md, "The console"): what needs an admin now,
 * then how the instance is doing, from its own database and sockets. Counts of accounts
 * and messages, never who: nothing here names anyone.
 */
export function AdminDashboard() {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const info = useHomeInstanceInfo();
  const navigate = useNavigate();
  const queue = useReviewStore((s) => s.queue);
  const reportsOpen = useReviewStore((s) => s.reportsOpen);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.admin.dashboard());
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const change = (values: readonly number[]): string | null => {
    const week = weekChange(values);
    if (!week) return null;
    if (week.kind === 'up' || week.kind === 'down') {
      return t(`admin:console.dashboard.delta.${week.kind}`, { percent: f.formatPercent(week.percent) });
    }
    return t(`admin:console.dashboard.delta.${week.kind}`);
  };

  const today = (values: readonly number[]) => values[values.length - 1] ?? 0;

  // The live counts while the socket has given them; the page's own until then (an account
  // made an admin during its session has not been told yet).
  const reviews = queue ? openReviewTotal(queue) : data?.open.reviews ?? 0;
  const reports = reportsOpen ?? data?.open.reports ?? 0;
  const alerts = data?.open.alerts ?? 0;
  const knowsWhatWaits = data !== null || (queue !== null && reportsOpen !== null);

  return (
    <div className="space-y-8">
      <header className="rise-in flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display-title ink">{t('admin:console.title')}</h1>
          {info && <p className="mt-2 text-lead text-txt-secondary">{t('admin:console.lead', { instance: info.name, version: info.version })}</p>}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} aria-busy={loading} className="btn-outline flex-shrink-0">
          <Icon name="refresh" size={14} />
          {t('common:actions.refresh')}
        </button>
      </header>

      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}

      <section aria-label={t('admin:console.dashboard.attention')}>
        <h2 className="label-mono mb-2">{t('admin:console.dashboard.attention')}</h2>
        {reports + reviews + alerts === 0 ? (knowsWhatWaits && (
          <p className="flex items-center gap-2 text-ui text-txt-secondary">
            <Icon name="check" size={15} className="text-txt-tertiary" />
            {t('admin:console.dashboard.caughtUp')}
          </p>
        )) : (
          <div className="grid gap-2 desktop:grid-cols-2">
            {alerts > 0 && <AttentionRow icon="alert" label={t('admin:console.dashboard.alerts')} count={alerts} to="/admin/system" />}
            {reports > 0 && <AttentionRow icon="flag" label={t('admin:console.dashboard.reports')} count={reports} to="/admin/reports" />}
            {reviews > 0 && <AttentionRow icon="shield" label={t('admin:console.dashboard.reviews')} count={reviews} to="/admin/reviews" />}
          </div>
        )}
      </section>

      {!data && !error && <div className="flex h-40 items-center justify-center"><LoadingSpinner /></div>}

      {data && (
        <div className={`stagger space-y-8 transition-opacity ${loading ? 'opacity-70' : ''}`}>
          <section aria-label={t('admin:console.dashboard.today')} className="grid grid-cols-2 gap-3 desktop:grid-cols-4">
            <StatTile
              label={t('admin:console.dashboard.stats.accounts')}
              value={f.formatNumber(data.accounts.total)}
              note={t('admin:console.dashboard.newThisWeek', { n: f.formatNumber(sum(data.series.signups.slice(-WEEK))) })}
              trend={data.series.signups}
            />
            <StatTile
              label={t('admin:console.dashboard.stats.online')}
              value={f.formatNumber(data.accounts.online)}
              note={t('admin:console.dashboard.onlineRightNow')}
            />
            <StatTile
              label={t('admin:console.dashboard.stats.active')}
              value={f.formatNumber(today(data.series.activeAccounts))}
              note={change(data.series.activeAccounts)}
              trend={data.series.activeAccounts}
            />
            <StatTile
              label={t('admin:console.dashboard.stats.messages')}
              value={f.formatNumber(today(data.series.messages))}
              note={change(data.series.messages)}
              trend={data.series.messages}
            />
          </section>

          <section aria-label={t('admin:console.dashboard.trends')} className="grid gap-3 desktop:grid-cols-2">
            <DayChart title={t('admin:console.dashboard.charts.messages')} values={data.series.messages} firstDay={data.firstDay} kind="line" />
            <DayChart title={t('admin:console.dashboard.charts.active')} values={data.series.activeAccounts} firstDay={data.firstDay} kind="line" />
            <DayChart title={t('admin:console.dashboard.charts.signups')} values={data.series.signups} firstDay={data.firstDay} kind="columns" />
            <DayChart title={t('admin:console.dashboard.charts.mail')} values={data.series.mail} firstDay={data.firstDay} kind="columns" />
          </section>

          <section aria-label={t('admin:console.dashboard.standing')} className="grid gap-3 desktop:grid-cols-2">
            <div className="surface-card space-y-4 rounded-lg p-4">
              <h3 className="text-ui font-medium text-txt-primary">{t('admin:console.dashboard.security')}</h3>
              <Meter label={t('admin:console.dashboard.twoFactor')} count={data.accounts.twoFactor} total={data.accounts.total} />
              <Meter label={t('admin:console.dashboard.confirmedEmail')} count={data.accounts.confirmedEmail} total={data.accounts.total} />
            </div>
            <div className="surface-card rounded-lg p-4">
              <h3 className="text-ui font-medium text-txt-primary">{t('admin:console.dashboard.standing')}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                {([
                  ['spacesTotal', data.spaces.total],
                  ['spacesListed', data.spaces.listed],
                  ['spacesVerified', data.spaces.verified],
                  ['suspended', data.accounts.suspended],
                  ['admins', data.accounts.admins],
                ] as const).map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="truncate text-meta text-txt-tertiary">{t(`admin:console.dashboard.${key}`)}</dt>
                    <dd className="tabular mt-0.5 font-mono text-body text-txt-primary">{f.formatNumber(value)}</dd>
                  </div>
                ))}
              </dl>
              <button type="button" onClick={() => navigate('/admin/system')} className="btn-quiet btn-sm -ml-2.5 mt-3">
                {t('admin:console.dashboard.toSystem')}
                <Icon name="chevron-right" size={13} />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
