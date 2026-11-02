import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResponse } from '@backspace/shared';
import { setLanguage } from '../i18n';
import { useMfaPromptStore } from '../stores/mfaPromptStore';
import { HttpError } from './client';
import { loginWithSecondFactor } from './secondFactorLogin';

// Signing in to another instance from inside the app: every caller goes through this, and
// none of them knows about the code.

const ORIGIN = 'https://other.example';
const TICKET = 'a'.repeat(43);
const signedIn = { token: 't', user: { id: 'u1' } } as unknown as AuthResponse;
const challenge = () => new HttpError(401, 'A second factor is required', { code: 'mfa_required', ticket: TICKET }, 'mfa_required');

function client() {
  return { auth: { login: vi.fn(), loginSecondFactor: vi.fn() } };
}
type Client = Parameters<typeof loginWithSecondFactor>[0];

async function promptOpen() {
  await vi.waitFor(() => expect(useMfaPromptStore.getState().origin).toBe(ORIGIN));
}

beforeEach(async () => {
  useMfaPromptStore.setState({ origin: null, problem: null, resolve: null, reject: null });
  await setLanguage('en');
});

describe('signing in to another instance', () => {
  it('asks nothing when the account has no second factor', async () => {
    const remote = client();
    remote.auth.login.mockResolvedValue(signedIn);
    await expect(loginWithSecondFactor(remote as unknown as Client, ORIGIN, { username: 'a', password: 'b' })).resolves.toBe(signedIn);
    expect(useMfaPromptStore.getState().origin).toBeNull();
  });

  it('asks for the code in the one dialog, and sends it with the ticket', async () => {
    const remote = client();
    remote.auth.login.mockRejectedValue(challenge());
    remote.auth.loginSecondFactor.mockResolvedValue(signedIn);
    const pending = loginWithSecondFactor(remote as unknown as Client, ORIGIN, { username: 'a', password: 'b' });
    await promptOpen();
    useMfaPromptStore.getState().answer('123456');
    await expect(pending).resolves.toBe(signedIn);
    expect(remote.auth.loginSecondFactor).toHaveBeenCalledWith({ ticket: TICKET, code: '123456' });
    expect(useMfaPromptStore.getState().origin).toBeNull();
  });

  it('asks again on a wrong code, and says why', async () => {
    const remote = client();
    remote.auth.login.mockRejectedValue(challenge());
    remote.auth.loginSecondFactor
      .mockRejectedValueOnce(new HttpError(401, 'No', undefined, 'mfa_code_invalid'))
      .mockResolvedValue(signedIn);
    const pending = loginWithSecondFactor(remote as unknown as Client, ORIGIN, { username: 'a', password: 'b' });
    await promptOpen();
    useMfaPromptStore.getState().answer('000000');
    await vi.waitFor(() => expect(useMfaPromptStore.getState().problem).toBe('That code is not right'));
    useMfaPromptStore.getState().answer('123456');
    await expect(pending).resolves.toBe(signedIn);
  });

  it('fails when someone cancels', async () => {
    const remote = client();
    remote.auth.login.mockRejectedValue(challenge());
    const pending = loginWithSecondFactor(remote as unknown as Client, ORIGIN, { username: 'a', password: 'b' });
    await promptOpen();
    useMfaPromptStore.getState().cancel();
    await expect(pending).rejects.toThrow('Cancelled');
    expect(remote.auth.loginSecondFactor).not.toHaveBeenCalled();
  });

  it('passes on what it cannot do anything about', async () => {
    const remote = client();
    const refused = new HttpError(401, 'No', undefined, 'invalid_credentials');
    remote.auth.login.mockRejectedValue(refused);
    await expect(loginWithSecondFactor(remote as unknown as Client, ORIGIN, { username: 'a', password: 'b' })).rejects.toBe(refused);

    const out = client();
    out.auth.login.mockRejectedValue(challenge());
    const locked = new HttpError(429, 'Locked', undefined, 'mfa_locked');
    out.auth.loginSecondFactor.mockRejectedValue(locked);
    const pending = loginWithSecondFactor(out as unknown as Client, ORIGIN, { username: 'a', password: 'b' });
    await promptOpen();
    useMfaPromptStore.getState().answer('123456');
    await expect(pending).rejects.toBe(locked);
  });
});
