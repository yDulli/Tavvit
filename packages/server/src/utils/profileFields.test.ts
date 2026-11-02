import { describe, expect, it } from 'vitest';
import {
  normalizeProfileLinkUrl,
  normalizeProfileLinks,
  normalizePronouns,
  parseStoredProfileLinks,
  profileLinkText,
} from '@backspace/shared/src/profileFields.js';

// The profile card's own fields (auth.md, "Profile fields"), as the instance
// stores them and every profile surface checks them again.

const BIDI_OVERRIDE = String.fromCharCode(0x202e);

describe('normalizePronouns', () => {
  it('trims, collapses spaces and clears when empty', () => {
    expect(normalizePronouns('  she /  her ')).toBe('she / her');
    expect(normalizePronouns('   ')).toBeNull();
    expect(normalizePronouns(null)).toBeNull();
  });

  it('refuses what is too long, not text, or hides its direction', () => {
    expect(normalizePronouns('x'.repeat(41))).toBeUndefined();
    expect(normalizePronouns(42)).toBeUndefined();
    expect(normalizePronouns(`he${BIDI_OVERRIDE}him`)).toBeUndefined();
    expect(normalizePronouns(`a${String.fromCharCode(7)}b`)).toBeUndefined();
  });

  it('reads a line break as the space it collapses to', () => {
    expect(normalizePronouns('they\nthem')).toBe('they them');
  });
});

describe('normalizeProfileLinkUrl', () => {
  it('keeps plain web addresses', () => {
    expect(normalizeProfileLinkUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeProfileLinkUrl(' http://example.com/a?b=1 ')).toBe('http://example.com/a?b=1');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com',
    'https://user:pass@example.com',
    'example.com',
    `https://example.com/${'a'.repeat(200)}`,
    '',
  ])('refuses %s', (url) => {
    expect(normalizeProfileLinkUrl(url)).toBeNull();
  });

  it('holds the limit to the stored form, which encoding can make longer than what was typed', () => {
    // 190 characters typed; each space becomes %20 in the stored address.
    const typed = `https://example.com/${'a b'.repeat(56)}`;
    expect(typed.length).toBeLessThanOrEqual(200);
    expect(normalizeProfileLinkUrl(typed)).toBeNull();
  });
});

describe('normalizeProfileLinks', () => {
  it('stores links in order, once each, with trimmed labels', () => {
    expect(normalizeProfileLinks([
      { url: 'https://example.com/a', label: '  Site  ' },
      { url: 'https://example.com/a', label: 'Again' },
      { url: 'https://example.org' },
    ])).toEqual([
      { url: 'https://example.com/a', label: 'Site' },
      { url: 'https://example.org/', label: null },
    ]);
  });

  it('clears with null or an empty list', () => {
    expect(normalizeProfileLinks(null)).toBeNull();
    expect(normalizeProfileLinks([])).toBeNull();
  });

  it('refuses the whole list for one bad entry, too many, or a label too long', () => {
    expect(normalizeProfileLinks([{ url: 'https://example.com' }, { url: 'javascript:alert(1)' }])).toBeUndefined();
    expect(normalizeProfileLinks(Array.from({ length: 6 }, (_, i) => ({ url: `https://example.com/${i}` })))).toBeUndefined();
    expect(normalizeProfileLinks([{ url: 'https://example.com', label: 'x'.repeat(33) }])).toBeUndefined();
    expect(normalizeProfileLinks([{ url: 'https://example.com', label: `a${BIDI_OVERRIDE}b` }])).toBeUndefined();
    expect(normalizeProfileLinks(['https://example.com'])).toBeUndefined();
    expect(normalizeProfileLinks('https://example.com')).toBeUndefined();
  });
});

describe('parseStoredProfileLinks and profileLinkText', () => {
  it('reads stored links back and treats anything unreadable as none', () => {
    expect(parseStoredProfileLinks(JSON.stringify([{ url: 'https://example.com/', label: null }]))).toEqual([{ url: 'https://example.com/', label: null }]);
    expect(parseStoredProfileLinks('not json')).toEqual([]);
    expect(parseStoredProfileLinks(JSON.stringify([{ url: 'javascript:alert(1)' }]))).toEqual([]);
    // One bad entry hides only itself.
    expect(parseStoredProfileLinks(JSON.stringify([{ url: 'https://example.com/a' }, { url: 'javascript:alert(1)' }, { url: 'https://example.org/' }])))
      .toEqual([{ url: 'https://example.com/a', label: null }, { url: 'https://example.org/', label: null }]);
    expect(parseStoredProfileLinks(null)).toEqual([]);
  });

  it('names a link by its label, else by its host without www', () => {
    expect(profileLinkText({ url: 'https://www.example.com/me', label: 'Me' })).toBe('Me');
    expect(profileLinkText({ url: 'https://www.example.com/me', label: null })).toBe('example.com');
  });
});
