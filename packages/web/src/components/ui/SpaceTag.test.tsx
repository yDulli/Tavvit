import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SpaceTagCardResponse, User } from '@backspace/shared';
import { setLanguage } from '../../i18n';

// Space tags beside names, and what a click on one shows (docs/systems/space-tags.md).

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));
const spaceTag = vi.hoisted(() => vi.fn());
vi.mock('../../utils/crossStoreResolvers', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../utils/crossStoreResolvers')>();
  return { ...original, getApiForOrigin: () => ({ explore: { spaceTag } }) };
});

const { SpaceTagChip, shownSpaceTag } = await import('./SpaceTag');
const { useAuthStore } = await import('../../stores/authStore');

const TAG = { spaceId: '100', text: 'NSFT', glyph: 'moon', color: 'lavender' } as const;
const card = (over: Partial<SpaceTagCardResponse['space']> = {}): SpaceTagCardResponse => ({
  space: { id: '100', name: 'Night Shift', icon: null, banner: null, avatarColor: null, description: 'Late games.', visibility: 'public', memberCount: 9, createdAt: 1, joined: false, ...over },
  tag: { text: 'NSFT', glyph: 'moon', color: 'lavender' },
});

beforeEach(async () => {
  await setLanguage('en');
  spaceTag.mockReset();
});
afterEach(cleanup);

describe('shownSpaceTag', () => {
  it('draws only a tag this client knows how to', () => {
    expect(shownSpaceTag({ spaceTag: TAG })).toEqual(TAG);
    expect(shownSpaceTag({ spaceTag: { ...TAG, glyph: 'unicorn' } })).toBeNull();
    expect(shownSpaceTag({ spaceTag: { ...TAG, text: 'MOD' } })).toBeNull();
    expect(shownSpaceTag(null)).toBeNull();
  });
});

describe('SpaceTagChip', () => {
  it('opens the space\'s card, which offers to join a public space', async () => {
    spaceTag.mockResolvedValue(card());
    const user = userEvent.setup();
    render(<MemoryRouter><SpaceTagChip tag={TAG} origin="" /></MemoryRouter>);
    const chip = screen.getByRole('button', { name: 'Space tag NSFT' });
    expect(chip).toHaveAttribute('data-color', 'lavender');
    await user.click(chip);
    expect(await screen.findByText('Night Shift')).toBeTruthy();
    expect(screen.getByText('9 members')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy();
    expect(spaceTag).toHaveBeenCalledWith('100');
  });

  it('lets a member wear the tag, on the space\'s own instance', async () => {
    spaceTag.mockResolvedValue(card({ joined: true }));
    const updateProfile = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ user: { id: 'me', username: 'me', createdAt: 1, status: 'online' } as User, updateProfile });
    const user = userEvent.setup();
    render(<MemoryRouter><SpaceTagChip tag={TAG} origin="" /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Space tag NSFT' }));
    await user.click(await screen.findByRole('button', { name: 'Wear this tag' }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ spaceTag: '100' }));
    expect(screen.getByRole('button', { name: 'Open space' })).toBeTruthy();
  });

  it('says so when the space has no tag any more', async () => {
    spaceTag.mockRejectedValue(new Error('gone'));
    const user = userEvent.setup();
    render(<MemoryRouter><SpaceTagChip tag={TAG} origin="" /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Space tag NSFT' }));
    expect(await screen.findByText('This space has no tag any more.')).toBeTruthy();
  });
});
