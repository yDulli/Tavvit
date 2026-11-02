import { create } from 'zustand';
import type { MentionItem, MessageWithUser } from '@backspace/shared';
import { getApiForOrigin } from '../utils/crossStoreResolvers';

/**
 * The inbox's mentions: per instance, the messages there that mention the
 * signed-in user (GET /api/users/@me/mentions), newest first.
 *
 * Each instance answers for its own spaces with the user's row there, so the
 * store keeps one list per origin ('' = home) and the inbox merges them.
 *
 * Sources: `loadOrigin()` when an origin's socket says `ready` (a fresh first
 * page, so a reconnect cannot leave gaps), `loadMore()` for older pages, and
 * the live socket: `addLive` for a new message that mentions the user,
 * `updateLive` and `removeLive` when one is edited or deleted. Whether an item
 * has been seen is not stored here: it is the channel's read position
 * (chatStore.readStates), the same fact the unread dots use.
 *
 * Imports no other store, so the socket handler and the pages read it without
 * import cycles.
 */

export type InboxStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface OriginMentions {
  items: MentionItem[];
  /** `before` for the next older page; null when there is none. */
  nextBefore: string | null;
  status: InboxStatus;
  /** An older page is being fetched. */
  loadingMore: boolean;
}

export interface InboxMention extends MentionItem {
  /** The instance that issued it ('' = home). */
  origin: string;
}

interface InboxState {
  byOrigin: Readonly<Record<string, OriginMentions>>;
  loadOrigin: (origin: string) => Promise<void>;
  loadMore: (origin: string) => Promise<void>;
  addLive: (origin: string, item: MentionItem) => void;
  updateLive: (origin: string, message: MessageWithUser) => void;
  removeLive: (origin: string, messageId: string) => void;
  dropOrigin: (origin: string) => void;
  reset: () => void;
}

/** First page per origin; enough for the badge and a screen of history. */
export const INBOX_PAGE = 30;

/** The latest load per origin; an answer for an older one, or a previous session, is dropped. */
const loadSeq = new Map<string, number>();
let session = 0;

function empty(): OriginMentions {
  return { items: [], nextBefore: null, status: 'idle', loadingMore: false };
}

export const useInboxStore = create<InboxState>((set, get) => ({
  byOrigin: {},

  loadOrigin: async (origin) => {
    const seq = (loadSeq.get(origin) ?? 0) + 1;
    loadSeq.set(origin, seq);
    const mySession = session;
    set((s) => ({ byOrigin: { ...s.byOrigin, [origin]: { ...(s.byOrigin[origin] ?? empty()), status: 'loading' } } }));
    try {
      const page = await getApiForOrigin(origin).inbox.mentions({ limit: INBOX_PAGE });
      if (mySession !== session || loadSeq.get(origin) !== seq) return;
      set((s) => ({
        byOrigin: { ...s.byOrigin, [origin]: { items: page.mentions, nextBefore: page.nextBefore, status: 'ready', loadingMore: false } },
      }));
    } catch (err) {
      if (mySession !== session || loadSeq.get(origin) !== seq) return;
      console.error('Failed to load mentions:', err);
      set((s) => ({ byOrigin: { ...s.byOrigin, [origin]: { ...(s.byOrigin[origin] ?? empty()), status: 'failed', loadingMore: false } } }));
    }
  },

  loadMore: async (origin) => {
    const current = get().byOrigin[origin];
    if (!current || current.nextBefore === null || current.loadingMore) return;
    const mySession = session;
    const before = current.nextBefore;
    set((s) => ({ byOrigin: { ...s.byOrigin, [origin]: { ...current, loadingMore: true } } }));
    try {
      const page = await getApiForOrigin(origin).inbox.mentions({ before, limit: INBOX_PAGE });
      if (mySession !== session) return;
      set((s) => {
        const now = s.byOrigin[origin] ?? empty();
        const known = new Set(now.items.map((item) => item.message.id));
        return {
          byOrigin: {
            ...s.byOrigin,
            [origin]: { ...now, items: [...now.items, ...page.mentions.filter((m) => !known.has(m.message.id))], nextBefore: page.nextBefore, loadingMore: false },
          },
        };
      });
    } catch (err) {
      if (mySession !== session) return;
      console.error('Failed to load older mentions:', err);
      set((s) => ({ byOrigin: { ...s.byOrigin, [origin]: { ...(s.byOrigin[origin] ?? empty()), loadingMore: false } } }));
    }
  },

  addLive: (origin, item) => set((s) => {
    const now = s.byOrigin[origin];
    // Before the first page has loaded there is nothing to add to: that page will carry it.
    if (!now || now.status !== 'ready') return s;
    if (now.items.some((m) => m.message.id === item.message.id)) return s;
    return { byOrigin: { ...s.byOrigin, [origin]: { ...now, items: [item, ...now.items] } } };
  }),

  updateLive: (origin, message) => set((s) => {
    const now = s.byOrigin[origin];
    if (!now || !now.items.some((m) => m.message.id === message.id)) return s;
    return { byOrigin: { ...s.byOrigin, [origin]: { ...now, items: now.items.map((m) => (m.message.id === message.id ? { ...m, message } : m)) } } };
  }),

  removeLive: (origin, messageId) => set((s) => {
    const now = s.byOrigin[origin];
    if (!now || !now.items.some((m) => m.message.id === messageId)) return s;
    return { byOrigin: { ...s.byOrigin, [origin]: { ...now, items: now.items.filter((m) => m.message.id !== messageId) } } };
  }),

  dropOrigin: (origin) => set((s) => {
    if (!(origin in s.byOrigin)) return s;
    const next = { ...s.byOrigin };
    delete next[origin];
    loadSeq.delete(origin);
    return { byOrigin: next };
  }),

  reset: () => {
    session += 1;
    loadSeq.clear();
    set({ byOrigin: {} });
  },
}));

const cache = new WeakMap<object, InboxMention[]>();

/** Every origin's mentions in one list, newest first. Memoised per store snapshot. */
export function selectAllMentions(state: Pick<InboxState, 'byOrigin'>): InboxMention[] {
  const hit = cache.get(state.byOrigin);
  if (hit) return hit;
  const all: InboxMention[] = [];
  for (const [origin, list] of Object.entries(state.byOrigin)) {
    for (const item of list.items) all.push({ ...item, origin });
  }
  all.sort((a, b) => b.message.createdAt - a.message.createdAt);
  cache.set(state.byOrigin, all);
  return all;
}
