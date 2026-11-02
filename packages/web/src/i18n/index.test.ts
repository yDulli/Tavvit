import { describe, it, expect, beforeEach, vi } from 'vitest';
import i18n, { initI18n, setLanguage, LANGUAGE_STORAGE_KEY } from './index';

const allReleased = new Set(['en', 'ru', 'de']);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
  document.documentElement.dir = '';
});

describe('initI18n', () => {
  it('starts in the stored language and reflects it on the document', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ru');
    await initI18n({ releasedLanguages: allReleased });
    expect(i18n.resolvedLanguage).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('starts in English when nothing is stored, whatever the browser prefers', async () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE', 'de']);
    const language = vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    await initI18n({ releasedLanguages: allReleased });
    expect(i18n.resolvedLanguage).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    languages.mockRestore();
    language.mockRestore();
  });

  it('has the selected language loaded before it resolves', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    await initI18n({ releasedLanguages: allReleased });
    expect(i18n.hasResourceBundle('de', 'common')).toBe(true);
    expect(i18n.t('common:actions.cancel')).toBe('Abbrechen');
  });
});

describe('initI18n release gate', () => {
  it('ignores a stored unreleased language and starts in English', async () => {
    // Every shipped language is released now; keep the gate covered with an
    // explicit released set so the next language can rely on it.
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ru');
    await initI18n({ releasedLanguages: new Set(['en']) });
    expect(i18n.resolvedLanguage).toBe('en');
  });
});

describe('initI18n preview', () => {
  it('shows an explicitly previewed language without persisting it', async () => {
    await initI18n({ previewLanguage: 'de' });
    expect(i18n.resolvedLanguage).toBe('de');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });
});

describe('setLanguage', () => {
  it('switches, persists, and updates the document', async () => {
    await initI18n();
    await setLanguage('ru');
    expect(i18n.resolvedLanguage).toBe('ru');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(i18n.t('common:actions.cancel')).toBe('Отмена');
  });

  it('falls back to English for a key the language has not translated', async () => {
    await initI18n();
    await setLanguage('de');
    i18n.addResource('en', 'common', 'test.onlyEnglish', 'English only');
    expect(i18n.t('common:test.onlyEnglish')).toBe('English only');
  });
});
