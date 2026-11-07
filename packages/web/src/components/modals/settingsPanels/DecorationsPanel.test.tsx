import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@backspace/shared';
import { setLanguage } from '../../../i18n';

// Settings → Decorations (docs/systems/decorations.md): tried on in the preview, saved together.

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));

import { DecorationsPanel } from './DecorationsPanel';
import { useAuthStore } from '../../../stores/authStore';
import { api, HttpError } from '../../../api/client';

function self(over: Partial<User> = {}): User {
  return { id: 'me', username: 'me', displayName: 'Me', createdAt: 1, status: 'online', ...over } as User;
}

let update: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await setLanguage('en');
  useAuthStore.setState({ user: self(), myRowIds: new Map(), trueHomeStatus: null });
  update = vi.spyOn(api.users, 'update').mockImplementation(async (data) => ({ ...useAuthStore.getState().user!, ...data } as User));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const picker = (name: string) => screen.getByRole('radiogroup', { name });

describe('DecorationsPanel', () => {
  it('saves only what was changed, each by its name', async () => {
    const user = userEvent.setup();
    render(<DecorationsPanel />);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    await user.click(within(picker('Frame')).getByRole('radio', { name: 'Aurora' }));
    await user.click(within(screen.getByRole('radiogroup', { name: 'What to decorate' })).getByRole('radio', { name: 'Name' }));
    await user.click(within(picker('Font')).getByRole('radio', { name: 'Serif' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]![0]).toEqual({ avatarFrame: 'aurora', nameFont: 'serif' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
  });

  it('starts from what the person has, takes one off with null, and resets to it', async () => {
    useAuthStore.setState({ user: self({ avatarFrame: 'gilded', nameplate: 'holo' }) });
    const user = userEvent.setup();
    render(<DecorationsPanel />);
    expect(within(picker('Frame')).getByRole('radio', { name: 'Gilded' })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(picker('Frame')).getByRole('radio', { name: 'None' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(within(picker('Frame')).getByRole('radio', { name: 'Gilded' })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(picker('Frame')).getByRole('radio', { name: 'None' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0]![0]).toEqual({ avatarFrame: null });
  });

  it('says what went wrong and keeps the choice when the server refuses it', async () => {
    update.mockRejectedValue(new HttpError(400, 'That decoration does not exist', undefined, 'profile_decoration_invalid', { field: 'avatarFrame' }));
    const user = userEvent.setup();
    render(<DecorationsPanel />);
    await user.click(within(picker('Frame')).getByRole('radio', { name: 'Prism' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That decoration does not exist.');
    expect(within(picker('Frame')).getByRole('radio', { name: 'Prism' })).toHaveAttribute('aria-checked', 'true');
  });
});
