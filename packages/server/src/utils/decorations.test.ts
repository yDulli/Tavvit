import { describe, expect, it } from 'vitest';
import {
  AVATAR_FRAMES,
  NAME_EFFECTS,
  NAME_FONTS,
  NAMEPLATES,
  PROFILE_EFFECTS,
  RETIRED_EFFECTS,
  RETIRED_FRAMES,
  RETIRED_NAME_EFFECTS,
  RETIRED_NAME_FONTS,
  RETIRED_NAMEPLATES,
  decorationUpdateOf,
  decorationsOf,
} from '@backspace/shared/src/decorations.js';

// The decorations' names (shared/src/decorations.ts) as the server stores them and every client
// reads them again (docs/systems/decorations.md).

describe('decorationsOf', () => {
  it('reads every known design', () => {
    expect(decorationsOf({ avatarFrame: 'headphones', profileEffect: 'butterflies', nameplate: 'vinyl', nameFont: 'wide', nameEffect: 'wave' }))
      .toEqual({ avatarFrame: 'headphones', profileEffect: 'butterflies', nameplate: 'vinyl', nameFont: 'wide', nameEffect: 'wave' });
  });

  it('shows a retired design as its successor', () => {
    expect(decorationsOf({ avatarFrame: 'gilded', profileEffect: 'sunbeams', nameplate: 'circuit' }))
      .toEqual({ avatarFrame: 'crown', profileEffect: 'butterflies', nameplate: 'skyline', nameFont: null, nameEffect: null });
  });

  it('shows nothing for a name it does not know, a value that is not a name, or no profile', () => {
    expect(decorationsOf({ avatarFrame: 'golden-crown', profileEffect: 7, nameplate: null, nameEffect: 'toString' }))
      .toEqual({ avatarFrame: null, profileEffect: null, nameplate: null, nameFont: null, nameEffect: null });
    expect(decorationsOf({ avatarFrame: 'constructor', nameplate: 'hasOwnProperty' }))
      .toEqual({ avatarFrame: null, profileEffect: null, nameplate: null, nameFont: null, nameEffect: null });
    expect(decorationsOf(null)).toEqual({ avatarFrame: null, profileEffect: null, nameplate: null, nameFont: null, nameEffect: null });
  });

  it('takes the classic typeface as none', () => {
    expect(decorationsOf({ nameFont: 'classic' }).nameFont).toBeNull();
  });

  it('has no name twice in any list', () => {
    for (const list of [AVATAR_FRAMES, PROFILE_EFFECTS, NAMEPLATES, NAME_FONTS, NAME_EFFECTS]) {
      expect(new Set<string>(list).size).toBe(list.length);
    }
  });

  it('retires only names that are gone, each to a design that is there', () => {
    const pairs: Array<[Readonly<Record<string, string>>, readonly string[]]> = [
      [RETIRED_FRAMES, AVATAR_FRAMES],
      [RETIRED_EFFECTS, PROFILE_EFFECTS],
      [RETIRED_NAMEPLATES, NAMEPLATES],
      [RETIRED_NAME_FONTS, NAME_FONTS],
      [RETIRED_NAME_EFFECTS, NAME_EFFECTS],
    ];
    for (const [retired, current] of pairs) {
      for (const [name, successor] of Object.entries(retired)) {
        expect(current).not.toContain(name);
        expect(current).toContain(successor);
      }
    }
  });
});

describe('decorationUpdateOf', () => {
  it('keeps the fields an update names, null clearing one, and leaves out the rest', () => {
    expect(decorationUpdateOf({ avatarFrame: 'crown', nameplate: null })).toEqual({ ok: true, values: { avatarFrame: 'crown', nameplate: null } });
    expect(decorationUpdateOf({})).toEqual({ ok: true, values: {} });
  });

  it('stores a retired design, from a client older than the change, as its successor', () => {
    expect(decorationUpdateOf({ avatarFrame: 'dial', profileEffect: 'rain', nameplate: 'dusk' }))
      .toEqual({ ok: true, values: { avatarFrame: 'stardust', profileEffect: 'bubbles', nameplate: 'sunset' } });
  });

  it('stores the classic typeface as none', () => {
    expect(decorationUpdateOf({ nameFont: 'classic' })).toEqual({ ok: true, values: { nameFont: null } });
  });

  it('names the first field that is not a design', () => {
    expect(decorationUpdateOf({ avatarFrame: 'crown', profileEffect: 'fireworks', nameEffect: 1 })).toEqual({ ok: false, field: 'profileEffect' });
    expect(decorationUpdateOf({ nameplate: '' })).toEqual({ ok: false, field: 'nameplate' });
    expect(decorationUpdateOf({ avatarFrame: '__proto__' })).toEqual({ ok: false, field: 'avatarFrame' });
  });
});
