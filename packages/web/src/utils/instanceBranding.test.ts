import { describe, it, expect, beforeEach } from 'vitest';
import { accentColorProblem, contrastRatio, parseHexColor } from '@backspace/shared/src/color.js';
import { DEFAULT_ACCENT_COLOR } from '@backspace/shared/src/constants.js';
import { ACCENT_VARIABLES, accentVariables, applyAccent, documentTitle } from './instanceBranding';

describe('accentVariables', () => {
  it('turns a hex colour into space-separated channels', () => {
    const variables = accentVariables('#7443fc');
    expect(variables?.['--accent-primary']).toBe('116 67 252');
  });

  it('derives progressively darker hover and pressed shades', () => {
    const v = accentVariables('#2563eb')!;
    const sum = (value: string) => value.split(' ').map(Number).reduce((a, b) => a + b, 0);
    expect(sum(v['--accent-primary-hover'])).toBeLessThan(sum(v['--accent-primary']));
    expect(sum(v['--accent-primary-active'])).toBeLessThan(sum(v['--accent-primary-hover']));
  });

  it('lifts the text shade until it is readable on the dark panels (WCAG AA)', () => {
    const v = accentVariables('#6d28d9')!;
    const soft = v['--accent-primary-soft'].split(' ').map(Number) as [number, number, number];
    expect(contrastRatio(soft, [19, 19, 26])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([null, undefined, '', 'red', '#fff', '#12345', '#12345g', 'rgb(1,2,3)'])('ignores %j', (value) => {
    expect(accentVariables(value)).toBeNull();
  });

  it('the built-in accent is itself a colour the server would accept', () => {
    expect(accentColorProblem(DEFAULT_ACCENT_COLOR)).toBeNull();
    expect(parseHexColor(DEFAULT_ACCENT_COLOR)).not.toBeNull();
  });
});

describe('applyAccent', () => {
  beforeEach(() => {
    for (const name of ACCENT_VARIABLES) document.documentElement.style.removeProperty(name);
  });

  it('sets every accent variable on the root element', () => {
    applyAccent(document.documentElement, '#d97706');
    for (const name of ACCENT_VARIABLES) {
      expect(document.documentElement.style.getPropertyValue(name)).toMatch(/^\d+ \d+ \d+$/);
    }
  });

  it('removes them again when the accent is cleared, so the stylesheet defaults apply', () => {
    applyAccent(document.documentElement, '#d97706');
    applyAccent(document.documentElement, null);
    for (const name of ACCENT_VARIABLES) {
      expect(document.documentElement.style.getPropertyValue(name)).toBe('');
    }
  });

  it('leaves the selected-row background neutral, whatever the accent', () => {
    applyAccent(document.documentElement, '#d97706');
    expect(document.documentElement.style.getPropertyValue('--interactive-selected')).toBe('');
  });

  it('leaves the defaults alone for an unusable value', () => {
    applyAccent(document.documentElement, 'not a colour');
    expect(document.documentElement.style.getPropertyValue('--accent-primary')).toBe('');
  });
});

describe('documentTitle', () => {
  it('is the instance name', () => {
    expect(documentTitle('Friend Club', 0)).toBe('Friend Club');
  });

  it('puts the number of unread conversations in front', () => {
    expect(documentTitle('Friend Club', 3)).toBe('(3) Friend Club');
  });

  it('caps the number', () => {
    expect(documentTitle('Friend Club', 250)).toBe('(99+) Friend Club');
  });

  it('falls back to the product name before the instance answers', () => {
    expect(documentTitle(null, 0)).toBe('Tavvit');
    expect(documentTitle('   ', 2)).toBe('(2) Tavvit');
  });
});
