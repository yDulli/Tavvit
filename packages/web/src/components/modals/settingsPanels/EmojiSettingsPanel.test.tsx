import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@backspace/shared';
import { CUSTOM_EMOJI_LIMITS, type CustomEmoji } from '@backspace/shared/src/customEmoji';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

const emojiApi = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() }));
const emojiPolicy = vi.hoisted(() => ({ value: 'everyone' as 'everyone' | 'admins' }));
vi.mock('../../../hooks/useHomeInstanceInfo', () => ({
  useHomeInstanceInfo: () => ({ emojiPolicy: emojiPolicy.value }),
}));
vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  api: { emojis: emojiApi },
}));

import { EmojiSettingsPanel, suggestEmojiName } from './EmojiSettingsPanel';
import { useEmojiStore } from '../../../stores/emojiStore';
import { useAuthStore } from '../../../stores/authStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useUIStore } from '../../../stores/uiStore';
import { HttpError } from '../../../api/client';

function emoji(id: string, name: string, createdBy: string | null): CustomEmoji {
  return { id, name, animated: false, createdBy, createdAt: 1 };
}

const toasts = () => useUIStore.getState().toasts.map((toast) => toast.message);

function choose(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
}

const png = (name = 'party parrot.png') => new File([Uint8Array.from([137, 80, 78, 71])], name, { type: 'image/png' });

beforeEach(() => {
  for (const fn of Object.values(emojiApi)) fn.mockReset();
  useEmojiStore.getState().reset();
  useAuthStore.setState({ user: { id: 'me', username: 'me' } as User });
  useSettingsStore.setState({ isAdmin: false });
  useUIStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  useEmojiStore.getState().reset();
  useSettingsStore.setState({ isAdmin: false });
});

describe('suggestEmojiName', () => {
  it('makes a name from a file name', () => {
    expect(suggestEmojiName('Party Parrot.png')).toBe('party_parrot');
    expect(suggestEmojiName('wave.GIF')).toBe('wave');
    expect(suggestEmojiName('  --my cool pic--.webp')).toBe('my_cool_pic');
    expect(suggestEmojiName('a'.repeat(60) + '.png')).toBe('a'.repeat(32));
  });

  it('gives nothing when no usable name is left', () => {
    expect(suggestEmojiName('x.png')).toBe('');
    expect(suggestEmojiName('日本語.png')).toBe('');
    expect(suggestEmojiName('')).toBe('');
  });
});

describe('adding an emoji', () => {
  it('takes a picture, suggests its name and adds it', async () => {
    emojiApi.create.mockImplementation(async (data: { name: string }) => emoji('5', data.name, 'me'));
    const user = userEvent.setup();
    render(<EmojiSettingsPanel />);
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeDisabled();

    choose(png());
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('party_parrot'));
    await user.click(screen.getByRole('button', { name: 'Add emoji' }));

    await waitFor(() => expect(emojiApi.create).toHaveBeenCalledOnce());
    const sent = emojiApi.create.mock.calls[0]![0] as { name: string; image: string };
    expect(sent.name).toBe('party_parrot');
    expect(atob(sent.image)).toBe('\u0089PNG');
    expect(toasts()).toContain('Added :party_parrot:');
    // The form is empty again and the emoji is in the library.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(await screen.findByText(':party_parrot:')).toBeInTheDocument();
  });

  it('does not overwrite a name the person already typed', async () => {
    render(<EmojiSettingsPanel />);
    await userEvent.setup().type(screen.getByLabelText('Name'), 'mine');
    choose(png());
    // The picture has been read once the button offers another one; the name is still the typed one.
    await screen.findByRole('button', { name: 'Choose another picture' });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('mine');
  });

  it('keeps the button off until the name is a valid one', async () => {
    const user = userEvent.setup();
    render(<EmojiSettingsPanel />);
    choose(png());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add emoji' })).toBeEnabled());
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'x');
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeDisabled();
    await user.clear(name);
    await user.type(name, 'has space');
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeDisabled();
  });

  it('refuses a file larger than the server takes, before reading it', () => {
    render(<EmojiSettingsPanel />);
    const huge = png();
    Object.defineProperty(huge, 'size', { value: CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES + 1 });
    choose(huge);
    expect(screen.getByRole('alert')).toHaveTextContent('That file is larger than 3 MB.');
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeDisabled();
  });

  it('shows the server\'s reason under the form and keeps the picture and the name', async () => {
    emojiApi.create.mockRejectedValue(new HttpError(409, 'taken', undefined, 'emoji_name_taken'));
    const user = userEvent.setup();
    render(<EmojiSettingsPanel />);
    choose(png('wave.png'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add emoji' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Add emoji' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An emoji with that name already exists.');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('wave');
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeEnabled();
  });

  it('shows how many the person added, but not to an administrator, who has no limit', () => {
    useEmojiStore.getState().upsert(emoji('1', 'a_one', 'me'));
    useEmojiStore.getState().upsert(emoji('2', 'b_two', 'someone'));
    const { unmount } = render(<EmojiSettingsPanel />);
    expect(screen.getByText(`You have added 1 of ${CUSTOM_EMOJI_LIMITS.MAX_PER_USER}.`)).toBeInTheDocument();
    unmount();
    useSettingsStore.setState({ isAdmin: true });
    render(<EmojiSettingsPanel />);
    expect(screen.queryByText(/You have added/)).not.toBeInTheDocument();
  });
});

