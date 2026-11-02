import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enChangelog from '../locales/en/changelog.json';
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
const NAMESPACES = ['help', 'changelog', 'status', 'roadmap'] as const;
type Namespace = (typeof NAMESPACES)[number];

const catalogs = import.meta.glob<Record<string, unknown>>(
  [
    '../locales/*/help.json',
    '../locales/*/changelog.json',
    '../locales/*/status.json',
    '../locales/*/roadmap.json',
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
      en: { help: enHelp, changelog: enChangelog, status: enStatus, roadmap: enRoadmap },
      ...(translated ? { [language]: translated } : {}),
    },
    returnNull: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}
