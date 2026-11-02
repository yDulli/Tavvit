import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForumPost, ForumPostsResponse } from '@backspace/shared/src/forums';
import type { ThreadSummary } from '@backspace/shared/src/threads';

const posts = vi.hoisted(() => vi.fn());

vi.mock('./spaceStore', () => ({
  getChannelOrigin: () => '',
  getApiForOrigin: () => ({ forums: { posts } }),
}));

import { useForumStore } from './forumStore';

const FORUM = 'forum-1';

const post = (id: string, lastMessageAt: number, tagIds: string[] = []): ForumPost => ({
  id, parentChannelId: FORUM, spaceId: 's', name: id, createdAt: 1, createdBy: 'u', messageCount: 1,
  lastMessageAt, archived: false, starterMessageId: null, tagIds, author: null, preview: '', thumbnail: null,
} as ForumPost);

const answer = (...list: ForumPost[]): ForumPostsResponse => ({ tags: [], posts: list, nextBefore: null });

const listed = () => useForumStore.getState().lists[FORUM]?.posts.map((entry) => entry.id);

beforeEach(() => {
  useForumStore.setState({ lists: {} });
  posts.mockReset();
});

describe('a forum\'s list', () => {
  it('loads with the filter asked for, and keeps it on the next load', async () => {
    posts.mockResolvedValue(answer(post('a', 5, ['bug'])));
    await useForumStore.getState().load(FORUM, 'bug');
    expect(posts).toHaveBeenLastCalledWith(FORUM, { tag: 'bug' });
    await useForumStore.getState().load(FORUM);
    expect(posts).toHaveBeenLastCalledWith(FORUM, { tag: 'bug' });
    await useForumStore.getState().load(FORUM, null);
    expect(posts).toHaveBeenLastCalledWith(FORUM, {});
  });

  it('does not take an old answer for the answer to a newer question', async () => {
    let answerOld: (value: ForumPostsResponse) => void = () => {};
    posts.mockReturnValueOnce(new Promise<ForumPostsResponse>((resolve) => { answerOld = resolve; }));
    const first = useForumStore.getState().load(FORUM, 'old');
    posts.mockResolvedValueOnce(answer(post('new', 5)));
    await useForumStore.getState().load(FORUM, 'new');
    answerOld(answer(post('old', 9)));
    await first;
    expect(listed()).toEqual(['new']);
  });

  it('brings a post up when something is said in it', async () => {
    posts.mockResolvedValue(answer(post('a', 9), post('b', 5)));
    await useForumStore.getState().load(FORUM, null);
    useForumStore.getState().applySummary(FORUM, { id: 'b', messageCount: 2, lastMessageAt: 20 } as ThreadSummary);
    expect(listed()).toEqual(['b', 'a']);
    expect(useForumStore.getState().lists[FORUM]?.posts[0]?.messageCount).toBe(2);
  });

  it('asks again for a post it has not seen, as the event does not hold all of it', async () => {
    posts.mockResolvedValue(answer(post('a', 9)));
    await useForumStore.getState().load(FORUM, null);
    posts.mockResolvedValue(answer(post('b', 20), post('a', 9)));
    useForumStore.getState().applySummary(FORUM, { id: 'b', messageCount: 1, lastMessageAt: 20 } as ThreadSummary);
    await vi.waitFor(() => expect(listed()).toEqual(['b', 'a']));
  });

  it('lets go of a post that lost the tag it is filtered by', async () => {
    posts.mockResolvedValue(answer(post('a', 9, ['bug']), post('b', 5, ['bug'])));
    await useForumStore.getState().load(FORUM, 'bug');
    useForumStore.getState().applySummary(FORUM, { id: 'a', tagIds: ['idea'] } as ThreadSummary);
    expect(listed()).toEqual(['b']);
  });

  it('adds a new post only where the filter lets it in, and once', async () => {
    posts.mockResolvedValue(answer(post('a', 9, ['bug'])));
    await useForumStore.getState().load(FORUM, 'bug');
    useForumStore.getState().addPost(FORUM, post('other', 30, ['idea']));
    useForumStore.getState().addPost(FORUM, post('mine', 30, ['bug']));
    useForumStore.getState().addPost(FORUM, post('mine', 30, ['bug']));
    expect(listed()).toEqual(['mine', 'a']);
  });

  it('goes through the pages without showing a post twice', async () => {
    posts.mockResolvedValueOnce({ ...answer(post('a', 9), post('b', 5)), nextBefore: '5:b' });
    await useForumStore.getState().load(FORUM, null);
    posts.mockResolvedValueOnce(answer(post('b', 5), post('c', 2)));
    await useForumStore.getState().loadMore(FORUM);
    expect(posts).toHaveBeenLastCalledWith(FORUM, { before: '5:b' });
    expect(listed()).toEqual(['a', 'b', 'c']);
    expect(useForumStore.getState().lists[FORUM]?.nextBefore).toBeNull();
  });

  it('says what went wrong and keeps nothing once it left the screen', async () => {
    posts.mockRejectedValue(new Error('no'));
    await useForumStore.getState().load(FORUM, null);
    expect(useForumStore.getState().lists[FORUM]?.error).not.toBe('');
    useForumStore.getState().forget(FORUM);
    expect(useForumStore.getState().lists[FORUM]).toBeUndefined();
  });
});
