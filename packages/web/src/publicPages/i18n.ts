import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import enChangelog from '../locales/en/changelog.json';
import enCreators from '../locales/en/creators.json';
import enHelp from '../locales/en/help.json';
import enRoadmap from '../locales/en/roadmap.json';
import enStatus from '../locales/en/status.json';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  getLanguageDirection,
  pickLanguage,
} from '../i18n/languages';

/**
 * These pages' own small i18n setup, as the product page has one: the app's bundles every English
 * catalog. It carries their namespaces and the same language choice.
 */
const NAMESPACES = ['help', 'changelog', 'status', 'roadmap', 'creators'] as const;
type Namespace = (typeof NAMESPACES)[number];

const catalogs = import.meta.glob<Record<string, unknown>>(
  [
    '../locales/*/help.json',
    '../locales/*/changelog.json',
    '../locales/*/status.json',
    '../locales/*/roadmap.json',
    '../locales/*/creators.json',
    '!../locales/en/*.json',
  ],
  { import: 'default' },
);

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // Storage can be disabled by browser privacy settings.
    return null;
  }
}

async function loadCatalogs(language: string): Promise<Record<Namespace, Record<string, unknown>> | null> {
  try {
    const loaded = await Promise.all(NAMESPACES.map(async (namespace) => {
      const load = catalogs[`../locales/${language}/${namespace}.json`];
      if (!load) throw new Error(`No ${namespace} in ${language}`);
      return [namespace, await load()] as const;
    }));
    return Object.fromEntries(loaded) as Record<Namespace, Record<string, unknown>>;
  } catch (error) {
    // A language that fails to load leaves the page in English rather than blank.
    console.error('[pages] Could not load the language, showing English:', error);
    return null;
  }
}

/**
 * English, at once, in `instance`: for the HTML the website's build renders (site/render.ts) and for
 * the first render that takes it over (site/client/public.tsx), which must say what the HTML says.
 * The visitor's own language follows (`applyStoredPublicLanguage`).
 */
export function initPublicPagesI18nEnglish(instance: i18n = i18next): void {
  if (instance.isInitialized) return;
  void instance.use(initReactI18next).init({
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    defaultNS: 'status',
    ns: [...NAMESPACES],
    resources: { en: { help: enHelp, changelog: enChangelog, status: enStatus, roadmap: enRoadmap, creators: enCreators } },
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

/** The language this visitor chose before, once the page rendered ahead of time is theirs. */
export async function applyStoredPublicLanguage(): Promise<void> {
  const wanted = pickLanguage(readStoredLanguage());
  if (wanted === DEFAULT_LANGUAGE) return;
  const translated = await loadCatalogs(wanted);
  if (!translated) return;
  for (const [namespace, catalog] of Object.entries(translated)) {
    i18next.addResourceBundle(wanted, namespace, catalog, true, true);
  }
  await i18next.changeLanguage(wanted);
  document.documentElement.lang = wanted;
  document.documentElement.dir = getLanguageDirection(wanted);
}

export async function initPublicPagesI18n(): Promise<void> {
  const wanted = pickLanguage(readStoredLanguage());
  const translated = wanted === DEFAULT_LANGUAGE ? null : await loadCatalogs(wanted);
  const language = translated ? wanted : DEFAULT_LANGUAGE;
  document.documentElement.lang = language;
  document.documentElement.dir = getLanguageDirection(language);

  await i18next.use(initReactI18next).init({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    defaultNS: 'status',
    ns: [...NAMESPACES],
    resources: {
      en: { help: enHelp, changelog: enChangelog, status: enStatus, roadmap: enRoadmap, creators: enCreators },
      ...(translated ? { [language]: translated } : {}),
    },
    returnNull: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}
