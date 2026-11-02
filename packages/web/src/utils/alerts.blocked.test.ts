import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { User } from '@backspace/shared';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: { users: { listBlocks: vi.fn(), block: vi.fn(), unblock: vi.fn() } },
}));

import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useBlockStore } from '../stores/blockStore';
import { messageAlertsUser } from './alerts';

const DM = 'dm-1';
const REMOTE_DM = 'dm-remote';

function event(channelId: string, userId: string): Parameters<typeof messageAlertsUser>[0] {
  return { channelId, message: { userId, content: 'hello', user: { id: userId } } } as Parameters<typeof messageAlertsUser>[0];
}

beforeEach(() => {
  useBlockStore.getState().reset();
  useAuthStore.setState({ user: { id: 'me', username: 'me' } as User, myRowIds: new Map() });
  useSpaceStore.setState({
    dmChannels: [
      { id: DM, federatedId: null, members: [], ownerId: null } as never,
      { id: REMOTE_DM, federatedId: null, members: [], ownerId: null } as never,
    ],
    channelOriginMap: new Map([[DM, ''], [REMOTE_DM, 'https://remote.example']]),
  });
});

describe('messageAlertsUser and blocked people', () => {
  it('alerts for a direct message from someone who is not blocked', () => {
    expect(messageAlertsUser(event(DM, 'friend'))).toBe(true);
  });

  it('raises no alert for a message from someone the user blocked', () => {
    useBlockStore.setState({ blockedIds: new Set(['friend']) });
    expect(messageAlertsUser(event(DM, 'friend'))).toBe(false);
    // Somebody else still alerts.
    expect(messageAlertsUser(event(DM, 'other'))).toBe(true);
  });

  it('does not apply a home block to a channel another instance hosts', () => {
    // The same id on another instance names a different person.
    useBlockStore.setState({ blockedIds: new Set(['friend']) });
    expect(messageAlertsUser(event(REMOTE_DM, 'friend'))).toBe(true);
  });
});
