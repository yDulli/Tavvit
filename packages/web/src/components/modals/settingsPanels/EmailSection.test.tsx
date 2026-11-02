import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AccountEmailStatus, InstanceInfoResponse, User } from '@backspace/shared';
import { api, HttpError } from '../../../api/client';
import { invalidateHomeInstanceInfo } from '../../../hooks/useHomeInstanceInfo';
import { setLanguage } from '../../../i18n';
import { EmailPromptBar } from '../../ui/EmailPromptBar';
import { EmailSection } from './EmailSection';

const baseUser = { id: 'u1', username: 'alice', homeInstance: null, isDeleted: false } as unknown as User;
const state = vi.hoisted(() => ({ auth: { user: null as unknown }, ui: { addToast: vi.fn(), openModal: vi.fn(), pushMobileScreen: vi.fn(), isMobile: false } }));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: typeof state.auth) => unknown) => selector(state.auth),
}));
vi.mock('../../../stores/uiStore', () => ({
  useUIStore: Object.assign((selector: (s: typeof state.ui) => unknown) => selector(state.ui), { getState: () => state.ui }),
}));

vi.mock('../../../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/client')>();
  return {
    ...original,
    api: {
      instance: { info: vi.fn() },
      users: { email: vi.fn(), changeEmail: vi.fn(), resendEmail: vi.fn(), cancelPendingEmail: vi.fn(), removeEmail: vi.fn() },
    },
  };
});

function status(over: Partial<AccountEmailStatus> = {}): AccountEmailStatus {
  return { address: null, verified: false, pendingAddress: null, undeliverable: false, lastSend: null, ...over };
}

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  invalidateHomeInstanceInfo();
  state.auth.user = baseUser;
  vi.mocked(api.instance.info).mockResolvedValue({ name: 'X', email: true } as InstanceInfoResponse);
  vi.mocked(api.users.email).mockResolvedValue(status());
  await setLanguage('en');
});

describe('the address section', () => {
  it('asks for an address and the password when there is none', async () => {
    const pending = status({ address: 'a@example.com', lastSend: 'queued' });
    vi.mocked(api.users.changeEmail).mockResolvedValue(pending);
    render(<EmailSection />);
    await userEvent.type(await screen.findByLabelText('New email address'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Current Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Send confirmation link' }));
    await screen.findByText(/We sent a link to a@example.com/);
    expect(vi.mocked(api.users.changeEmail).mock.calls[0]![0]).toMatchObject({ address: 'a@example.com', password: 'secret-password', locale: 'en' });
    expect(screen.getByText('Not confirmed')).toBeTruthy();
  });

  it('shows what stands and what waits, and can take back the change', async () => {
    vi.mocked(api.users.email).mockResolvedValue(status({ address: 'old@example.com', verified: true, pendingAddress: 'new@example.com' }));
    vi.mocked(api.users.cancelPendingEmail).mockResolvedValue(status({ address: 'old@example.com', verified: true }));
    render(<EmailSection />);
    expect(await screen.findByText('Confirmed')).toBeTruthy();
    expect(screen.getByText(/Waiting for confirmation: new@example.com/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the change' }));
    await waitFor(() => expect(screen.queryByText(/Waiting for confirmation/)).toBeNull());
  });

  it('says when mail to the address failed, and offers nothing that cannot work', async () => {
    vi.mocked(api.users.email).mockResolvedValue(status({ address: 'gone@example.com', undeliverable: true, lastSend: 'failed' }));
    render(<EmailSection />);
    expect(await screen.findByText(/could not be delivered/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send the link again' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says when the last mail did not go, while the address itself is fine', async () => {
    vi.mocked(api.users.email).mockResolvedValue(status({ address: 'a@example.com', lastSend: 'failed' }));
    render(<EmailSection />);
    expect(await screen.findByText(/could not be sent/)).toBeTruthy();
  });

  it('shows what the server refused', async () => {
    vi.mocked(api.users.changeEmail).mockRejectedValue(new HttpError(403, 'No', undefined, 'current_password_incorrect'));
    render(<EmailSection />);
    await userEvent.type(await screen.findByLabelText('New email address'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Current Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Send confirmation link' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('asks for the password to remove it', async () => {
    vi.mocked(api.users.email).mockResolvedValue(status({ address: 'a@example.com', verified: true }));
    vi.mocked(api.users.removeEmail).mockResolvedValue(status());
    render(<EmailSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await userEvent.type(await screen.findByLabelText('Current Password'), 'secret-password');
    const buttons = screen.getAllByRole('button', { name: 'Remove' });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(api.users.removeEmail).toHaveBeenCalledWith('secret-password', undefined));
  });

  it('is not there on a server that sends no mail, or for an account whose home is elsewhere', async () => {
    vi.mocked(api.instance.info).mockResolvedValue({ name: 'X', email: false } as InstanceInfoResponse);
    const { container } = render(<EmailSection />);
    await waitFor(() => expect(api.instance.info).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    cleanup();
    invalidateHomeInstanceInfo();
    vi.mocked(api.instance.info).mockResolvedValue({ name: 'X', email: true } as InstanceInfoResponse);
    state.auth.user = { ...baseUser, homeInstance: 'other.example' };
    const second = render(<EmailSection />);
    await waitFor(() => expect(api.instance.info).toHaveBeenCalledTimes(2));
    expect(second.container.textContent).toBe('');
  });
});

describe('the prompt bar', () => {
  it('suggests an address to an account without one, and can be put away', async () => {
    render(<EmailPromptBar />);
    expect(await screen.findByText(/Add an email address/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/Add an email address/)).toBeNull();
    cleanup();
    render(<EmailPromptBar />);
    await waitFor(() => expect(api.instance.info).toHaveBeenCalled());
    expect(screen.queryByText(/Add an email address/)).toBeNull();
  });

  it('stays for an account that needs it, and leads to the security tab', async () => {
    state.auth.user = { ...baseUser, email: 'a@example.com', emailVerificationRequired: true };
    render(<EmailPromptBar />);
    expect(await screen.findByText(/to create spaces/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(state.ui.openModal).toHaveBeenCalledWith('userSettings', { tab: 'security' });
  });

  it('leads to the same tab on a phone, where the settings are a screen and not a dialog', async () => {
    state.ui.isMobile = true;
    state.ui.openModal.mockClear();
    state.auth.user = { ...baseUser, email: 'a@example.com', emailVerificationRequired: true };
    render(<EmailPromptBar />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open settings' }));
    state.ui.isMobile = false;
    expect(state.ui.pushMobileScreen).toHaveBeenCalledWith('settings-security');
    expect(state.ui.openModal).not.toHaveBeenCalled();
  });

  it('is gone with a confirmed address, on a server without mail, and for a replicated account', async () => {
    state.auth.user = { ...baseUser, email: 'a@example.com', emailVerified: true };
    const { container } = render(<EmailPromptBar />);
    await waitFor(() => expect(api.instance.info).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toBe('');
    cleanup();
    state.auth.user = { ...baseUser, homeInstance: 'other.example' };
    expect(render(<EmailPromptBar />).container.textContent).toBe('');
  });
});
