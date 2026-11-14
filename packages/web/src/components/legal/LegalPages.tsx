import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isLegalTextLanguage, type LegalDocumentKind, type LegalDocumentResponse, type LegalOperator } from '@backspace/shared/src/legal';
import { api } from '../../api/client';
import { useFormatters } from '../../i18n/formatters';
import { useLegalStore } from '../../stores/legalStore';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { Icon } from '../ui/Icon';
import { LightField } from '../ui/LightField';
import { LegalLinks } from './LegalLinks';
import { ReportForm } from './ReportForm';
import { hasStoredSession } from '../../landing/entry';

/** The language a legal text is asked for in; the server falls back from there. */
export function useLegalLanguage(): string {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return isLegalTextLanguage(language) ? language : 'en';
}

/**
 * A document's Markdown. Links inside it go to pages of this app or open
 * elsewhere; in a dialog over the app (`linksInNewTab`) they all open beside it.
 */
export function LegalMarkdown({ text, linksInNewTab = false }: { text: string; linksInNewTab?: boolean }) {
  return (
    <div className="legal-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (href?.startsWith('/') && !linksInNewTab
            ? <Link to={href} className="text-accent-soft hover:underline">{children}</Link>
            : <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-soft hover:underline">{children}</a>),
          // A document is the operator's words, not a place for pictures from elsewhere.
          img: () => null,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** The frame of the public legal pages: reachable without an account, with a way back. */
function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTranslation(['legal', 'common']);
  const navigate = useNavigate();
  // The product page is not one of the app's routes: for someone who is not
  // signed in, `/` is a full page load, not a step inside the router.
  const goBack = () => {
    if (hasStoredSession()) navigate('/');
    else window.location.assign('/');
  };
  return (
    <div className="lit relative isolate h-full overflow-y-auto bg-surface-base">
      <LightField intensity="quiet" className="light-field-top" />
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 py-8">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/icons/logo-mark.svg" alt="" className="h-6 w-6" />
            <span className="text-lead font-semibold tracking-[-0.01em] text-txt-primary">{t('common:appName')}</span>
          </div>
          <button type="button" onClick={goBack} className="btn-quiet btn-sm">
            <Icon name="chevron-left" size={14} />
            {hasStoredSession() ? t('legal:shell.back') : t('legal:shell.backHome')}
          </button>
        </header>
        <main className="flex-1">
          <h1 className="display-title ink kinetic mb-8 pb-1">{title}</h1>
          {children}
        </main>
        <footer className="mt-10 border-t border-border-hard pt-4">
          <LegalLinks sameWindow />
        </footer>
      </div>
    </div>
  );
}

function LegalDocumentPage({ kind }: { kind: LegalDocumentKind }) {
  const { t } = useTranslation('legal');
  const { formatFullDate } = useFormatters();
  const language = useLegalLanguage();
  const [document, setDocument] = useState<LegalDocumentResponse | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    setDocument(null);
    setMissing(false);
    api.legal.document(kind, language)
      .then((response) => { if (active) setDocument(response); })
      .catch(() => { if (active) setMissing(true); });
    return () => { active = false; };
  }, [kind, language]);

  return (
    <LegalShell title={t(`documents.${kind}.title`)}>
      {!document && !missing && <div className="flex h-32 items-center justify-center"><LoadingSpinner /></div>}
      {missing && (
        <div className="surface-card rounded-lg">
          <div className="empty-state">
            <p className="empty-state-body">{t('documents.missing')}</p>
          </div>
        </div>
      )}
      {document && (
        <>
          <p className="mb-5 font-mono text-label text-txt-tertiary">
            {t('documents.meta', { version: document.version, date: formatFullDate(document.effectiveAt) })}
          </p>
          <LegalMarkdown text={document.text} />
        </>
      )}
    </LegalShell>
  );
}

export function TermsPage() {
  return <LegalDocumentPage kind="terms" />;
}

export function PrivacyPage() {
  return <LegalDocumentPage kind="privacy" />;
}

function ImprintRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-mono mb-1">{label}</div>
      <div className="whitespace-pre-line break-words text-ui text-txt-primary">{children}</div>
    </div>
  );
}

function ImprintDetails({ operator }: { operator: LegalOperator }) {
  const { t } = useTranslation('legal');
  return (
    <div className="space-y-5">
      <ImprintRow label={t('imprint.provider')}>{`${operator.name}\n${operator.address}`}</ImprintRow>
      {operator.representative && <ImprintRow label={t('imprint.representative')}>{operator.representative}</ImprintRow>}
      <ImprintRow label={t('imprint.contact')}>
        <a href={`mailto:${operator.email}`} className="text-accent-soft hover:underline">{operator.email}</a>
        {operator.phone && `\n${operator.phone}`}
      </ImprintRow>
      {operator.register && <ImprintRow label={t('imprint.register')}>{operator.register}</ImprintRow>}
      {operator.vatId && <ImprintRow label={t('imprint.vatId')}>{operator.vatId}</ImprintRow>}
      {operator.editorial && <ImprintRow label={t('imprint.editorial')}>{operator.editorial}</ImprintRow>}
      <ImprintRow label={t('imprint.dsaContact')}>{t('imprint.dsaContactBody', { email: operator.email })}</ImprintRow>
    </div>
  );
}

export function ImprintPage() {
  const { t } = useTranslation('legal');
  const info = useLegalStore((s) => s.info);
  const load = useLegalStore((s) => s.load);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void load().finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [load]);

  return (
    <LegalShell title={t('imprint.title')}>
      {!loaded && !info && <div className="flex h-32 items-center justify-center"><LoadingSpinner /></div>}
      {loaded && !info?.operator && (
        <div className="surface-card rounded-lg">
          <div className="empty-state">
            <p className="empty-state-body">{t('imprint.missing')}</p>
          </div>
        </div>
      )}
      {info?.operator && <ImprintDetails operator={info.operator} />}
    </LegalShell>
  );
}

export function ReportPage() {
  const { t } = useTranslation('legal');
  return (
    <LegalShell title={t('report.pageTitle')}>
      <p className="mb-6 max-w-xl text-ui leading-relaxed text-txt-secondary">{t('report.pageIntro')}</p>
      <div className="max-w-xl">
        <ReportForm target={null} />
      </div>
    </LegalShell>
  );
}
