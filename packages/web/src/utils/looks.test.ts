import { describe, expect, it } from 'vitest';
import { CARBON_SETTINGS, DEFAULT_APPEARANCE, THEME_PRESETS } from './appTheme';
import {
  appearanceOfLook,
  decodeLook,
  encodeLook,
  lookAddress,
  lookNameOf,
  lookOf,
  lookOfAppearance,
  sameLook,
  spaceLookOfLook,
  themeChoiceOf,
  withSpaceLook,
  type Look,
} from './looks';

// Looks (docs/systems/design-system.md, "Looks"): what one holds, how it is put on a device without
// touching what helps reading, and how a link carries it whole and cannot carry anything else.

const LOOK: Look = {
  surface: { hue: 320, strength: 14, depth: 0 },
  accent: '#0e8f7e',
  light: 'off',
  corners: 'round',
  font: 'inter',
  avatarShape: 'circle',
  messageStyle: 'bubbles',
  density: 'spacious',
};

function linkOf(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

describe('a look in a link', () => {
  it('comes back whole, with its name, in any script', () => {
    const decoded = decodeLook(`#${encodeLook(LOOK, 'Pflaume am Abend 🌙')}`);
    expect(decoded).toEqual({ name: 'Pflaume am Abend 🌙', look: LOOK });
    expect(lookAddress(LOOK, 'x', 'https://tavvit.com')).toMatch(/^https:\/\/tavvit\.com\/look#1\./);
  });

  it('is nothing when the link holds no look of this kind', () => {
    for (const fragment of ['', '#', '#2.abc', '#1.', '#1.!!!', '#1.bm90IGpzb24', `#${linkOf([1, 2])}`, `#1.${'A'.repeat(3000)}`]) {
      expect(decodeLook(fragment)).toBeNull();
    }
  });

  it('brings what a hand-made link holds into range, and drops a colour white text cannot be read on', () => {
    const decoded = decodeLook(`#${linkOf({ n: 'a\u0000b\n', h: 9999, s: -5, d: 0.3, a: '#ffffff', l: 'disco', c: 'round', f: 'comic', p: 'circle', m: 'bubbles', y: 'cozy' })}`);
    expect(decoded?.name).toBe('a b');
    expect(decoded?.look).toMatchObject({ surface: { hue: 359, strength: 0, depth: 0.5 }, accent: null, light: 'on', corners: 'round', font: 'geist' });
  });
});

describe('a look\'s name', () => {
  it('is one line of plain text, cut to its length', () => {
    expect(lookNameOf('  Night\tShift    ')).toBe('Night Shift');
    expect([...(lookNameOf('🌙'.repeat(60)) ?? '')]).toHaveLength(40);
    expect(lookNameOf('   ')).toBeNull();
    expect(lookNameOf(5)).toBeNull();
  });
});

describe('putting a look on', () => {
  it('names a ready-made theme by its name and keeps the person\'s own surfaces for theirs', () => {
    expect(themeChoiceOf(CARBON_SETTINGS)).toBe('carbon');
    expect(themeChoiceOf(THEME_PRESETS.plum)).toBe('plum');
    expect(themeChoiceOf({ hue: 1, strength: 2, depth: 3 })).toBe('custom');
    expect(appearanceOfLook(LOOK)).not.toHaveProperty('custom');
    expect(appearanceOfLook({ ...LOOK, surface: { hue: 1, strength: 2, depth: 3 } })).toMatchObject({ theme: 'custom', custom: { hue: 1, strength: 2, depth: 3 } });
  });

  it('reads the look a device shows back as the same look', () => {
    const appearance = { ...DEFAULT_APPEARANCE, ...appearanceOfLook(LOOK) };
    expect(sameLook(lookOfAppearance(appearance), LOOK)).toBe(true);
    expect(sameLook(lookOfAppearance(DEFAULT_APPEARANCE), LOOK)).toBe(false);
    expect(lookOf('nope')).toBeNull();
  });
});

describe('a space\'s look', () => {
  it('takes a look\'s colours only', () => {
    expect(spaceLookOfLook(LOOK)).toEqual({ hue: 320, strength: 14, depth: 0, accent: '#0e8f7e' });
  });

  it('colours a device while in the space, and leaves its shape and what helps reading alone', () => {
    const mine = { ...DEFAULT_APPEARANCE, accent: '#c0283f', contrast: 'high' as const, corners: 'sharp' as const, chatTextScale: 1.25 };
    const shown = withSpaceLook(mine, { hue: 1, strength: 2, depth: 3, accent: '#0e8f7e' });
    expect(shown).toMatchObject({ theme: 'custom', custom: { hue: 1, strength: 2, depth: 3 }, accent: '#0e8f7e', contrast: 'high', corners: 'sharp', chatTextScale: 1.25 });
    expect(withSpaceLook(mine, { ...THEME_PRESETS.plum, accent: null })).toMatchObject({ theme: 'plum', accent: '#c0283f' });
  });
});
