import { describe, expect, it } from 'vitest';
import { parseRoleDisplayFields, roleColorOf, roleIconOf, roleNameOf } from './roleFields.js';

// A role's display fields as the create and update routes check them
// (permissions.md, "Role display").

const STAR = String.fromCodePoint(0x2b50);
const SHIELD = String.fromCodePoint(0x1f6e1, 0xfe0f);
const FAMILY = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map((point) => String.fromCodePoint(point)).join('');
const FLAG = String.fromCodePoint(0x1f1e9, 0x1f1ea);
const KEYCAP = `1${String.fromCodePoint(0xfe0f, 0x20e3)}`;
const THUMB_TONED = String.fromCodePoint(0x1f44d, 0x1f3fd);
/** England's flag: the black flag, the tag letters g b e n g, the cancel tag. */
const ENGLAND = String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f);
const DEVELOPER = String.fromCodePoint(0x1f469, 0x200d, 0x1f4bb);

describe('roleIconOf', () => {
  it.each([STAR, SHIELD, FAMILY, FLAG, KEYCAP, THUMB_TONED, ENGLAND, `${STAR}${STAR}`])('takes the emoji %s', (icon) => {
    expect(roleIconOf(icon)).toBe(icon);
  });

  it('clears with null or blank', () => {
    expect(roleIconOf(null)).toBeNull();
    expect(roleIconOf('   ')).toBeNull();
  });

  it.each([
    'abc',
    'A',
    `${STAR}a`,
    `${STAR} ${STAR}`,
    `${String.fromCharCode(0x202e)}${STAR}`,
    STAR.repeat(17),
    '1',
  ])('refuses %s', (icon) => {
    expect(roleIconOf(icon)).toEqual({ code: 'role_icon_invalid' });
  });

  it('refuses what is not text', () => {
    expect(roleIconOf(5)).toEqual({ code: 'role_icon_invalid' });
  });
});

describe('roleNameOf', () => {
  it('takes a name with an emoji sequence, a joiner included, and collapses its spaces', () => {
    expect(roleNameOf(`  ${DEVELOPER}   Developers `)).toBe(`${DEVELOPER} Developers`);
  });

  it('refuses a hidden character with its own code, and a long name with the length', () => {
    expect(roleNameOf(`Ad${String.fromCharCode(0x202e)}min`)).toEqual({ code: 'role_name_invalid' });
    expect(roleNameOf(`a${String.fromCharCode(0x200b)}b`)).toEqual({ code: 'role_name_invalid' });
    expect(roleNameOf('x'.repeat(101))).toEqual({ code: 'role_name_too_long', details: { max: 100 } });
    expect(roleNameOf('   ')).toEqual({ code: 'role_name_required' });
  });
});

describe('roleColorOf', () => {
  it('stores #rrggbb in lower case and refuses anything else', () => {
    expect(roleColorOf(' #AABBCC ')).toBe('#aabbcc');
    expect(roleColorOf('#abc')).toEqual({ code: 'role_color_invalid' });
    expect(roleColorOf('red')).toEqual({ code: 'role_color_invalid' });
  });
});

describe('parseRoleDisplayFields', () => {
  it('checks only the fields a request names', () => {
    expect(parseRoleDisplayFields({ hoist: false })).toEqual({ ok: true, value: { hoist: 0 } });
    expect(parseRoleDisplayFields({ colorSecondary: '', description: '  ', icon: null }))
      .toEqual({ ok: true, value: { colorSecondary: null, description: null, icon: null } });
    expect(parseRoleDisplayFields({ name: '  Night   Owls ', mentionable: true }))
      .toEqual({ ok: true, value: { name: 'Night Owls', mentionable: 1 } });
  });

  it('names the first field that is wrong', () => {
    expect(parseRoleDisplayFields({ name: '' })).toEqual({ ok: false, refusal: { code: 'role_name_required' } });
    expect(parseRoleDisplayFields({ description: 'x'.repeat(201) }))
      .toEqual({ ok: false, refusal: { code: 'role_description_too_long', details: { max: 200 } } });
    expect(parseRoleDisplayFields({ hoist: 'yes' })).toEqual({ ok: false, refusal: { code: 'validation_failed' } });
    expect(parseRoleDisplayFields({ colorSecondary: 'blue' })).toEqual({ ok: false, refusal: { code: 'role_color_invalid' } });
  });
});
