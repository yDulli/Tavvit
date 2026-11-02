import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthResponse, InstanceInfoResponse } from '@backspace/shared';
import { api, HttpError, RateLimitError } from '../../api/client';
import { setLanguage } from '../../i18n';
import { LoginPage } from './LoginPage';

const authState = vi.hoisted(() => ({ login: vi.fn(), initSession: vi.fn(), isLoading: false }));
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
      auth: { loginSecondFactor: vi.fn() },
    },
  };
});

const TICKET = 'a'.repeat(43);
const signedIn = { token: 't', user: { id: 'u1' } } as unknown as AuthResponse;
const challenge = () => new HttpError(401, 'A second factor is required', { code: 'mfa_required', ticket: TICKET }, 'mfa_required');

function show() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/channels/@me" element={<p>the app</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function enterPassword() {
  await userEvent.type(screen.getByLabelText(/^Username/), 'alice');
  await userEvent.type(screen.getByLabelText(/^Password/), 'secret-password');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(api.instance.info).mockResolvedValue({ name: 'Friend Club', registrationOpen: true } as InstanceInfoResponse);
  vi.mocked(api.desktop.release).mockResolvedValue({ available: false } as never);
  authState.login.mockRejectedValue(challenge());
  await setLanguage('en');
});

describe('signing in with a second factor', () => {
  it('asks for the code after the password, and enters the app only with a right one', async () => {
    vi.mocked(api.auth.loginSecondFactor).mockResolvedValue(signedIn);
    show();
    await enterPassword();
    await userEvent.type(await screen.findByLabelText('Six-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('the app');
    expect(api.auth.loginSecondFactor).toHaveBeenCalledWith({ ticket: TICKET, code: '123456' });
    expect(authState.initSession).toHaveBeenCalledWith('t', signedIn.user);
  });

  it('does not sign in on the password alone', async () => {
    show();
    await enterPassword();
    await screen.findByLabelText('Six-digit code');
    expect(authState.initSession).not.toHaveBeenCalled();
    expect(screen.queryByText('the app')).toBeNull();
  });

  it('stays and says so on a wrong code', async () => {
    vi.mocked(api.auth.loginSecondFactor).mockRejectedValue(new HttpError(401, 'No', undefined, 'mfa_code_invalid'));
    show();
    await enterPassword();
    await userEvent.type(await screen.findByLabelText('Six-digit code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('Six-digit code') as HTMLInputElement).value).toBe('');
    expect(authState.initSession).not.toHaveBeenCalled();
  });

  it('says how long to wait when too many were wrong', async () => {
    vi.mocked(api.auth.loginSecondFactor).mockRejectedValue(new RateLimitError(60));
    show();
    await enterPassword();
    await userEvent.type(await screen.findByLabelText('Six-digit code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Try again in 60 seconds/)).toBeTruthy();
  });

  it('takes a recovery code instead', async () => {
    vi.mocked(api.auth.loginSecondFactor).mockResolvedValue(signedIn);
    show();
    await enterPassword();
    await screen.findByLabelText('Six-digit code');
    await userEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await userEvent.type(screen.getByLabelText('Recovery code'), 'AAAA-BBBB-CCCC-DDDD');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(api.auth.loginSecondFactor).toHaveBeenCalledWith({ ticket: TICKET, code: 'AAAA-BBBB-CCCC-DDDD' }));
  });

  it('goes back to the password when the ticket ran out', async () => {
    vi.mocked(api.auth.loginSecondFactor).mockRejectedValue(new HttpError(401, 'No', undefined, 'mfa_ticket_invalid'));
    show();
    await enterPassword();
    await userEvent.type(await screen.findByLabelText('Six-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/took too long/)).toBeTruthy();
    expect(screen.getByLabelText(/^Password/)).toBeTruthy();
  });

  it('tells someone who lost everything who can help, and that mail is no way in', async () => {
    show();
    await enterPassword();
    expect(await screen.findByText(/A mail cannot get you past this step/)).toBeTruthy();
  });
});
