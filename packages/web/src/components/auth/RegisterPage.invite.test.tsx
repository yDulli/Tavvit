import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { InstanceInfoResponse } from '@backspace/shared';
import { api } from '../../api/client';
import { setLanguage } from '../../i18n';
import { RegisterPage } from './RegisterPage';

const authState = {
  login: vi.fn(),
  isLoading: false,
  initSession: vi.fn(),
};

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

vi.mock('../../stores/transferStore', () => ({
  useTransferStore: {
    getState: () => ({ startUpload: vi.fn() }),
  },
}));

vi.mock('../../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client')>();
  return {
    ...original,
    api: {
      desktop: { release: vi.fn(async () => ({ release: null })) },
      instance: { info: vi.fn() },
      auth: {
        checkInvite: vi.fn(),
        checkUsername: vi.fn(async () => ({ available: true })),
        register: vi.fn(),
      },
      users: { update: vi.fn() },
    },
  };
});

const REFUSED_LINK = 'a'.repeat(22);
const GOOD_CODE = 'b'.repeat(22);
const CODE_FIELD = 'Invite code or link';

// A person whose invite link has expired is told to enter a code instead. The field
// for that code used to hang on the link's refusal, which is cleared while a code is
// checked: it left the page mid-typing, and the refused link was what got sent.
describe('a refused invite link, then a good code', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setLanguage('en');
    vi.mocked(api.instance.info).mockResolvedValue({ name: 'Friend Club', registrationOpen: false } as InstanceInfoResponse);
    vi.mocked(api.auth.checkInvite).mockImplementation(async (token) => (
      token === GOOD_CODE ? { valid: true, name: 'Friends' } : { valid: false, reason: 'invalid' }
    ));
    vi.mocked(api.auth.register).mockRejectedValue(new Error('stops here'));
  });

  function renderFromLink() {
    return render(
      <MemoryRouter initialEntries={[`/register?invite=${REFUSED_LINK}`]}>
        <RegisterPage />
      </MemoryRouter>,
    );
  }

  it('says nothing against the code field until something is typed in it', async () => {
    renderFromLink();
    const field = await screen.findByLabelText(CODE_FIELD);
    expect(screen.getByText('Invalid invite link. Please request a new one.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText('Invalid invite code.')).not.toBeInTheDocument();
  });

  it('keeps the field, and the focus in it, while the code is checked', async () => {
    const user = userEvent.setup();
    renderFromLink();
    const field = await screen.findByLabelText(CODE_FIELD);
    await user.type(field, GOOD_CODE);
    expect(await screen.findByText('Valid invite: Friends', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByLabelText(CODE_FIELD)).toBe(field);
    expect(field).toHaveFocus();
  });

  it('registers with the typed code, not the refused link', async () => {
    const user = userEvent.setup();
    const { container } = renderFromLink();
    await user.type(await screen.findByLabelText(CODE_FIELD), GOOD_CODE);
    await screen.findByText('Valid invite: Friends', undefined, { timeout: 3000 });

    await user.type(container.querySelector<HTMLInputElement>('#register-username')!, 'alice');
    await user.type(container.querySelector<HTMLInputElement>('#register-password')!, 'long-enough-password');
    await user.type(container.querySelector<HTMLInputElement>('#register-confirm-password')!, 'long-enough-password');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Get started' }));

    expect(api.auth.register).toHaveBeenCalledWith(expect.objectContaining({ inviteToken: GOOD_CODE }));
  });
});
