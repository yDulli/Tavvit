import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getAvatarGradient, getSpaceGradient } from '../../utils/gradients';
import { lightFromColor } from '../../utils/placeLight';

const state = vi.hoisted(() => ({
  spaces: [] as Array<Record<string, unknown>>,
  dmChannels: [] as Array<Record<string, unknown>>,
  colors: [] as string[],
}));

vi.mock('../../stores/spaceStore', () => ({
  useSpaceStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('../../hooks/useDmViewer', () => ({
  useDmViewer: () => ({ origin: '', self: { id: 'me' } }),
}));
vi.mock('../../utils/userViewLookup', () => ({
  useCanonicalUserView: <T,>(user: T) => user,
}));
vi.mock('../../utils/identity', () => ({
  isMine: (member: { id: string }) => member.id === 'me',
}));
vi.mock('../../utils/colorExtractor', () => ({
  extractDominantColors: () => Promise.resolve(state.colors),
}));

import { AmbientLight } from './AmbientLight';

const shown = () => document.documentElement.style.getPropertyValue('--place-target');

function at(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AmbientLight /></MemoryRouter>);
}

beforeEach(() => {
  state.spaces = [{ id: 's1', name: 'Night Shift', avatarColor: 'mint', icon: null }];
  state.dmChannels = [
    { id: 'd1', ownerId: null, members: [{ id: 'me' }, { id: 'u1', username: 'noor', avatarColor: 'rose', accentColor: null }] },
    { id: 'd2', ownerId: null, members: [{ id: 'me' }, { id: 'u2', username: 'yuki', avatarColor: null, accentColor: '#ff8800' }] },
    { id: 'd3', ownerId: 'me', members: [{ id: 'me' }, { id: 'u1', username: 'noor' }, { id: 'u2', username: 'yuki' }] },
  ];
  state.colors = [];
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--place-target');
});

describe('the light of a place', () => {
  it('is a space\'s colour in that space, in any of its channels', () => {
    const color = lightFromColor(getSpaceGradient('s1', 'Night Shift', 'mint').from)!;
    at('/channels/s1');
    expect(shown()).toBe(color);
    cleanup();
    at('/channels/s1/c9');
    expect(shown()).toBe(color);
  });

  it('is the colour of a space\'s picture when it can be read', async () => {
    state.spaces[0]!.icon = 'night.png';
    state.colors = ['#3366cc'];
    at('/channels/s1');
    await waitFor(() => expect(shown()).toBe(lightFromColor('#3366cc')));
  });

  it('stays the tile\'s colour when a picture cannot be read', async () => {
    state.spaces[0]!.icon = 'night.png';
    at('/channels/s1');
    await Promise.resolve();
    expect(shown()).toBe(lightFromColor(getSpaceGradient('s1', 'Night Shift', 'mint').from));
  });

  it('is the other person\'s profile colour, or their tile\'s, in a conversation', () => {
    at('/channels/@me/d2');
    expect(shown()).toBe(lightFromColor('#ff8800'));
    cleanup();
    at('/channels/@me/d1');
    expect(shown()).toBe(lightFromColor(getAvatarGradient('u1', 'noor', 'rose').from));
  });

  it('is left to the stylesheet\'s accent at home, on the home pages and in a group', () => {
    for (const path of ['/channels/@me', '/explore', '/friends', '/inbox', '/channels/@me/d3', '/channels/unknown']) {
      at(path);
      expect(shown(), path).toBe('');
      cleanup();
    }
  });

  it('is taken back when the app goes', () => {
    const { unmount } = at('/channels/s1');
    expect(shown()).not.toBe('');
    unmount();
    expect(shown()).toBe('');
  });
});
