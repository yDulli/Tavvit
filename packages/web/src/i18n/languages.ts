/**
 * The languages Backspace ships, and how a browser or stored preference is
 * mapped onto them. Adding a language is one entry here plus its catalogs
 * under `src/locales/<code>/`; see docs/systems/localization.md.
 */
export const supportedLanguages = [
  { code: 'en', nativeName: 'English', dir: 'ltr', released: true },
  // A new language starts with `released: false` so it can land surface by
  // surface without reaching users half translated; flip it in the release
  // PR once every surface is covered and the translation has been reviewed.
  { code: 'ru', nativeName: 'Русский', dir: 'ltr', released: true },
  { code: 'de', nativeName: 'Deutsch', dir: 'ltr', released: true },
  // Brazilian Portuguese. Detection sends every pt-* tag here, as with zh
  // below: a pt-PT reader gets Portuguese rather than English, and the picker
  // names the variant.
  { code: 'pt', nativeName: 'Português do Brasil', dir: 'ltr', released: true },
  // Simplified Chinese. Detection sends every zh-* tag here, Traditional
  // included: a zh-TW reader gets a script they can read rather than English,
  // and the picker names the variant so they know what they got.
  { code: 'zh', nativeName: '简体中文', dir: 'ltr', released: true },
] as const satisfies readonly { code: string; nativeName: string; dir: 'ltr' | 'rtl'; released: boolean }[];

export type SupportedLanguage = (typeof supportedLanguages)[number]['code'];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/** Kept from the community translation in PR #45 so its testers keep their choice. */
export const LANGUAGE_STORAGE_KEY = 'backspace-language';

export const supportedLanguageCodes: readonly SupportedLanguage[] = supportedLanguages.map((l) => l.code);

/** The languages users can pick. */
export const availableLanguages = supportedLanguages.filter((l) => l.released);

const releasedLanguageCodes: ReadonlySet<string> = new Set(availableLanguages.map((l) => l.code));

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (supportedLanguageCodes as readonly string[]).includes(value);
}

/**
 * The person's stored choice, otherwise English. The browser and the system are not
 * asked: Tavvit starts in English for everyone, and another language is something a
 * person picks. Only released languages are eligible; `released` exists so tests can
 * exercise the others.
 */
export function pickLanguage(
  stored: string | null,
  released: ReadonlySet<string> = releasedLanguageCodes,
): SupportedLanguage {
  return isSupportedLanguage(stored) && released.has(stored) ? stored : DEFAULT_LANGUAGE;
}

export function getLanguageDirection(language: SupportedLanguage): 'ltr' | 'rtl' {
  return supportedLanguages.find((l) => l.code === language)?.dir ?? 'ltr';
}

/**
 * `?lang=de` on the URL previews a language regardless of its `released`
 * flag, for translators and reviewers. Development builds only: in
 * production the release gate is the whole point.
 */
export function readPreviewLanguage(search: string, isDev: boolean): SupportedLanguage | null {
  if (!isDev) return null;
  const base = new URLSearchParams(search).get('lang')?.trim().toLowerCase().split('-')[0];
  return isSupportedLanguage(base) ? base : null;
}
