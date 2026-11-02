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

describe('the profile theme in the account panel', () => {
  it('saves both colours of a ready-made theme', async () => {
    const user = userEvent.setup();
    render(<AccountPanel />);
    await user.click(screen.getByRole('button', { name: 'Ember' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]![0]).toMatchObject({ accentColor: '#f0803c', accentColorSecondary: '#d6336c' });
  });

  it('starts from the colours the person has and sends nothing for them until they change', async () => {
    useAuthStore.setState({ user: self({ accentColor: '#7443fc', accentColorSecondary: '#45affd', bio: '' }) });
    const user = userEvent.setup();
    render(<AccountPanel />);
    expect((screen.getByLabelText('First colour: hex code') as HTMLInputElement).value).toBe('#7443fc');
    await user.type(screen.getByPlaceholderText('Tell the world about yourself…'), 'hi');
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const sent = update.mock.calls[0]![0] as Record<string, unknown>;
    expect('accentColor' in sent).toBe(false);
    expect('accentColorSecondary' in sent).toBe(false);
  });

  it('changes only the second colour when only that was edited', async () => {
    useAuthStore.setState({ user: self({ accentColor: '#7443fc', accentColorSecondary: '#45affd' }) });
    const user = userEvent.setup();
    render(<AccountPanel />);
    const field = screen.getByLabelText('Second colour: hex code');
    await user.clear(field);
    await user.type(field, '#e8743b');
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const sent = update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ accentColorSecondary: '#e8743b' });
    expect('accentColor' in sent).toBe(false);
  });

  it('clears the theme by sending empty strings, which is how the server clears it', async () => {
    useAuthStore.setState({ user: self({ accentColor: '#7443fc', accentColorSecondary: '#45affd' }) });
    const user = userEvent.setup();
    render(<AccountPanel />);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]![0]).toMatchObject({ accentColor: '', accentColorSecondary: '' });
  });
});
