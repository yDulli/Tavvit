import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@backspace/shared';
import { initI18n } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { StatusPicker } from './StatusPicker';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));
vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));

const me = { id: 'me', username: 'alice', status: 'online', homeInstance: null, homeUserId: null } as unknown as User;

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  useAuthStore.setState({ user: me });
});

afterEach(cleanup);

describe('StatusPicker', () => {
  it('saves a status the moment it is chosen', async () => {
    const updateProfile = vi.fn(async () => {});
    useAuthStore.setState({ updateProfile: updateProfile as never });
    render(<StatusPicker />);
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Do Not Disturb' }));
    expect(updateProfile).toHaveBeenCalledWith({ status: 'dnd' });
  });

  it('asks nothing of the server for the status already chosen', async () => {
    const updateProfile = vi.fn(async () => {});
    useAuthStore.setState({ updateProfile: updateProfile as never });
    render(<StatusPicker />);
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Online' }));
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('says so when the save fails', async () => {
    const addToast = vi.fn();
    useUIStore.setState({ addToast });
    useAuthStore.setState({ updateProfile: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as never });
    render(<StatusPicker />);
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Idle' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('The server could not be reached. Check your connection and try again.', 'warning'));
  });
});
