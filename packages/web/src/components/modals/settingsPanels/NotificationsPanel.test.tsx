import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../../i18n';
import { DEFAULT_NOTIFICATION_PREFS, useNotificationPrefsStore } from '../../../stores/notificationPrefsStore';
import { useNotificationSettingsStore } from '../../../stores/notificationSettingsStore';
import { useSpaceStore, type TaggedSpace } from '../../../stores/spaceStore';
import { NotificationsPanel } from './NotificationsPanel';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

const space = {
  id: 'space-1', name: 'Night Shift', icon: null, banner: null, avatarColor: 'lavender', ownerId: 'u1', inviteCode: null,
  visibility: 'public', directoryListed: false, description: '', createdAt: 1, _instanceOrigin: '',
} as unknown as TaggedSpace;

function stubNotification(permission: NotificationPermission) {
  const requestPermission = vi.fn(async () => {
    (globalThis.Notification as unknown as { permission: NotificationPermission }).permission = 'granted';
    return 'granted' as NotificationPermission;
  });
  const created: Array<{ title: string; body?: string }> = [];
  class FakeNotification {
    static permission = permission;
    static requestPermission = requestPermission;
    onclick: (() => void) | null = null;
    constructor(title: string, options?: { body?: string }) {
      created.push({ title, body: options?.body });
    }
    close() {}
  }
  vi.stubGlobal('Notification', FakeNotification);
  return { requestPermission, created };
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  useNotificationPrefsStore.setState(DEFAULT_NOTIFICATION_PREFS);
  useNotificationSettingsStore.getState().reset();
  useSpaceStore.setState({ spaces: [space] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NotificationsPanel', () => {
  it('offers to turn notifications on where the browser has not been asked, and asks only then', async () => {
    const { requestPermission } = stubNotification('default');
    render(<NotificationsPanel />);
    expect(requestPermission).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send a test notification' })).toBeInTheDocument());
  });

  it('says how to allow them when the browser blocks them, and offers no button that cannot work', () => {
    stubNotification('denied');
    render(<NotificationsPanel />);
    expect(screen.getByText(/blocks notifications for this site/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
  });

  it('sends a test notification once they are allowed', async () => {
    const { created } = stubNotification('granted');
    render(<NotificationsPanel />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send a test notification' }));
    expect(created).toEqual([{ title: 'Tavvit', body: 'This is what a notification looks like.' }]);
  });

  it('keeps what a notification says as a choice of this device', async () => {
    stubNotification('granted');
    render(<NotificationsPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Show the message text' }));
    await user.click(screen.getByRole('switch', { name: 'Direct messages' }));
    await user.click(screen.getByRole('switch', { name: 'Ringtone for calls' }));
    expect(useNotificationPrefsStore.getState()).toMatchObject({ showMessageText: false, directMessages: false, callSound: false });
  });

  it('lists each space with what it may tell you, and opens its settings', async () => {
    stubNotification('granted');
    render(<NotificationsPanel />);
    const row = screen.getByRole('button', { name: /Night Shift/ });
    expect(row).toHaveTextContent('Only @mentions');
    await userEvent.setup().click(row);
    expect(screen.getByText('Notifications for Night Shift')).toBeInTheDocument();
  });
});
