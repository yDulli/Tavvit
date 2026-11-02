import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { SecurityOverview, User } from '@backspace/shared';
import { api, HttpError } from '../../../api/client';
import { setLanguage } from '../../../i18n';
import { TwoFactorCodeField, TwoFactorSection } from './TwoFactorSection';

const state = vi.hoisted(() => ({ auth: { user: null as unknown }, ui: { addToast: vi.fn() } }));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: typeof state.auth) => unknown) => selector(state.auth),
}));
vi.mock('../../../stores/uiStore', () => ({
  useUIStore: (selector: (s: typeof state.ui) => unknown) => selector(state.ui),
}));
vi.mock('../../../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/client')>();
  return {
    ...original,
    api: { auth: { twoFactorSetup: vi.fn(), twoFactorEnable: vi.fn(), twoFactorDisable: vi.fn(), twoFactorRecoveryCodes: vi.fn() } },
  };
});

const baseUser = { id: 'u1', username: 'alice', homeInstance: null } as unknown as User;
const CODES = ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'];

function overview(twoFactor: Partial<SecurityOverview['twoFactor']> = {}): SecurityOverview {
  return {
    twoFactor: { available: true, enabled: false, enabledAt: null, recoveryCodesLeft: 0, ...twoFactor },
    passwordChangedAt: null,
    sessionCount: 1,
    events: [],
  };
}

const onChanged = vi.fn();

beforeEach(async () => {
  cleanup();
  vi.clearAllMocks();
  state.auth.user = baseUser;
  await setLanguage('en');
});

describe('turning it on', () => {
  it('goes through the password, a QR code and a code, and only then shows recovery codes', async () => {
    vi.mocked(api.auth.twoFactorSetup).mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/Tavvit:alice?secret=JBSWY3DPEHPK3PXP' });
    vi.mocked(api.auth.twoFactorEnable).mockResolvedValue({ recoveryCodes: CODES });
    render(<TwoFactorSection overview={overview()} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await userEvent.type(screen.getByLabelText('Current Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('img', { name: /QR code/ })).toBeTruthy();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    expect(api.auth.twoFactorSetup).toHaveBeenCalledWith('secret-password');
    expect(api.auth.twoFactorEnable).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Code from the app'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(await screen.findByText(CODES[0]!)).toBeTruthy();
    expect(api.auth.twoFactorEnable).toHaveBeenCalledWith('123456');
    expect(onChanged).toHaveBeenCalled();

    // Not gone by accident: they are shown only now.
    const done = screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    await userEvent.click(screen.getByLabelText(/put them somewhere safe/));
    expect(done.disabled).toBe(false);
    await userEvent.click(done);
    expect(screen.queryByText(CODES[0]!)).toBeNull();
  });

  it('stays on the code step when the code is wrong, and says so', async () => {
    vi.mocked(api.auth.twoFactorSetup).mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/Tavvit:alice?secret=JBSWY3DPEHPK3PXP' });
    vi.mocked(api.auth.twoFactorEnable).mockRejectedValue(new HttpError(400, 'No', undefined, 'mfa_code_invalid'));
    render(<TwoFactorSection overview={overview()} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await userEvent.type(screen.getByLabelText('Current Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(await screen.findByLabelText('Code from the app'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Code from the app')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('says so when the password is wrong, and shows no secret', async () => {
    vi.mocked(api.auth.twoFactorSetup).mockRejectedValue(new HttpError(403, 'No', undefined, 'current_password_incorrect'));
    render(<TwoFactorSection overview={overview()} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await userEvent.type(screen.getByLabelText('Current Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull();
  });

  it('is not offered where the server cannot do it', () => {
    render(<TwoFactorSection overview={overview({ available: false })} onChanged={onChanged} />);
    expect(screen.getByText(/Not available on this server/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
  });

  it('is not offered to an account whose home is elsewhere', () => {
    state.auth.user = { ...baseUser, homeInstance: 'other.example' };
    const { container } = render(<TwoFactorSection overview={overview()} onChanged={onChanged} />);
    expect(container.textContent).toBe('');
  });
});

describe('while it is on', () => {
  const on = overview({ enabled: true, enabledAt: 1_800_000_000_000, recoveryCodesLeft: 7 });

  it('says since when, and how many codes are left', () => {
    render(<TwoFactorSection overview={on} onChanged={onChanged} />);
    expect(screen.getByText(/7 recovery codes left/)).toBeTruthy();
    expect(screen.queryByText(/running out/)).toBeNull();
  });

  it('warns when few codes are left', () => {
    render(<TwoFactorSection overview={overview({ enabled: true, enabledAt: 1, recoveryCodesLeft: 2 })} onChanged={onChanged} />);
    expect(screen.getByText(/running out/)).toBeTruthy();
  });

  it('takes the password and a code to turn off', async () => {
    vi.mocked(api.auth.twoFactorDisable).mockResolvedValue({ success: true });
    render(<TwoFactorSection overview={on} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    const submit = screen.getAllByRole('button', { name: 'Turn off' }).at(-1) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Current Password'), 'secret-password');
    expect(submit.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Code from your app/), '123456');
    await userEvent.click(submit);
    await waitFor(() => expect(api.auth.twoFactorDisable).toHaveBeenCalledWith('secret-password', '123456'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('takes the password and a code to make new recovery codes, and shows them once', async () => {
    vi.mocked(api.auth.twoFactorRecoveryCodes).mockResolvedValue({ recoveryCodes: CODES });
    render(<TwoFactorSection overview={on} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Make new recovery codes' }));
    await userEvent.type(screen.getByLabelText('Current Password'), 'secret-password');
    await userEvent.type(screen.getByLabelText(/Code from your app/), '123456');
    await userEvent.click(screen.getAllByRole('button', { name: 'Make new recovery codes' }).at(-1)!);
    expect(await screen.findByText(CODES[1]!)).toBeTruthy();
  });
});

describe('the code field on other forms', () => {
  function Form() {
    const [value, setValue] = useState('');
    return <TwoFactorCodeField id="x" value={value} onChange={setValue} />;
  }

  it('is there for an account with 2FA', () => {
    state.auth.user = { ...baseUser, twoFactorEnabled: true };
    render(<Form />);
    expect(screen.getByLabelText(/Code from your app/)).toBeTruthy();
  });

  it('is not there for one without', () => {
    expect(render(<Form />).container.textContent).toBe('');
  });
});
