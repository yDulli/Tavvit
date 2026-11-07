import { describe, expect, it } from 'vitest';
import {
  AVATAR_FRAMES,
  NAME_EFFECTS,
  NAME_FONTS,
  NAMEPLATES,
  PROFILE_EFFECTS,
  decorationUpdateOf,
  decorationsOf,
} from '@backspace/shared/src/decorations.js';

// The decorations' names (shared/src/decorations.ts) as the server stores them and every client
// reads them again (docs/systems/decorations.md).

describe('decorationsOf', () => {
  it('reads every known design', () => {
    expect(decorationsOf({ avatarFrame: 'stardust', profileEffect: 'aurora', nameplate: 'waves', nameFont: 'wide', nameEffect: 'theme' }))
      .toEqual({ avatarFrame: 'stardust', profileEffect: 'aurora', nameplate: 'waves', nameFont: 'wide', nameEffect: 'theme' });
  });

  it('shows nothing for a name it does not know, a value that is not a name, or no profile', () => {
    expect(decorationsOf({ avatarFrame: 'crown', profileEffect: 7, nameplate: null, nameEffect: 'toString' }))
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
});

describe('decorationUpdateOf', () => {
  it('keeps the fields an update names, null clearing one, and leaves out the rest', () => {
    expect(decorationUpdateOf({ avatarFrame: 'dial', nameplate: null })).toEqual({ ok: true, values: { avatarFrame: 'dial', nameplate: null } });
    expect(decorationUpdateOf({})).toEqual({ ok: true, values: {} });
  });

  it('stores the classic typeface as none', () => {
    expect(decorationUpdateOf({ nameFont: 'classic' })).toEqual({ ok: true, values: { nameFont: null } });
  });

  it('names the first field that is not a design', () => {
    expect(decorationUpdateOf({ avatarFrame: 'silver', profileEffect: 'fireworks', nameEffect: 1 })).toEqual({ ok: false, field: 'profileEffect' });
    expect(decorationUpdateOf({ nameplate: '' })).toEqual({ ok: false, field: 'nameplate' });
  });
});
