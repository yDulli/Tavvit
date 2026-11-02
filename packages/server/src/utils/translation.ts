import {
  TRANSLATION_LIMITS,
  joinTranslation,
  longestIndex,
  primaryLanguage,
  splitForTranslation,
  type TranslateMessageResponse,
  type TranslationTarget,
} from '@backspace/shared/src/translation.js';
import { config } from '../config.js';

// A message is translated when a person asks, by a service the operator chose and named in
// the server's settings, never by an address anyone sends in (docs/systems/translation.md).

/** The provider said no, or did not answer. Nothing it said reaches the logs, nor do the words. */
export class TranslationFailed extends Error {
  constructor(readonly providerStatus: number | null) {
    super(`The translation service answered ${providerStatus ?? 'nothing'}`);
    this.name = 'TranslationFailed';
  }
}

const PROVIDER_TIMEOUT_MS = 12_000;
/** DeepL takes 50 texts to a request; the other takes as many, and this keeps one request small. */
const TEXTS_PER_REQUEST = 50;

interface ProviderAnswer {
  texts: string[];
  /** What the longest text was written in, when the provider could tell. */
  source: string | null;
}

export function translationAvailable(): boolean {
  return config.translation.provider !== 'none';
}

/** DeepL wants a region for two of them, and names the simplified script. */
function deeplTarget(target: TranslationTarget): string {
  if (target === 'en') return 'EN-US';
  if (target === 'pt') return 'PT-BR';
  if (target === 'zh') return 'ZH-HANS';
  return target.toUpperCase();
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw new TranslationFailed(null);
  }
  if (!response.ok) throw new TranslationFailed(response.status);
  try {
    return await response.json();
  } catch {
    throw new TranslationFailed(response.status);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function askDeepl(texts: readonly string[], target: TranslationTarget): Promise<ProviderAnswer> {
  const { deeplApiKey } = config.translation;
  // A key of the free plan says so at its end, and that plan has an address of its own.
  const host = deeplApiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const answer = await postJson(`${host}/v2/translate`, { authorization: `DeepL-Auth-Key ${deeplApiKey}` }, {
    text: texts,
    target_lang: deeplTarget(target),
    preserve_formatting: true,
    split_sentences: 'nonewlines',
  });
  const list = isRecord(answer) ? answer.translations : null;
  if (!Array.isArray(list) || list.length !== texts.length) throw new TranslationFailed(200);
  const out = list.map((entry: unknown) => (isRecord(entry) && typeof entry.text === 'string' ? entry.text : null));
  if (out.some((text) => text === null)) throw new TranslationFailed(200);
  const longest: unknown = list[longestIndex(texts)];
  const detected = isRecord(longest) ? longest.detected_source_language : null;
  return { texts: out as string[], source: typeof detected === 'string' ? detected : null };
}

async function askLibreTranslate(texts: readonly string[], target: TranslationTarget): Promise<ProviderAnswer> {
  const { libreUrl, libreApiKey } = config.translation;
  const answer = await postJson(`${libreUrl.replace(/\/+$/, '')}/translate`, {}, {
    q: texts,
    source: 'auto',
    target,
    format: 'text',
    ...(libreApiKey ? { api_key: libreApiKey } : {}),
  });
  const list = isRecord(answer) ? answer.translatedText : null;
  if (!Array.isArray(list) || list.length !== texts.length || list.some((text) => typeof text !== 'string')) {
    throw new TranslationFailed(200);
  }
  const detected: unknown = isRecord(answer) ? answer.detectedLanguage : null;
  const longest: unknown = Array.isArray(detected) ? detected[longestIndex(texts)] : detected;
  const language = isRecord(longest) ? longest.language : null;
  return { texts: list as string[], source: typeof language === 'string' ? language : null };
}

async function askProvider(texts: readonly string[], target: TranslationTarget): Promise<ProviderAnswer> {
  const ask = config.translation.provider === 'deepl' ? askDeepl : askLibreTranslate;
  const out: string[] = [];
  let source: string | null = null;
  let sourceLength = -1;
  for (let at = 0; at < texts.length; at += TEXTS_PER_REQUEST) {
    const chunk = texts.slice(at, at + TEXTS_PER_REQUEST);
    const answer = await ask(chunk, target);
    out.push(...answer.texts);
    const length = chunk[longestIndex(chunk)]?.length ?? 0;
    if (answer.source && length > sourceLength) {
      source = answer.source;
      sourceLength = length;
    }
  }
  return { texts: out, source };
}

/**
 * The last answers, in memory only: an announcement that many people read in their language
 * costs one request. A message's words are part of the key, so an edit asks again. They go with
 * a restart and hold nothing that is not in the message already.
 */
const CACHE_MAX = 500;
const answers = new Map<string, TranslateMessageResponse>();

/** Characters each person had translated today. Only what went to the provider counts. */
const spent = new Map<string, { day: number; chars: number }>();

const dayOf = (now: number): number => Math.floor(now / 86_400_000);

/** How many of today's characters this person has left. */
function charsLeft(userId: string, now: number): number {
  const entry = spent.get(userId);
  return entry && entry.day === dayOf(now) ? TRANSLATION_LIMITS.CHARS_PER_DAY - entry.chars : TRANSLATION_LIMITS.CHARS_PER_DAY;
}

function charge(userId: string, chars: number, now: number): void {
  const day = dayOf(now);
  // A person from an earlier day leaves here, so this stays as small as the people of one day.
  if (spent.size > 10_000) {
    for (const [id, entry] of spent) if (entry.day !== day) spent.delete(id);
  }
  const entry = spent.get(userId);
  spent.set(userId, { day, chars: (entry && entry.day === day ? entry.chars : 0) + chars });
}

export type TranslationOutcome =
  | { ok: true; answer: TranslateMessageResponse }
  | { ok: false; code: 'translation_limit_reached' };

/** Throws `TranslationFailed` when the provider does not come through. */
export async function translateContent(
  userId: string,
  messageId: string,
  content: string,
  target: TranslationTarget,
  now: number = Date.now(),
): Promise<TranslationOutcome> {
  const key = `${messageId}|${target}|${content}`;
  const known = answers.get(key);
  if (known) {
    // Used again: the entry goes to the back of the line of what is dropped first.
    answers.delete(key);
    answers.set(key, known);
    return { ok: true, answer: known };
  }

  const parts = splitForTranslation(content);
  const texts = parts.filter((part) => part.translate).map((part) => part.text);
  if (texts.length === 0) {
    return { ok: true, answer: { text: content, sourceLanguage: null, targetLanguage: target, sameLanguage: true } };
  }
  const chars = texts.reduce((sum, text) => sum + text.length, 0);
  if (chars > charsLeft(userId, now)) return { ok: false, code: 'translation_limit_reached' };

  const { texts: translated, source } = await askProvider(texts, target);
  charge(userId, chars, now);
  const sourceLanguage = source ? primaryLanguage(source) : null;
  const sameLanguage = sourceLanguage === target;
  const answer: TranslateMessageResponse = {
    text: sameLanguage ? content : joinTranslation(parts, translated),
    sourceLanguage,
    targetLanguage: target,
    sameLanguage,
  };
  answers.set(key, answer);
  if (answers.size > CACHE_MAX) {
    const oldest = answers.keys().next().value;
    if (oldest !== undefined) answers.delete(oldest);
  }
  return { ok: true, answer };
}

/** Test-only: forget what was translated and spent. */
export function __resetTranslationForTests(): void {
  answers.clear();
  spent.clear();
}
