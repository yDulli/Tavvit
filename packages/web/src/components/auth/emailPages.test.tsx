import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { InstanceInfoResponse } from '@backspace/shared';
import { api, HttpError } from '../../api/client';
import { invalidateHomeInstanceInfo } from '../../hooks/useHomeInstanceInfo';
import { setLanguage } from '../../i18n';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { LoginPage } from './LoginPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { VerifyEmailPage } from './VerifyEmailPage';

const authState = { login: vi.fn(), isLoading: false };
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
      auth: { forgotPassword: vi.fn(), resetPassword: vi.fn(), verifyEmail: vi.fn() },
    },
  };
});

const TOKEN = 'a'.repeat(43);

function info(over: Partial<InstanceInfoResponse> = {}): InstanceInfoResponse {
  return {
    name: 'Friend Club',
    version: '1.18.0',
    registrationOpen: true,
    email: true,
    emailRequired: false,
    federatedRegistrationOpen: false,
    instanceId: 'i-1',
    sourceCodeUrl: 'https://git.example.org/friends/orbit',
    commit: 'abc1234',
    directoryConfigured: false,
    directoryAvailable: false,
    directoryEnabled: false,
    ...over,
  } as InstanceInfoResponse;
}

function show(element: React.ReactElement, hash = '') {
  window.history.replaceState(null, '', `/somewhere${hash}`);
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  invalidateHomeInstanceInfo();
  vi.mocked(api.instance.info).mockResolvedValue(info());
  vi.mocked(api.desktop.release).mockResolvedValue({ available: false } as never);
  await setLanguage('en');
});

describe('the sign-in page', () => {
  it('offers "forgot password" and the address on a server that sends mail', async () => {
    show(<LoginPage />);
    expect(await screen.findByRole('link', { name: 'Forgot your password?' })).toBeTruthy();
    expect(screen.getByLabelText(/Username or email/)).toBeTruthy();
  });

  it('offers neither on a server that does not, or that is too old to say', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info({ email: undefined }));
    show(<LoginPage />);
    await screen.findAllByText(/Friend Club/);
    expect(screen.queryByRole('link', { name: 'Forgot your password?' })).toBeNull();
    expect(screen.getByLabelText(/^Username/)).toBeTruthy();
    expect(screen.queryByLabelText(/Username or email/)).toBeNull();
  });
});

describe('asking for a reset link', () => {
  it('says the same thing whoever the address belongs to', async () => {
    vi.mocked(api.auth.forgotPassword).mockResolvedValue({ success: true });
    show(<ForgotPasswordPage />);
    await userEvent.type(await screen.findByLabelText('Email address'), 'a@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send link' }));
    expect(await screen.findByText('Check your inbox')).toBeTruthy();
    expect(screen.getByText(/If this address belongs to an account here/)).toBeTruthy();
    expect(api.auth.forgotPassword).toHaveBeenCalledWith('a@example.com', 'en');
  });

  it('says when mail is down, rather than pretending a link is coming', async () => {
    vi.mocked(api.auth.forgotPassword).mockRejectedValue(new HttpError(503, 'Unavailable', undefined, 'email_unavailable'));
    show(<ForgotPasswordPage />);
    await userEvent.type(await screen.findByLabelText('Email address'), 'a@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send link' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Check your inbox')).toBeNull();
  });

  it('says who can help on a server that sends no mail', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info({ email: false }));
    show(<ForgotPasswordPage />);
    expect(await screen.findByText(/Ask its administrator/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send link' })).toBeNull();
  });
});

describe('a reset link', () => {
  it('sets the password, takes the token out of the address bar, and leads to signing in', async () => {
    vi.mocked(api.auth.resetPassword).mockResolvedValue({ success: true });
    show(<ResetPasswordPage />, `#${TOKEN}`);
    await waitFor(() => expect(window.location.hash).toBe(''));
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new password');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'a brand new password');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Your password was changed')).toBeTruthy();
    expect(api.auth.resetPassword).toHaveBeenCalledWith(TOKEN, 'a brand new password');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });

  it('asks nothing of the server for a password that cannot be right', async () => {
    show(<ResetPasswordPage />, `#${TOKEN}`);
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new password');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(api.auth.resetPassword).not.toHaveBeenCalled();
  });

  it('says when it is used up, and how to get another', async () => {
    vi.mocked(api.auth.resetPassword).mockRejectedValue(new HttpError(410, 'Gone', undefined, 'email_token_invalid'));
    show(<ResetPasswordPage />, `#${TOKEN}`);
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new password');
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'a brand new password');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('This link no longer works')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ask for a new link' }).getAttribute('href')).toBe('/forgot-password');
  });

  it('without a token is a dead link from the start', () => {
    show(<ResetPasswordPage />);
    expect(screen.getByText('This link no longer works')).toBeTruthy();
  });
});

describe('a confirmation link', () => {
  it('does nothing on opening: a mail scanner opens links too', async () => {
    vi.mocked(api.auth.verifyEmail).mockResolvedValue({ success: true, address: 'a@example.com' });
    show(<VerifyEmailPage />, `#${TOKEN}`);
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(api.auth.verifyEmail).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm address' }));
    expect(await screen.findByText('Address confirmed')).toBeTruthy();
    expect(screen.getByText(/a@example.com is now confirmed/)).toBeTruthy();
    expect(api.auth.verifyEmail).toHaveBeenCalledWith(TOKEN);
  });

  it('says when it no longer works', async () => {
    vi.mocked(api.auth.verifyEmail).mockRejectedValue(new HttpError(410, 'Gone', undefined, 'email_token_invalid'));
    show(<VerifyEmailPage />, `#${TOKEN}`);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm address' }));
    expect(await screen.findByText('This link no longer works')).toBeTruthy();
  });

  it('says when someone else was first', async () => {
    vi.mocked(api.auth.verifyEmail).mockRejectedValue(new HttpError(409, 'Taken', undefined, 'email_address_in_use'));
    show(<VerifyEmailPage />, `#${TOKEN}`);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm address' }));
    expect(await screen.findByText(/already belongs to another account/)).toBeTruthy();
  });
});
