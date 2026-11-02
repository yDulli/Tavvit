import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { REPORT_CATEGORIES, REPORT_LIMITS, type ReportCategory, type ReportTargetType } from '@backspace/shared/src/legal';
import { describeError } from '../../i18n/errors';
import { useAuthStore } from '../../stores/authStore';
import { getApiForOrigin } from '../../utils/crossStoreResolvers';
import { useUIStore } from '../../stores/uiStore';
import { Modal } from '../ui/Modal';

/** What a report made inside the app points at. */
export interface ReportTarget {
  type: Exclude<ReportTargetType, 'link'>;
  id: string;
  /** The instance that holds it, whose operator decides. Empty for the home instance. */
  origin: string;
  /** What the person sees it as: a name, the start of a message. */
  label: string | null;
}

/**
 * The report form (DSA Art. 16), inside the app for something a person points
 * at, and on the public page for anyone with an address. It asks for what
 * Art. 16(2) names: why this is illegal, where it is, who is reporting (the
 * account, or a name and an email address) and that it is meant honestly.
 */
export function ReportForm({ target, onDone }: { target: ReportTarget | null; onDone?: () => void }) {
  const { t } = useTranslation('legal');
  const signedIn = useAuthStore((s) => s.user !== null);
  const [category, setCategory] = useState<ReportCategory | ''>('');
  const [explanation, setExplanation] = useState('');
  const [where, setWhere] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [goodFaith, setGoodFaith] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  // Only a report of child sexual abuse material may stay unsigned (Art. 16(2)(c)).
  const needsContact = !signedIn && category !== 'child_safety';
  const canSend = category !== ''
    && explanation.trim().length >= REPORT_LIMITS.EXPLANATION_MIN
    && (target !== null || where.trim().length > 0)
    && (!needsContact || (name.trim().length >= 2 && email.trim().length >= 3))
    && goodFaith
    && !sending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError('');
    try {
      await getApiForOrigin(target?.origin ?? '').legal.report({
        category,
        explanation: explanation.trim(),
        goodFaith,
        ...(target
          ? { targetType: target.type, targetId: target.id }
          : { targetType: 'link' as const, targetUrl: where.trim() }),
        ...(signedIn ? {} : { reporterName: name.trim() || undefined, reporterEmail: email.trim() || undefined }),
      });
      setSent(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div role="status" className="space-y-3">
        <p className="text-ui font-medium text-txt-primary">{t('report.sentTitle')}</p>
        <p className="text-ui text-txt-secondary">{signedIn && !target?.origin ? t('report.sentBodyAccount') : t('report.sentBody')}</p>
        {onDone && <button type="button" onClick={onDone} className="btn-primary">{t('report.close')}</button>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {target?.label && (
        <div>
          <div className="label-mono mb-1">{t('report.about')}</div>
          <p className="line-clamp-3 break-words rounded-md border border-border-soft bg-surface-input px-3 py-2 text-ui text-txt-secondary">{target.label}</p>
        </div>
      )}

      <div>
        <label htmlFor="report-category" className="field-label">{t('report.category')}</label>
        <select
          id="report-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ReportCategory | '')}
          className="input-standard w-full"
        >
          <option value="">{t('report.categoryChoose')}</option>
          {REPORT_CATEGORIES.map((value) => (
            <option key={value} value={value}>{t(`report.categories.${value}`)}</option>
          ))}
        </select>
      </div>

      {!target && (
        <div>
          <label htmlFor="report-where" className="field-label">{t('report.where')}</label>
          <input
            id="report-where"
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            maxLength={REPORT_LIMITS.URL_MAX}
            placeholder={t('report.wherePlaceholder')}
            className="input-standard w-full"
          />
        </div>
      )}

      <div>
        <label htmlFor="report-explanation" className="field-label">{t('report.explanation')}</label>
        <textarea
          id="report-explanation"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={5}
          maxLength={REPORT_LIMITS.EXPLANATION_MAX}
          placeholder={t('report.explanationPlaceholder')}
          className="input-standard w-full resize-y"
        />
        <p className="mt-1 text-meta text-txt-tertiary">{t('report.explanationHint', { min: REPORT_LIMITS.EXPLANATION_MIN })}</p>
      </div>

      {!signedIn && (
        <div className="grid gap-4 desktop:grid-cols-2">
          <div>
            <label htmlFor="report-name" className="field-label">{t('report.name')}</label>
            <input id="report-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={REPORT_LIMITS.NAME_MAX} autoComplete="name" className="input-standard w-full" />
          </div>
          <div>
            <label htmlFor="report-email" className="field-label">{t('report.email')}</label>
            <input id="report-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={REPORT_LIMITS.EMAIL_MAX} autoComplete="email" className="input-standard w-full" />
          </div>
          {category === 'child_safety' && <p className="text-meta text-txt-tertiary desktop:col-span-2">{t('report.contactOptional')}</p>}
        </div>
      )}

      <label className="flex items-start gap-2 text-ui text-txt-secondary">
        <input type="checkbox" checked={goodFaith} onChange={(e) => setGoodFaith(e.target.checked)} className="mt-0.5 flex-shrink-0" />
        <span>{t('report.goodFaith')}</span>
      </label>

      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}

      <button type="submit" disabled={!canSend} className="btn-primary">
        {t('report.send')}
      </button>
    </form>
  );
}

/** The report dialog behind "Report" on a message, a person or a space. */
export function ReportModal() {
  const { t } = useTranslation('legal');
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const target = modalData.target as ReportTarget | undefined;
  const isOpen = activeModal === 'report' && target !== undefined;

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title={t('report.dialogTitle')} maxWidth="max-w-lg">
      {isOpen && target && <ReportForm key={`${target.type}:${target.id}`} target={target} onDone={closeModal} />}
    </Modal>
  );
}
