import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PRODUCT_NAME } from '@backspace/shared/src/constants.js';
import { PUBLIC_SERVICES, type PublicStatus, type ServiceState } from '@backspace/shared/src/publicStatus';
import { createFormatters } from '../i18n/createFormatters';
import type { PublicPagePath } from './entry';

/** How often the status page asks again while it is open. */
const STATUS_EVERY_MS = 60_000;

const FRAME_LINKS = ['creators', 'help', 'roadmap', 'changelog', 'status'] as const;
const LEGAL_LINKS = ['terms', 'privacy', 'imprint', 'report', 'developers'] as const;

function PageFrame({ current, title, lead, children }: { current: PublicPagePath; title: string; lead: string; children: ReactNode }) {
  const { t } = useTranslation('status');
  // The page's name with the product's, as the website's HTML has it (site/seo.ts).
  useEffect(() => { document.title = `${title} · ${PRODUCT_NAME}`; }, [title]);
  return (
    <div className="flex min-h-screen flex-col bg-surface-base text-txt-primary">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border-soft px-4 py-3 desktop:px-6">
        <a href="/" aria-label={t('frame.home')} className="flex items-center gap-2 text-ui font-semibold text-txt-primary">
          <img src="/icons/logo-mark.svg" alt="" className="h-5 w-5" />
          Tavvit{/* i18n-check: allow-literal (the name of the product) */}
        </a>
        <nav className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-ui">
          {FRAME_LINKS.map((link) => (
            <a
              key={link}
              href={`/${link}`}
              aria-current={current === `/${link}` ? 'page' : undefined}
              className={current === `/${link}` ? 'text-txt-primary' : 'text-txt-secondary transition-colors hover:text-txt-primary'}
            >
              {t(`frame.${link}`)}
            </a>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 desktop:py-12">
        <h1 className="page-title">{title}</h1>
        <p className="mt-2 text-lead text-txt-secondary">{lead}</p>
        <div className="mt-8">{children}</div>
      </main>
      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-border-soft px-4 py-5 text-meta text-txt-tertiary">
        {LEGAL_LINKS.map((link) => (
          <a key={link} href={`/${link}`} className="transition-colors hover:text-txt-secondary">{t(`frame.${link}`)}</a>
        ))}
      </footer>
    </div>
  );
}

function stateClass(state: ServiceState): string {
  if (state === 'ok') return 'bg-status-online';
  return state === 'down' ? 'bg-accent-rose' : 'bg-txt-tertiary';
}

function StatusPage() {
  const { t, i18n } = useTranslation('status');
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const f = useMemo(() => createFormatters(() => i18n.resolvedLanguage ?? 'en'), [i18n.resolvedLanguage]);

  useEffect(() => {
    let cancelled = false;
    const ask = async () => {
      try {
        const response = await fetch('/api/status');
        if (!response.ok) throw new Error(`status ${response.status}`);
        const answer = await response.json() as PublicStatus;
        if (cancelled) return;
        setStatus(answer);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void ask();
    const timer = setInterval(() => void ask(), STATUS_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const anyDown = status ? PUBLIC_SERVICES.some((service) => status.services[service] === 'down') : false;

  return (
    <PageFrame current="/status" title={t('title')} lead={t('lead')}>
      {failed && <p role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{t('unreachable')}</p>}
      {!status && !failed && <p className="text-ui text-txt-tertiary">{t('checking')}</p>}
      {status && (
        <>
          <p role="status" className="mb-4 text-body font-medium">{anyDown ? t('someDown') : t('allGood')}</p>
          <ul className="surface-card divide-y divide-border-hard rounded-lg">
            {PUBLIC_SERVICES.map((service) => (
              <li key={service} className="flex items-center gap-2.5 px-4 py-3 text-ui">
                <span aria-hidden="true" className={`h-2 w-2 flex-shrink-0 rounded-full ${stateClass(status.services[service])}`} />
                <span className="min-w-0 flex-1 text-txt-primary">{t(`services.${service}`)}</span>
                <span className="flex-shrink-0 text-meta text-txt-tertiary">{t(`states.${status.services[service]}`)}</span>
              </li>
            ))}
          </ul>
          {status.notes.length > 0 && (
            <section className="mt-8" aria-labelledby="status-notes">
              <h2 id="status-notes" className="label-mono mb-2">{t('notes')}</h2>
              <ul className="space-y-2">
                {status.notes.map((note) => (
                  <li key={note.id} className="surface-card rounded-lg px-4 py-3">
                    <p className="whitespace-pre-wrap break-words text-ui text-txt-primary">{note.body}</p>
                    <p className="mt-1 text-meta text-txt-tertiary">
                      {note.endedAt === null
                        ? t('noteOngoing', { date: f.formatDateTime(note.createdAt) })
                        : t('noteEnded', { date: f.formatDateTime(note.createdAt), until: f.formatDateTime(note.endedAt) })}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <p className="mt-8 text-meta text-txt-tertiary">{t('limit')}</p>
    </PageFrame>
  );
}

interface HelpTopic {
  title: string;
  items: Record<string, { q: string; a: string }>;
}

function HelpPage() {
  const { t } = useTranslation('help');
  const topics = t('topics', { returnObjects: true }) as unknown as Record<string, HelpTopic>;
  return (
    <PageFrame current="/help" title={t('title')} lead={t('lead')}>
      <div className="space-y-8">
        {Object.entries(topics).map(([id, topic]) => (
          <section key={id} aria-labelledby={`help-${id}`}>
            <h2 id={`help-${id}`} className="label-mono mb-2">{topic.title}</h2>
            <div className="surface-card divide-y divide-border-hard rounded-lg">
              {Object.entries(topic.items).map(([itemId, item]) => (
                <details key={itemId} className="group px-4 py-3">
                  <summary className="cursor-pointer text-ui font-medium text-txt-primary">{item.q}</summary>
                  <p className="mt-2 text-ui leading-relaxed text-txt-secondary">{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageFrame>
  );
}

interface ChangelogVersion {
  title: string;
  items: Record<string, string>;
}

function ChangelogPage() {
  const { t } = useTranslation('changelog');
  const versions = t('versions', { returnObjects: true }) as unknown as Record<string, ChangelogVersion>;
  return (
    <PageFrame current="/changelog" title={t('title')} lead={t('lead')}>
      <ol className="space-y-8">
        {Object.entries(versions).map(([version, entry]) => (
          <li key={version}>
            <p className="label-mono mb-1">{version}</p>
            <h2 className="text-title font-semibold text-txt-primary">{entry.title}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ui leading-relaxed text-txt-secondary">
              {Object.entries(entry.items).map(([id, text]) => <li key={id}>{text}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </PageFrame>
  );
}

interface RoadmapSection {
  title: string;
  note?: string;
  items: Record<string, { title: string; text: string }>;
}

/** How many of the newest versions the roadmap names as just finished. */
const RECENT_VERSIONS = 3;

function RoadmapPage() {
  const { t } = useTranslation(['roadmap', 'changelog']);
  const sections = t('roadmap:sections', { returnObjects: true }) as unknown as Record<string, RoadmapSection>;
  const versions = t('changelog:versions', { returnObjects: true }) as unknown as Record<string, ChangelogVersion>;
  return (
    <PageFrame current="/roadmap" title={t('roadmap:title')} lead={t('roadmap:lead')}>
      <div className="space-y-8">
        {Object.entries(sections).map(([id, section]) => (
          <section key={id} aria-labelledby={`roadmap-${id}`}>
            <h2 id={`roadmap-${id}`} className="label-mono mb-2">{section.title}</h2>
            {section.note && <p className="mb-2 text-ui text-txt-tertiary">{section.note}</p>}
            <ul className="surface-card divide-y divide-border-hard rounded-lg">
              {Object.entries(section.items).map(([itemId, item]) => (
                <li key={itemId} className="px-4 py-3">
                  <h3 className="text-ui font-medium text-txt-primary">{item.title}</h3>
                  <p className="mt-0.5 text-ui leading-relaxed text-txt-secondary">{item.text}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section aria-labelledby="roadmap-recent">
          <h2 id="roadmap-recent" className="label-mono mb-2">{t('roadmap:recent.title')}</h2>
          <ul className="space-y-1.5">
            {Object.entries(versions).slice(0, RECENT_VERSIONS).map(([version, entry]) => (
              <li key={version} className="flex items-baseline gap-3 text-ui text-txt-secondary">
                <span className="w-12 flex-shrink-0 font-mono text-meta text-txt-tertiary">{version}</span>
                <span className="min-w-0">{entry.title}</span>
              </li>
            ))}
          </ul>
          <a href="/changelog" className="mt-3 inline-block text-ui text-txt-link hover:underline">{t('roadmap:recent.all')}</a>
        </section>
      </div>
    </PageFrame>
  );
}

interface CreatorsItem {
  title: string;
  text: string;
}

interface CreatorsSection {
  title: string;
  items: Record<string, CreatorsItem>;
}

/**
 * What Tavvit offers someone who brings a community along (docs/systems/operations.md, "The public
 * pages"): only what the app does, and how to start. The team of an instance is reached through its
 * legal notice, which every instance has.
 */
function CreatorsPage() {
  const { t } = useTranslation('creators');
  const sections = t('sections', { returnObjects: true }) as unknown as Record<string, CreatorsSection>;
  return (
    <PageFrame current="/creators" title={t('title')} lead={t('lead')}>
      <div className="space-y-10">
        {Object.entries(sections).map(([id, section]) => (
          <section key={id} aria-labelledby={`creators-${id}`}>
            <h2 id={`creators-${id}`} className="label-mono mb-3">{section.title}</h2>
            <div className="grid gap-3">
              {Object.entries(section.items).map(([itemId, entry]) => (
                <div key={itemId} className="surface-card rounded-lg p-4">
                  <h3 className="text-body font-semibold text-txt-primary">{entry.title}</h3>
                  <p className="mt-1.5 text-ui leading-relaxed text-txt-secondary">{entry.text}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
        <section aria-labelledby="creators-cta" className="surface-card rounded-lg p-5">
          <h2 id="creators-cta" className="text-title font-semibold text-txt-primary">{t('cta.title')}</h2>
          <p className="mt-2 text-ui leading-relaxed text-txt-secondary">{t('cta.text')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/channels/@me" className="btn-primary">{t('cta.open')}</a>
            <a href="/imprint" className="btn-outline">{t('cta.contact')}</a>
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

export function PublicPage({ path }: { path: PublicPagePath }) {
  if (path === '/status') return <StatusPage />;
  if (path === '/changelog') return <ChangelogPage />;
  if (path === '/roadmap') return <RoadmapPage />;
  if (path === '/creators') return <CreatorsPage />;
  return <HelpPage />;
}
