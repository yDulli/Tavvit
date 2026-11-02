import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { setLanguage } from '../../i18n';
import { axisEnd, DayChart, Sparkline } from './DayChart';
import { weekChange } from './AdminDashboard';

beforeEach(async () => {
  cleanup();
  await setLanguage('en');
});

const FIRST_DAY = 20_000;

describe('an axis', () => {
  it('ends on a clean number that halves into a clean tick', () => {
    expect(axisEnd(0)).toBe(1);
    expect(axisEnd(1)).toBe(1);
    expect(axisEnd(3)).toBe(4);
    expect(axisEnd(5)).toBe(6);
    expect(axisEnd(9)).toBe(10);
    expect(axisEnd(33)).toBe(40);
    expect(axisEnd(100)).toBe(100);
    expect(axisEnd(101)).toBe(200);
    expect(axisEnd(12_345)).toBe(20_000);
  });
});

describe('a day chart', () => {
  const values = [0, 3, 0, 5];

  it('says its name, the total, and the same numbers for those who cannot see it', () => {
    render(<DayChart title="Messages per day" values={values} firstDay={FIRST_DAY} kind="line" />);
    expect(screen.getByRole('region', { name: 'Messages per day' })).toBeTruthy();
    expect(screen.getByText('8 in 30 days')).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(values.length + 1);
  });

  it('shows the numbers as a table on request, newest first', () => {
    render(<DayChart title="Messages per day" values={values} firstDay={FIRST_DAY} kind="line" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show as a table' }));
    expect(screen.getByRole('button', { name: 'Show as a chart' })).toBeTruthy();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]!.textContent).toContain('5');
    expect(rows[rows.length - 1]!.textContent).toContain('0');
  });

  it('finds a day with the arrow keys, not only with a pointer', () => {
    render(<DayChart title="Messages per day" values={values} firstDay={FIRST_DAY} kind="columns" />);
    const plot = screen.getByRole('group', { name: 'Messages per day' });
    fireEvent.focus(plot);
    // Focus starts on the last day: 5.
    expect(plot.querySelector('.glass')?.textContent).toContain('5');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(plot.querySelector('.glass')?.textContent).toContain('0');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(plot.querySelector('.glass')?.textContent).toContain('3');
    fireEvent.blur(plot);
    expect(plot.querySelector('.glass')).toBeNull();
  });

  it('draws nothing for a day with nothing', () => {
    const { container } = render(<DayChart title="New accounts" values={values} firstDay={FIRST_DAY} kind="columns" />);
    expect(container.querySelectorAll('.chart-column')).toHaveLength(2);
  });

  it('copes with a month of nothing', () => {
    const { container } = render(<DayChart title="Mail" values={new Array<number>(30).fill(0)} firstDay={FIRST_DAY} kind="line" />);
    expect(screen.getByText('0 in 30 days')).toBeTruthy();
    expect(container.querySelector('path')?.getAttribute('d')).not.toContain('NaN');
  });

  it('has no sparkline without two points', () => {
    expect(render(<Sparkline values={[1]} />).container.firstChild).toBeNull();
  });
});

describe('the change against the week before', () => {
  const weeks = (before: number, last: number) => [...new Array<number>(6).fill(0), before, ...new Array<number>(6).fill(0), last];

  it('says how much more or fewer', () => {
    expect(weekChange(weeks(10, 15))).toEqual({ kind: 'up', percent: 50 });
    expect(weekChange(weeks(10, 5))).toEqual({ kind: 'down', percent: 50 });
  });

  it('has words for the same, for from nothing, and nothing to say about nothing', () => {
    expect(weekChange(weeks(4, 4))).toEqual({ kind: 'same' });
    expect(weekChange(weeks(0, 4))).toEqual({ kind: 'new' });
    expect(weekChange(weeks(0, 0))).toBeNull();
  });
});
