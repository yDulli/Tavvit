import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpaceWithChannelsAndMembers } from '@backspace/shared';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));

vi.mock('./instanceStore', () => ({
  useInstanceStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ instances: [], _autoConnectDone: true }),
    {
      getState: () => ({ instances: [], _autoConnectDone: true }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock('./authStore', async () => {
  const state = { user: null, token: null };
  return (await import('../test/authStoreMock')).authStoreMock(() => state);
});

import { useSpaceStore } from './spaceStore';

/** Every field a space has on the wire, none of them left at its default. */
const WIRE = {
  id: 's1', name: 'Night Shift', icon: 'icon.png', banner: 'banner.png', avatarColor: 'mint', ownerId: 'o',
  ownerTitle: 'Keeper', ownerGroup: false, inviteCode: 'abcd1234', vanityCode: 'night-shift', visibility: 'public',
  directoryListed: true, description: 'A crew', badges: ['verified'], defaultNotificationLevel: 'mentions', createdAt: 7,
} as const;

const space = { ...WIRE, badges: [...WIRE.badges], channels: [], categories: [], members: [], roles: [], myPermissions: '1' } as unknown as SpaceWithChannelsAndMembers;

const stored = () => useSpaceStore.getState().spaces.find((entry) => entry.id === WIRE.id);

beforeEach(() => {
  useSpaceStore.getState().reset();
});

describe('a space from the server', () => {
  it('keeps every field when it comes with the first answer', () => {
    useSpaceStore.getState().populateFromReady('', [space]);
    expect(stored()).toMatchObject({ ...WIRE, badges: ['verified'], _instanceOrigin: '' });
  });

  it('keeps every field when it is joined later', () => {
    useSpaceStore.getState().addSpaceFromReady('', space);
    expect(stored()).toMatchObject({ ...WIRE, badges: ['verified'], _instanceOrigin: '' });
  });
});
