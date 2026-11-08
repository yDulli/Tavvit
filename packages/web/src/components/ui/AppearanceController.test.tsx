import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const instanceInfo = vi.hoisted(() => ({ value: null as { accentColor: string | null } | null }));
vi.mock('../../hooks/useHomeInstanceInfo', () => ({ useHomeInstanceInfo: () => instanceInfo.value }));
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { AppearanceController } from './AppearanceController';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { useSpaceStore, type TaggedSpace } from '../../stores/spaceStore';
import { THEME_PRESETS, surfaceVariables } from '../../utils/appTheme';

const root = () => document.documentElement;
const prop = (name: string) => root().style.getPropertyValue(name);

/** The controller where the app has it: inside the router, at `path`. */
function mount(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><AppearanceController /></MemoryRouter>);
}

beforeEach(() => {
  instanceInfo.value = null;
  useAppearanceStore.getState().reset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  useAppearanceStore.getState().reset();
});

describe('AppearanceController', () => {
  it('puts nothing on the page for the default look, so the stylesheet is in force', () => {
    mount();
    expect(prop('--bg-chat')).toBe('');
    expect(prop('--accent-primary')).toBe('');
    expect(prop('--chat-text-scale')).toBe('');
    expect(root().dataset.motion).toBeUndefined();
  });

  it('applies the chosen theme at once and takes it off again when the component goes', () => {
    const { unmount } = mount();
    act(() => useAppearanceStore.getState().setTheme('clay'));
    expect(prop('--bg-chat')).toBe(surfaceVariables(THEME_PRESETS.clay)['--bg-chat']);
    unmount();
    expect(prop('--bg-chat')).toBe('');
  });

  it('marks the look on the page and takes it off again', () => {
    const { unmount } = mount();
    expect(root().dataset.messageStyle).toBe('rows');
    act(() => useAppearanceStore.getState().setLook({ messageStyle: 'lines', corners: 'round', avatarShape: 'circle', underlineLinks: true }));
    expect(root().dataset.messageStyle).toBe('lines');
    expect(root().dataset.avatar).toBe('circle');
    expect(root().dataset.links).toBe('underline');
    expect(prop('--radius-scale')).toBe('2.2');
    unmount();
    expect(root().dataset.messageStyle).toBeUndefined();
    expect(root().dataset.links).toBeUndefined();
    expect(prop('--radius-scale')).toBe('');
  });

  it('follows the text size and the motion setting', () => {
    mount();
    act(() => { useAppearanceStore.getState().setChatTextScale(1.25); useAppearanceStore.getState().setReduceMotion(true); });
    expect(prop('--chat-text-scale')).toBe('1.25');
    expect(root().dataset.motion).toBe('reduce');
    act(() => { useAppearanceStore.getState().setChatTextScale(1); useAppearanceStore.getState().setReduceMotion(false); });
    expect(prop('--chat-text-scale')).toBe('');
    expect(root().dataset.motion).toBeUndefined();
  });

  it('uses the server\'s accent colour when the person chose none', () => {
    instanceInfo.value = { accentColor: '#d97706' };
    mount();
    expect(prop('--accent-primary')).toBe('217 119 6');
  });

  it('prefers the person\'s own accent over the server\'s, and falls back to the server\'s when it is cleared', () => {
    instanceInfo.value = { accentColor: '#d97706' };
    mount();
    act(() => { useAppearanceStore.getState().setAccent('#2f6fed'); });
    expect(prop('--accent-primary')).toBe('47 111 237');
    // A selected row keeps its neutral fill whatever the accent; the accent only marks its edge.
    expect(prop('--interactive-selected')).toBe('');
    act(() => { useAppearanceStore.getState().setAccent(null); });
    expect(prop('--accent-primary')).toBe('217 119 6');
  });

  it('applies the person\'s accent even when the server has none', () => {
    mount();
    act(() => { useAppearanceStore.getState().setAccent('#0e8f7e'); });
    expect(prop('--accent-primary')).toBe('14 143 126');
  });
});

// A space in its own colours (docs/systems/spaces.md, "A space's look"): while the person is in it,
// unless they turned that off, and never in the theme studio, where they shape their own.
describe('a space\'s colours', () => {
  beforeEach(() => {
    useSpaceStore.setState({
      currentSpaceId: 's1',
      spaces: [{ id: 's1', name: 'Night Shift', look: { hue: 280, strength: 26, depth: 0.5, accent: '#0e8f7e' }, _instanceOrigin: '' }] as unknown as TaggedSpace[],
    });
  });

  afterEach(() => {
    useSpaceStore.setState({ currentSpaceId: null, spaces: [] });
  });

  it('colour the app while the person is in the space, over the server\'s accent', () => {
    instanceInfo.value = { accentColor: '#d97706' };
    mount('/channels/s1/c1');
    expect(prop('--bg-chat')).not.toBe('');
    expect(prop('--accent-primary')).toBe('14 143 126');
  });

  it('stand aside for someone who turned them off', () => {
    useAppearanceStore.setState({ spaceLooks: false });
    mount('/channels/s1/c1');
    expect(prop('--bg-chat')).toBe('');
    expect(prop('--accent-primary')).toBe('');
  });

  it('stand aside in the theme studio, which shows the person\'s own', () => {
    mount('/studio');
    expect(prop('--bg-chat')).toBe('');
  });

  it('are none from a host that sent colours that do not hold', () => {
    useSpaceStore.setState({
      spaces: [{ id: 's1', name: 'Night Shift', look: { hue: 999, strength: 26, depth: 0.5, accent: '#ffffff' }, _instanceOrigin: '' }] as unknown as TaggedSpace[],
    });
    mount('/channels/s1/c1');
    expect(prop('--bg-chat')).toBe('');
  });
});
