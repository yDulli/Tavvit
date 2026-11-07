import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '@backspace/shared';

// The store sends what this client reports over the socket, which reaches the voice stack.
vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn(), wsSendAll: vi.fn() }));

const { useActivityStore } = await import('../../stores/activityStore');
const { ProfileActivity } = await import('./ProfileActivity');

// A profile's activity, and the way to a stream the person's home found live on
// Twitch (docs/systems/activity-presence.md, "Live on Twitch").

const ORIGIN = 'https://tavvit.test';
const mara = { id: 'mara', homeUserId: null, homeInstance: null };
const live: Activity = {
  type: 'streaming',
  name: 'Any% attempts',
  details: 'Celeste',
  url: 'https://www.twitch.tv/mara',
  source: 'twitch',
};

afterEach(() => {
  useActivityStore.getState().reset();
});

describe('ProfileActivity', () => {
  it('offers the way to a stream found live on Twitch, opening outside the app', () => {
    useActivityStore.getState().setUserActivities(mara, ORIGIN, [live]);
    render(<ProfileActivity subject={mara} origin={ORIGIN} isSelf={false} />);
    expect(screen.getByText('Live on Twitch')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Watch on Twitch' });
    expect(link).toHaveAttribute('href', 'https://www.twitch.tv/mara');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('never offers an address that is not the channel\'s own page', () => {
    useActivityStore.getState().setUserActivities(mara, ORIGIN, [{ ...live, url: 'https://example.com/twitch.tv/mara' }]);
    render(<ProfileActivity subject={mara} origin={ORIGIN} isSelf={false} />);
    expect(screen.getByText('Live on Twitch')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers no way to a stream an activity only claims', () => {
    const claimed: Activity = { type: 'streaming', name: 'Any% attempts', url: 'https://www.twitch.tv/mara' };
    useActivityStore.getState().setUserActivities(mara, ORIGIN, [claimed]);
    render(<ProfileActivity subject={mara} origin={ORIGIN} isSelf={false} />);
    expect(screen.getByText('Streaming Any% attempts')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows one\'s own stream beside what this client reports', () => {
    useActivityStore.getState().setUserActivities(mara, ORIGIN, [live, { type: 'playing', name: 'Old game' }]);
    useActivityStore.setState({ myActivities: [{ type: 'playing', name: 'Celeste' }] });
    render(<ProfileActivity subject={mara} origin={ORIGIN} isSelf />);
    expect(screen.getByText('Live on Twitch')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Watch on Twitch' })).toBeInTheDocument();
  });

  it('shows what this client reports for oneself when nothing was found on Twitch', () => {
    useActivityStore.getState().setUserActivities(mara, ORIGIN, [{ type: 'playing', name: 'Old game' }]);
    useActivityStore.setState({ myActivities: [{ type: 'playing', name: 'Celeste' }] });
    render(<ProfileActivity subject={mara} origin={ORIGIN} isSelf />);
    expect(screen.getByText('Playing Celeste')).toBeInTheDocument();
    expect(screen.queryByText('Playing Old game')).not.toBeInTheDocument();
  });
});
