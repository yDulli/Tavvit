import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LinkedAccountsResponse } from '@backspace/shared';
import { setLanguage } from '../../../i18n';

// Settings → Linked accounts (docs/systems/linked-accounts.md).

vi.mock('../../../hooks/useWebSocket', () => ({ wsSend: vi.fn(), wsSendAll: vi.fn() }));
const platform = vi.hoisted(() => ({ electron: true }));
vi.mock('../../../platform/platform', () => ({ isElectron: () => platform.electron }));
vi.mock('../../../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/client')>();
  return {
    ...original,
    api: {
      users: {
        linkedAccounts: vi.fn(),
        startLinkedAccount: vi.fn(),
        updateLinkedAccount: vi.fn(),
        unlinkAccount: vi.fn(),
      },
    },
  };
});

const { api } = await import('../../../api/client');
const { useLinkedAccountsStore } = await import('../../../stores/linkedAccountsStore');
const { useActivityStore } = await import('../../../stores/activityStore');
const { LinkedAccountsPanel } = await import('./LinkedAccountsPanel');

const NOTHING: LinkedAccountsResponse = { available: ['twitch'], accounts: [] };
const LINKED: LinkedAccountsResponse = {
  available: ['twitch'],
  accounts: [{ provider: 'twitch', login: 'mara_plays', name: 'Mara_Plays', showOnProfile: true, showLive: true, linkedAt: Date.UTC(2026, 10, 7) }],
};

beforeEach(async () => {
  vi.clearAllMocks();
  platform.electron = true;
  useLinkedAccountsStore.getState().reset();
  useActivityStore.setState({ showActivity: true });
  await setLanguage('en');
});

afterEach(cleanup);

describe('LinkedAccountsPanel', () => {
  it('offers to link Twitch, and in the desktop app hands the sign-in to the browser', async () => {
    vi.mocked(api.users.linkedAccounts).mockResolvedValue(NOTHING);
    vi.mocked(api.users.startLinkedAccount).mockResolvedValue({ url: 'https://id.twitch.tv/oauth2/authorize?state=s' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<LinkedAccountsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Link Twitch' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://id.twitch.tv/oauth2/authorize?state=s', '_blank', 'noopener,noreferrer'));
    expect(api.users.startLinkedAccount).toHaveBeenCalledWith('twitch');
    expect(await screen.findByText(/Twitch opened in your browser/)).toBeInTheDocument();

    // The link completed in the browser arrives over the socket.
    act(() => useLinkedAccountsStore.getState().setAccounts(LINKED.accounts));
    expect(await screen.findByText('Mara_Plays')).toBeInTheDocument();
    expect(screen.queryByText(/Twitch opened in your browser/)).not.toBeInTheDocument();
    open.mockRestore();
  });

  it('shows the linked account, and changes what it shows', async () => {
    vi.mocked(api.users.linkedAccounts).mockResolvedValue(LINKED);
    vi.mocked(api.users.updateLinkedAccount).mockResolvedValue({
      available: ['twitch'],
      accounts: [{ ...LINKED.accounts[0]!, showLive: false }],
    });
    render(<LinkedAccountsPanel />);

    expect(await screen.findByText('Mara_Plays')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'twitch.tv/mara_plays' })).toHaveAttribute('href', 'https://www.twitch.tv/mara_plays');
    fireEvent.click(screen.getByRole('switch', { name: "Show when I'm live" }));
    await waitFor(() => expect(api.users.updateLinkedAccount).toHaveBeenCalledWith('twitch', { showLive: false }));
    await waitFor(() => expect(screen.getByRole('switch', { name: "Show when I'm live" })).toHaveAttribute('aria-checked', 'false'));
  });

  it('says nobody sees the live stream while sharing activity is off', async () => {
    useActivityStore.setState({ showActivity: false });
    vi.mocked(api.users.linkedAccounts).mockResolvedValue(LINKED);
    render(<LinkedAccountsPanel />);
    expect(await screen.findByText(/is off in Privacy, so nobody sees it for now/)).toBeInTheDocument();
  });

  it('unlinks, also after the server stopped offering Twitch', async () => {
    vi.mocked(api.users.linkedAccounts).mockResolvedValue({ ...LINKED, available: [] });
    vi.mocked(api.users.unlinkAccount).mockResolvedValue({ available: [], accounts: [] });
    render(<LinkedAccountsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(api.users.unlinkAccount).toHaveBeenCalledWith('twitch'));
    expect(await screen.findByText('This server links no accounts elsewhere.')).toBeInTheDocument();
  });
});
