import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@backspace/shared';
import { initI18n } from '../../../i18n';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { ContactRulesSection } from './ContactRulesSection';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));
vi.mock('../../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'me', username: 'me', dmPolicy: 'friends', friendRequestPolicy: 'anyone' } as User });
});

afterEach(cleanup);

describe('ContactRulesSection', () => {
  it('shows what the account has, and saves a change at once', async () => {
    const updateProfile = vi.fn(async () => {});
    useAuthStore.setState({ updateProfile: updateProfile as never });
    render(<ContactRulesSection />);
    const dm = screen.getByRole('combobox', { name: 'Who can start a conversation with you' });
    expect(dm).toHaveValue('friends');
    await userEvent.setup().selectOptions(dm, 'nobody');
    expect(updateProfile).toHaveBeenCalledWith({ dmPolicy: 'nobody' });
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Who can send you friend requests' }), 'shared_spaces');
    expect(updateProfile).toHaveBeenCalledWith({ friendRequestPolicy: 'shared_spaces' });
  });

  it('starts from the defaults for a row that says nothing', () => {
    useAuthStore.setState({ user: { id: 'me', username: 'me' } as User });
    render(<ContactRulesSection />);
    expect(screen.getByRole('combobox', { name: 'Who can start a conversation with you' })).toHaveValue('friends_and_spaces');
    expect(screen.getByRole('combobox', { name: 'Who can send you friend requests' })).toHaveValue('anyone');
  });

  it('says so when the save fails', async () => {
    const addToast = vi.fn();
    useUIStore.setState({ addToast });
    useAuthStore.setState({ updateProfile: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as never });
    render(<ContactRulesSection />);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Who can start a conversation with you' }), 'anyone');
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('The server could not be reached. Check your connection and try again.', 'warning'));
  });
});
