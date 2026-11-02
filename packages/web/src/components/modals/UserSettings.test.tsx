import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { InstanceInfoResponse, User } from '@backspace/shared';
import { __resetHomeInstanceInfoForTests } from '../../hooks/useHomeInstanceInfo';

// ── Fixtures and store mocks ────────────────────────────────────────────────
// The modal reads four stores through selectors. Each is mocked with the
// selector-aware callable idiom used across the web suite
// (settingsPanels/AccountPanel.detachedNotice.test.tsx), so a selector gets the
// fixture state and `getState()` keeps working for anything that reaches for it
// outside a render. Everything a `vi.mock` factory touches lives in `vi.hoisted`,
// because those factories run before module-level `const`s are initialised.
const mocks = vi.hoisted(() => {
  const user: User = {
    id: 'user-self',
    username: 'me',
    displayName: 'Me',
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: 0,
    homeInstance: null,
    homeUserId: null,
    replicatedInstances: [],
  };

  const instanceInfo: InstanceInfoResponse = {
    name: 'Test Instance',
    version: '1.2.1',
    registrationOpen: true,
    federatedRegistrationOpen: true,
    instanceId: 'instance-1',
    sourceCodeUrl: 'https://github.com/TheZwiss/backspace',
    commit: 'abc1234',
  };

  return {
    ui: {
      activeModal: 'userSettings',
      modalData: {} as Record<string, unknown>,
      isMobile: false,
      closeModal: vi.fn(),
    },
    auth: { user, logout: vi.fn() },
    // useInstanceUpdateBadge reads these three; no update is pending, so no dot.
    settings: {
      updateStatus: null,
      updateAck: { seenVersion: null, toastShownFor: null },
      isAdmin: false,
    },
    instanceInfo,
    // The update store the Electron panel consumes, copied from
    // settingsPanels/DesktopPanel.test.tsx.
    update: {
      initialize: vi.fn(),
      snapshot: {
        capability: 'external' as const,
        dismissedVersion: null,
        status: { phase: 'idle' as const },
      },
      currentVersion: '1.0.5',
      checkNow: vi.fn(),
      install: vi.fn(),
      openDownloadPage: vi.fn(),
    },
  };
});

vi.mock('../legal/LegalLinks', () => ({ LegalLinks: () => null }));
vi.mock('../../stores/uiStore', () => ({
  useUIStore: Object.assign(
    (selector: (s: typeof mocks.ui) => unknown) => selector(mocks.ui),
    { getState: () => mocks.ui, setState: vi.fn(), subscribe: vi.fn() },
  ),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: typeof mocks.auth) => unknown) => selector(mocks.auth),
    { getState: () => mocks.auth, setState: vi.fn(), subscribe: vi.fn() },
  ),
}));

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector: (s: typeof mocks.settings) => unknown) => selector(mocks.settings),
    { getState: () => mocks.settings, setState: vi.fn(), subscribe: vi.fn() },
  ),
}));

vi.mock('../../stores/updateStore', () => ({
  useUpdateStore: (selector: (s: typeof mocks.update) => unknown) => selector(mocks.update),
}));

vi.mock('../../api/client', () => ({
  api: { instance: { info: () => Promise.resolve(mocks.instanceInfo) } },
}));

// Every sibling panel is stubbed, so this test renders only the modal chrome and
// whichever of the two Desktop panels the wiring picks.
vi.mock('./settingsPanels/AccountPanel', () => ({ AccountPanel: () => <p>AccountPanel stub</p> }));
vi.mock('./settingsPanels/AppearancePanel', () => ({ AppearancePanel: () => <p>AppearancePanel stub</p> }));
vi.mock('./settingsPanels/VoicePanel', () => ({ VoicePanel: () => <p>VoicePanel stub</p> }));
vi.mock('./settingsPanels/PrivacyPanel', () => ({ PrivacyPanel: () => <p>PrivacyPanel stub</p> }));
vi.mock('./settingsPanels/ConnectionsPanel', () => ({ ConnectionsPanel: () => <p>ConnectionsPanel stub</p> }));
vi.mock('./settingsPanels/KeybindsPanel', () => ({ KeybindsPanel: () => <p>KeybindsPanel stub</p> }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => navigate,
}));

import { UserSettingsModal } from './UserSettings';

/** The preload bridge whose presence is what `isElectron()` reads. */
function installDesktopHost() {
  Object.defineProperty(window, 'backspace', {
    configurable: true,
    writable: true,
    value: {
      isSandboxed: vi.fn().mockResolvedValue(false),
      getAutoLaunchSettings: vi.fn().mockResolvedValue({ openAtLogin: false, startMinimized: true }),
      setAutoLaunchSettings: vi.fn(),
      clearInstanceUrl: vi.fn(),
    },
  });
}

