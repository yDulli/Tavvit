import { describe, it, expect } from 'vitest';
import { availableLanguages, isSupportedLanguage, pickLanguage, readPreviewLanguage, supportedLanguages } from './languages';

describe('pickLanguage', () => {
  const allReleased = new Set(['en', 'ru', 'de', 'pt', 'zh']);

  it('takes the stored choice', () => {
    expect(pickLanguage('de', allReleased)).toBe('de');
    expect(pickLanguage('ru')).toBe('ru');
  });

  it('is English without a choice, or with one that is not a shipped language', () => {
    expect(pickLanguage(null, allReleased)).toBe('en');
    expect(pickLanguage('', allReleased)).toBe('en');
    expect(pickLanguage('fr', allReleased)).toBe('en');
  });
});

describe('availableLanguages', () => {
  it('offers every released language to users', () => {
    expect(availableLanguages.map((l) => l.code)).toEqual(['en', 'ru', 'de', 'pt', 'zh']);
  });

  it('never lets a stored choice name a language that is not released', () => {
    // The gate stays in place for the next language; exercise it with an
    // explicit released set so the test does not depend on the shipped flags.
    expect(pickLanguage('ru', new Set(['en']))).toBe('en');
  });

  it('still lets code select any supported language explicitly', () => {
    expect(isSupportedLanguage('ru')).toBe(true);
  });
});

describe('supportedLanguages', () => {
  it('lists every language by its own name and text direction', () => {
    expect(supportedLanguages.map((l) => l.code)).toEqual(['en', 'ru', 'de', 'pt', 'zh']);
    for (const language of supportedLanguages) {
      expect(language.nativeName.length).toBeGreaterThan(0);
      expect(['ltr', 'rtl']).toContain(language.dir);
    }
  });
});

describe('readPreviewLanguage', () => {
  it('reads ?lang= in development so unreleased languages can be reviewed', () => {
    expect(readPreviewLanguage('?lang=de', true)).toBe('de');
    expect(readPreviewLanguage('?foo=1&lang=ru-RU', true)).toBe('ru');
  });

  it('ignores the parameter in production builds', () => {
    expect(readPreviewLanguage('?lang=de', false)).toBeNull();
  });

  it('ignores values that are not shipped languages', () => {
    expect(readPreviewLanguage('?lang=fr', true)).toBeNull();
    expect(readPreviewLanguage('', true)).toBeNull();
  });
});
