import { describe, it, expect } from 'vitest';
import { accentColorProblem, contrastRatio, type Rgb } from '@backspace/shared/src/color.js';
import { DEFAULT_ACCENT_COLOR } from '@backspace/shared/src/constants.js';
import {
  ACCENT_CHOICES,
  CHAT_TEXT_SCALES,
  DEFAULT_APPEARANCE,
  DEPTH_RANGE,
  CARBON_SETTINGS,
  DEFAULT_FRAME_COLOR,
  HUE_RANGE,
  STRENGTH_RANGE,
  SURFACE_VARIABLES,
  THEME_IDS,
  THEME_PRESETS,
  applyAppearance,
  clearAppearance,
  frameColor,
  hslToRgb,
  isThemeChoice,
  normalizeChatTextScale,
  normalizeSurface,
  surfaceChannels,
  surfaceOf,
  surfaceVariables,
  type SurfaceSettings,
} from './appTheme';

// The text colours from globals.css.
const TEXT = {
  primary: [237, 238, 242] as Rgb,
  message: [225, 227, 233] as Rgb,
  secondary: [172, 175, 186] as Rgb,
  tertiary: [141, 144, 156] as Rgb,
};

/** The quietest text on the shipped floating panel (globals.css: --bg-elevated 30 31 37). */
const CARBON_ELEVATED_TERTIARY = contrastRatio(TEXT.tertiary, [30, 31, 37]);

/** Every combination of the ends of the three ranges, with a few hues in between. */
function corners(): SurfaceSettings[] {
  const out: SurfaceSettings[] = [];
  for (const hue of [0, 45, 90, 135, 180, 225, 270, 315]) {
    for (const strength of [STRENGTH_RANGE.min, STRENGTH_RANGE.max]) {
      for (const depth of [DEPTH_RANGE.min, DEPTH_RANGE.max]) out.push({ hue, strength, depth });
    }
  }
  return out;
}

describe('hslToRgb', () => {
  it('maps the primary colours', () => {
    expect(hslToRgb(0, 100, 50)).toEqual([255, 0, 0]);
    expect(hslToRgb(120, 100, 50)).toEqual([0, 255, 0]);
    expect(hslToRgb(240, 100, 50)).toEqual([0, 0, 255]);
  });

  it('maps greys, and wraps the hue', () => {
    expect(hslToRgb(200, 0, 50)).toEqual([128, 128, 128]);
    expect(hslToRgb(0, 0, 0)).toEqual([0, 0, 0]);
    expect(hslToRgb(360, 100, 50)).toEqual(hslToRgb(0, 100, 50));
    expect(hslToRgb(-120, 100, 50)).toEqual(hslToRgb(240, 100, 50));
  });
});

describe('normalizeSurface', () => {
  it('keeps what is in range', () => {
    expect(normalizeSurface({ hue: 120, strength: 30, depth: 1.5 })).toEqual({ hue: 120, strength: 30, depth: 1.5 });
  });

  it('brings numbers into range and rounds them', () => {
    expect(normalizeSurface({ hue: 999, strength: 250, depth: 40 })).toEqual({ hue: 359, strength: 100, depth: 4 });
    expect(normalizeSurface({ hue: -5, strength: -9, depth: -40 })).toEqual({ hue: 0, strength: 0, depth: -3 });
    expect(normalizeSurface({ hue: 10.6, strength: 20.4, depth: 0.3 })).toEqual({ hue: 11, strength: 20, depth: 0.5 });
  });

  it('falls back to Carbon for what is not a number', () => {
    expect(normalizeSurface(undefined)).toEqual(CARBON_SETTINGS);
    expect(normalizeSurface({ hue: 'red', strength: NaN, depth: null })).toEqual(CARBON_SETTINGS);
    expect(normalizeSurface('nonsense')).toEqual(CARBON_SETTINGS);
  });
});

