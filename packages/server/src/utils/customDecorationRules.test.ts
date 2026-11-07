import { describe, expect, it } from 'vitest';
import {
  CUSTOM_DECORATION_LIMITS,
  customDecorationIdOf,
  customDecorationRef,
  customDecorationViewOf,
  effectMotionOf,
  normalizeDecorationName,
  normalizeNameStyle,
  wornCustomDecorationsFrom,
} from '@backspace/shared/src/customDecorations.js';
import { decorationUpdateOf } from '@backspace/shared/src/decorations.js';

// The rules for decorations people make (shared/src/customDecorations.ts), as the server applies
// them to what it stores and every client to what it is sent (docs/systems/decorations.md).

describe('references to a made design', () => {
  it('names a design by its id after custom:, and nothing else', () => {
    expect(customDecorationRef('42')).toBe('custom:42');
    expect(customDecorationIdOf('custom:42')).toBe('42');
    for (const value of ['custom:', 'custom:4a', 'custom:-1', `custom:${'1'.repeat(21)}`, 'crown', 'CUSTOM:42', 42, null, undefined]) {
      expect(customDecorationIdOf(value)).toBeNull();
    }
  });

  it('lets a profile update wear one in the four fields that take them, never as its typeface', () => {
    expect(decorationUpdateOf({ avatarFrame: 'custom:1', profileEffect: 'custom:2', nameplate: 'custom:3', nameEffect: 'custom:4' }))
      .toEqual({ ok: true, values: { avatarFrame: 'custom:1', profileEffect: 'custom:2', nameplate: 'custom:3', nameEffect: 'custom:4' } });
    expect(decorationUpdateOf({ nameFont: 'custom:1' })).toEqual({ ok: false, field: 'nameFont' });
    expect(decorationUpdateOf({ avatarFrame: 'custom:x' })).toEqual({ ok: false, field: 'avatarFrame' });
  });
});

describe('a name style', () => {
  it('keeps a known look with the colours it takes, in lower case', () => {
    expect(normalizeNameStyle({ look: 'gradient', colors: [' #AABBCC', '#112233'] })).toEqual({ look: 'gradient', colors: ['#aabbcc', '#112233'] });
    expect(normalizeNameStyle({ look: 'sticker', colors: ['#ffffff'] })).toEqual({ look: 'sticker', colors: ['#ffffff'] });
  });

  it.each([
    [{ look: 'gradient', colors: ['#aabbcc'] }],
    [{ look: 'wave', colors: ['#aabbcc', '#112233', '#445566'] }],
    [{ look: 'neon', colors: ['#aabbcc', '#112233'] }],
    [{ look: 'sticker', colors: ['white'] }],
    [{ look: 'sticker', colors: ['#fff'] }],
    [{ look: 'sticker', colors: '#ffffff' }],
    [{ look: 'sticker', colors: [0xffffff] }],
    [null],
    ['gradient'],
  ])('refuses %j', (value) => {
    expect(normalizeNameStyle(value)).toBeNull();
  });
});

describe('a design\'s name', () => {
  it('is one trimmed line, counted in characters as a person sees them', () => {
    expect(normalizeDecorationName('  Gold   leaf \n')).toBe('Gold leaf');
    expect(normalizeDecorationName('🙂'.repeat(CUSTOM_DECORATION_LIMITS.NAME_MAX))).toBe('🙂'.repeat(CUSTOM_DECORATION_LIMITS.NAME_MAX));
    expect(normalizeDecorationName('🙂'.repeat(CUSTOM_DECORATION_LIMITS.NAME_MAX + 1))).toBeUndefined();
  });

  it('refuses one that is empty or hides what it says', () => {
    for (const name of ['', '   ', 'a\u0007b', 'gnp.‮exe', 'in​visible', 'joined⁠word', 42]) {
      expect(normalizeDecorationName(name)).toBeUndefined();
    }
  });
});

describe('an effect\'s motion', () => {
  it('reads a known motion and falls where there is none', () => {
    expect(effectMotionOf({ motion: 'rise' })).toBe('rise');
    expect(effectMotionOf({ motion: 'spin' })).toBe('fall');
    expect(effectMotionOf({})).toBe('fall');
    expect(effectMotionOf(null)).toBe('fall');
  });
});

describe('what a client draws of a made design', () => {
  const frame = { id: '7', kind: 'frame', name: 'Ring', image: '/api/decorations/7.webp', still: null, style: null, motion: null };

  it('draws a picture from where an instance serves one: its path there, or that path on another instance', () => {
    expect(customDecorationViewOf(frame, 'frame')).toEqual(frame);
    const remote = { ...frame, image: 'https://orbit.example/api/decorations/7.webp', still: 'https://orbit.example/api/decorations/7-still.webp' };
    expect(customDecorationViewOf(remote, 'frame')).toEqual(remote);
  });

  it.each([
    '/api/uploads/7.webp',
    '/api/decorations/7.png',
    '/api/decorations/7.webp?x=1',
    'https://evil.example/frame.png',
    'https://user@evil.example/api/decorations/7.webp',
    'javascript:alert(1)',
    'data:image/webp;base64,AAAA',
    '//evil.example/api/decorations/7.webp',
  ])('draws nothing from %s', (image) => {
    expect(customDecorationViewOf({ ...frame, image }, 'frame')).toBeNull();
  });

  it('keeps a still frame only from where pictures are served', () => {
    expect(customDecorationViewOf({ ...frame, still: 'https://evil.example/still.webp' }, 'frame')).toEqual(frame);
  });

  it('draws a design only in the field of its kind, with a sound id', () => {
    expect(customDecorationViewOf(frame, 'nameplate')).toBeNull();
    expect(customDecorationViewOf({ ...frame, id: 'abc' }, 'frame')).toBeNull();
    expect(customDecorationViewOf('custom:7', 'frame')).toBeNull();
  });

  it('cuts a name that is too long, and needs a sound style for a name', () => {
    expect(customDecorationViewOf({ ...frame, name: 'x'.repeat(100) }, 'frame')?.name).toHaveLength(CUSTOM_DECORATION_LIMITS.NAME_MAX);
    const name = { id: '8', kind: 'name', name: 'Wave', image: null, still: null, style: { look: 'wave', colors: ['#5cc491', '#60a5e6'] }, motion: null };
    expect(customDecorationViewOf(name, 'name')).toEqual(name);
    expect(customDecorationViewOf({ ...name, style: { look: 'wave', colors: ['red', 'blue'] } }, 'name')).toBeNull();
  });

  it('gives an effect its motion, and a fall when it names none it knows', () => {
    const effect = { id: '9', kind: 'effect', name: 'Hearts', image: '/api/decorations/9.webp', still: '/api/decorations/9-still.webp', style: null, motion: 'float' };
    expect(customDecorationViewOf(effect, 'effect')).toEqual(effect);
    expect(customDecorationViewOf({ ...effect, motion: 'spin' }, 'effect')?.motion).toBe('fall');
  });

  it('reads what a profile wears field by field, leaving out what does not pass', () => {
    expect(wornCustomDecorationsFrom({ avatarFrame: frame, nameplate: frame, nameEffect: 'nothing' })).toEqual({ avatarFrame: frame });
    expect(wornCustomDecorationsFrom(null)).toEqual({});
  });
});
