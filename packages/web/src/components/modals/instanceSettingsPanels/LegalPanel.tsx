import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LEGAL_DOCUMENT_KINDS,
  LEGAL_LIMITS,
  LEGAL_TEXT_LANGUAGES,
  type AdminLegalResponse,
  type LegalDocumentKind,
  type LegalOperator,
  type LegalTextLanguage,
} from '@backspace/shared/src/legal';
import { api } from '../../../api/client';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { useLegalStore } from '../../../stores/legalStore';
import { LoadingSpinner } from '../../ui/LoadingSpinner';

const EMPTY_OPERATOR: LegalOperator = {
  kind: 'person',
  name: '',
  representative: null,
  address: '',
  email: '',
  phone: null,
  register: null,
  vatId: null,
  editorial: null,
  hosting: null,
  dpo: null,
  minimumAge: LEGAL_LIMITS.MIN_AGE_DEFAULT,
};

type OptionalField = 'representative' | 'phone' | 'register' | 'vatId' | 'editorial' | 'hosting' | 'dpo';
const OPTIONAL_FIELDS: readonly OptionalField[] = ['representative', 'phone', 'register', 'vatId', 'editorial', 'hosting', 'dpo'];

/** Who runs the instance: what the imprint names and the drafts are written with. */
function OperatorForm({ initial, onSaved }: { initial: LegalOperator | null; onSaved: (operator: LegalOperator) => void }) {
  const { t } = useTranslation('legal');
  const [form, setForm] = useState<LegalOperator>(initial ?? EMPTY_OPERATOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const change = (patch: Partial<LegalOperator>) => {
    setForm((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const operator = await api.admin.saveLegalOperator(form);
      onSaved(operator);
      setSaved(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="label-mono">{t('admin.operator.title')}</h3>
        <p className="mt-1 text-meta leading-snug text-txt-tertiary">{t('admin.operator.description')}</p>
      </div>
      <div className="surface-card grid gap-3 rounded-lg p-4 desktop:grid-cols-2">
        <div>
          <label htmlFor="legal-kind" className="field-label">{t('admin.operator.kind')}</label>
          <select
            id="legal-kind"
            value={form.kind}
            onChange={(e) => change({ kind: e.target.value === 'organization' ? 'organization' : 'person' })}
            className="input-standard w-full"
          >
            <option value="person">{t('admin.operator.kinds.person')}</option>
            <option value="organization">{t('admin.operator.kinds.organization')}</option>
          </select>
        </div>
        <div>
          <label htmlFor="legal-age" className="field-label">{t('admin.operator.minimumAge')}</label>
          <input
            id="legal-age"
            type="number"
            min={LEGAL_LIMITS.MIN_AGE_LOWEST}
            max={LEGAL_LIMITS.MIN_AGE_HIGHEST}
            value={form.minimumAge}
            onChange={(e) => change({ minimumAge: Number(e.target.value) })}
            className="input-standard w-full"
          />
        </div>
        <div className="desktop:col-span-2">
          <label htmlFor="legal-name" className="field-label">{t('admin.operator.name')}</label>
          <input id="legal-name" value={form.name} maxLength={LEGAL_LIMITS.LINE_MAX} onChange={(e) => change({ name: e.target.value })} className="input-standard w-full" />
        </div>
        <div className="desktop:col-span-2">
          <label htmlFor="legal-address" className="field-label">{t('admin.operator.address')}</label>
          <textarea id="legal-address" rows={3} value={form.address} maxLength={LEGAL_LIMITS.ADDRESS_MAX} onChange={(e) => change({ address: e.target.value })} className="input-standard w-full resize-y" />
          <p className="mt-1 text-meta text-txt-tertiary">{t('admin.operator.addressHint')}</p>
        </div>
        <div className="desktop:col-span-2">
          <label htmlFor="legal-email" className="field-label">{t('admin.operator.email')}</label>
          <input id="legal-email" type="email" value={form.email} maxLength={LEGAL_LIMITS.EMAIL_MAX} onChange={(e) => change({ email: e.target.value })} className="input-standard w-full" />
          <p className="mt-1 text-meta text-txt-tertiary">{t('admin.operator.emailHint')}</p>
        </div>
        {OPTIONAL_FIELDS.map((field) => (
          <div key={field}>
            <label htmlFor={`legal-${field}`} className="field-label">{t(`admin.operator.${field}`)}</label>
            <input
              id={`legal-${field}`}
              value={form[field] ?? ''}
              maxLength={LEGAL_LIMITS.LINE_MAX}
              onChange={(e) => change({ [field]: e.target.value || null })}
              className="input-standard w-full"
            />
          </div>
        ))}
      </div>
      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving} aria-busy={saving} className="btn-primary">{t('admin.operator.save')}</button>
        {saved && <span role="status" className="text-meta text-txt-tertiary">{t('admin.operator.saved')}</span>}
      </div>
    </section>
  );
}

/** Writing and publishing a new version of the terms or the privacy policy. */
function DocumentEditor({ data, onPublished }: { data: AdminLegalResponse; onPublished: () => void }) {
  const { t } = useTranslation('legal');
  const [kind, setKind] = useState<LegalDocumentKind>('terms');
  const [language, setLanguage] = useState<LegalTextLanguage>('en');
  const [texts, setTexts] = useState<Record<LegalDocumentKind, Partial<Record<LegalTextLanguage, string>>>>({ terms: {}, privacy: {} });
  const [changes, setChanges] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [published, setPublished] = useState(false);

  const latest = data.documents.find((document) => document.kind === kind);
  const text = texts[kind][language] ?? '';
  const setText = (value: string) => {
    setTexts((current) => ({ ...current, [kind]: { ...current[kind], [language]: value } }));
    setPublished(false);
  };
  const hasText = Object.values(texts[kind]).some((value) => value && value.trim().length > 0);
  const changesNeeded = kind === 'terms' && latest !== undefined;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const insertDraft = () => run(async () => {
    const { text: draft } = await api.admin.legalTemplate(kind, language);
    setText(draft);
  });

  const loadLatest = () => run(async () => {
    if (!latest) return;
    const document = await api.admin.legalDocument(latest.id);
    setTexts((current) => ({ ...current, [kind]: document.texts }));
  });

  const publish = () => run(async () => {
    await api.admin.publishLegalDocument({
      kind,
      texts: texts[kind],
      effectiveAt: effectiveDate ? new Date(`${effectiveDate}T00:00:00`).getTime() : null,
      changes: changes.trim() || null,
    });
    setTexts((current) => ({ ...current, [kind]: {} }));
    setChanges('');
    setEffectiveDate('');
    setPublished(true);
    onPublished();
  });

  return (
    <section className="space-y-3">
      <div>
        <h3 className="label-mono">{t('admin.documents.title')}</h3>
        <p className="mt-1 text-meta leading-snug text-txt-tertiary">{t('admin.documents.description')}</p>
      </div>
      <div className="surface-card space-y-3 rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t('admin.documents.kindLabel')} className="flex gap-1">
          {LEGAL_DOCUMENT_KINDS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              onClick={() => { setKind(value); setPublished(false); }}
              className={kind === value ? 'btn-outline btn-sm' : 'btn-quiet btn-sm'}
            >
              {t(`documents.${value}.title`)}
            </button>
          ))}
        </div>
        <div role="tablist" aria-label={t('admin.documents.languageLabel')} className="ml-auto flex gap-1">
          {LEGAL_TEXT_LANGUAGES.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={language === value}
              onClick={() => setLanguage(value)}
              className={language === value ? 'btn-outline btn-sm' : 'btn-quiet btn-sm'}
            >
              {t(`admin.documents.languages.${value}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void insertDraft()} disabled={busy || !data.operator} className="btn-outline btn-sm">{t('admin.documents.insertDraft')}</button>
        {latest && <button type="button" onClick={() => void loadLatest()} disabled={busy} className="btn-outline btn-sm">{t('admin.documents.loadLatest')}</button>}
      </div>
      {!data.operator && <p className="text-meta leading-snug text-txt-warning">{t('admin.documents.operatorFirst')}</p>}
      <p className="text-meta leading-snug text-txt-warning">{t('admin.documents.draftWarning')}</p>
      <textarea
        aria-label={t('admin.documents.textLabel')}
        rows={16}
        value={text}
        maxLength={LEGAL_LIMITS.TEXT_MAX}
        onChange={(e) => setText(e.target.value)}
        className="input-standard w-full resize-y font-mono text-meta"
      />
      <div className="grid gap-3 desktop:grid-cols-2">
        <div>
          <label htmlFor="legal-effective" className="field-label">{t('admin.documents.effective')}</label>
          <input id="legal-effective" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="input-standard w-full" />
          <p className="mt-1 text-meta text-txt-tertiary">{t('admin.documents.effectiveHint')}</p>
        </div>
        <div>
          <label htmlFor="legal-changes" className="field-label">{t('admin.documents.changes')}</label>
          <textarea id="legal-changes" rows={3} value={changes} maxLength={LEGAL_LIMITS.CHANGES_MAX} onChange={(e) => setChanges(e.target.value)} className="input-standard w-full resize-y" />
          <p className="mt-1 text-meta text-txt-tertiary">{changesNeeded ? t('admin.documents.changesRequired') : t('admin.documents.changesHint')}</p>
        </div>
      </div>
      </div>
      {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void publish()}
          disabled={busy || !hasText || !data.operator || (changesNeeded && changes.trim().length === 0)}
          aria-busy={busy}
          className="btn-primary"
        >
          {t('admin.documents.publish', { title: t(`documents.${kind}.title`) })}
        </button>
        {published && <span role="status" className="text-meta text-txt-tertiary">{t('admin.documents.published')}</span>}
      </div>
    </section>
  );
}

/** The admin's place for the imprint details and the published documents (docs/systems/legal.md). */
export function LegalPanel() {
  const { t } = useTranslation('legal');
  const { formatDateTime } = useFormatters();
  const reloadPublic = useLegalStore((s) => s.load);
  const [data, setData] = useState<AdminLegalResponse | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.admin.legal());
      setError('');
    } catch (err) {
      setError(describeError(err));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!data) {
    return error
      ? <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>
      : <div className="flex h-24 items-center justify-center"><LoadingSpinner /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">{t('admin.title')}</h2>
        <p className="mt-1 text-meta leading-snug text-txt-tertiary">{t('admin.description')}</p>
      </div>
      <OperatorForm
        initial={data.operator}
        onSaved={(operator) => {
          setData((current) => (current ? { ...current, operator } : current));
          void reloadPublic();
        }}
      />
      <DocumentEditor
        data={data}
        onPublished={() => {
          void load();
          void reloadPublic();
        }}
      />
      {data.documents.length > 0 && (
        <section>
          <h3 className="label-mono mb-1.5">{t('admin.history.title')}</h3>
          <ol className="surface-card divide-y divide-border-hard rounded-lg">
            {data.documents.map((document) => (
              <li key={document.id} className="px-3 py-2.5 text-ui">
                <div className="font-medium text-txt-primary">
                  {t(`documents.${document.kind}.title`)} · {t('admin.history.version', { version: document.version })}
                </div>
                <div className="font-mono text-label text-txt-tertiary">
                  {t('admin.history.effective', { date: formatDateTime(document.effectiveAt) })}
                  {document.publishedBy ? ` · @${document.publishedBy.username}` : ''}
                </div>
                {document.changes && <p className="mt-1 whitespace-pre-wrap break-words text-meta text-txt-secondary">{document.changes}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
