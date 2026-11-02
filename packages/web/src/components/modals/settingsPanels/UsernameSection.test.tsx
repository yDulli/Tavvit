import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@backspace/shared';

const changeUsername = vi.hoisted(() => vi.fn());
const setUser = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ user: null as unknown }));

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  api: { users: { changeUsername } },
}));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: state.user, setUser }),
}));
vi.mock('../../../stores/uiStore', () => ({
  useUIStore: (selector: (s: unknown) => unknown) => selector({ addToast }),
}));
vi.mock('./TwoFactorSection', () => ({ TwoFactorCodeField: () => null }));

import { UsernameSection } from './UsernameSection';

const user = (fields: Partial<User> = {}) => ({ id: '1', username: 'mara', replicatedInstances: [], usernameChangedAt: null, homeInstance: null, ...fields });

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Change' }));

beforeEach(() => {
  changeUsername.mockReset();
  setUser.mockReset();
  addToast.mockReset();
  state.user = user();
});

describe('the username in the settings', () => {
  it('shows the name, and the form only when asked for', () => {
    render(<UsernameSection />);
    expect(screen.getByText('@mara')).toBeTruthy();
    expect(screen.queryByLabelText('New username')).toBeNull();
    open();
    expect(screen.getByLabelText('New username')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('asks for a name of the right shape and the password before it sends anything', () => {
    render(<UsernameSection />);
    open();
    const send = screen.getByRole('button', { name: 'Change username' });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('New username'), { target: { value: 'no spaces' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('New username'), { target: { value: 'New_Name' } });
    expect(send).toHaveProperty('disabled', false);
  });

  it('sends it in small letters, takes the answer and closes', async () => {
    changeUsername.mockResolvedValue({ user: user({ username: 'new_name' }) });
    render(<UsernameSection />);
    open();
    fireEvent.change(screen.getByLabelText('New username'), { target: { value: ' New_Name ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change username' }));
    await waitFor(() => expect(changeUsername).toHaveBeenCalledWith({ username: 'new_name', password: 'secret' }));
    await waitFor(() => expect(setUser).toHaveBeenCalledTimes(1));
    expect(addToast).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByLabelText('New username')).toBeNull());
  });

  it('says what went wrong and stays open', async () => {
    changeUsername.mockRejectedValue(Object.assign(new Error('That username is already taken.'), { code: 'username_taken' }));
    render(<UsernameSection />);
    open();
    fireEvent.change(screen.getByLabelText('New username'), { target: { value: 'noor' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change username' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('New username')).toBeTruthy();
    expect(setUser).not.toHaveBeenCalled();
  });

  it('says when the next change can be, and offers none until then', () => {
    state.user = user({ usernameChangedAt: Date.now() });
    render(<UsernameSection />);
    expect(screen.getByText(/You can change it again on/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it('offers it again once the time is up', () => {
    state.user = user({ usernameChangedAt: Date.now() - 31 * 86_400_000 });
    render(<UsernameSection />);
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('leaves an account from another server to that server', () => {
    state.user = user({ username: 'mara@home.example', homeInstance: 'home.example' });
    render(<UsernameSection />);
    expect(screen.getByText(/set on the server your account comes from/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it('waits while the account is connected to other servers', () => {
    state.user = user({ replicatedInstances: [{ origin: 'https://b.example', username: 'mara@a.example' }] as User['replicatedInstances'] });
    render(<UsernameSection />);
    expect(screen.getByText(/connected to other servers/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});
