/**
 * Reading a message in another language (docs/systems/translation.md).
 *
 * A message is more than words: code, links, mentions, emoji and the marks of a spoiler have
 * to come out exactly as they went in, and no translator can be trusted with them. So a
 * message is cut into the words, which go to a translator, and everything else, which does
 * not. The same cut serves the browser's own translator and the server's provider.
 */

/** What one person may have the server translate in a day, in characters. What was translated before is free. */
export const TRANSLATION_LIMITS = { CHARS_PER_DAY: 30_000 } as const;

/**
 * The languages a message can be read in: those the browser's models, DeepL and LibreTranslate
 * all have. Each is named in its own language, as a person looks for their own.
 */
export const TRANSLATION_TARGETS = [
  { code: 'ar', nativeName: 'العربية' },
  { code: 'bg', nativeName: 'Български' },
  { code: 'cs', nativeName: 'Čeština' },
  { code: 'da', nativeName: 'Dansk' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'el', nativeName: 'Ελληνικά' },
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },
  { code: 'fi', nativeName: 'Suomi' },
  { code: 'fr', nativeName: 'Français' },
  { code: 'hu', nativeName: 'Magyar' },
  { code: 'id', nativeName: 'Bahasa Indonesia' },
  { code: 'it', nativeName: 'Italiano' },
  { code: 'ja', nativeName: '日本語' },
  { code: 'ko', nativeName: '한국어' },
  { code: 'nl', nativeName: 'Nederlands' },
  { code: 'pl', nativeName: 'Polski' },
  { code: 'pt', nativeName: 'Português' },
  { code: 'ro', nativeName: 'Română' },
  { code: 'ru', nativeName: 'Русский' },
  { code: 'sv', nativeName: 'Svenska' },
  { code: 'tr', nativeName: 'Türkçe' },
  { code: 'uk', nativeName: 'Українська' },
  { code: 'zh', nativeName: '中文' },
] as const;

export type TranslationTarget = (typeof TRANSLATION_TARGETS)[number]['code'];

const TARGET_CODES: ReadonlySet<string> = new Set(TRANSLATION_TARGETS.map((target) => target.code));

export function isTranslationTarget(value: unknown): value is TranslationTarget {
  return typeof value === 'string' && TARGET_CODES.has(value);
}

/** `POST /api/messages/:id/translate` */
export interface TranslateMessageResponse {
  /** The message in the language asked for. The original when it was in that language already. */
  text: string;
  /** What it was written in, in small letters, when the provider could tell. */
  sourceLanguage: string | null;
  targetLanguage: TranslationTarget;
  sameLanguage: boolean;
}

/** `pt-BR`, `PT`, `zh-Hans`: the language alone, as two translators name it alike. */
export function primaryLanguage(code: string): string {
  return (code.split('-')[0] ?? code).toLowerCase();
}

/** A piece of a message: words to translate, or something that stays exactly as written. */
export interface TranslationPart {
  text: string;
  translate: boolean;
}

/**
 * What is not words. In order: code, a link with its address, a mention or a custom emoji, an
 * emoji's short name, a bare address, the marks of a spoiler, what opens a line of a list, a
 * quote or a heading, and the end of a line. A line stays a line this way, whatever a
 * translator does with line breaks.
 */
const KEPT = new RegExp([
  '```[\\s\\S]*?```',
  '`[^`\\n]+`',
  '\\[[^\\]\\n]*\\]\\([^)\\s]+\\)',
  '<(?:@&?|#|:[a-z0-9_]{2,32}:)[^>\\s]*>',
  '(?<![\\w:]):[a-z0-9_]{2,32}:(?![\\w:])',
  '@(?:everyone|here)\\b',
  'https?:\\/\\/[^\\s<>]+',
  '\\|\\|',
  '^[ \\t]*(?:[-*+]|\\d+[.)]|>+|#{1,6})[ \\t]+',
  '\\n',
].join('|'), 'gmu');

const HAS_WORDS = /\p{L}/u;

/** Keeps the spaces round some words out of what is translated, as a translator would drop them. */
function pushWords(parts: TranslationPart[], text: string): void {
  if (!text) return;
  const core = text.trim();
  if (!core || !HAS_WORDS.test(core)) {
    parts.push({ text, translate: false });
    return;
  }
  const start = text.indexOf(core);
  if (start > 0) parts.push({ text: text.slice(0, start), translate: false });
  parts.push({ text: core, translate: true });
  const end = start + core.length;
  if (end < text.length) parts.push({ text: text.slice(end), translate: false });
}

/** Read back in order, the parts give the message again, whatever it held. */
export function splitForTranslation(content: string): TranslationPart[] {
  const parts: TranslationPart[] = [];
  let at = 0;
  for (const match of content.matchAll(KEPT)) {
    pushWords(parts, content.slice(at, match.index));
    parts.push({ text: match[0], translate: false });
    at = match.index + match[0].length;
  }
  pushWords(parts, content.slice(at));
  return parts;
}

/** A translator may put spaces inside bold marks, which would end them being bold. */
function withTightMarks(text: string): string {
  return text.replace(/(\*\*|~~|__) +(?=\S)([^*~_\n]*?\S) +\1/g, '$1$2$1');
}

/** The parts again, with the translated words in place of the original ones, in their order. */
export function joinTranslation(parts: readonly TranslationPart[], translated: readonly string[]): string {
  let next = 0;
  return parts.map((part) => {
    if (!part.translate) return part.text;
    const words = translated[next];
    next += 1;
    return withTightMarks(words ?? part.text);
  }).join('');
}

/** The longest words: what a language is best told from. */
export function longestIndex(texts: readonly string[]): number {
  let best = 0;
  texts.forEach((text, index) => {
    if (text.length > (texts[best]?.length ?? 0)) best = index;
  });
  return best;
}

/**
 * The fallback where nothing here can translate: Google's own page with the words on it. It is
 * a link a person chooses to follow, so nothing leaves until then, and it leaves from their
 * browser. Addresses have a limit, so a long message goes as far as one will take.
 */
export function googleTranslateUrl(content: string, target: TranslationTarget): string {
  const words = splitForTranslation(content).map((part) => part.text).join('').slice(0, 1800);
  return `https://translate.google.com/?sl=auto&tl=${target}&op=translate&text=${encodeURIComponent(words)}`;
}
