import React from 'react';
import { useFormatters } from '../../i18n/formatters';
import { Icon, type IconName } from '../ui/Icon';
import { LightField } from '../ui/LightField';

/** One figure of the page: what it counts, how many, and where that leads. */
export interface HomeStat {
  key: string;
  icon: IconName;
  label: string;
  value: number;
  /** Where the figure leads. One with nowhere to lead is not a button. */
  onOpen?: () => void;
}

/**
 * The arrow of a way onward in its round chip. It turns up and fills with the signal when what it
 * stands in (`.go-host`) is pointed at or focused. Decoration: the thing it stands in says where it leads.
 */
export function GoChip(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="go-chip">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </span>
  );
}

function StatTile({ stat }: { stat: HomeStat }) {
  const { formatNumber } = useFormatters();
  const body = (
    <>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="label-mono truncate">{stat.label}</span>
        <Icon name={stat.icon} size={14} className="flex-shrink-0 text-txt-tertiary" />
      </span>
      <span className="flex items-end justify-between gap-2">
        <span className="stat-value" data-empty={stat.value === 0}>{formatNumber(stat.value)}</span>
        {stat.onOpen && <GoChip />}
      </span>
    </>
  );
  return stat.onOpen
    ? <button type="button" onClick={stat.onOpen} className="stat-tile surface-card spotlight go-host">{body}</button>
    : <div className="stat-tile surface-card">{body}</div>;
}

/**
 * The opening of Home: the day, the greeting at the size of a title page with the person's name in
 * polished metal, a line about who is around, what one can start from here, and beside all that the
 * page's figures as tiles (what is unread, who is online). Behind it the field of light threads at
 * full strength: Home is where everyone lands, so it opens as large as the pages outside the app.
 *
 * The name is found in the greeting wherever the language puts it; a greeting it cannot be found in
 * (no name, or one the translation changed) is simply set in the type's own colour.
 */
export function HomeHero({ eyebrow, greeting, name, description, actions, stats }: {
  eyebrow: React.ReactNode;
  /** The whole greeting, the name included. */
  greeting: string;
  name: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
  stats: readonly HomeStat[];
}): React.JSX.Element {
  const at = name ? greeting.indexOf(name) : -1;
  return (
    <header className="home-hero">
      <LightField intensity="hero" />
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-x-12 gap-y-7 px-5 pb-8 pt-7 desktop:grid-cols-[minmax(0,1fr)_auto] desktop:items-end desktop:px-8 desktop:pb-10 desktop:pt-11 compact:grid-cols-1">
        <div className="min-w-0">
          <div className="eyebrow rise">{eyebrow}</div>
          <h1 className="display-title home-greeting ink kinetic mt-4 pb-2">
            {at < 0 ? greeting : (
              <>
                {greeting.slice(0, at)}
                <span className="chrome-text">{name}</span>
                {greeting.slice(at + name.length)}
              </>
            )}
          </h1>
          <div className="rise rise-2 mt-2 max-w-2xl text-lead text-txt-secondary">{description}</div>
          {actions && <div className="rise rise-3 mt-6 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {stats.length > 0 && (
          <ul className="home-stats stagger">
            {stats.map((stat) => <li key={stat.key} className="min-w-0"><StatTile stat={stat} /></li>)}
          </ul>
        )}
      </div>
    </header>
  );
}
