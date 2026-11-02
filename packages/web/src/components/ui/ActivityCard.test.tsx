import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '@backspace/shared';
import { setLanguage } from '../../i18n';
import { ActivityCard } from './ActivityCard';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));
});

afterEach(async () => {
  await setLanguage('en');
  vi.useRealTimers();
});

describe('ActivityCard', () => {
  it('localizes the elapsed activity time', async () => {
    await setLanguage('ru');
    const activity: Activity = {
      type: 'playing',
      name: 'Escape from Tarkov',
      timestamps: { start: Date.now() - 32 * 60 * 1000 },
    };

    render(<ActivityCard activities={[activity]} />);

    expect(screen.getByText('Играет в Escape from Tarkov')).toBeInTheDocument();
    expect(screen.getByText('Прошло 32 мин.')).toBeInTheDocument();
  });

  it('says what the person does: playing, listening to, watching', () => {
    const { rerender } = render(<ActivityCard activities={[{ type: 'playing', name: 'Factorio' }]} />);
    expect(screen.getByText('Playing Factorio')).toBeInTheDocument();
    rerender(<ActivityCard activities={[{ type: 'listening', name: 'Lo-fi' }]} />);
    expect(screen.getByText('Listening to Lo-fi')).toBeInTheDocument();
    rerender(<ActivityCard activities={[{ type: 'watching', name: 'Dune' }]} />);
    expect(screen.getByText('Watching Dune')).toBeInTheDocument();
  });

  it('shows the details line when there is one', () => {
    render(<ActivityCard activities={[{ type: 'playing', name: 'Factorio', details: 'Nauvis' }]} />);
    expect(screen.getByText('Nauvis')).toBeInTheDocument();
  });

  it('renders emoji shortcodes in a custom status (issue #252)', () => {
    render(<ActivityCard activities={[{ type: 'custom', name: 'on call :pager:' }]} />);
    expect(screen.getByText('on call 📟')).toBeInTheDocument();
  });

  it('renders emoji shortcodes in the fallback custom status', () => {
    render(<ActivityCard activities={[]} fallbackCustomStatus="on call :pager:" />);
    expect(screen.getByText('on call 📟')).toBeInTheDocument();
  });
});
