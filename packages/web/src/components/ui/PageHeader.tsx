import React from 'react';
import { LightField } from './LightField';

/**
 * The opening of a page of its own: a mono eyebrow behind the turning spark saying what kind of
 * place this is, the title rising out of a clip, a line about it and the page's actions at the far
 * end, over a hairline that runs the width of the page column, with a quiet field of light threads
 * behind it. Home, the inbox, Friends, Explore, the events of a space, About and the admin console
 * open with it, so every page starts the same way.
 */
export function PageHeader({ eyebrow, title, description, actions, children, titleId }: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Under the title row: tabs, filters, a strip of figures. */
  children?: React.ReactNode;
  titleId?: string;
}): React.JSX.Element {
  return (
    <header className="page-header relative isolate overflow-hidden border-b border-border-hard">
      <LightField intensity="quiet" />
      <div className="mx-auto w-full max-w-[1440px] px-5 pt-7 desktop:px-8 desktop:pt-9">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-7">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow rise mb-3.5">{eyebrow}</div>}
            <h1 id={titleId} className="display-title ink kinetic pb-1">{title}</h1>
            {description && <div className="rise rise-2 mt-2 max-w-2xl text-lead text-txt-secondary">{description}</div>}
          </div>
          {actions && <div className="rise rise-3 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </header>
  );
}

/** What follows a page's header: the same measure, its panels in a column with room between. */
export function PageBody({ children, className = '' }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <div className={`mx-auto w-full max-w-[1440px] px-5 py-6 desktop:px-8 ${className}`}>{children}</div>;
}

/**
 * A panel (Evolve's structural unit): a hairline-edged surface with a head row (its title, a quiet
 * line or count, its actions at the end) and what it holds. A `<section>` named by its title, so a
 * screen reader lists it as a region of the page.
 */
export function Panel({ title, meta, actions, children, className = '', bodyClassName = 'p-1.5' }: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}): React.JSX.Element {
  return (
    <section aria-label={title} className={`surface-card min-w-0 overflow-hidden rounded-lg ${className}`}>
      <div className="panel-head">
        <h2 className="panel-head-title">{title}</h2>
        {meta !== undefined && meta !== null && meta !== false && <span className="panel-head-meta tabular">{meta}</span>}
        {actions && <div className="ml-auto flex flex-shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
