import { describe, it, expect } from 'vitest';
import { contrastRatio, parseHexColor, relativeLuminance } from '@backspace/shared/src/color.js';
import {
  PROFILE_THEME_PRESETS,
  bannerBackground,
  cardEdge,
  cardTint,
  deepened,
  presetOf,
  profileCardLook,
  profileThemeOf,
  profileThemeStyleOf,
} from './profileTheme';

/** The colours a gradient of the card's look runs through, in order. */
function gradientColors(look: { backgroundImage?: string }): string[] {
  return [...(look.backgroundImage ?? '').matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0]);
}

// The quietest text there is (`--text-tertiary`), and the panel `full` puts it on (`.profile-panel`, black at 0.55).
const TERTIARY = [141, 144, 156] as const;
const onPanel = (hex: string) => parseHexColor(hex)!.map((channel) => channel * 0.45) as unknown as readonly [number, number, number];

describe('how strongly a theme colours the card', () => {
  it('is soft unless a person chose otherwise, and nothing else counts as a choice', () => {
    expect(profileThemeStyleOf({})).toBe('soft');
    expect(profileThemeStyleOf({ profileThemeStyle: 'full' })).toBe('full');
    expect(profileThemeStyleOf({ profileThemeStyle: 'loud' })).toBe('soft');
  });

  it('keeps soft as it always was: a faint tint and an edge', () => {
    const theme = profileThemeOf({ accentColor: '#7443fc', accentColorSecondary: '#45affd' })!;
    expect(profileCardLook(theme, 'soft')).toEqual({ card: { backgroundImage: cardTint(theme), borderColor: cardEdge(theme) }, ring: null, panel: false });
  });

  it('deepens a colour to the light asked for and no further, its hue kept', () => {
    const deep = deepened('#f2b84b', 0.02);
    expect(relativeLuminance(parseHexColor(deep)!)).toBeLessThanOrEqual(0.021);
    const [r, g, b] = parseHexColor(deep)!;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(deepened('#101114', 0.02)).toBe('#101114');
  });

  it('reads every text colour on a strong card, and on the panel of a full one, with every preset', () => {
    for (const preset of PROFILE_THEME_PRESETS) {
      const theme = profileThemeOf({ accentColor: preset.primary, accentColorSecondary: preset.secondary })!;
      const strong = profileCardLook(theme, 'strong');
      expect(strong.panel).toBe(false);
      for (const ground of gradientColors(strong.card)) {
        expect(contrastRatio(TERTIARY, parseHexColor(ground)!), `${preset.id} strong ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
      const full = profileCardLook(theme, 'full');
      expect(full.panel).toBe(true);
      for (const ground of gradientColors(full.card)) {
        expect(contrastRatio(TERTIARY, onPanel(ground)), `${preset.id} full ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('profileThemeOf', () => {
  it('is null when no first colour was chosen, whatever the second says', () => {
    expect(profileThemeOf({})).toBeNull();
    expect(profileThemeOf({ accentColor: null, accentColorSecondary: '#45affd' })).toBeNull();
    expect(profileThemeOf({ accentColor: '', accentColorSecondary: '#45affd' })).toBeNull();
  });

  it('uses both colours when both were chosen', () => {
    expect(profileThemeOf({ accentColor: '#7443fc', accentColorSecondary: '#45affd' }))
      .toEqual({ primary: '#7443fc', secondary: '#45affd' });
  });

  it('makes the second colour the first made darker when only one was chosen, as a single colour always looked', () => {
    const theme = profileThemeOf({ accentColor: '#7443fc' })!;
    expect(theme.primary).toBe('#7443fc');
    expect(theme.secondary).toBe('#4c1bd4');
    expect(profileThemeOf({ accentColor: '#7443fc', accentColorSecondary: null })!.secondary).toBe('#4c1bd4');
  });

  it('does not trust a colour that is not #rrggbb', () => {
    expect(profileThemeOf({ accentColor: 'red' })).toBeNull();
    expect(profileThemeOf({ accentColor: 'url(javascript:alert(1))' })).toBeNull();
    // A bad second colour falls back to the derived one rather than reaching a style.
    expect(profileThemeOf({ accentColor: '#7443fc', accentColorSecondary: 'expression(1)' })!.secondary).toBe('#4c1bd4');
  });
});

describe('what a theme paints', () => {
  const theme = { primary: '#7443fc', secondary: '#45affd' };

  it('makes the banner a gradient from the first colour to the second', () => {
    const css = bannerBackground(theme);
    expect(css).toContain('linear-gradient(135deg');
    expect(css.indexOf('116,67,252')).toBeLessThan(css.indexOf('69,175,253'));
  });

  it('tints the card faintly, from the top down to nothing', () => {
    const css = cardTint(theme);
    expect(css).toMatch(/^linear-gradient\(180deg, rgba\(116,67,252,0\.2\) 0%, rgba\(69,175,253,0\.1\) 38%, transparent 72%\)$/);
  });

  it('gives the card an edge in the first colour', () => {
    expect(cardEdge(theme)).toBe('rgba(116,67,252,0.35)');
  });
});

describe('the presets', () => {
  it('are valid colours with their own names and no repeats', () => {
    const ids = new Set<string>();
    for (const preset of PROFILE_THEME_PRESETS) {
      expect(parseHexColor(preset.primary)).not.toBeNull();
      expect(parseHexColor(preset.secondary)).not.toBeNull();
      expect(preset.primary).not.toBe(preset.secondary);
      ids.add(preset.id);
    }
    expect(ids.size).toBe(PROFILE_THEME_PRESETS.length);
  });

  it('are recognised from the colours a person saved, ignoring case', () => {
    const first = PROFILE_THEME_PRESETS[0]!;
    expect(presetOf({ accentColor: first.primary.toUpperCase(), accentColorSecondary: first.secondary })).toEqual(first);
    expect(presetOf({ accentColor: first.primary })).toBeNull();
    expect(presetOf({ accentColor: first.primary, accentColorSecondary: '#000000' })).toBeNull();
  });
});
