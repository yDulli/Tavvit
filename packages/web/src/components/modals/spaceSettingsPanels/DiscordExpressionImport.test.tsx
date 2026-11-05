import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiscordExpressionApplyResult, DiscordExpressionPreview } from '@backspace/shared/src/discordExpressionImport';

// The bot token lives in this form for one look-up and is gone once Discord has answered or
// refused; the import then runs batch after batch without it and ends in a report.

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

const api = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('../../../utils/crossStoreResolvers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/crossStoreResolvers')>()),
  getApiForOrigin: () => ({
    import: {
      discordExpressionsPreview: (...args: unknown[]) => api.preview(...args),
      discordExpressionsApply: (...args: unknown[]) => api.apply(...args),
      discordExpressionsCancel: (...args: unknown[]) => api.cancel(...args),
    },
  }),
}));

import { DiscordExpressionImport } from './DiscordExpressionImport';
import { HttpError, RequestTimeoutError } from '../../../api/client';

const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GsEnTi.SentinelBotTokenValue0123456789';
const GUILD = '987654321098765432';

const PREVIEW: DiscordExpressionPreview = {
  importId: 'import-1',
  expiresAt: Date.now() + 60_000,
  items: [
    { key: 'emoji:100000000000000001', kind: 'emoji', discordId: '100000000000000001', sourceName: 'PartyParrot', name: 'partyparrot', animated: false, action: 'import', skip: null, notes: ['renamed'] },
    { key: 'sticker:200000000000000002', kind: 'sticker', discordId: '200000000000000002', sourceName: 'Dance', name: 'Dance', animated: false, format: 'lottie', action: 'skip', skip: 'lottie', notes: [] },
  ],
  room: { emoji: 200, stickers: 60 },
  limits: { emoji: 200, stickers: 60 },
};

beforeEach(() => {
  api.preview.mockReset();
  api.apply.mockReset();
  api.cancel.mockReset().mockResolvedValue({ success: true });
  vi.unstubAllGlobals();
});

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Server ID'), GUILD);
  await user.type(screen.getByLabelText('Bot token'), TOKEN);
}

describe('DiscordExpressionImport', () => {
  it('types the token into a plain field the browser hides, where it can, so no password manager offers to save it', () => {
    vi.stubGlobal('CSS', { supports: (property: string, value: string) => property === '-webkit-text-security' && value === 'disc' });
    render(<DiscordExpressionImport spaceId="space-1" origin="" />);
    const field = screen.getByLabelText('Bot token');
    expect(field).toHaveAttribute('type', 'text');
    expect((field.style as unknown as Record<string, string>).WebkitTextSecurity).toBe('disc');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('data-1p-ignore');
    expect(field).toHaveAttribute('data-bwignore');
  });

  it('asks for the token in a password field and forgets it once Discord has answered', async () => {
    const user = userEvent.setup();
    api.preview.mockResolvedValue(PREVIEW);
    render(<DiscordExpressionImport spaceId="space-1" origin="" />);
    const field = screen.getByLabelText('Bot token');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Look up' }));

    expect(await screen.findByText('Discord has 1 emoji and 1 sticker on this server.', { exact: false })).toBeInTheDocument();
    expect(api.preview).toHaveBeenCalledWith({ spaceId: 'space-1', guildId: GUILD, token: TOKEN });
    // What cannot come over cannot be picked.
    expect(screen.getByRole('checkbox', { name: /:PartyParrot:/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Dance/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Bot token')).toHaveValue('');
    expect(screen.getByLabelText('Server ID')).toHaveValue(GUILD);
  });

  it('forgets the token when Discord refuses it too, and says why', async () => {
    const user = userEvent.setup();
    api.preview.mockRejectedValue(new HttpError(400, 'Discord did not accept that bot token', undefined, 'discord_bot_token_invalid'));
    render(<DiscordExpressionImport spaceId="space-1" origin="" />);
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Discord did not accept that bot token.');
    expect(screen.getByLabelText('Bot token')).toHaveValue('');
  });

  it('imports batch after batch, sending the pick with the first only, and reports what came', async () => {
    const user = userEvent.setup();
    api.preview.mockResolvedValue(PREVIEW);
    const first: DiscordExpressionApplyResult = { done: 1, total: 2, finished: false, stopped: null, results: [
      { key: 'sticker:200000000000000002', kind: 'sticker', discordId: '200000000000000002', name: 'Dance', outcome: 'lottie' },
    ] };
    const second: DiscordExpressionApplyResult = { done: 2, total: 2, finished: true, stopped: null, results: [
      { key: 'emoji:100000000000000001', kind: 'emoji', discordId: '100000000000000001', name: 'partyparrot', outcome: 'imported' },
    ] };
    api.apply.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const finished = vi.fn();
    render(<DiscordExpressionImport spaceId="space-1" origin="" onFinished={finished} />);
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await user.click(await screen.findByRole('button', { name: 'Import 1' }));

    expect(await screen.findByText('Emoji and stickers imported')).toBeInTheDocument();
    expect(screen.getByText('1 emoji and 0 stickers came over.')).toBeInTheDocument();
    expect(screen.getByText('an animated vector sticker, which can\'t come over')).toBeInTheDocument();
    expect(api.apply).toHaveBeenNthCalledWith(1, { importId: 'import-1', selection: ['emoji:100000000000000001'], after: 0 });
    expect(api.apply).toHaveBeenNthCalledWith(2, { importId: 'import-1', after: 1 });
    await waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
  });

  it('asks again when a batch outlasts its request, with the pick until an answer arrives', async () => {
    const user = userEvent.setup();
    api.preview.mockResolvedValue(PREVIEW);
    const done: DiscordExpressionApplyResult = { done: 1, total: 1, finished: true, stopped: null, results: [
      { key: 'emoji:100000000000000001', kind: 'emoji', discordId: '100000000000000001', name: 'partyparrot', outcome: 'imported' },
    ] };
    api.apply.mockRejectedValueOnce(new RequestTimeoutError()).mockResolvedValueOnce(done);
    render(<DiscordExpressionImport spaceId="space-1" origin="" />);
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await user.click(await screen.findByRole('button', { name: 'Import 1' }));

    expect(await screen.findByText('Emoji and stickers imported', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText('1 emoji and 0 stickers came over.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.apply).toHaveBeenCalledTimes(2);
    expect(api.apply).toHaveBeenNthCalledWith(2, { importId: 'import-1', selection: ['emoji:100000000000000001'], after: 0 });
  }, 15_000);
});
