import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { User } from '@backspace/shared';

const playSound = vi.hoisted(() => vi.fn(async () => null));
vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn(), playSound }),
  },
}));

import { useAuthStore } from '../stores/authStore';
import { DEFAULT_NOTIFICATION_PREFS, useNotificationPrefsStore } from '../stores/notificationPrefsStore';
import { useSpaceStore } from '../stores/spaceStore';
import { messageAlertsUser, playAlertSound } from './alerts';

const DM = 'dm-1';

function dmEvent(): Parameters<typeof messageAlertsUser>[0] {
  return { channelId: DM, message: { userId: 'bob', content: 'hello', user: { id: 'bob' } } } as never;
}

beforeEach(() => {
  playSound.mockClear();
  useNotificationPrefsStore.setState(DEFAULT_NOTIFICATION_PREFS);
  useAuthStore.setState({ user: { id: 'me', username: 'me', status: 'online' } as User });
  useSpaceStore.setState({
    dmChannels: [{ id: DM, members: [] }] as never,
    channelOriginMap: new Map([[DM, '']]),
  });
});

describe('what this device was told about alerts', () => {
  it('lets a direct message alert by default', () => {
    expect(messageAlertsUser(dmEvent())).toBe(true);
  });

  it('keeps direct messages quiet when they are turned off', () => {
    useNotificationPrefsStore.setState({ directMessages: false });
    expect(messageAlertsUser(dmEvent())).toBe(false);
  });

  it('plays each cue only while its own switch is on', async () => {
    useNotificationPrefsStore.setState({ messageSound: false });
    await playAlertSound('message');
    expect(playSound).not.toHaveBeenCalled();
    await playAlertSound('incoming_call');
    expect(playSound).toHaveBeenCalledTimes(1);

    useNotificationPrefsStore.setState({ messageSound: true, callSound: false });
    await playAlertSound('incoming_call');
    expect(playSound).toHaveBeenCalledTimes(1);
    await playAlertSound('message');
    expect(playSound).toHaveBeenCalledTimes(2);
  });
});
