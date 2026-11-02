/**
 * The matching and ranking behind the quick switcher (Ctrl/Cmd+K).
 *
 * Pure: the component gathers what exists (conversations, friends, spaces,
 * channels, pages) into `SwitcherItem`s, and this file decides which of them a
 * typed query means and in what order. Matching is forgiving the way a person
 * types: case and accents are ignored, every word of the query has to be found,
 * a word at the start of a name beats a word in the middle, and letters spread
 * over a name ("gnt" for "Game Night") still count, weakest of all.
 */

import type { ChannelType } from '@backspace/shared';

export type SwitcherKind = 'dm' | 'friend' | 'space' | 'channel' | 'page';

export interface SwitcherItem {
  /** Unique within one list; the React key. */
  id: string;
  kind: SwitcherKind;
  /** The name shown. */
  label: string;
  /** A second, quieter line: the space a channel is in, a username, ... */
  detail?: string;
  /** Extra text that should find the item without being shown. */
  keywords?: string;
  /** Something is waiting there. Unread items rank first on an empty query. */
  unread?: boolean;
  /** When there was last activity (ms); newer first among equals. */
  recency?: number;
  /** Where choosing the item goes; the component interprets it. */
  target: SwitcherTarget;
  /** A channel's type and the icon its space gave it, which stand in for the kind's icon. */
  channel?: { type: ChannelType; icon: string | null };
}

export type SwitcherTarget =
  | { type: 'route'; path: string }
  | { type: 'friend'; key: string }
  | { type: 'settings' };

/** Lowercase, accents removed, so "Müller" is found by "muller". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const SCORE_EXACT = 100;
const SCORE_PREFIX = 80;
const SCORE_WORD_START = 60;
const SCORE_SUBSTRING = 40;
const SCORE_SUBSEQUENCE = 15;

/** Whether `needle`'s letters appear in `haystack` in order (not necessarily together). */
function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const ch of haystack) {
    if (ch === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
}

/** How well one word of the query matches `text` (already folded). 0 is no match. */
function scoreWord(word: string, text: string): number {
  if (text === word) return SCORE_EXACT;
  if (text.startsWith(word)) return SCORE_PREFIX;
  const index = text.indexOf(word);
  if (index > 0) {
    const before = text[index - 1] ?? '';
    return /[^a-z0-9]/.test(before) ? SCORE_WORD_START : SCORE_SUBSTRING;
  }
  // A subsequence match for very short words would match nearly everything.
  if (word.length >= 3 && isSubsequence(word, text)) return SCORE_SUBSEQUENCE;
  return 0;
}

/**
 * How well `query` matches an item, or 0 when it does not. Every word must match
 * the label, the detail or the keywords; the label counts the most.
 */
export function scoreItem(query: string, item: Pick<SwitcherItem, 'label' | 'detail' | 'keywords'>): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const label = fold(item.label);
  const detail = fold(item.detail ?? '');
  const keywords = fold(item.keywords ?? '');
  let total = 0;
  for (const word of words) {
    const inLabel = scoreWord(word, label);
    const inOther = Math.max(scoreWord(word, detail), scoreWord(word, keywords)) * 0.5;
    const best = Math.max(inLabel, inOther);
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Which kinds come first when scores tie, and on an empty query. */
const KIND_ORDER: Record<SwitcherKind, number> = { dm: 0, channel: 1, friend: 2, space: 3, page: 4 };

function unreadFirst(a: SwitcherItem, b: SwitcherItem): number {
  return Number(b.unread === true) - Number(a.unread === true);
}

function byRecencyThenName(a: SwitcherItem, b: SwitcherItem): number {
  const recent = (b.recency ?? 0) - (a.recency ?? 0);
  if (recent !== 0) return recent;
  return a.label.localeCompare(b.label);
}

/**
 * The items for `query`, best first, at most `limit`. An empty query returns the
 * likeliest destinations: what is unread, then what was used last.
 */
export function rankSwitcherItems(items: readonly SwitcherItem[], query: string, limit: number): SwitcherItem[] {
  if (fold(query).trim() === '') {
    return [...items]
      .sort((a, b) => unreadFirst(a, b) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byRecencyThenName(a, b))
      .slice(0, limit);
  }
  return items
    .map((item) => ({ item, score: scoreItem(query, item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) =>
      b.score - a.score
      || unreadFirst(a.item, b.item)
      || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind]
      || byRecencyThenName(a.item, b.item))
    .slice(0, limit)
    .map((entry) => entry.item);
}

/** How the shortcut is written for this platform: "⌘ K" on a Mac, "Ctrl K" elsewhere. */
export function switcherShortcut(platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘ K' : 'Ctrl K';
}
