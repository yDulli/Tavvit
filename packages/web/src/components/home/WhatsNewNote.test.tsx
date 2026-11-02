import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const info = vi.hoisted(() => ({ version: '1.31.0' as string | null }));
vi.mock('../../hooks/useHomeInstanceInfo', () => ({ useHomeInstanceInfo: () => (info.version ? { version: info.version } : null) }));

import { WhatsNewNote } from './WhatsNewNote';

const KEY = 'tavvit-whats-new-seen';

beforeEach(() => {
  window.localStorage.clear();
  info.version = '1.31.0';
});

afterEach(cleanup);

describe('the note about what is new', () => {
  it('says nothing to someone new, and remembers where they started', () => {
    render(<WhatsNewNote />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe('1.31.0');
  });

  it('tells someone who was here before, and leads to the page beside the app', () => {
    window.localStorage.setItem(KEY, '1.30.0');
    render(<WhatsNewNote />);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('New in 1.31.0');
    expect(link).toHaveAttribute('href', '/changelog');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('goes when it is closed, for good', () => {
    window.localStorage.setItem(KEY, '1.30.0');
    const { unmount } = render(<WhatsNewNote />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('link')).toBeNull();
    unmount();
    render(<WhatsNewNote />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('goes when it is followed', () => {
    window.localStorage.setItem(KEY, '1.30.0');
    render(<WhatsNewNote />);
    fireEvent.click(screen.getByRole('link'));
    expect(window.localStorage.getItem(KEY)).toBe('1.31.0');
  });

  it('does not repeat itself for the same version', () => {
    window.localStorage.setItem(KEY, '1.31.0');
    render(<WhatsNewNote />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says nothing for a version with nothing to say', () => {
    window.localStorage.setItem(KEY, '1.30.0');
    info.version = '1.31.1';
    render(<WhatsNewNote />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('waits for the version to be known', () => {
    window.localStorage.setItem(KEY, '1.30.0');
    info.version = null;
    render(<WhatsNewNote />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe('1.30.0');
  });
});