describe('the library', () => {
  it('invites the first emoji when there are none', () => {
    render(<EmojiSettingsPanel />);
    expect(screen.getByText('No emoji yet. Add the first one.')).toBeInTheDocument();
  });

  it('lists every emoji, counted, and finds one by name', async () => {
    useEmojiStore.getState().upsert(emoji('1', 'wave', 'me'));
    useEmojiStore.getState().upsert(emoji('2', 'party_parrot', 'x'));
    render(<EmojiSettingsPanel />);
    expect(screen.getByText('2 emoji')).toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText('Search emoji'), ':parr');
    expect(screen.getByText(':party_parrot:')).toBeInTheDocument();
    expect(screen.queryByText(':wave:')).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText('Search emoji'), 'zzz');
    expect(screen.getByText('No emoji match your search.')).toBeInTheDocument();
  });

  it('offers the way to ask again when the library could not be read', async () => {
    useEmojiStore.setState({ status: 'failed' });
    emojiApi.list.mockResolvedValue({ emojis: [emoji('1', 'wave', null)] });
    render(<EmojiSettingsPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the emoji.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(':wave:')).toBeInTheDocument();
  });
});

describe('changing and removing', () => {
  it('lets a person change only their own, and marks them', () => {
    useEmojiStore.getState().upsert(emoji('1', 'mine_one', 'me'));
    useEmojiStore.getState().upsert(emoji('2', 'theirs', 'someone'));
    render(<EmojiSettingsPanel />);
    // One row has Rename and Delete; the other has neither.
    expect(screen.getAllByRole('button', { name: 'Rename' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    expect(screen.getByText('Yours')).toBeInTheDocument();
  });

  it('lets an administrator change every one', () => {
    useSettingsStore.setState({ isAdmin: true });
    useEmojiStore.getState().upsert(emoji('1', 'mine_one', 'me'));
    useEmojiStore.getState().upsert(emoji('2', 'theirs', 'someone'));
    render(<EmojiSettingsPanel />);
    expect(screen.getAllByRole('button', { name: 'Rename' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
  });

  it('renames in place with Enter', async () => {
    useEmojiStore.getState().upsert(emoji('1', 'wave', 'me'));
    emojiApi.rename.mockResolvedValue(emoji('1', 'hello', 'me'));
    const user = userEvent.setup();
    render(<EmojiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText('Name of :wave:');
    await user.clear(field);
    await user.type(field, 'Hello{Enter}');
    await waitFor(() => expect(emojiApi.rename).toHaveBeenCalledWith('1', 'hello'));
    expect(await screen.findByText(':hello:')).toBeInTheDocument();
    expect(toasts()).toContain('Renamed to :hello:');
  });

  it('leaves the name alone on Escape, and sends nothing for an unchanged or invalid name', async () => {
    useEmojiStore.getState().upsert(emoji('1', 'wave', 'me'));
    const user = userEvent.setup();
    render(<EmojiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.type(screen.getByLabelText('Name of :wave:'), 'zzz{Escape}');
    expect(screen.getByText(':wave:')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(emojiApi.rename).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason when a rename is refused, and keeps the old name', async () => {
    useEmojiStore.getState().upsert(emoji('1', 'wave', 'me'));
    emojiApi.rename.mockRejectedValue(new HttpError(409, 'taken', undefined, 'emoji_name_taken'));
    const user = userEvent.setup();
    render(<EmojiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText('Name of :wave:');
    await user.clear(field);
    await user.type(field, 'taken_name{Enter}');
    await waitFor(() => expect(toasts()).toContain('An emoji with that name already exists.'));
    expect(useEmojiStore.getState().emojis[0]!.name).toBe('wave');
  });

  it('asks before deleting, and deletes once confirmed', async () => {
    useEmojiStore.getState().upsert(emoji('1', 'wave', 'me'));
    emojiApi.remove.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<EmojiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete :wave:?')).toBeInTheDocument();
    expect(emojiApi.remove).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    await waitFor(() => expect(emojiApi.remove).toHaveBeenCalledWith('1'));
    await waitFor(() => expect(useEmojiStore.getState().emojis).toEqual([]));
    expect(toasts()).toContain('Removed :wave:');
  });

  it('keeps the emoji when the server refuses to delete it', async () => {
    useEmojiStore.getState().upsert(emoji('1', 'wave', 'me'));
    emojiApi.remove.mockRejectedValue(new HttpError(403, 'no', undefined, 'forbidden'));
    const user = userEvent.setup();
    render(<EmojiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    await waitFor(() => expect(emojiApi.remove).toHaveBeenCalled());
    expect(useEmojiStore.getState().emojis).toHaveLength(1);
  });
});

describe('who may add', () => {
  afterEach(() => {
    emojiPolicy.value = 'everyone';
  });

  it('keeps the form away from someone the server would refuse', () => {
    emojiPolicy.value = 'admins';
    render(<EmojiSettingsPanel />);
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByText(/administrators add emoji/)).toBeInTheDocument();
  });

  it('shows it to an administrator, whatever the setting', () => {
    emojiPolicy.value = 'admins';
    useSettingsStore.setState({ isAdmin: true });
    render(<EmojiSettingsPanel />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });
});
