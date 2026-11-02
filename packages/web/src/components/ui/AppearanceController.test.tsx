import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const instanceInfo = vi.hoisted(() => ({ value: null as { accentColor: string | null } | null }));
vi.mock('../../hooks/useHomeInstanceInfo', () => ({ useHomeInstanceInfo: () => instanceInfo.value }));

import { AppearanceController } from './AppearanceController';
import { useAppearanceStore } from '../../stores/appearanceStore';
import { THEME_PRESETS, surfaceVariables } from '../../utils/appTheme';

const root = () => document.documentElement;
const prop = (name: string) => root().style.getPropertyValue(name);

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
    render(<AppearanceController />);
    expect(prop('--bg-chat')).toBe('');
    expect(prop('--accent-primary')).toBe('');
    expect(prop('--chat-text-scale')).toBe('');
    expect(root().dataset.motion).toBeUndefined();
  });

  it('applies the chosen theme at once and takes it off again when the component goes', () => {
    const { unmount } = render(<AppearanceController />);
    act(() => useAppearanceStore.getState().setTheme('clay'));
    expect(prop('--bg-chat')).toBe(surfaceVariables(THEME_PRESETS.clay)['--bg-chat']);
    unmount();
    expect(prop('--bg-chat')).toBe('');
  });

  it('marks the look on the page and takes it off again', () => {
    const { unmount } = render(<AppearanceController />);
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
    render(<AppearanceController />);
    act(() => { useAppearanceStore.getState().setChatTextScale(1.25); useAppearanceStore.getState().setReduceMotion(true); });
    expect(prop('--chat-text-scale')).toBe('1.25');
    expect(root().dataset.motion).toBe('reduce');
    act(() => { useAppearanceStore.getState().setChatTextScale(1); useAppearanceStore.getState().setReduceMotion(false); });
    expect(prop('--chat-text-scale')).toBe('');
    expect(root().dataset.motion).toBeUndefined();
  });

  it('uses the server\'s accent colour when the person chose none', () => {
    instanceInfo.value = { accentColor: '#d97706' };
    render(<AppearanceController />);
    expect(prop('--accent-primary')).toBe('217 119 6');
  });

  it('prefers the person\'s own accent over the server\'s, and falls back to the server\'s when it is cleared', () => {
    instanceInfo.value = { accentColor: '#d97706' };
    render(<AppearanceController />);
    act(() => { useAppearanceStore.getState().setAccent('#2f6fed'); });
    expect(prop('--accent-primary')).toBe('47 111 237');
    // A selected row keeps its neutral fill whatever the accent; the accent only marks its edge.
    expect(prop('--interactive-selected')).toBe('');
    act(() => { useAppearanceStore.getState().setAccent(null); });
    expect(prop('--accent-primary')).toBe('217 119 6');
  });

  it('applies the person\'s accent even when the server has none', () => {
    render(<AppearanceController />);
    act(() => { useAppearanceStore.getState().setAccent('#0e8f7e'); });
    expect(prop('--accent-primary')).toBe('14 143 126');
  });
});
