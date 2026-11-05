import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en/landing.json';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  getLanguageDirection,
  pickLanguage,
  type SupportedLanguage,
} from '../i18n/languages';

/**
 * The product page's own small i18n setup. The app's (`i18n/index.ts`) bundles
 * every English catalog, which a visitor who only reads this page has no use for;
 * this one carries the page's own namespace, and the same language choice, so
 * someone who picked German in the app sees this page in German too.
 */
const catalogs = import.meta.glob<Record<string, unknown>>(
  ['../locales/*/landing.json', '!../locales/en/landing.json'],
  { import: 'default' },
);

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // Storage can be disabled by browser privacy settings; detection continues without it.
    return null;
  }
}

/** A translated catalog, or null when there is none or it could not be fetched. */
async function loadCatalog(language: SupportedLanguage): Promise<Record<string, unknown> | null> {
  const load = catalogs[`../locales/${language}/landing.json`];
  if (!load) return null;
  try {
    return await load();
  } catch (error) {
    // A language that fails to load leaves the page in English rather than blank.
    console.error('[landing] Could not load the language, showing English:', error);
    return null;
  }
}

/**
 * Remembers a language picked on this page and shows the page in it, where it
 * stands: the picker is in the footer, and a reload would start over at the top.
 * The catalog is added before the change, since i18next only resolves a language
 * it holds a bundle for.
 */
export async function chooseLandingLanguage(language: SupportedLanguage): Promise<void> {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Without storage the choice lasts until the page is left.
  }
  const catalog = language === DEFAULT_LANGUAGE ? null : await loadCatalog(language);
  const shown = catalog || language === DEFAULT_LANGUAGE ? language : DEFAULT_LANGUAGE;
  if (catalog) i18next.addResourceBundle(shown, 'landing', catalog, true, true);
  await i18next.changeLanguage(shown);
  document.documentElement.lang = shown;
  document.documentElement.dir = getLanguageDirection(shown);
}

/**
 * English, at once, in `instance`: for the HTML the website's build renders (site/render.ts) and for
 * the first render that takes that HTML over (site/client/landing.tsx), which must say exactly what
 * the HTML says. The visitor's own language follows once the page is theirs
 * (`applyStoredLandingLanguage`).
 */
export function initLandingI18nEnglish(instance: i18n = i18next): void {
  if (instance.isInitialized) return;
  void instance.use(initReactI18next).init({
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    defaultNS: 'landing',
    ns: ['landing'],
    resources: { en: { landing: en } },
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

/**
 * The language this visitor chose before, on the page rendered ahead of time, after it has been
 * taken over in English. Nothing is written: the choice is already stored.
 */
export async function applyStoredLandingLanguage(): Promise<void> {
  const wanted = pickLanguage(readStoredLanguage());
  if (wanted === DEFAULT_LANGUAGE) return;
  const catalog = await loadCatalog(wanted);
  if (!catalog) return;
  i18next.addResourceBundle(wanted, 'landing', catalog, true, true);
  await i18next.changeLanguage(wanted);
  document.documentElement.lang = wanted;
  document.documentElement.dir = getLanguageDirection(wanted);
}

/**
 * The catalog is fetched first and handed to `init`. i18next works out
 * `resolvedLanguage` from the bundles it holds at that moment, and a bundle added
 * afterwards does not change it, so a catalog added after `init` leaves the page
 * in German and `resolvedLanguage`, which the footer's picker shows, on English.
 */
export async function initLandingI18n(): Promise<void> {
  const wanted = pickLanguage(readStoredLanguage());
  const catalog = wanted === DEFAULT_LANGUAGE ? null : await loadCatalog(wanted);
  const language = catalog ? wanted : DEFAULT_LANGUAGE;
  document.documentElement.lang = language;
  document.documentElement.dir = getLanguageDirection(language);

  await i18next.use(initReactI18next).init({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    defaultNS: 'landing',
    ns: ['landing'],
    resources: { en: { landing: en }, ...(catalog ? { [language]: { landing: catalog } } : {}) },
    returnNull: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}
