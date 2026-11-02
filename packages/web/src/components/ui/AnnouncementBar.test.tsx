import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Announcement } from '@backspace/shared/src/adminConsole';
import { setLanguage } from '../../i18n';

const mocks = vi.hoisted(() => ({
  announcements: vi.fn<() => Promise<{ announcements: Announcement[] }>>(),
}));

vi.mock('../../api/client', () => ({
  api: { instance: { announcements: () => mocks.announcements() } },
}));

import { useAnnouncementStore } from '../../stores/announcementStore';
import { AnnouncementBar } from './AnnouncementBar';

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return { id: 'a1', tone: 'info', body: 'Maintenance tonight.', createdAt: 1, endsAt: null, endedAt: null, ...overrides };
}

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  useAnnouncementStore.setState({ announcements: [], dismissed: [] });
  mocks.announcements.mockReset();
  await setLanguage('en');
});

describe('the announcement bar', () => {
  it('shows what runs, and nothing when nothing does', async () => {
    mocks.announcements.mockResolvedValue({ announcements: [] });
    const { container } = render(<AnnouncementBar />);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('');

    cleanup();
    mocks.announcements.mockResolvedValue({ announcements: [announcement()] });
    render(<AnnouncementBar />);
    expect((await screen.findByRole('status')).textContent).toContain('Maintenance tonight.');
  });

  it('marks a warning as one', async () => {
    mocks.announcements.mockResolvedValue({ announcements: [announcement({ tone: 'warning' })] });
    render(<AnnouncementBar />);
    expect((await screen.findByRole('status')).className).toContain('announcement-warning');
  });

  it('shows what an admin wrote as words, whatever they look like', async () => {
    mocks.announcements.mockResolvedValue({ announcements: [announcement({ body: '<img src=x onerror=alert(1)>' })] });
    render(<AnnouncementBar />);
    const bar = await screen.findByRole('status');
    expect(bar.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(bar.querySelector('img')).toBeNull();
  });

  it('can be put away, on this device, for good', async () => {
    mocks.announcements.mockResolvedValue({ announcements: [announcement()] });
    render(<AnnouncementBar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(JSON.parse(localStorage.getItem('tavvit-announcements-dismissed') ?? '[]')).toEqual(['a1']);
  });

  it('forgets what has stopped running, so the list does not grow', async () => {
    useAnnouncementStore.setState({ announcements: [announcement({ id: 'a2' })], dismissed: ['old'] });
    useAnnouncementStore.getState().dismiss('a2');
    expect(useAnnouncementStore.getState().dismissed).toEqual(['a2']);
  });

  it('does not show what has run out', async () => {
    mocks.announcements.mockResolvedValue({ announcements: [announcement({ endsAt: Date.now() - 1000 })] });
    render(<AnnouncementBar />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stays quiet when the server cannot be asked', async () => {
    mocks.announcements.mockRejectedValue(new Error('offline'));
    const { container } = render(<AnnouncementBar />);
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('');
  });
});