describe('the surfaces a theme makes', () => {
  it('keep the layout\'s order at every point: frame darkest, content lighter, floating panels lightest', () => {
    for (const settings of corners()) {
      const lum = (token: Parameters<typeof surfaceChannels>[1]) => {
        const [r, g, b] = surfaceChannels(settings, token);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      expect(lum('--bg-base'), JSON.stringify(settings)).toBeLessThanOrEqual(lum('--bg-channel'));
      expect(lum('--bg-channel'), JSON.stringify(settings)).toBeLessThanOrEqual(lum('--bg-chat'));
      expect(lum('--bg-chat'), JSON.stringify(settings)).toBeLessThanOrEqual(lum('--bg-elevated'));
      expect(lum('--bg-input'), JSON.stringify(settings)).toBeLessThanOrEqual(lum('--bg-chat'));
    }
  });

  it('keep every text colour readable on every surface, at the ends of all three ranges', () => {
    const channelsOf = (value: string): Rgb => value.split(' ').map(Number) as unknown as Rgb;
    for (const settings of [...corners(), ...Object.values(THEME_PRESETS)]) {
      // The quieter text is part of the theme: it is lifted to keep its contrast as the surfaces lift.
      const vars = surfaceVariables(settings);
      const secondary = channelsOf(vars['--text-secondary']);
      const tertiary = channelsOf(vars['--text-tertiary']);
      for (const surface of ['--bg-chat', '--bg-channel', '--bg-members', '--bg-elevated'] as const) {
        const channels = surfaceChannels(settings, surface);
        const where = `${surface} at ${JSON.stringify(settings)}`;
        expect(contrastRatio(TEXT.primary, channels), where).toBeGreaterThanOrEqual(9);
        expect(contrastRatio(TEXT.message, channels), where).toBeGreaterThanOrEqual(7.5);
        // The floating panel is lighter by design, so there the quiet text may sit a little
        // below what it has on the content surfaces, as it already does in Carbon.
        const floor = surface === '--bg-elevated' ? CARBON_ELEVATED_TERTIARY - 0.05 : 4.5;
        expect(contrastRatio(tertiary, channels), where).toBeGreaterThanOrEqual(floor);
        expect(contrastRatio(secondary, channels), where).toBeGreaterThanOrEqual(surface === '--bg-elevated' ? 5.5 : 6.5);
      }
    }
  });

  it('leave the quiet text alone where Carbon already reads well, and lift it only as far as needed', () => {
    const lifted = surfaceVariables({ ...CARBON_SETTINGS, depth: DEPTH_RANGE.max });
    const calm = surfaceVariables({ ...CARBON_SETTINGS, depth: DEPTH_RANGE.min });
    expect(calm['--text-tertiary']).toBe('141 144 156');
    const [r, g, b] = lifted['--text-tertiary'].split(' ').map(Number);
    expect(r).toBeGreaterThan(141);
    expect(r).toBeLessThan(255);
    expect(g).toBeGreaterThan(144);
    expect(b).toBeGreaterThan(156);
  });

  it('keep borders visible against the surface they sit on', () => {
    for (const settings of [...corners(), ...Object.values(THEME_PRESETS)]) {
      const chat = surfaceChannels(settings, '--bg-chat');
      expect(contrastRatio(surfaceChannels(settings, '--border-soft'), chat), JSON.stringify(settings)).toBeGreaterThan(1.1);
    }
  });

  it('are grey at no strength and coloured at full strength', () => {
    const grey = surfaceChannels({ hue: 100, strength: 0, depth: 0 }, '--bg-chat');
    expect(new Set(grey).size).toBe(1);
    const coloured = surfaceChannels({ hue: 100, strength: 100, depth: 0 }, '--bg-chat');
    expect(new Set(coloured).size).toBeGreaterThan(1);
  });

  it('get lighter with depth and never reach black', () => {
    const at = (depth: number) => surfaceChannels({ hue: 240, strength: 26, depth }, '--bg-base');
    expect(at(DEPTH_RANGE.max)[2]).toBeGreaterThan(at(0)[2]);
    expect(at(DEPTH_RANGE.min)[2]).toBeLessThan(at(0)[2]);
    expect(at(DEPTH_RANGE.min).some((c) => c > 0)).toBe(true);
  });

  it('come out as channel triples (the floating layers follow --bg-elevated in the stylesheet)', () => {
    const vars = surfaceVariables(THEME_PRESETS.clay);
    for (const name of SURFACE_VARIABLES) expect(vars[name], name).toBeTruthy();
    expect(vars['--bg-chat']).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    expect(SURFACE_VARIABLES).not.toContain('--glass-bg');
  });

  it('land close to the shipped Carbon at its own point', () => {
    const chat = surfaceChannels(CARBON_SETTINGS, '--bg-chat');
    // globals.css says 21 22 27.
    chat.forEach((channel, i) => expect(Math.abs(channel - [21, 22, 27][i]!)).toBeLessThanOrEqual(3));
    // The browser's chrome with no theme set is the shipped frame, --bg-base 13 14 17.
    const frame = [1, 3, 5].map((at) => parseInt(DEFAULT_FRAME_COLOR.slice(at, at + 2), 16));
    expect(frame).toEqual([13, 14, 17]);
    const carbonFrame = [1, 3, 5].map((at) => parseInt(frameColor(CARBON_SETTINGS).slice(at, at + 2), 16));
    carbonFrame.forEach((channel, i) => expect(Math.abs(channel - frame[i]!)).toBeLessThanOrEqual(3));
  });
});

describe('choices', () => {
  it('stand for no change (Carbon), a preset or the person\'s own settings', () => {
    const custom = { hue: 10, strength: 20, depth: 1 };
    expect(surfaceOf('carbon', custom)).toBeNull();
    expect(surfaceOf('clay', custom)).toEqual(THEME_PRESETS.clay);
    expect(surfaceOf('custom', custom)).toEqual(custom);
    expect(surfaceOf('custom', { hue: 999, strength: 20, depth: 1 })!.hue).toBe(HUE_RANGE.max);
  });

  it('recognise only the known names', () => {
    for (const id of THEME_IDS) expect(isThemeChoice(id)).toBe(true);
    expect(isThemeChoice('custom')).toBe(true);
    for (const bad of ['light', '', null, 3, undefined, {}]) expect(isThemeChoice(bad)).toBe(false);
  });

  it('have a preset for every id but Carbon', () => {
    expect(Object.keys(THEME_PRESETS).sort()).toEqual(THEME_IDS.filter((id) => id !== 'carbon').sort());
  });
});

describe('text size', () => {
  it('accepts only the offered sizes and falls back to the default', () => {
    for (const scale of CHAT_TEXT_SCALES) expect(normalizeChatTextScale(scale)).toBe(scale);
    for (const bad of [0.5, 3, '1.25', null, NaN, undefined]) expect(normalizeChatTextScale(bad)).toBe(1);
  });
});

describe('applyAppearance', () => {
  function root() {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = DEFAULT_FRAME_COLOR;
    document.head.append(meta);
    return { element: document.documentElement, meta };
  }

  it('sets the surface variables, the text scale and the motion mark, and takes them off again', () => {
    const { element, meta } = root();
    applyAppearance(element, { ...DEFAULT_APPEARANCE, theme: 'moss', chatTextScale: 1.25, reduceMotion: true, messageStyle: 'lines' });
    expect(element.style.getPropertyValue('--bg-chat')).toBe(surfaceVariables(THEME_PRESETS.moss)['--bg-chat']);
    expect(element.style.getPropertyValue('--chat-text-scale')).toBe('1.25');
    expect(element.dataset.motion).toBe('reduce');
    expect(element.dataset.messageStyle).toBe('lines');
    expect(meta.content).toBe(frameColor(THEME_PRESETS.moss));

    applyAppearance(element, DEFAULT_APPEARANCE);
    for (const name of SURFACE_VARIABLES) expect(element.style.getPropertyValue(name), name).toBe('');
    expect(element.style.getPropertyValue('--chat-text-scale')).toBe('');
    expect(element.dataset.motion).toBeUndefined();
    expect(element.dataset.messageStyle).toBe('rows');
    expect(meta.content).toBe(DEFAULT_FRAME_COLOR);

    clearAppearance(element);
    expect(element.dataset.messageStyle).toBeUndefined();
    meta.remove();
  });

  it('applies a custom theme from the custom settings', () => {
    const { element, meta } = root();
    applyAppearance(element, { ...DEFAULT_APPEARANCE, theme: 'custom', custom: { hue: 10, strength: 60, depth: 2 } });
    expect(element.style.getPropertyValue('--bg-base')).toBe(surfaceChannels({ hue: 10, strength: 60, depth: 2 }, '--bg-base').join(' '));
    clearAppearance(element);
    meta.remove();
  });
});

describe('the ready-made accent colours', () => {
  it('are all colours the rule for the server accent accepts, and all different', () => {
    const seen = new Set<string>();
    for (const choice of ACCENT_CHOICES) {
      expect(accentColorProblem(choice.hex), choice.id).toBeNull();
      seen.add(choice.hex);
    }
    expect(seen.size).toBe(ACCENT_CHOICES.length);
  });

  it('start with the built-in colour, Tavvit violet', () => {
    expect(ACCENT_CHOICES[0]).toEqual({ id: 'violet', hex: DEFAULT_ACCENT_COLOR });
  });
});
