import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { PermissionBits } from '../../utils/permissions';
import { api } from '../../api/client';
import { initI18n } from '../../i18n';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore, type TaggedSpace } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { AccessPanel, SpaceSettingsModal } from './SpaceSettings';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));
vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));

const space = {
  id: 'space-1', name: 'Night Shift', icon: null, banner: null, avatarColor: 'lavender', ownerId: 'owner', inviteCode: null,
  visibility: 'request', directoryListed: false, description: '', createdAt: 1, _instanceOrigin: '',
} as unknown as TaggedSpace;

function seed(permissions: bigint, userId = 'member') {
  useAuthStore.setState({ user: { id: userId, username: userId, isAdmin: false } as never });
  useSpaceStore.setState({
    spaces: [space],
    currentSpaceId: space.id,
    spacePermissions: new Map([[space.id, permissions]]) as never,
  });
  useUIStore.setState({ activeModal: 'spaceSettings', modalData: {} });
}

function open() {
  render(<MemoryRouter><SpaceSettingsModal /></MemoryRouter>);
}

const navNames = () => screen.getAllByRole('button').map((b) => b.textContent ?? '');

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  vi.spyOn(api.explore, 'getJoinRequests').mockResolvedValue({ requests: [] } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useUIStore.setState({ activeModal: null, modalData: {} });
});

describe('space settings, by who is looking', () => {
  it('gives a member with no permissions their own settings and nothing to look at but not use', async () => {
    seed(0n);
    open();
    expect(await screen.findByRole('button', { name: 'Leave Space' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit space profile' })).toBeInTheDocument();
    const names = navNames();
    expect(names).toContain('Your settings');
    for (const hidden of ['Overview', 'Access', 'Discovery', 'Moderation', 'Members', 'Roles', 'Bans', 'Audit log']) {
      expect(names, hidden).not.toContain(hidden);
    }
  });

  it('shows a moderator who may kick the member list, and still not the space itself', async () => {
    seed(BigInt(PermissionBits.KICK_MEMBERS));
    open();
    await screen.findByRole('button', { name: 'Leave Space' });
    const names = navNames();
    expect(names).toContain('Members');
    expect(names).not.toContain('Overview');
  });

  it('ignores a deep link to a tab the viewer may not open', async () => {
    seed(0n);
    useUIStore.setState({ modalData: { tab: 'discovery' } });
    open();
    expect(await screen.findByRole('button', { name: 'Leave Space' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Discovery' })).toBeNull();
  });

  it('opens on the overview for those who manage the space, with Access and its count beside it', async () => {
    vi.spyOn(api.explore, 'getJoinRequests').mockResolvedValue({ requests: [{ id: 'r1' }, { id: 'r2' }] } as never);
    seed(BigInt(PermissionBits.MANAGE_SPACE), 'owner');
    open();
    const access = await screen.findByRole('button', { name: /Access/ });
    await waitFor(() => expect(access).toHaveTextContent('2'));
  });

  it('has no way out for the owner: a space cannot lose its owner by leaving', async () => {
    seed(BigInt(PermissionBits.MANAGE_SPACE), 'owner');
    useUIStore.setState({ modalData: { tab: 'you' } });
    open();
    await screen.findByRole('button', { name: 'Edit space profile' });
    expect(screen.queryByRole('button', { name: 'Leave Space' })).toBeNull();
  });
});

describe('AccessPanel', () => {
  it('saves the visibility alone, through the store, so a remote space goes to its own instance', async () => {
    seed(BigInt(PermissionBits.MANAGE_SPACE), 'owner');
    const updateSpace = vi.fn().mockResolvedValue(undefined);
    useSpaceStore.setState({ updateSpace });
    render(<AccessPanel spaceId="space-1" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Private/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateSpace).toHaveBeenCalledWith('space-1', { visibility: 'private' });
  });
});
