import { describe, expect, it } from 'vitest';
import { bannerFill, lightFromColor } from './placeLight';

function channels(light: string | null): [number, number, number] {
  const match = /^rgb\((\d+) (\d+) (\d+)\)$/.exec(light ?? '');
  if (!match) throw new Error(`not a colour: ${light}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

describe('the light of a colour', () => {
  it('lifts a deep tile until it would light a dark room, and keeps its hue', () => {
    const [r, g, b] = channels(lightFromColor('#26765a'));
    expect(Math.max(r, g, b)).toBeGreaterThan(150);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('takes the glare off something almost white', () => {
    const [r, g, b] = channels(lightFromColor('#ffe9e0'));
    expect(Math.min(r, g, b)).toBeLessThan(200);
    expect(r).toBeGreaterThan(b);
  });

  it('leaves a grey grey, and invents no colour for a place that has none', () => {
    const [r, g, b] = channels(lightFromColor('#808080'));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(2);
  });

  it('has nothing to say about what is not a colour', () => {
    for (const bad of ['', 'red', '#12345', '#gggggg', 'rgb(1 2 3)']) expect(lightFromColor(bad), bad).toBeNull();
  });
});

describe('a band in a colour', () => {
  it('is the colour itself, a little deeper at its foot, with no light of its own', () => {
    const fill = bannerFill('#26765a');
    expect(fill).toMatch(/^linear-gradient\(180deg, #26765a 0%, /);
    expect(fill).not.toContain(lightFromColor('#26765a')!);
  });
});
