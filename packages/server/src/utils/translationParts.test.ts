import { describe, expect, it } from 'vitest';
import {
  googleTranslateUrl,
  isTranslationTarget,
  joinTranslation,
  longestIndex,
  primaryLanguage,
  splitForTranslation,
} from '@backspace/shared/src/translation.js';

const words = (content: string) => splitForTranslation(content).filter((part) => part.translate).map((part) => part.text);
const shout = (content: string) => {
  const parts = splitForTranslation(content);
  return joinTranslation(parts, parts.filter((part) => part.translate).map((part) => part.text.toUpperCase()));
};

describe('cutting a message', () => {
  const samples = [
    'plain words',
    '  spaces round it  ',
    'line one\n\nline three\n',
    'Hello <@123> and <@&456>, see <#789>',
    '<:party:12345> well done :tada: everyone',
    'look at https://example.com/a?b=c first',
    'the [docs](https://example.com) say so',
    'run `pnpm dev` then\n```ts\nconst a = 1;\n```\nand wait',
    '- first\n- second\n1. third\n> quoted\n# heading',
    'a ||secret|| word',
    '@everyone come here',
    '123 456 !!!',
    '',
  ];

  it.each(samples)('gives the message back whole: %j', (content) => {
    expect(splitForTranslation(content).map((part) => part.text).join('')).toBe(content);
  });

  it('keeps mentions, emoji, addresses and code away from a translator', () => {
    expect(words('Hello <@123>, look at https://example.com/a and `code` now')).toEqual(['Hello', ', look at', 'and', 'now']);
    expect(words('<:party:12345> well done :tada:')).toEqual(['well done']);
    expect(words('```\nnot this\n```')).toEqual([]);
    expect(words('the [docs](https://example.com) say so')).toEqual(['the', 'say so']);
    expect(words('@everyone come')).toEqual(['come']);
  });

  it('sends a line at a time, without what opens a line of a list or a quote', () => {
    expect(words('- first\n> second\n## third\nfourth')).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('keeps what a spoiler covers covered', () => {
    expect(shout('a ||secret|| word')).toBe('A ||SECRET|| WORD');
  });

  it('sends nothing that has no letters', () => {
    expect(words('123 456 !!! 🎉')).toEqual([]);
  });

  it('puts the words back where they were', () => {
    expect(shout('Hello <@123>, look at https://example.com/a now\n- and this')).toBe('HELLO <@123>, LOOK AT https://example.com/a NOW\n- AND THIS');
  });

  it('keeps the original words of a part a translator did not answer', () => {
    const parts = splitForTranslation('one <@1> two');
    expect(joinTranslation(parts, ['eins'])).toBe('eins <@1> two');
  });

  it('closes up bold marks a translator spaced out', () => {
    const parts = splitForTranslation('this is **very** good');
    expect(joinTranslation(parts, ['das ist ** sehr ** gut'])).toBe('das ist **sehr** gut');
  });
});

describe('the small helpers', () => {
  it('knows the languages a message can be read in', () => {
    expect(isTranslationTarget('de')).toBe(true);
    expect(isTranslationTarget('xx')).toBe(false);
    expect(isTranslationTarget(1)).toBe(false);
  });

  it('reads a language without its region or script, as two translators name it alike', () => {
    expect(primaryLanguage('PT-BR')).toBe('pt');
    expect(primaryLanguage('zh-Hans')).toBe('zh');
    expect(primaryLanguage('de')).toBe('de');
  });

  it('finds the longest words', () => {
    expect(longestIndex(['a', 'bcd', 'ef'])).toBe(1);
    expect(longestIndex([])).toBe(0);
  });

  it('leads to Google with the words on it, as far as an address takes them', () => {
    const url = new URL(googleTranslateUrl('Hallo <@1> du', 'en'));
    expect(url.origin).toBe('https://translate.google.com');
    expect(url.searchParams.get('tl')).toBe('en');
    expect(url.searchParams.get('text')).toBe('Hallo <@1> du');
    expect(new URL(googleTranslateUrl('x'.repeat(4000), 'en')).searchParams.get('text')).toHaveLength(1800);
  });
});
