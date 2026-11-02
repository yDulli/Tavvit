import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));
vi.mock('../hooks/useWebSocket', () => ({
  connectInstance: vi.fn(),
  disconnectInstance: vi.fn(),
  disconnectAllRemote: vi.fn(),
}));

import { api, HttpError } from '../api/client';
import { useAuthStore } from './authStore';

// Starting the app asks who the token belongs to. Only the server saying no may
// end the session: a network failure, a 500 or a 429 says nothing about the token,
// and with one of those a person used to land on the sign-in page.
describe('loadUser when the answer is not a yes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.setItem('backspace_token', 'a-token');
    useAuthStore.setState({ token: 'a-token', user: null, isLoading: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it.each([
    ['a network failure', new TypeError('Failed to fetch')],
    ['a server error', new HttpError(500, 'boom')],
    ['a bad gateway', new HttpError(502, 'bad gateway')],
    ['too many requests', new HttpError(429, 'slow down')],
    ['a timeout', new HttpError(408, 'timeout')],
  ])('%s keeps the session and asks again', async (_name, failure) => {
    vi.spyOn(api.users, 'me').mockRejectedValue(failure);

    await useAuthStore.getState().loadUser();

    expect(useAuthStore.getState().token).toBe('a-token');
    expect(window.localStorage.getItem('backspace_token')).toBe('a-token');
    // Still on the loading state, so useAuth does not ask again in a tight loop…
    expect(useAuthStore.getState().isLoading).toBe(true);
    // …and it does once the wait is over.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it.each([
    ['a refused token', new HttpError(401, 'nope')],
    ['a forbidden account', new HttpError(403, 'forbidden')],
  ])('%s ends the session', async (_name, failure) => {
    vi.spyOn(api.users, 'me').mockRejectedValue(failure);

    await useAuthStore.getState().loadUser();

    expect(useAuthStore.getState().token).toBeNull();
    expect(window.localStorage.getItem('backspace_token')).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('waits longer each time and stops at half a minute', async () => {
    vi.spyOn(api.users, 'me').mockRejectedValue(new HttpError(503, 'down'));
    useAuthStore.setState({ isLoading: false });

    const waits: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      await useAuthStore.getState().loadUser();
      let waited = 0;
      while (useAuthStore.getState().isLoading) {
        await vi.advanceTimersByTimeAsync(1000);
        waited += 1000;
      }
      waits.push(waited);
    }

    expect(waits[1]!).toBeGreaterThan(waits[0]!);
    expect(waits[6]).toBe(30_000);
  });
});
