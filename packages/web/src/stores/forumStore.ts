import { create } from 'zustand';
import type { ForumPost, ForumTag } from '@backspace/shared/src/forums';
import type { ThreadSummary } from '@backspace/shared/src/threads';
import { describeError } from '../i18n/errors';
import { getApiForOrigin, getChannelOrigin } from './spaceStore';

/** The list of a forum someone has open: what `GET /channels/:id/posts` said, kept up to date by events. */
export interface ForumList {
  tags: ForumTag[];
  posts: ForumPost[];
  nextBefore: string | null;
  /** The tag the list is filtered by. */
  tagId: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string;
}

const EMPTY_LIST: ForumList = { tags: [], posts: [], nextBefore: null, tagId: null, loading: true, loadingMore: false, error: '' };

/** The latest activity first; among equals the newer post. Ids are numbers too long for a number. */
function byActivity(a: ForumPost, b: ForumPost): number {
  const difference = (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt);
  if (difference !== 0) return difference;
  return b.id.length - a.id.length || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0);
}

interface ForumState {
  lists: Readonly<Record<string, ForumList>>;
  /** Fetches the first page, with this tag or without one. */
  load: (channelId: string, tagId?: string | null) => Promise<void>;
  loadMore: (channelId: string) => Promise<void>;
  /** The forum left the screen: nothing keeps it up to date from here on. */
  forget: (channelId: string) => void;
  addPost: (channelId: string, post: ForumPost) => void;
  applySummary: (channelId: string, summary: ThreadSummary) => void;
  removePost: (channelId: string, threadId: string) => void;
  setTags: (channelId: string, tags: ForumTag[]) => void;
}

/** So an answer that comes after a newer question is not taken for the answer to it. */
const latestRequest = new Map<string, number>();

export const useForumStore = create<ForumState>((set, get) => {
  const patch = (channelId: string, change: (list: ForumList) => ForumList) => set((state) => {
    const list = state.lists[channelId];
    return list ? { lists: { ...state.lists, [channelId]: change(list) } } : state;
  });

  return {
    lists: {},

    load: async (channelId, tagId) => {
      const known = get().lists[channelId];
      const wanted = tagId === undefined ? known?.tagId ?? null : tagId;
      const request = (latestRequest.get(channelId) ?? 0) + 1;
      latestRequest.set(channelId, request);
      set((state) => ({
        lists: {
          ...state.lists,
          // A filter that changes shows it is working; the same list asked for again stays on screen.
          [channelId]: { ...(known ?? EMPTY_LIST), tagId: wanted, loading: !known || known.tagId !== wanted, error: '' },
        },
      }));
      try {
        const response = await getApiForOrigin(getChannelOrigin(channelId)).forums.posts(channelId, wanted ? { tag: wanted } : {});
        if (latestRequest.get(channelId) !== request) return;
        patch(channelId, (list) => ({ ...list, ...response, loading: false }));
      } catch (err) {
        if (latestRequest.get(channelId) !== request) return;
        patch(channelId, (list) => ({ ...list, loading: false, error: describeError(err) }));
      }
    },

    loadMore: async (channelId) => {
      const list = get().lists[channelId];
      if (!list?.nextBefore || list.loadingMore) return;
      const { nextBefore, tagId } = list;
      patch(channelId, (current) => ({ ...current, loadingMore: true }));
      try {
        const response = await getApiForOrigin(getChannelOrigin(channelId)).forums.posts(channelId, { ...(tagId ? { tag: tagId } : {}), before: nextBefore });
        patch(channelId, (current) => {
          const seen = new Set(current.posts.map((post) => post.id));
          return {
            ...current,
            posts: [...current.posts, ...response.posts.filter((post) => !seen.has(post.id))],
            nextBefore: response.nextBefore,
            loadingMore: false,
          };
        });
      } catch (err) {
        patch(channelId, (current) => ({ ...current, loadingMore: false, error: describeError(err) }));
      }
    },

    forget: (channelId) => set((state) => {
      if (!state.lists[channelId]) return state;
      const lists = { ...state.lists };
      delete lists[channelId];
      latestRequest.delete(channelId);
      return { lists };
    }),

    addPost: (channelId, post) => patch(channelId, (list) => (
      list.posts.some((known) => known.id === post.id) || (list.tagId && !post.tagIds.includes(list.tagId))
        ? list
        : { ...list, posts: [post, ...list.posts].sort(byActivity) }
    )),

    applySummary: (channelId, summary) => {
      const list = get().lists[channelId];
      if (!list) return;
      if (!list.posts.some((post) => post.id === summary.id)) {
        // A post this list has not seen: someone just started it. The list asks once and has all of it.
        void get().load(channelId);
        return;
      }
      patch(channelId, (current) => ({
        ...current,
        posts: current.posts
          .map((post) => (post.id === summary.id ? { ...post, ...summary, tagIds: summary.tagIds ?? post.tagIds } : post))
          // A post that lost the tag this list is filtered by goes from it.
          .filter((post) => !current.tagId || post.tagIds.includes(current.tagId))
          .sort(byActivity),
      }));
    },

    removePost: (channelId, threadId) => patch(channelId, (list) => ({
      ...list,
      posts: list.posts.filter((post) => post.id !== threadId),
    })),

    setTags: (channelId, tags) => patch(channelId, (list) => ({
      ...list,
      tags,
      // The tag the list is filtered by may be the one that went.
      tagId: list.tagId && tags.some((tag) => tag.id === list.tagId) ? list.tagId : null,
    })),
  };
});
