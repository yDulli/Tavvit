import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  REPORT_GROUNDS,
  REPORT_LIMITS,
  type AdminReport,
  type AdminReportListResponse,
  type ReportDecision,
  type ReportGround,
} from '@backspace/shared/src/legal';
import { SUSPENSION_DURATIONS, SUSPENSION_LIMITS, discoveryDecisionApplies, type SuspensionDuration } from '@backspace/shared/src/platform';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { useReviewStore } from '../../../stores/reviewStore';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { Modal } from '../../ui/Modal';
import { durationKey } from './AdminUserDetailModal';

/** What can be done about what was reported: a message or a decoration someone made can be removed, only a listed space unlisted. */
function decisionsFor(report: AdminReport): ReportDecision[] {
  const decisions: ReportDecision[] = ['no_action', 'handled'];
  if (report.targetType === 'message' || report.targetType === 'dm_message' || report.targetType === 'decoration') decisions.push('content_removed');
  if (report.targetType !== 'link' && report.targetType !== 'space') decisions.push('account_suspended');
  if (report.targetType === 'space' && discoveryDecisionApplies('withdraw', report.listingStatus)) decisions.push('listing_withdrawn');
  return decisions;
}

function ReportDetail({ report, onClose, onDecided }: { report: AdminReport; onClose: () => void; onDecided: () => void }) {
  const { t } = useTranslation(['legal', 'admin']);
  const { formatDateTime } = useFormatters();
  const decisions = decisionsFor(report);
  const [decision, setDecision] = useState<ReportDecision>('no_action');
  const [ground, setGround] = useState<ReportGround | ''>('');
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState<SuspensionDuration>(168);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const open = report.status === 'open';
  const restricts = decision !== 'no_action' && decision !== 'handled';
  // A suspension's reason has a shorter limit, because the sign-in page shows it.
  const noteMax = decision === 'account_suspended' ? SUSPENSION_LIMITS.REASON_MAX_LENGTH : REPORT_LIMITS.NOTE_MAX;
  const noteLength = note.trim().length;
  const canDecide = noteLength >= REPORT_LIMITS.NOTE_MIN && noteLength <= noteMax && (!restricts || ground !== '') && !saving;

  const decide = async () => {
    setSaving(true);
    setError('');
    try {
      await api.admin.decideReport(report.id, {
        decision,
        ground: ground === '' ? null : ground,
        note: note.trim(),
        ...(decision === 'account_suspended' ? { durationHours: duration } : {}),
      });
      onDecided();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const snapshot = report.snapshot;
  return (
    <Modal isOpen onClose={onClose} title={t('legal:admin.reports.detailTitle')} maxWidth="max-w-xl">
      <div className="space-y-4 text-ui">
        <div>
          <div className="label-mono mb-1">{t('legal:admin.reports.category')}</div>
          <p className="text-txt-primary">{t(`legal:report.categories.${report.category}`)}</p>
        </div>
        <div>
          <div className="label-mono mb-1">{t('legal:admin.reports.explanation')}</div>
          <p className="whitespace-pre-wrap break-words text-txt-primary">{report.explanation}</p>
        </div>
        {report.targetUrl && (
          <div>
            <div className="label-mono mb-1">{t('legal:admin.reports.where')}</div>
            <p className="break-words text-txt-primary">{report.targetUrl}</p>
          </div>
        )}
        {snapshot && (
          <div>
            <div className="label-mono mb-1">{t('legal:admin.reports.reported', { type: t(`legal:admin.reports.targets.${report.targetType}`) })}</div>
            <div className="rounded-md border border-border-soft bg-surface-input p-2.5">
              <div className="font-mono text-label text-txt-tertiary">
                {snapshot.authorName ? `@${snapshot.authorName}` : t('legal:admin.reports.unknownAuthor')}
                {snapshot.place ? ` · ${snapshot.place}` : ''}
                {snapshot.createdAt ? ` · ${formatDateTime(snapshot.createdAt)}` : ''}
              </div>
              {snapshot.content && <p className="mt-1 whitespace-pre-wrap break-words text-txt-primary">{snapshot.content}</p>}
              {/* A decoration's picture, while it is there; a removed one no longer answers. */}
              {report.targetType === 'decoration' && snapshot.attachments[0] && (
                <img src={snapshot.attachments[0]} alt="" className="mt-2 max-h-40 rounded-md border border-border-soft bg-surface-chat object-contain" />
              )}
              {report.targetType !== 'decoration' && snapshot.attachments.length > 0 && (
                <p className="mt-1 break-words text-meta text-txt-secondary">{t('legal:admin.reports.attachments', { names: snapshot.attachments.join(', ') })}</p>
              )}
            </div>
          </div>
        )}
        <div>
          <div className="label-mono mb-1">{t('legal:admin.reports.reporter')}</div>
          <p className="break-words text-txt-primary">
            {report.reporterUser ? `@${report.reporterUser.username}` : report.reporterName ?? t('legal:admin.reports.anonymous')}
            {report.reporterEmail ? ` · ${report.reporterEmail}` : ''}
          </p>
          <p className="font-mono text-label text-txt-tertiary">{formatDateTime(report.createdAt)}</p>
          {!report.reporterUser && report.reporterEmail && open && (
            <p className="mt-1 text-meta text-txt-tertiary">{t('legal:admin.reports.replyByEmail')}</p>
          )}
        </div>

        {open ? (
          <div className="space-y-3 border-t border-border-hard pt-4">
            <div>
              <label htmlFor="report-decision" className="field-label">{t('legal:admin.reports.decision')}</label>
              <select id="report-decision" value={decision} onChange={(e) => setDecision(e.target.value as ReportDecision)} className="input-standard w-full">
                {decisions.map((value) => <option key={value} value={value}>{t(`legal:admin.reports.decisions.${value}`)}</option>)}
              </select>
            </div>
            {restricts && (
              <div>
                <label htmlFor="report-ground" className="field-label">{t('legal:admin.reports.ground')}</label>
                <select id="report-ground" value={ground} onChange={(e) => setGround(e.target.value as ReportGround | '')} className="input-standard w-full">
                  <option value="">{t('legal:admin.reports.groundChoose')}</option>
                  {REPORT_GROUNDS.map((value) => <option key={value} value={value}>{t(`legal:admin.reports.grounds.${value}`)}</option>)}
                </select>
              </div>
            )}
            {decision === 'account_suspended' && (
              <div>
                <label htmlFor="report-duration" className="field-label">{t('legal:admin.reports.duration')}</label>
                <select
                  id="report-duration"
                  value={duration === null ? 'null' : String(duration)}
                  onChange={(e) => setDuration(e.target.value === 'null' ? null : Number(e.target.value) as SuspensionDuration)}
                  className="input-standard w-full"
                >
                  {SUSPENSION_DURATIONS.map((value) => (
                    <option key={String(value)} value={value === null ? 'null' : String(value)}>{t(durationKey(value))}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="report-note" className="field-label">{t('legal:admin.reports.note')}</label>
              <textarea id="report-note" rows={3} value={note} maxLength={REPORT_LIMITS.NOTE_MAX} onChange={(e) => setNote(e.target.value)} className="input-standard w-full resize-y" />
              <p className="mt-1 text-meta text-txt-tertiary">{restricts ? t('legal:admin.reports.noteHint') : t('legal:admin.reports.noteHintNoAction')}</p>
              {noteLength > noteMax && <p role="alert" className="mt-1 text-meta text-txt-danger">{t('legal:admin.reports.noteTooLong', { max: noteMax })}</p>}
            </div>
            {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn-quiet">{t('legal:report.close')}</button>
              <button type="button" onClick={() => void decide()} disabled={!canDecide} aria-busy={saving} className={restricts ? 'btn-danger' : 'btn-primary'}>
                {t('legal:admin.reports.decide')}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-border-hard pt-4">
            <div className="label-mono mb-1">{t('legal:admin.reports.decision')}</div>
            <p className="text-txt-primary">{report.decision ? t(`legal:admin.reports.decisions.${report.decision}`) : ''}</p>
            {report.note && <p className="mt-1 whitespace-pre-wrap break-words text-txt-secondary">{report.note}</p>}
            <p className="mt-1 font-mono text-label text-txt-tertiary">
              {report.decidedBy ? `@${report.decidedBy.username} · ` : ''}{report.decidedAt ? formatDateTime(report.decidedAt) : ''}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Reports of illegal content, for the instance's admins to decide (docs/systems/legal.md). */
export function ReportsPanel() {
  const { t } = useTranslation(['legal', 'common']);
  const { formatDateTime } = useFormatters();
  const openCount = useReviewStore((s) => s.reportsOpen);
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [data, setData] = useState<AdminReportListResponse | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AdminReport | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.admin.reports(status));
      setError('');
    } catch (err) {
      setError(describeError(err));
    }
  }, [status]);

  // A report arriving anywhere moves the live count; the list follows.
  useEffect(() => { void load(); }, [load, openCount]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="page-title">{t('legal:admin.reports.title')}</h2>
        <p className="mt-1 text-meta text-txt-tertiary">{t('legal:admin.reports.description')}</p>
      </div>
      <div role="tablist" className="flex w-fit rounded-md border border-border-soft bg-surface-input p-0.5">
        {(['open', 'closed'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            onClick={() => { setData(null); setStatus(value); }}
            className={`h-7 rounded px-3 text-ui font-medium transition-colors duration-100 ${
              status === value ? 'bg-surface-elevated text-txt-primary' : 'text-txt-tertiary hover:bg-interactive-hover hover:text-txt-primary'
            }`}
          >
            {t(`legal:admin.reports.tabs.${value}`)}
          </button>
        ))}
      </div>
      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      {!data && !error && <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>}
      {data && data.reports.length === 0 && (
        <div className="surface-card rounded-lg">
          <div className="empty-state">
            <p className="empty-state-body">{status === 'open' ? t('legal:admin.reports.emptyOpen') : t('legal:admin.reports.emptyClosed')}</p>
          </div>
        </div>
      )}
      {data && data.reports.length > 0 && (
        <ul className="surface-card divide-y divide-border-hard overflow-hidden rounded-lg">
          {data.reports.map((report) => (
            <li key={report.id}>
              <button type="button" onClick={() => setSelected(report)} className="list-row w-full rounded-none px-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium text-txt-primary">{t(`legal:report.categories.${report.category}`)}</span>
                  <span className="mt-0.5 block truncate text-meta text-txt-secondary">{report.explanation}</span>
                  <span className="mt-0.5 block truncate font-mono text-label text-txt-tertiary">
                    {t(`legal:admin.reports.targets.${report.targetType}`)} · {formatDateTime(report.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <ReportDetail
          report={selected}
          onClose={() => setSelected(null)}
          onDecided={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
