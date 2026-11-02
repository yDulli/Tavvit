import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DataExportStatus } from '@backspace/shared';
import { api, HttpError } from '../../../api/client';
import { initI18n } from '../../../i18n';
import { DataExportSection } from './DataExportSection';

// The second factor's field reads the account; this account has none.
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }),
}));

const none: DataExportStatus = { status: 'none', createdAt: null, expiresAt: null, sizeBytes: null };
const ready: DataExportStatus = { status: 'ready', createdAt: 1, expiresAt: Date.now() + 86_400_000, sizeBytes: 10 };
const pending: DataExportStatus = { status: 'pending', createdAt: 1, expiresAt: null, sizeBytes: null };

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  vi.spyOn(api.users, 'dataExportStatus').mockResolvedValue(none);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DataExportSection', () => {
  it('asks for the password and says the copy is being prepared', async () => {
    const request = vi.spyOn(api.users, 'requestDataExport').mockResolvedValue(pending);
    render(<DataExportSection />);
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Request a copy' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Your password'), 'secret');
    await user.click(button);
    expect(request).toHaveBeenCalledWith('secret', undefined);
    expect(await screen.findByRole('status')).toHaveTextContent('being prepared');
    expect(screen.queryByLabelText('Your password')).toBeNull();
  });

  it('says what the server refused, in the reader\'s words', async () => {
    vi.spyOn(api.users, 'requestDataExport').mockRejectedValue(new HttpError(403, 'nope', undefined, 'current_password_incorrect'));
    render(<DataExportSection />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Your password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Request a copy' }));
    await waitFor(() => expect(screen.getByLabelText('Your password')).toHaveValue('wrong'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('offers the file once it is ready', async () => {
    vi.spyOn(api.users, 'dataExportStatus').mockResolvedValue(ready);
    const fetchFile = vi.spyOn(api.users, 'downloadDataExport').mockResolvedValue(new Blob(['zip']));
    URL.createObjectURL = vi.fn(() => 'blob:copy');
    URL.revokeObjectURL = vi.fn();
    render(<DataExportSection />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Download' }));
    expect(fetchFile).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:copy'));
  });
});
