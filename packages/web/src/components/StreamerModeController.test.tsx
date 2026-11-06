import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const pushMask = vi.hoisted(() => ({ write: vi.fn(async () => undefined) }));
vi.mock('../streamer/pushMask', () => ({ writePushMask: pushMask.write }));

import { StreamerModeController } from './StreamerModeController';
import { maskNotifications, sendNotification } from '../platform/notifications';
import { useStreamerModeStore } from '../streamer/streamerModeStore';
import { useUIStore } from '../stores/uiStore';

const MASK = { title: 'Tavvit', body: 'You have a new notification.' };

/** The browser's notifications: what was shown, in order. */
const shown: Array<{ title: string; body?: string }> = [];
class FakeNotification {
  static permission = 'granted';
  onclick: (() => void) | null = null;
  constructor(title: string, options?: { body?: string }) {
    shown.push({ title, body: options?.body });
  }
  close(): void {}
}

beforeEach(() => {
  shown.length = 0;
  pushMask.write.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
  maskNotifications(null);
  delete window.backspace;
  useStreamerModeStore.setState(useStreamerModeStore.getInitialState(), true);
});

describe('streamer mode beyond the page', () => {
  it('lets notifications and pushes say only that there is one while it is on', () => {
    render(<StreamerModeController />);
    sendNotification('Ada in #general', 'the door code is 4711');
    expect(shown.at(-1)).toEqual({ title: 'Ada in #general', body: 'the door code is 4711' });
    expect(pushMask.write).toHaveBeenLastCalledWith(null);

    act(() => useStreamerModeStore.getState().setOn(true));
    sendNotification('Ada in #general', 'the door code is 4711');
    expect(shown.at(-1)).toEqual(MASK);
    expect(pushMask.write).toHaveBeenLastCalledWith(MASK);

    act(() => useStreamerModeStore.getState().setOn(false));
    sendNotification('Ada in #general', 'see you');
    expect(shown.at(-1)).toEqual({ title: 'Ada in #general', body: 'see you' });
    expect(pushMask.write).toHaveBeenLastCalledWith(null);
  });

  it('asks the desktop app to watch for streaming programs only while the mode may turn on by itself', async () => {
    const watch = vi.fn(async () => null as boolean | null);
    let tell: ((running: boolean) => void) | null = null;
    window.backspace = {
      watchStreamingPrograms: watch,
      onStreamingPrograms: (callback: (running: boolean) => void) => {
        tell = callback;
        return () => { tell = null; };
      },
    } as unknown as BackspaceElectronAPI;
    const addToast = vi.spyOn(useUIStore.getState(), 'addToast');

    render(<StreamerModeController />);
    expect(watch).toHaveBeenLastCalledWith(true);

    act(() => tell!(true));
    expect(useStreamerModeStore.getState()).toMatchObject({ on: true, bySoftware: true });
    expect(addToast).toHaveBeenLastCalledWith('Streamer mode is on: a streaming program started.', 'info', 5000);
    act(() => tell!(false));
    expect(useStreamerModeStore.getState().on).toBe(false);
    expect(addToast).toHaveBeenLastCalledWith('Streamer mode is off: the streaming program closed.', 'info', 5000);

    await act(async () => useStreamerModeStore.getState().setAutomatic(false));
    expect(watch).toHaveBeenLastCalledWith(false);
    expect(tell).toBeNull();
    addToast.mockRestore();
  });

  it('asks nothing of a desktop app too old to watch', () => {
    window.backspace = {} as unknown as BackspaceElectronAPI;
    expect(() => render(<StreamerModeController />)).not.toThrow();
  });
});
