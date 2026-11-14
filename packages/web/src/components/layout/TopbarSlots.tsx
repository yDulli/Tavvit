import React, { createContext, useContext, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';

/**
 * The topbar of the desktop shell is one bar for every page (AppTopbar.tsx), and what a page
 * says in it is the page's own: where you are (the breadcrumb) and what you can do here (its
 * actions). A page hands both over through these two portals, so its buttons keep their state,
 * their refs and the popovers anchored to them where they always lived, while they stand in the
 * bar. A page that hands over nothing leaves the bar's own default in place.
 */
interface TopbarSlotState {
  lead: HTMLElement | null;
  actions: HTMLElement | null;
  setLead: (el: HTMLElement | null) => void;
  setActions: (el: HTMLElement | null) => void;
}

const TopbarSlotContext = createContext<TopbarSlotState | null>(null);

export function TopbarSlotProvider({ children }: { children: React.ReactNode }) {
  const [lead, setLead] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ lead, actions, setLead, setActions }), [lead, actions]);
  return <TopbarSlotContext.Provider value={value}>{children}</TopbarSlotContext.Provider>;
}

/** The bar registers its two places with these. */
export function useTopbarSlotSetters(): Pick<TopbarSlotState, 'setLead' | 'setActions'> | null {
  const context = useContext(TopbarSlotContext);
  return context ? { setLead: context.setLead, setActions: context.setActions } : null;
}

function TopbarPortal({ slot, children }: { slot: 'lead' | 'actions'; children: React.ReactNode }) {
  const context = useContext(TopbarSlotContext);
  // Outside the desktop shell (a test that renders a page alone, a page shown on its own) there is
  // no bar to hand over to: the page keeps its words and buttons in its own (`PageBar`).
  if (!context) {
    return <div className={slot === 'lead' ? 'flex min-w-0 flex-1 items-center gap-3' : 'flex flex-shrink-0 items-center gap-1'}>{children}</div>;
  }
  const target = context[slot];
  if (!target) return null;
  return ReactDOM.createPortal(<div className="topbar-portal contents">{children}</div>, target);
}

/** Where you are: the breadcrumb at the start of the bar. */
export function TopbarLead({ children }: { children: React.ReactNode }) {
  return <TopbarPortal slot="lead">{children}</TopbarPortal>;
}

/** What you can do here: the page's actions, before the bar's own. */
export function TopbarActions({ children }: { children: React.ReactNode }) {
  return <TopbarPortal slot="actions">{children}</TopbarPortal>;
}

/** Whether the desktop shell's bar is there to take a page's breadcrumb and actions. */
export function useHasTopbar(): boolean {
  return useContext(TopbarSlotContext) !== null;
}

/**
 * A page's bar: in the shell its breadcrumb and actions go up into the topbar and nothing is drawn
 * here; outside it, a bar of the page's own holds them, as every page had before the topbar.
 */
export function PageBar({ children, onContextMenu }: { children: React.ReactNode; onContextMenu?: (e: React.MouseEvent) => void }) {
  const inShell = useHasTopbar();
  if (inShell) return <>{children}</>;
  return (
    <div className="panel-bar flex items-center justify-between gap-3 px-5" onContextMenu={onContextMenu}>
      {children}
    </div>
  );
}

/** One step of a breadcrumb: a link to a place on the way, or where you are (the last). */
export function Crumb({ children, current = false, onClick, mono = false, onContextMenu }: {
  children: React.ReactNode;
  current?: boolean;
  onClick?: () => void;
  mono?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const tone = current ? 'text-txt-primary font-medium' : 'text-txt-secondary';
  const face = mono ? 'font-mono text-meta text-txt-tertiary' : 'text-ui';
  if (onClick && !current) {
    return (
      <button type="button" onClick={onClick} onContextMenu={onContextMenu} className={`crumb min-w-0 truncate ${face} ${mono ? '' : tone}`}>
        {children}
      </button>
    );
  }
  return (
    <span aria-current={current ? 'page' : undefined} onContextMenu={onContextMenu} className={`crumb-here flex min-w-0 items-center gap-2 truncate ${face} ${mono ? '' : tone}`}>
      {children}
    </span>
  );
}

/** The mark between two steps of a breadcrumb. */
export function CrumbSep() {
  return <span aria-hidden="true" className="flex-shrink-0 text-ui text-txt-tertiary/50">/</span>;
}
