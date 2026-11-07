import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { InstanceInfoResponse, LinkedAccountsResponse } from '@backspace/shared';
import { api, HttpError } from '../../api/client';
import { invalidateHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { setLanguage } from '../../i18n';

// Where Twitch sends a person back after they signed in there to link their account
// (docs/systems/linked-accounts.md): completed with whoever is signed in here.

const authState: { token: string | null } = { token: 'session' };
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

vi.mock('../../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client')>();
  return {
    ...original,
    api: {
      instance: { info: vi.fn() },
      desktop: { release: vi.fn() },
      users: { completeLinkedAccount: vi.fn() },
    },
  };
});

vi.mock('../../utils/openUserSettings', () => ({ openUserSettings: vi.fn() }));

const { LinkedAccountReturnPage } = await import('./LinkedAccountReturnPage');

const LINKED: LinkedAccountsResponse = {
  available: ['twitch'],
  accounts: [{ provider: 'twitch', login: 'mara_plays', name: 'Mara_Plays', showOnProfile: true, showLive: true, linkedAt: 1 }],
};

function arrive(search: string) {
  window.history.replaceState(null, '', `/linked-accounts/twitch${search}`);
  return render(
    <MemoryRouter initialEntries={[`/linked-accounts/twitch${search}`]}>
      <Routes>
        <Route path="/linked-accounts/:provider" element={<LinkedAccountReturnPage />} />
        <Route path="/login" element={<p>sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
  authState.token = 'session';
  invalidateHomeInstanceInfo();
  vi.mocked(api.instance.info).mockResolvedValue({ name: 'Tavvit', linkedAccounts: ['twitch'] } as InstanceInfoResponse);
  vi.mocked(api.desktop.release).mockResolvedValue({ available: false } as never);
  await setLanguage('en');
});

describe('coming back from Twitch', () => {
  it('completes the link with this session, and takes the code out of the address', async () => {
    vi.mocked(api.users.completeLinkedAccount).mockResolvedValue(LINKED);
    arrive('?code=the-code&scope=&state=the-state');
    expect(await screen.findByText('Twitch is linked')).toBeTruthy();
    expect(screen.getByText('Mara_Plays is linked to your account now.')).toBeTruthy();
    expect(api.users.completeLinkedAccount).toHaveBeenCalledTimes(1);
    expect(api.users.completeLinkedAccount).toHaveBeenCalledWith('twitch', { code: 'the-code', state: 'the-state' });
    expect(window.location.search).toBe('');
  });

  it('says so when the person stopped at Twitch, and asks nothing', async () => {
    arrive('?error=access_denied&error_description=The+user+denied+you+access&state=the-state');
    expect(await screen.findByText('You stopped at Twitch, so nothing was linked.')).toBeTruthy();
    expect(api.users.completeLinkedAccount).not.toHaveBeenCalled();
  });

  it('says why the server refused it', async () => {
    vi.mocked(api.users.completeLinkedAccount).mockRejectedValue(
      new HttpError(403, 'refused', undefined, 'linked_account_other_account'),
    );
    arrive('?code=the-code&state=someone-elses');
    expect(await screen.findByText('This was started from another account. Sign in here with that account, or start again from this one.')).toBeTruthy();
  });

  it('has a signed-out person sign in first, and goes on with what Twitch handed back', async () => {
    authState.token = null;
    vi.mocked(api.users.completeLinkedAccount).mockResolvedValue(LINKED);
    const first = arrive('?code=the-code&state=the-state');
    expect(await screen.findByText('sign-in page')).toBeTruthy();
    expect(api.users.completeLinkedAccount).not.toHaveBeenCalled();
    first.unmount();

    authState.token = 'session';
    arrive('');
    expect(await screen.findByText('Twitch is linked')).toBeTruthy();
    expect(api.users.completeLinkedAccount).toHaveBeenCalledWith('twitch', { code: 'the-code', state: 'the-state' });
    expect(window.sessionStorage.length).toBe(0);
  });

  it('has nothing to do without anything from Twitch', async () => {
    arrive('');
    expect(await screen.findByText('There is nothing to link here. Start from Settings → Linked accounts.')).toBeTruthy();
  });
});
