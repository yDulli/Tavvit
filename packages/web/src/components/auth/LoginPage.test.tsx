import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { InstanceInfoResponse } from '@backspace/shared';
import { api, HttpError } from '../../api/client';
import { setLanguage } from '../../i18n';
import { LoginPage } from './LoginPage';

const authState = { login: vi.fn(), isLoading: false };
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

vi.mock('../../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client')>();
  return { ...original, api: { instance: { info: vi.fn() }, desktop: { release: vi.fn() } } };
});

function info(over: Partial<InstanceInfoResponse> = {}): InstanceInfoResponse {
  return {
    name: 'Friend Club',
    version: '1.4.0',
    registrationOpen: false,
    federatedRegistrationOpen: false,
    instanceId: 'i-1',
    sourceCodeUrl: 'https://git.example.org/friends/orbit',
    commit: 'abc1234',
    directoryConfigured: false,
    directoryAvailable: false,
    directoryEnabled: false,
    supportCardEnabled: false,
    setupRequired: false,
    ...over,
  };
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  authState.isLoading = false;
  vi.mocked(api.desktop.release).mockResolvedValue({ release: null });
  await setLanguage('en');
});

describe('LoginPage', () => {
  it('names the server being signed in to', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info());
    renderLogin();
    expect(await screen.findByText('Log in to Friend Club')).toBeInTheDocument();
  });

  it('marks the button as working while signing in', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info());
    authState.isLoading = true;
    renderLogin();
    await screen.findByText('Log in to Friend Club');
    const button = screen.getByRole('button', { name: 'Logging in…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });

  it('marks both fields when the credentials are refused, until each is changed', async () => {
    const user = userEvent.setup();
    vi.mocked(api.instance.info).mockResolvedValue(info());
    authState.login.mockRejectedValue(new HttpError(401, 'nope', undefined, 'invalid_credentials'));
    renderLogin();
    const username = screen.getByLabelText(/Username/);
    const password = screen.getByLabelText(/Password/);
    await user.type(username, 'mara');
    await user.type(password, 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
    expect(username).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-invalid', 'true');
    await user.type(password, 'x');
    expect(password).toHaveAttribute('aria-invalid', 'false');
    expect(username).toHaveAttribute('aria-invalid', 'true');
  });

  it('says so, and gives the exact command, when no account exists yet', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info({ setupRequired: true }));
    renderLogin();
    expect(await screen.findByText('No account exists yet')).toBeInTheDocument();
    expect(screen.getByText('./tavvit-admin.sh create <username> --admin')).toBeInTheDocument();
    // Nobody can register while the server is empty and closed, so the page does not offer it.
    expect(screen.queryByRole('link', { name: /Create your account|Sign up/ })).toBeNull();
  });

  it('offers plain registration where it is open', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info({ registrationOpen: true }));
    renderLogin();
    expect(await screen.findByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
    expect(screen.queryByText(/invite-only/)).toBeNull();
  });

  it('explains that the server is invite-only when registration is closed', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info());
    renderLogin();
    expect(await screen.findByText(/This server is invite-only/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your account' })).toHaveAttribute('href', '/register');
    expect(screen.queryByText('No account exists yet')).toBeNull();
  });

  it('offers the desktop installer beside the form once one is published', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info());
    vi.mocked(api.desktop.release).mockResolvedValue({
      release: {
        version: '1.12.0',
        releasedAt: null,
        files: [{ platform: 'windows', arch: 'x64', fileName: 'Tavvit-1.12.0-win-x64.exe', url: '/downloads/desktop/Tavvit-1.12.0-win-x64.exe', size: 1, sha512: 'x' }],
      },
    });
    renderLogin();
    expect(await screen.findByRole('link', { name: 'Download for Windows' })).toHaveAttribute('href', '/downloads/desktop/Tavvit-1.12.0-win-x64.exe');
  });

  it('names no licence and offers no desktop app when nothing is published', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info());
    vi.mocked(api.desktop.release).mockResolvedValue({ release: null });
    renderLogin();
    await screen.findByText('Friend Club');
    expect(screen.queryByText(/AGPL|Download for Windows/)).toBeNull();
  });

  it('calls a server by its own name, and one that kept the product name by what it is', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info());
    renderLogin();
    expect(await screen.findByText('Friend Club')).toBeInTheDocument();
    expect(screen.getByText('Server')).toBeInTheDocument();
    cleanup();

    vi.mocked(api.instance.info).mockResolvedValue(info({ name: 'Tavvit' }));
    renderLogin();
    expect(await screen.findByText('Your people, in one place.')).toBeInTheDocument();
    expect(screen.queryByText('Server')).toBeNull();
  });

  it('lets someone choose their language before they have an account', async () => {
    vi.mocked(api.instance.info).mockResolvedValue(info());
    renderLogin();
    await screen.findByText('Friend Club');
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
  });

  it('claims nothing about registration until the server has answered', () => {
    vi.mocked(api.instance.info).mockReturnValue(new Promise(() => {}));
    renderLogin();
    expect(screen.getByLabelText(/Username/)).toBeInTheDocument();
    expect(screen.getByText('Log in to Tavvit')).toBeInTheDocument();
    expect(screen.queryByText(/invite-only/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Create your account|Sign up/ })).toBeNull();
  });

  it('still shows the form, under the product name, when the server cannot be asked', async () => {
    vi.mocked(api.instance.info).mockRejectedValue(new Error('offline'));
    renderLogin();
    // The link appears once the failure has been seen, so what follows is about
    // that state and not the moment before it. Not knowing is not the same as
    // closed: the plain way to an account stays, /register asks again, and the
    // server decides there.
    expect(await screen.findByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register');
    expect(screen.getByLabelText(/Username/)).toBeInTheDocument();
    expect(screen.getByText('Log in to Tavvit')).toBeInTheDocument();
    expect(screen.queryByText(/invite-only/)).toBeNull();
  });
});
