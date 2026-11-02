import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { Icon } from '../ui/Icon';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The clean numbers an axis may end on, times a power of ten. An even one halves into a clean tick too. */
const AXIS_ENDS = [1, 2, 4, 6, 8];

/**
 * A day of the server's, counted in UTC, as a moment that reads as that same date wherever
 * the viewer is. Midnight UTC is still yesterday west of Greenwich.
 */
function dateOfDay(day: number): number {
  const utc = new Date(day * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()).getTime();
}

/** The smallest clean number at or above `value`. */
export function axisEnd(value: number): number {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const end of [...AXIS_ENDS, 10]) {
    if (end * power >= value) return end * power;
  }
  return 10 * power;
}

/** Where a number stands on an axis ending at `end`, in percent from the bottom. */
function heightOf(value: number, end: number): number {
  return Math.max(0, Math.min(100, (value / end) * 100));
}

function linePath(values: readonly number[], end: number): string {
  const step = 100 / Math.max(1, values.length - 1);
  return values.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(2)} ${(100 - heightOf(value, end)).toFixed(2)}`).join(' ');
}

/**
 * One measure, one number per day: the chart of a card on the dashboard. A line for what
 * goes on all the time, columns for what happens now and then. One series, so its title says
 * what it is. The pointer and the arrow keys find a day; the same numbers are one click away
 * as a table, and always there as one for assistive technology.
 */
export function DayChart({ title, values, firstDay, kind }: {
  title: string;
  values: readonly number[];
  /** The first value's day, as days since 1970-01-01 UTC. */
  firstDay: number;
  kind: 'line' | 'columns';
}): React.JSX.Element {
  const { t } = useTranslation('admin');
  const f = useFormatters();
  const tableId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const count = values.length;
  const total = values.reduce((sum, value) => sum + value, 0);
  const end = axisEnd(Math.max(0, ...values));
  const ticks = end === 1 ? [1, 0] : [end, end / 2, 0];
  const dayOf = (index: number) => f.formatMediumDate(dateOfDay(firstDay + index));
  const tick = (value: number) => (end >= 10_000 ? f.formatCompactNumber(value) : f.formatNumber(value));
  /** Where a day stands across the plot, in percent. */
  const xOf = (index: number) => (kind === 'line' ? (index / Math.max(1, count - 1)) * 100 : ((index + 0.5) / count) * 100);

  const follow = (clientX: number) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || count === 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    setActive(kind === 'line' ? Math.round(ratio * (count - 1)) : Math.min(count - 1, Math.floor(ratio * count)));
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const from = active ?? count - 1;
    setActive(Math.max(0, Math.min(count - 1, from + (event.key === 'ArrowRight' ? 1 : -1))));
  };

  const shown = active === null ? null : { index: active, value: values[active] ?? 0 };
  const lastValue = values[count - 1] ?? 0;

  return (
    <section className="surface-card flex min-w-0 flex-col rounded-lg p-4" aria-label={title}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-ui font-medium text-txt-primary">{title}</h3>
          <p className="mt-0.5 text-meta text-txt-tertiary">{t('console.dashboard.total30', { total: f.formatNumber(total) })}</p>
        </div>
        <button
          type="button"
          onClick={() => setAsTable((current) => !current)}
          aria-pressed={asTable}
          title={asTable ? t('console.dashboard.showChart') : t('console.dashboard.showTable')}
          aria-label={asTable ? t('console.dashboard.showChart') : t('console.dashboard.showTable')}
          className="icon-btn"
          data-active={asTable}
        >
          <Icon name="grid" size={14} />
        </button>
      </header>

      {asTable ? (
        <div className="mt-3 h-[172px] overflow-y-auto scrollbar-thin">
          <DayTable title={title} values={values} dayOf={dayOf} />
        </div>
      ) : (
        <div className="mt-3 flex gap-2" aria-hidden="false">
          <div aria-hidden="true" className="relative h-[150px] w-9 flex-shrink-0 font-mono text-2xs text-txt-tertiary">
            {ticks.map((value) => (
              <span key={value} className="tabular absolute right-0 -translate-y-1/2" style={{ top: `${100 - heightOf(value, end)}%` }}>{tick(value)}</span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div
              ref={plotRef}
              tabIndex={0}
              role="group"
              aria-label={title}
              aria-describedby={tableId}
              onPointerDown={(event) => follow(event.clientX)}
              onPointerMove={(event) => follow(event.clientX)}
              // A finger leaves when it lifts; what it tapped stays shown until the next tap.
              onPointerLeave={(event) => { if (event.pointerType === 'mouse') setActive(null); }}
              onFocus={() => setActive((current) => current ?? count - 1)}
              onBlur={() => setActive(null)}
              onKeyDown={onKeyDown}
              className="relative h-[150px] rounded-sm"
            >
              {ticks.map((value) => (
                <span key={value} aria-hidden="true" className="absolute inset-x-0 h-px bg-border-hard" style={{ top: `${100 - heightOf(value, end)}%` }} />
              ))}

              {kind === 'line' ? (
                <>
                  <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
                    <path d={`${linePath(values, end)} L100 100 L0 100 Z`} fill="rgb(var(--accent-primary))" fillOpacity={0.1} />
                    <path
                      d={linePath(values, end)}
                      fill="none"
                      stroke="rgb(var(--accent-primary))"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <span
                    aria-hidden="true"
                    className="chart-dot"
                    style={{ left: `${xOf(shown?.index ?? count - 1)}%`, top: `${100 - heightOf(shown?.value ?? lastValue, end)}%` }}
                  />
                </>
              ) : (
                <div aria-hidden="true" className="absolute inset-0 flex items-end gap-[2px]">
                  {values.map((value, index) => (
                    <div key={index} className="flex h-full min-w-0 flex-1 items-end justify-center">
                      {value > 0 && (
                        <div
                          className={`chart-column${active === index ? ' chart-column-active' : ''}`}
                          style={{ height: `${Math.max(2, heightOf(value, end))}%` }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {shown && (
                <>
                  {kind === 'line' && <span aria-hidden="true" className="absolute inset-y-0 w-px bg-border-soft" style={{ left: `${xOf(shown.index)}%` }} />}
                  <div
                    aria-live="off"
                    className="glass pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md px-2 py-1"
                    style={{ left: `${Math.max(14, Math.min(86, xOf(shown.index)))}%` }}
                  >
                    <span className="block text-ui font-semibold text-txt-primary">{f.formatNumber(shown.value)}</span>
                    <span className="block text-label text-txt-tertiary">{dayOf(shown.index)}</span>
                  </div>
                </>
              )}
            </div>
            <div aria-hidden="true" className="mt-1.5 flex justify-between font-mono text-2xs text-txt-tertiary">
              <span>{f.formatShortDate(dateOfDay(firstDay))}</span>
              <span>{f.formatShortDate(dateOfDay(firstDay + count - 1))}</span>
            </div>
          </div>
        </div>
      )}
      {!asTable && <div id={tableId} className="sr-only"><DayTable title={title} values={values} dayOf={dayOf} /></div>}
    </section>
  );
}

function DayTable({ title, values, dayOf }: { title: string; values: readonly number[]; dayOf: (index: number) => string }) {
  const { t } = useTranslation('admin');
  const f = useFormatters();
  return (
    <table className="w-full text-meta">
      <caption className="sr-only">{title}</caption>
      <thead>
        <tr className="text-left text-txt-tertiary">
          <th scope="col" className="py-1 font-normal">{t('console.dashboard.day')}</th>
          <th scope="col" className="py-1 text-right font-normal">{t('console.dashboard.value')}</th>
        </tr>
      </thead>
      <tbody>
        {[...values].map((value, index) => ({ value, index })).reverse().map(({ value, index }) => (
          <tr key={index} className="border-t border-border-hard">
            <td className="py-1 text-txt-secondary">{dayOf(index)}</td>
            <td className="tabular py-1 text-right font-mono text-txt-primary">{f.formatNumber(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The last two weeks of a number, without axes: the shape of it, beside the number itself. */
export function Sparkline({ values }: { values: readonly number[] }): React.JSX.Element | null {
  const recent = values.slice(-14);
  if (recent.length < 2) return null;
  const end = Math.max(1, ...recent);
  const last = recent[recent.length - 1] ?? 0;
  return (
    <div aria-hidden="true" className="relative h-8 w-full text-txt-tertiary">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <path d={linePath(recent, end)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="chart-dot chart-dot-small" style={{ left: '100%', top: `${100 - heightOf(last, end)}%` }} />
    </div>
  );
}
