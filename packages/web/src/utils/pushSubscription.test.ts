import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  push: {
    key: vi.fn(async () => ({ publicKey: 'BAA' })),
    subscribe: vi.fn(async () => ({ success: true })),
    unsubscribe: vi.fn(async () => ({ success: true })),
  },
}));
const isElectronNow = vi.hoisted(() => ({ value: false }));

vi.mock('../api/client', () => ({ api }));
vi.mock('../platform/platform', () => ({ isElectron: () => isElectronNow.value }));
vi.mock('../i18n', () => ({ default: { language: 'de' } }));

const { disablePush, dropThisDevicesPush, enablePush, readPushState, syncPushSubscription } = await import('./pushSubscription');

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
};
let current: typeof subscription | null;
const pushManager = {
  getSubscription: vi.fn(async () => current),
  subscribe: vi.fn(async () => { current = subscription; return subscription; }),
};
const registration = { pushManager };

function installBrowser({ permission = 'default', answer = 'granted' }: { permission?: string; answer?: string } = {}): void {
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, {
    permission,
    requestPermission: vi.fn(async () => answer),
  }));
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration), getRegistrations: async () => [registration] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  current = null;
  isElectronNow.value = false;
  localStorage.clear();
  installBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('what a device can do', () => {
  it('leaves the desktop app out, which has its own notifications', async () => {
    isElectronNow.value = true;
    expect(await readPushState('u1')).toBe('unsupported');
  });

  it('tells an iPhone browser to put the app on the Home Screen first', async () => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
    const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
    expect(await readPushState('u1')).toBe('install-first');
    agent.mockRestore();
  });

  it('says when the browser was told no', async () => {
    installBrowser({ permission: 'denied' });
    expect(await readPushState('u1')).toBe('denied');
  });
});

describe('turning it on and off', () => {
  it('subscribes and tells the server what this device chose', async () => {
    expect(await enablePush('u1')).toBe('on');
    expect(api.push.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: subscription.endpoint,
      keys: { p256dh: 'p', auth: 'a' },
      showText: true,
      directMessages: true,
      locale: 'de',
    }));
    expect(await readPushState('u1')).toBe('on');
  });

  it('stops where the browser was told no', async () => {
    installBrowser({ answer: 'denied' });
    expect(await enablePush('u1')).toBe('denied');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('asks again another time when the browser was not answered', async () => {
    installBrowser({ answer: 'default' });
    expect(await enablePush('u1')).toBe('off');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('turns off at the server and in the browser', async () => {
    await enablePush('u1');
    expect(await disablePush('u1')).toBe('off');
    expect(api.push.unsubscribe).toHaveBeenCalledWith(subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});

describe('at every start', () => {
  it('tells the server the address again for the account that turned it on', async () => {
    await enablePush('u1');
    api.push.subscribe.mockClear();
    installBrowser({ permission: 'granted' });
    await syncPushSubscription('u1');
    expect(api.push.subscribe).toHaveBeenCalledTimes(1);
  });

  it('drops a subscription another account left in this browser, instead of inheriting it', async () => {
    await enablePush('u1');
    api.push.subscribe.mockClear();
    installBrowser({ permission: 'granted' });
    await syncPushSubscription('someone-else');
    expect(api.push.subscribe).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});

describe('signing out', () => {
  it('stops this browser getting anything', async () => {
    await enablePush('u1');
    await dropThisDevicesPush();
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});
