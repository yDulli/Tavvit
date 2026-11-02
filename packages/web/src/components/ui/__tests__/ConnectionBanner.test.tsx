import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ConnectionBanner, CONNECTION_BANNER_GRACE_MS } from '../ConnectionBanner';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ConnectionBanner', () => {
  it('shows nothing while the connection is up', () => {
    render(<ConnectionBanner connected />);
    act(() => { vi.advanceTimersByTime(CONNECTION_BANNER_GRACE_MS * 4); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('waits out a short interruption before saying anything', () => {
    render(<ConnectionBanner connected={false} />);
    act(() => { vi.advanceTimersByTime(CONNECTION_BANNER_GRACE_MS - 1); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says the connection is lost once it has stayed down', () => {
    render(<ConnectionBanner connected={false} />);
    act(() => { vi.advanceTimersByTime(CONNECTION_BANNER_GRACE_MS); });
    expect(screen.getByRole('status')).toHaveTextContent('Connection lost. Reconnecting…');
  });

  it('goes away the moment the connection returns', () => {
    const { rerender } = render(<ConnectionBanner connected={false} />);
    act(() => { vi.advanceTimersByTime(CONNECTION_BANNER_GRACE_MS); });
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(<ConnectionBanner connected />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not show a stale banner for an interruption that ended inside the grace period', () => {
    const { rerender } = render(<ConnectionBanner connected={false} />);
    act(() => { vi.advanceTimersByTime(CONNECTION_BANNER_GRACE_MS - 500); });
    rerender(<ConnectionBanner connected />);
    act(() => { vi.advanceTimersByTime(CONNECTION_BANNER_GRACE_MS * 2); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('starts the wait again when the connection drops a second time', () => {
    const { rerender } = render(<ConnectionBanner connected={false} />);
    act(() => { vi.advanceTimersByTime(CONNECTION_BANNER_GRACE_MS); });
    rerender(<ConnectionBanner connected />);
    rerender(<ConnectionBanner connected={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { vi.advanceTimersByTime(CONNECTION_BANNER_GRACE_MS); });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
