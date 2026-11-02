import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { setLanguage } from '../../i18n';

// The shell says which section is open. What protects a section is the server, so these
// tests are about who is shown what, not about keeping anyone out.

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'me', isAdmin: true } as { id: string; isAdmin: boolean } | null },
  ui: { isMobile: false },
  review: { queue: { verificationOpen: 2, discoveryOpen: 1 } as { verificationOpen: number; discoveryOpen: number } | null, reportsOpen: 4 as number | null },
  federation: false,
  fetchInstanceSettings: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { federation: { approvalRequests: () => Promise.resolve({ requests: [{ id: 'r1' }, { id: 'r2' }] }) } },
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: typeof mocks.auth) => unknown) => selector(mocks.auth),
}));
vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: typeof mocks.ui) => unknown) => selector(mocks.ui),
}));
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { fetchInstanceSettings: () => void }) => unknown) => selector({ fetchInstanceSettings: mocks.fetchInstanceSettings }),
}));
vi.mock('../../stores/reviewStore', () => ({
  useReviewStore: (selector: (s: typeof mocks.review) => unknown) => selector(mocks.review),
  openReviewTotal: (queue: { verificationOpen: number; discoveryOpen: number } | null) => (queue ? queue.verificationOpen + queue.discoveryOpen : 0),
}));
vi.mock('../../hooks/useFederationEnabled', () => ({ useFederationEnabled: () => mocks.federation }));
vi.mock('../modals/lazySettingsPanels', () => {
  const stub = (name: string) => () => <p>{name} panel</p>;
  return {
    EmailPanel: stub('Email'),
    FederationPanel: stub('Federation'),
    GeneralPanel: stub('General'),
    LegalPanel: stub('Legal'),
    PlatformAuditPanel: stub('Audit'),
    PlatformSpacesPanel: stub('Spaces'),
    RegistrationPanel: stub('Registration'),
    ReportsPanel: stub('Reports'),
    ReviewQueuePanel: stub('Reviews'),
    StoragePanel: stub('Storage'),
    StreamingPanel: stub('Streaming'),
    UsersPanel: stub('Users'),
    SettingsPanelSuspense: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
vi.mock('../modals/instanceSettingsPanels/AdminUserDetailModal', () => ({ AdminUserDetailModal: () => null }));
vi.mock('../modals/instanceSettingsPanels/AdminSpaceDetailModal', () => ({ AdminSpaceDetailModal: () => null }));
vi.mock('./AdminDashboard', () => ({ AdminDashboard: () => <p>Dashboard</p> }));
vi.mock('./AdminSearch', () => ({ AdminSearch: () => null }));
vi.mock('./AnnouncementsSection', () => ({ AnnouncementsSection: () => <p>Announcements panel</p> }));
vi.mock('./SignupRulesSection', () => ({ SignupRulesSection: () => <p>Sign-up panel</p> }));
vi.mock('./StarterSpacesSection', () => ({ StarterSpacesSection: () => <p>Starter panel</p> }));
vi.mock('./SystemSection', () => ({ SystemSection: () => <p>System panel</p> }));

import { AdminConsole } from './AdminConsole';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/admin/:section?" element={<AdminConsole />} />
        <Route path="*" element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  mocks.auth.user = { id: 'me', isAdmin: true };
  mocks.ui.isMobile = false;
  mocks.federation = false;
  mocks.review.queue = { verificationOpen: 2, discoveryOpen: 1 };
  mocks.review.reportsOpen = 4;
  await setLanguage('en');
});

describe('who is let in', () => {
  it('sends someone who is no admin home, before anything is asked of the server', () => {
    mocks.auth.user = { id: 'me', isAdmin: false };
    at('/admin/users');
    expect(screen.getByTestId('where').textContent).toBe('/channels/@me');
    expect(screen.getByText('Home')).toBeTruthy();
    expect(mocks.fetchInstanceSettings).not.toHaveBeenCalled();
  });

  it('opens for an admin, on the overview', () => {
    at('/admin');
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(mocks.fetchInstanceSettings).toHaveBeenCalled();
  });
});

describe('its sections', () => {
  it('open from the address, and from the list', () => {
    at('/admin/system');
    expect(screen.getByText('System panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Announcements/ }));
    expect(screen.getByTestId('where').textContent).toBe('/admin/announcements');
    expect(screen.getByText('Announcements panel')).toBeTruthy();
  });

  it('say which one is open', () => {
    at('/admin/reports');
    expect(screen.getByRole('button', { name: /^Reports/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: /^Overview/ }).getAttribute('aria-current')).toBeNull();
  });

  it('fall back to the overview for one that does not exist', () => {
    at('/admin/nonsense');
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('carry what is waiting in them', () => {
    at('/admin');
    expect(screen.getByRole('button', { name: /^Reviews/ }).textContent).toContain('3');
    expect(screen.getByRole('button', { name: /^Reports/ }).textContent).toContain('4');
  });

  it('leave out federation where the server does not federate, and its address too', () => {
    at('/admin/federation');
    expect(screen.queryByRole('button', { name: /^Federation/ })).toBeNull();
    expect(screen.getByText('Dashboard')).toBeTruthy();
    cleanup();
    mocks.federation = true;
    at('/admin/federation');
    expect(screen.getByRole('button', { name: /^Federation/ })).toBeTruthy();
    expect(screen.getByText('Federation panel')).toBeTruthy();
  });

  it('say how many peers wait without the section having been opened', async () => {
    mocks.federation = true;
    at('/admin');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Federation/ }).textContent).toContain('2'));
  });
});

describe('on a phone', () => {
  beforeEach(() => {
    mocks.ui.isMobile = true;
  });

  it('opens on the list of places, and goes back to it from a section', () => {
    at('/admin');
    expect(screen.queryByText('Dashboard')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Overview/ }));
    expect(screen.getByTestId('where').textContent).toBe('/admin/overview');
    expect(screen.getByText('Dashboard')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where').textContent).toBe('/admin');
  });

  it('leaves for the app from the list', () => {
    at('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where').textContent).toBe('/channels/@me');
  });
});
