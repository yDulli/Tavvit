import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HomeHero, type HomeStat } from './HomeHero';

afterEach(cleanup);

function figures(open: () => void = vi.fn()): HomeStat[] {
  return [
    { key: 'unread', icon: 'message', label: 'Unread', value: 3, onOpen: open },
    { key: 'spaces', icon: 'grid', label: 'Spaces', value: 0 },
  ];
}

function renderHero(greeting: string, name: string, stats: readonly HomeStat[] = []) {
  return render(<HomeHero eyebrow="Home" greeting={greeting} name={name} description={<p>Friend Club</p>} stats={stats} />);
}

describe('HomeHero', () => {
  // Each language puts the name where it belongs ("Still up, Maxi?"): it is found, not assumed to be last.
  it('sets the name in metal wherever the greeting has it, and keeps the greeting whole', () => {
    renderHero('Still up, Maxi?', 'Maxi');
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Still up, Maxi?');
    expect(title.querySelector('.chrome-text')).toHaveTextContent('Maxi');
  });

  it('sets a greeting it cannot find the name in as it is', () => {
    renderHero('Good evening', 'Maxi');
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Good evening');
    expect(title.querySelector('.chrome-text')).toBeNull();
  });

  it('greets someone with no name without an empty piece of metal', () => {
    renderHero('Good evening, ', '');
    expect(screen.getByRole('heading', { level: 1 }).querySelector('.chrome-text')).toBeNull();
  });

  it('makes a figure that leads somewhere a button, and one that leads nowhere plain', () => {
    const open = vi.fn();
    renderHero('Hi', '', figures(open));
    fireEvent.click(screen.getByRole('button', { name: /^Unread\s*3$/ }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Spaces/ })).toBeNull();
    expect(screen.getByText('Spaces')).toBeInTheDocument();
  });

  it('lets a figure with nothing to count step back', () => {
    const { container } = renderHero('Hi', '', figures());
    const values = container.querySelectorAll('.stat-value');
    expect(values).toHaveLength(2);
    expect(values[0]).toHaveAttribute('data-empty', 'false');
    expect(values[1]).toHaveAttribute('data-empty', 'true');
  });

  it('has no list of figures and no row of actions when it is given none', () => {
    renderHero('Hi', '');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  // The light behind the opening is decoration: nothing of it reaches a screen reader.
  it('keeps its light out of what is read', () => {
    const { container } = renderHero('Hi', '', figures());
    expect(container.querySelector('canvas.light-field')).toHaveAttribute('aria-hidden', 'true');
    for (const chip of container.querySelectorAll('.go-chip')) expect(chip).toHaveAttribute('aria-hidden', 'true');
  });
});
