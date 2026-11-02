import { describe, expect, it } from 'vitest';
import { isWeakPassword } from './passwordPolicy.js';

describe('a new password', () => {
  it('may not be one of the first things anyone tries', () => {
    for (const weak of ['password', 'Password123', '12345678', 'qwertyuiop', 'PASSWORT123', 'iloveyou', 'schalke04']) {
      expect(isWeakPassword(weak), weak).toBe(true);
    }
  });

  it('may not be one character over and over', () => {
    expect(isWeakPassword('aaaaaaaaaaaa')).toBe(true);
    expect(isWeakPassword('!!!!!!!!')).toBe(true);
  });

  it('may not be the account\'s name, in any case', () => {
    expect(isWeakPassword('maximilian', 'maximilian')).toBe(true);
    expect(isWeakPassword('MaxiMilian', 'maximilian')).toBe(true);
    expect(isWeakPassword('maximilian')).toBe(false);
  });

  it('needs no digits, capitals or symbols to be fine', () => {
    for (const fine of ['correct horse battery staple', 'lange-worte-im-regen', 'alles klein geschrieben', 'password but much longer than that']) {
      expect(isWeakPassword(fine, 'alice'), fine).toBe(false);
    }
  });
});
