import { joinTranslation, longestIndex, primaryLanguage, splitForTranslation, type TranslationTarget } from '@backspace/shared/src/translation';
import { isElectron } from '../platform/platform';

/**
 * The browser's own translator, which runs on the device (Chrome 138 and Edge 148 on a computer):
 * nothing leaves it, and it costs nobody anything. It needs a language pack the first time, which
 * the browser fetches from its maker. A browser without one, or one that cannot do this pair of
 * languages, answers null and the caller goes on to what else there is. The DOM's types do not
 * name these yet.
 */
interface DeviceTranslator {
  translate: (text: string) => Promise<string>;
}

type Monitor = (monitor: EventTarget) => void;

interface TranslatorApi {
  availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
  create: (options: { sourceLanguage: string; targetLanguage: string; monitor?: Monitor }) => Promise<DeviceTranslator>;
}

interface DeviceDetector {
  detect: (text: string) => Promise<ReadonlyArray<{ detectedLanguage?: string; confidence?: number }>>;
}

interface DetectorApi {
  availability: () => Promise<string>;
  create: (options?: { monitor?: Monitor }) => Promise<DeviceDetector>;
}

export interface DeviceTranslation {
  text: string;
  /** What it was written in, as far as the browser could tell. */
  source: string | null;
  same: boolean;
}

/** Below this the browser is guessing, and a guess at the language gives a translation that reads like one. */
const MIN_CONFIDENCE = 0.5;
/** How long a question may take. A browser can list these and never answer them. */
const ANSWER_LIMIT_MS = 6_000;
/** How long a language pack may take to say anything. Chrome took a minute over one and said nothing until the end. */
const SILENCE_LIMIT_MS = 180_000;

class NoAnswer extends Error {}

let detector: Promise<DeviceDetector> | null = null;
const translators = new Map<string, Promise<DeviceTranslator>>();
/** It stopped answering once: waiting for it again helps nobody, this window goes on without it. */
let silent = false;

/**
 * Electron has the names, from Chromium, but not what stands behind them: asking which pair of
 * languages it has never comes back (Electron 43), so the desktop app does not ask.
 */
function deviceApis(): { translator: TranslatorApi; detector: DetectorApi } | null {
  if (silent || isElectron()) return null;
  const scope = globalThis as unknown as { Translator?: TranslatorApi; LanguageDetector?: DetectorApi };
  if (!scope.Translator || !scope.LanguageDetector) return null;
  return { translator: scope.Translator, detector: scope.LanguageDetector };
}

function answered<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new NoAnswer()), ANSWER_LIMIT_MS);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Makes something that may have to fetch a language pack first, for as long as that keeps moving. */
function madeWhileMoving<T>(make: (monitor: Monitor) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer = setTimeout(() => reject(new NoAnswer()), SILENCE_LIMIT_MS);
    make((monitor) => {
      monitor.addEventListener('downloadprogress', () => {
        clearTimeout(timer);
        timer = setTimeout(() => reject(new NoAnswer()), SILENCE_LIMIT_MS);
      });
    }).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * Translates on this device, or says it cannot. `onDownload` says a language pack has to come
 * first, which a person should know, as it takes a while once. Starting that takes a click,
 * which the menu entry is.
 */
export async function translateOnDevice(
  content: string,
  target: TranslationTarget,
  onDownload: () => void,
): Promise<DeviceTranslation | null> {
  const apis = deviceApis();
  if (!apis) return null;
  const parts = splitForTranslation(content);
  const texts = parts.filter((part) => part.translate).map((part) => part.text);
  if (texts.length === 0) return { text: content, source: null, same: true };

  try {
    if (!detector) {
      if ((await answered(apis.detector.availability())) !== 'available') onDownload();
      detector = madeWhileMoving((monitor) => apis.detector.create({ monitor }));
    }
    const results = await answered((await detector).detect(texts[longestIndex(texts)] ?? ''));
    const best = results[0];
    if (!best?.detectedLanguage || best.detectedLanguage === 'und' || (best.confidence ?? 0) < MIN_CONFIDENCE) return null;
    const source = primaryLanguage(best.detectedLanguage);
    if (source === target) return { text: content, source, same: true };

    const pair = { sourceLanguage: source, targetLanguage: target };
    const availability = await answered(apis.translator.availability(pair));
    if (availability === 'unavailable') return null;
    if (availability !== 'available') onDownload();
    const key = `${source}>${target}`;
    let translator = translators.get(key);
    if (!translator) {
      translator = madeWhileMoving((monitor) => apis.translator.create({ ...pair, monitor }));
      translators.set(key, translator);
    }
    const ready = await translator;
    const translated: string[] = [];
    for (const text of texts) translated.push(await answered(ready.translate(text)));
    return { text: joinTranslation(parts, translated), source, same: false };
  } catch (error) {
    // Refused or failed, and the next try should start clean.
    detector = null;
    translators.clear();
    if (error instanceof NoAnswer) silent = true;
    return null;
  }
}

/** Test-only: forget what was created. */
export function __resetDeviceTranslationForTests(): void {
  detector = null;
  translators.clear();
  silent = false;
}
