import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@backspace/shared';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));

import { AccountPanel } from './AccountPanel';
import { useAuthStore } from '../../../stores/authStore';
import { api } from '../../../api/client';

const HOUR = 3_600_000;

function self(over: Partial<User> = {}): User {
  return { id: 'me', username: 'me', displayName: 'Me', createdAt: 1, status: 'online', ...over } as User;
}

let update: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useAuthStore.setState({ user: self(), myRowIds: new Map(), trueHomeStatus: null });
  update = vi.spyOn(api.users, 'update').mockImplementation(async (data) => self({ ...data } as Partial<User>));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const expirySelect = () => screen.getByLabelText('Clear after') as HTMLSelectElement;
const statusInput = () => screen.getByPlaceholderText('What are you up to?');

describe('the custom status "clear after" choice', () => {
  it('is disabled until there is a status to clear', async () => {
    const user = userEvent.setup();
    render(<AccountPanel />);
    expect(expirySelect()).toBeDisabled();
    await user.type(statusInput(), 'brb');
    expect(expirySelect()).toBeEnabled();
  });

  it('sends the chosen duration with the new status', async () => {
    const user = userEvent.setup();
    render(<AccountPanel />);
    await user.type(statusInput(), 'lunch');
    await user.selectOptions(expirySelect(), '1 hour');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]![0]).toMatchObject({ customStatus: 'lunch', customStatusExpiresInMinutes: 60 });
  });

  it('sends "no end" for a new status when nothing was chosen', async () => {
    const user = userEvent.setup();
    render(<AccountPanel />);
    await user.type(statusInput(), 'around');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]![0]).toMatchObject({ customStatus: 'around', customStatusExpiresInMinutes: null });
  });

  it('can re-time the status that is already set, without touching its text', async () => {
    useAuthStore.setState({ user: self({ customStatus: 'busy', customStatusExpiresAt: Date.now() + HOUR }) });
    const user = userEvent.setup();
    render(<AccountPanel />);
    expect(expirySelect().value).toBe('keep');
    await user.selectOptions(expirySelect(), '4 hours');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const sent = update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.customStatusExpiresInMinutes).toBe(240);
    expect('customStatus' in sent).toBe(false);
  });

  it('does not re-time a running status when only something else is saved', async () => {
    useAuthStore.setState({ user: self({ customStatus: 'busy', customStatusExpiresAt: Date.now() + HOUR, bio: '' }) });
    const user = userEvent.setup();
    render(<AccountPanel />);
    await user.type(screen.getByPlaceholderText('Tell the world about yourself…'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const sent = update.mock.calls[0]![0] as Record<string, unknown>;
    expect('customStatusExpiresInMinutes' in sent).toBe(false);
    expect('customStatus' in sent).toBe(false);
  });

  it('carries the remaining time over when the text is edited and "keep" is left alone', async () => {
    useAuthStore.setState({ user: self({ customStatus: 'busy', customStatusExpiresAt: Date.now() + HOUR }) });
    const user = userEvent.setup();
    render(<AccountPanel />);
    await user.type(statusInput(), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const sent = update.mock.calls[0]![0] as { customStatus: string; customStatusExpiresInMinutes: number };
    expect(sent.customStatus).toBe('busy!');
    expect(sent.customStatusExpiresInMinutes).toBeGreaterThanOrEqual(59);
    expect(sent.customStatusExpiresInMinutes).toBeLessThanOrEqual(60);
  });

  it('sends no duration when the status is cleared', async () => {
    useAuthStore.setState({ user: self({ customStatus: 'busy', customStatusExpiresAt: Date.now() + HOUR }) });
    const user = userEvent.setup();
    render(<AccountPanel />);
    await user.clear(statusInput());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const sent = update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.customStatus).toBe('');
    expect('customStatusExpiresInMinutes' in sent).toBe(false);
  });

  it('offers "keep" only while the status has an end ahead', () => {
    useAuthStore.setState({ user: self({ customStatus: 'busy', customStatusExpiresAt: Date.now() - 1000 }) });
    render(<AccountPanel />);
    expect(screen.queryByRole('option', { name: /Keep current end/ })).not.toBeInTheDocument();
    expect(expirySelect().value).toBe('never');
  });
});
