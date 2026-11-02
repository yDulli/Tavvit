import { describe, expect, it } from 'vitest';
import { getAvatarGradient, getSpaceGradient } from './gradients';
import { roleDotStyle, roleTextStyle } from './roleStyle';

// Colours another instance sends are drawn only as the colours they are meant to be.

describe('an avatar colour from another instance', () => {
  it('named like a key every object has is no colour, and the gradient comes from the id', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const gradient = getAvatarGradient('user-1', 'Name', name);
      expect(gradient, name).toEqual(getAvatarGradient('user-1', 'Name', null));
      expect(typeof gradient.from, name).toBe('string');
      expect(getSpaceGradient('space-1', 'Space', name), name).toEqual(getSpaceGradient('space-1', 'Space', null));
    }
  });
});

describe('a role colour from another instance', () => {
  it('that is not #rrggbb adds no layer to a gradient, so it loads nothing from anywhere', () => {
    const role = { color: '#aaaaaa', colorSecondary: 'red), url(https://tracker.example/p.png), linear-gradient(red' };
    expect(roleTextStyle(role).backgroundImage).toBeUndefined();
    expect(roleDotStyle(role).backgroundImage).toBeUndefined();
    expect(roleTextStyle({ color: 'url(https://tracker.example/p.png)', colorSecondary: null }).color).toBeUndefined();
  });

  it('that is draws as before', () => {
    expect(roleTextStyle({ color: '#112233', colorSecondary: '#445566' }).backgroundImage).toBe('linear-gradient(90deg, #112233, #445566)');
    expect(roleDotStyle({ color: '#112233', colorSecondary: null })).toEqual({ backgroundColor: '#112233' });
  });
});
