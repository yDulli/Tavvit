import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LegalDocumentMeta, LegalDocumentResponse, UserNotice } from '@backspace/shared/src/legal';
import { removalSubjectOf } from '@backspace/shared/src/adminRemoval';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { useFormatters } from '../../i18n/formatters';
import { removedText } from '../../i18n/removal';
import { useAuthStore } from '../../stores/authStore';
import { useLegalStore } from '../../stores/legalStore';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Modal } from '../ui/Modal';
import { LegalMarkdown, useLegalLanguage } from './LegalPages';

/**
 * Asks a person to agree to the terms. Changed terms apply to someone only
 * once they agree (docs/systems/legal.md, "When the terms change"), so the
 * version that applies now cannot be dismissed, and one that is only announced
 * can be put off until it takes effect.
 */
function TermsDialog({ document, required, onLater }: { document: LegalDocumentMeta; required: boolean; onLater: () => void }) {
  const { t } = useTranslation('legal');
  const { formatFullDate } = useFormatters();
  const language = useLegalLanguage();
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const reload = useLegalStore((s) => s.load);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState<LegalDocumentResponse | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.legal.document('terms', language, !required)
      .then((response) => { if (active) setText(response); })
      .catch((err: unknown) => { if (active) setError(describeError(err)); });
    return () => { active = false; };
  }, [language, required, document.version, attempt]);

  const accept = async () => {
    setAccepting(true);
    setError('');
    try {
      const { termsVersion } = await api.legal.acceptTerms(document.version);
      if (user) setUser({ ...user, termsVersion });
    } catch (err) {
      setError(describeError(err));
      // A newer version may have taken this one's place: this dialog then shows that one.
      void reload();
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Modal isOpen onClose={onLater} dismissible={!required} title={t('terms.dialogTitle')} maxWidth="max-w-2xl" mobileStyle="fullscreen">
      <div className="space-y-4">
        <p className="text-ui text-txt-secondary">
          {required ? t('terms.required') : t('terms.upcoming', { date: formatFullDate(document.effectiveAt) })}
        </p>
        {document.changes && (
          <div>
            <div className="label-mono mb-1">{t('terms.changes')}</div>
            <p className="whitespace-pre-wrap break-words text-ui text-txt-primary">{document.changes}</p>
          </div>
        )}
        <div className="max-h-[calc(45*var(--app-vh))] overflow-y-auto rounded-md border border-border-soft bg-surface-input p-4">
          {text ? <LegalMarkdown text={text.text} linksInNewTab /> : !error && <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>}
        </div>
        {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
        {error && !text && (
          <button type="button" onClick={() => { setError(''); setAttempt((n) => n + 1); }} className="btn-quiet btn-sm">{t('terms.retry')}</button>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {required
            ? <button type="button" onClick={() => void logout()} className="btn-quiet">{t('terms.logOut')}</button>
            : <button type="button" onClick={onLater} className="btn-quiet">{t('terms.later')}</button>}
          <button type="button" onClick={() => void accept()} disabled={accepting || !text} aria-busy={accepting} className="btn-primary">
            {t('terms.accept')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function noticeTitleKey(notice: UserNotice) {
  return `notices.${notice.kind}.title` as const;
}

/** The kinds whose subject says what an administrator removed (adminRemoval.ts), named in the person's own words. */
const REMOVAL_KINDS: ReadonlySet<UserNotice['kind']> = new Set(['profile_content_removed', 'space_content_removed', 'space_removed']);

/** One sentence for a notice, shared by the dialog and the list on About. */
export function NoticeBody({ notice }: { notice: UserNotice }) {
  const { t } = useTranslation('legal');
  const { formatDateTime } = useFormatters();
  const removal = REMOVAL_KINDS.has(notice.kind) ? removalSubjectOf(notice.subject) : null;
  // What went: its parts, or the emoji, sticker or sound by its name.
  const removed = removal ? removedText(removal) : '';
  return (
    <div className="space-y-2 text-ui">
      {notice.kind === 'report_decided' ? (
        <p className="text-txt-secondary">{t(`notices.report_decided.outcome.${notice.decision ?? 'no_action'}`)}</p>
      ) : (
        <>
          {removal ? (
            (removal.space || removed) && (
              <div className="space-y-0.5 rounded-md border border-border-soft bg-surface-input px-3 py-2 text-ui">
                {removal.space && <p className="break-words text-txt-tertiary">{t('notices.inSpace', { space: removal.space })}</p>}
                {removed && <p className="break-words text-txt-secondary">{removed}</p>}
              </div>
            )
          ) : notice.subject && <p className="line-clamp-3 break-words rounded-md border border-border-soft bg-surface-input px-3 py-2 text-ui text-txt-secondary">{notice.subject}</p>}
          {notice.note && (
            <div>
              <div className="label-mono mb-0.5">{t('notices.reason')}</div>
              <p className="whitespace-pre-wrap break-words text-txt-primary">{notice.note}</p>
            </div>
          )}
          {notice.ground && <p className="text-txt-secondary">{t(`notices.ground.${notice.ground}`)}</p>}
          {notice.kind === 'account_suspended' && (
            <p className="text-txt-secondary">
              {notice.until === null ? t('notices.untilLifted') : t('notices.until', { date: formatDateTime(notice.until) })}
            </p>
          )}
          <p className="text-meta text-txt-tertiary">{t('notices.redress')}</p>
        </>
      )}
    </div>
  );
}

/** The operator's decisions, one at a time, until the person has read them. */
function NoticeDialog() {
  const { t } = useTranslation('legal');
  const notices = useLegalStore((s) => s.notices);
  const markRead = useLegalStore((s) => s.markRead);
  const email = useLegalStore((s) => s.info?.operator?.email);
  const unread = useMemo(() => notices.filter((notice) => notice.readAt === null), [notices]);
  const notice = unread[unread.length - 1];
  if (!notice) return null;
  const dismiss = () => void markRead(notice.id);

  return (
    <Modal isOpen onClose={dismiss} title={t(noticeTitleKey(notice))} maxWidth="max-w-lg">
      <div className="space-y-4">
        <NoticeBody notice={notice} />
        {email && notice.kind !== 'report_decided' && <p className="text-meta text-txt-tertiary">{t('notices.contact', { email })}</p>}
        <div className="flex items-center justify-between gap-2">
          <Link to="/terms" onClick={dismiss} className="text-meta text-txt-tertiary hover:underline">{t('links.terms')}</Link>
          <button type="button" onClick={dismiss} className="btn-primary">{t('notices.ok')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Keeps the legal details loaded and asks what a signed-in person has to answer. */
export function LegalController() {
  const user = useAuthStore((s) => s.user);
  const info = useLegalStore((s) => s.info);
  const load = useLegalStore((s) => s.load);
  const loadNotices = useLegalStore((s) => s.loadNotices);
  const clearNotices = useLegalStore((s) => s.clearNotices);
  const [putOff, setPutOff] = useState<number | null>(null);
  const signedIn = user !== null;
  const upcomingAt = info?.terms.upcoming?.effectiveAt;

  useEffect(() => { void load(); }, [load]);
  // An announced version takes effect by the clock, with nothing to tell the client.
  useEffect(() => {
    if (upcomingAt === undefined) return;
    const timer = setTimeout(() => void load(), Math.min(Math.max(upcomingAt - Date.now(), 0) + 1000, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [upcomingAt, load]);
  useEffect(() => {
    if (signedIn) void loadNotices();
    else clearNotices();
  }, [signedIn, loadNotices, clearNotices]);

  if (!user) return null;

  const accepted = user.termsVersion ?? 0;
  const current = info?.terms.current ?? null;
  const upcoming = info?.terms.upcoming ?? null;

  if (current && accepted < current.version) {
    return <TermsDialog key={current.version} document={current} required onLater={() => undefined} />;
  }
  if (upcoming && accepted < upcoming.version && putOff !== upcoming.version) {
    return <TermsDialog key={upcoming.version} document={upcoming} required={false} onLater={() => setPutOff(upcoming.version)} />;
  }
  return <NoticeDialog />;
}