/** True when the nodes appear in this order in the document, each one after the last. */
function inDocumentOrder(...nodes: HTMLElement[]): boolean {
  return nodes.every(
    (node, i) =>
      i === 0 ||
      Boolean(nodes[i - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
}

/**
 * Renders the modal. The panels are lazily loaded (`lazySettingsPanels`), so
 * this does not mean the open panel has mounted: a test that reads a panel
 * waits for it with `findBy*`.
 */
async function openSettings(): Promise<void> {
  render(<UserSettingsModal />);
  await screen.findAllByRole('button', { name: 'Log Out' });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetHomeInstanceInfoForTests();
  Reflect.deleteProperty(mocks.instanceInfo, 'federationEnabled');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'backspace');
});

describe('UserSettingsModal Desktop tab', () => {
  it('has no Desktop tab in the browser: there are no Tavvit installers to offer', async () => {
    await openSettings();

    expect(screen.queryByRole('button', { name: 'Desktop' })).not.toBeInTheDocument();
    // App Settings still holds the other tabs, in order, before the footer.
    expect(
      inDocumentOrder(
        screen.getByText('App Settings'),
        screen.getByRole('button', { name: 'Connections' }),
        screen.getByRole('button', { name: 'Keybinds' }),
        screen.getByRole('button', { name: 'Log Out' }),
      ),
    ).toBe(true);
    expect(screen.getAllByText(/^(User Settings|App Settings|Administration)$/)).toHaveLength(2);
  });

  it('shows the desktop app settings inside Electron', async () => {
    installDesktopHost();
    await openSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));

    expect(await screen.findByRole('heading', { name: 'Desktop' })).toBeInTheDocument();
    // The app opens one server; there is nothing to switch.
    expect(screen.queryByRole('button', { name: 'Change Instance' })).toBeNull();
  });
});

describe('UserSettingsModal Connections tab', () => {
  it('is offered where the instance federates', async () => {
    mocks.instanceInfo.federationEnabled = true;
    await openSettings();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
  });

  it('is offered by a server that does not say (an older one federates)', async () => {
    await openSettings();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
  });

  it('is not offered on a private server: nothing behind it would answer', async () => {
    mocks.instanceInfo.federationEnabled = false;
    await openSettings();
    expect(screen.queryByRole('button', { name: 'Connections' })).not.toBeInTheDocument();
  });
});

describe('UserSettingsModal deep links (#330)', () => {
  afterEach(() => {
    mocks.ui.modalData = {};
    mocks.auth.user = { ...mocks.auth.user, isAdmin: false };
  });

  it.each([
    ['appearance', 'AppearancePanel stub'],
    ['voice', 'VoicePanel stub'],
    ['keybinds', 'KeybindsPanel stub'],
  ])('opens on the %s tab a caller names', async (tab, marker) => {
    mocks.ui.modalData = { tab };
    await openSettings();
    // The named panel has to mount before the absence check below means
    // anything: before it does, no panel is rendered at all.
    expect(await screen.findByText(marker)).toBeInTheDocument();
    expect(screen.queryByText('AccountPanel stub')).not.toBeInTheDocument();
  });

  it('falls back to Account for the desktop tab in a browser', async () => {
    mocks.ui.modalData = { tab: 'desktop' };
    await openSettings();
    expect(await screen.findByText('AccountPanel stub')).toBeInTheDocument();
  });

  it('opens on the desktop tab a caller names inside Electron', async () => {
    installDesktopHost();
    mocks.ui.modalData = { tab: 'desktop' };
    await openSettings();
    expect(await screen.findByRole('heading', { name: 'Desktop' })).toBeInTheDocument();
  });

  it('falls back to Account for the connections tab on a private server', async () => {
    mocks.instanceInfo.federationEnabled = false;
    mocks.ui.modalData = { tab: 'connections' };
    await openSettings();
    expect(await screen.findByText('AccountPanel stub')).toBeInTheDocument();
  });

  it('falls back to Account for the instance tab when the user is not an admin', async () => {
    mocks.ui.modalData = { tab: 'instance' };
    await openSettings();
    expect(await screen.findByText('AccountPanel stub')).toBeInTheDocument();
  });

  it('leads an admin to the console, which is a page of its own, and closes itself', async () => {
    mocks.auth.user = { ...mocks.auth.user, isAdmin: true };
    mocks.ui.modalData = {};
    await openSettings();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Admin console' }))[0]!);
    expect(mocks.ui.closeModal).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/admin');
  });

  it('offers nobody else the way there', async () => {
    mocks.auth.user = { ...mocks.auth.user, isAdmin: false };
    mocks.ui.modalData = {};
    await openSettings();
    expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
  });

  it('opens Account for what used to be the instance tab', async () => {
    mocks.auth.user = { ...mocks.auth.user, isAdmin: true };
    mocks.ui.modalData = { tab: 'instance' };
    await openSettings();
    expect(await screen.findByText('AccountPanel stub')).toBeInTheDocument();
  });

  it('falls back to Account for a tab that does not exist', async () => {
    mocks.ui.modalData = { tab: 'nonsense' };
    await openSettings();
    expect(await screen.findByText('AccountPanel stub')).toBeInTheDocument();
  });
});
