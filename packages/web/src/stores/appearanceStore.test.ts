import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_APPEARANCE, CARBON_SETTINGS } from '../utils/appTheme';
import { appearanceSettingsOf, normalizeAppearance, useAppearanceStore } from './appearanceStore';

beforeEach(() => {
  localStorage.clear();
  useAppearanceStore.getState().reset();
});

describe('normalizeAppearance', () => {
  it('is the default for nothing, for rubbish and for another version\'s shape', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance('nope')).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ theme: 'light', chatTextScale: 9, accent: 'red', reduceMotion: 'yes' })).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps what is valid and drops only what is not', () => {
    expect(normalizeAppearance({
      theme: 'moss', custom: { hue: 10, strength: 20, depth: 1 }, accent: '#2F6FED', chatTextScale: 1.25, reduceMotion: true,
      messageStyle: 'lines', font: 'mono', corners: 'nonsense', glow: 80,
    })).toEqual({
      ...DEFAULT_APPEARANCE,
      theme: 'moss', custom: { hue: 10, strength: 20, depth: 1 }, accent: '#2f6fed', chatTextScale: 1.25, reduceMotion: true,
      messageStyle: 'lines', font: 'mono',
    });
    expect(normalizeAppearance({ theme: 'clay', accent: 'javascript:alert(1)' })).toMatchObject({ theme: 'clay', accent: null });
  });

  it('does not trust a stored accent that would be refused today', () => {
    expect(normalizeAppearance({ accent: '#ffffff' }).accent).toBeNull();
    expect(normalizeAppearance({ accent: '#000000' }).accent).toBeNull();
  });

  it('brings a hand-edited custom theme back into range', () => {
    expect(normalizeAppearance({ custom: { hue: 9999, strength: -4, depth: 'x' } }).custom)
      .toEqual({ hue: 359, strength: 0, depth: CARBON_SETTINGS.depth });
  });
});

describe('the store', () => {
  it('starts as the default', () => {
    expect(appearanceSettingsOf(useAppearanceStore.getState())).toEqual(DEFAULT_APPEARANCE);
  });

  it('chooses a theme, and refuses a name it does not know', () => {
    useAppearanceStore.getState().setTheme('harbor');
    expect(useAppearanceStore.getState().theme).toBe('harbor');
    useAppearanceStore.getState().setTheme('light' as never);
    expect(useAppearanceStore.getState().theme).toBe('carbon');
  });

  it('makes the custom theme the active one when it is edited, and keeps it in range', () => {
    useAppearanceStore.getState().setTheme('ink');
    useAppearanceStore.getState().setCustom({ hue: 400, strength: 50, depth: 1 });
    expect(useAppearanceStore.getState().theme).toBe('custom');
    expect(useAppearanceStore.getState().custom).toEqual({ hue: 359, strength: 50, depth: 1 });
  });

  it('takes an accent that is usable and says no to one that is not', () => {
    expect(useAppearanceStore.getState().setAccent('#2F6FED')).toBe(true);
    expect(useAppearanceStore.getState().accent).toBe('#2f6fed');
    expect(useAppearanceStore.getState().setAccent('#ffffff')).toBe(false);
    expect(useAppearanceStore.getState().setAccent('#000000')).toBe(false);
    expect(useAppearanceStore.getState().setAccent('blue')).toBe(false);
    // A refused colour leaves the last good one in place.
    expect(useAppearanceStore.getState().accent).toBe('#2f6fed');
    expect(useAppearanceStore.getState().setAccent(null)).toBe(true);
    expect(useAppearanceStore.getState().accent).toBeNull();
  });

  it('takes a look setting only from its own options', () => {
    useAppearanceStore.getState().setLook({ messageStyle: 'bubbles', corners: 'sharp' });
    expect(useAppearanceStore.getState()).toMatchObject({ messageStyle: 'bubbles', corners: 'sharp' });
    useAppearanceStore.getState().setLook({ messageStyle: 'cards' as never });
    expect(useAppearanceStore.getState().messageStyle).toBe('rows');
  });

  it('accepts only the offered text sizes', () => {
    useAppearanceStore.getState().setChatTextScale(1.25);
    expect(useAppearanceStore.getState().chatTextScale).toBe(1.25);
    useAppearanceStore.getState().setChatTextScale(7);
    expect(useAppearanceStore.getState().chatTextScale).toBe(1);
  });

  it('keeps its choices in this browser, and nothing else', () => {
    useAppearanceStore.getState().setTheme('clay');
    useAppearanceStore.getState().setAccent('#c2410c');
    useAppearanceStore.getState().setReduceMotion(true);
    useAppearanceStore.getState().setLook({ density: 'spacious' });
    const stored = JSON.parse(localStorage.getItem('orbit-appearance')!).state;
    expect(stored).toEqual({
      ...DEFAULT_APPEARANCE, theme: 'clay', custom: CARBON_SETTINGS, accent: '#c2410c', reduceMotion: true, density: 'spacious',
    });
  });

  it('resets everything', () => {
    useAppearanceStore.getState().setTheme('clay');
    useAppearanceStore.getState().setAccent('#c2410c');
    useAppearanceStore.getState().setLook({ font: 'inter' });
    useAppearanceStore.getState().reset();
    expect(useAppearanceStore.getState().theme).toBe('carbon');
    expect(useAppearanceStore.getState().font).toBe('geist');
    expect(useAppearanceStore.getState().accent).toBeNull();
  });
});
