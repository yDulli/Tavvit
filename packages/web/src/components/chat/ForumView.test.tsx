import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@backspace/shared';
import type { ForumPost, ForumPostsResponse, ForumTag } from '@backspace/shared/src/forums';
import { PermissionBits } from '../../utils/permissions';

const posts = vi.hoisted(() => vi.fn());
const createPost = vi.hoisted(() => vi.fn());
const permissions = vi.hoisted(() => ({ value: undefined as string | undefined }));
const openThreadView = vi.hoisted(() => vi.fn());

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));
vi.mock('../../stores/spaceStore', () => {
  const api = { forums: { posts, createPost } };
  const state = () => ({ channelPermissions: new Map(permissions.value ? [['forum', permissions.value]] : []) });
  return {
    getChannelOrigin: () => '',
    getApiForOrigin: () => api,
    useSpaceStore: (selector: (s: unknown) => unknown) => selector(state()),
  };
});
vi.mock('../../utils/openThread', () => ({ openThreadView }));

import { ForumView } from './ForumView';

const CHANNEL = { id: 'forum', spaceId: 's', name: 'questions', type: 'forum' } as Channel;
const TAGS: ForumTag[] = [{ id: 'bug', name: 'Bug', color: 'rose' }, { id: 'idea', name: 'Idea', color: 'mint' }];

const post = (id: string, name: string, tagIds: string[] = []): ForumPost => ({
  id, parentChannelId: 'forum', spaceId: 's', name, createdAt: 1, createdBy: 'u', messageCount: 1, lastMessageAt: 2,
  archived: false, starterMessageId: null, tagIds, author: null, preview: `About ${name}`, thumbnail: null,
} as ForumPost);

const answer = (...list: ForumPost[]): ForumPostsResponse => ({ tags: TAGS, posts: list, nextBefore: null });

const mayPost = () => {
  permissions.value = (PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES | PermissionBits.CREATE_THREADS).toString();
};

beforeEach(() => {
  posts.mockReset();
  createPost.mockReset();
  openThreadView.mockReset();
  permissions.value = undefined;
});

describe('a forum on screen', () => {
  it('lists its posts and opens one', async () => {
    posts.mockResolvedValue(answer(post('p1', 'First question', ['bug'])));
    render(<ForumView channel={CHANNEL} />);
    const row = await screen.findByRole('button', { name: /First question/ });
    expect(within(row).getByText('Bug')).toBeInTheDocument();
    expect(within(row).getByText('About First question')).toBeInTheDocument();
    fireEvent.click(row);
    expect(openThreadView).toHaveBeenCalledTimes(1);
  });

  it('asks the server again when a tag is chosen, and says so when nothing has it', async () => {
    posts.mockResolvedValue(answer(post('p1', 'First question', ['bug'])));
    render(<ForumView channel={CHANNEL} />);
    await screen.findByRole('button', { name: /First question/ });
    posts.mockResolvedValue(answer());
    fireEvent.click(screen.getByRole('button', { name: 'Idea', pressed: false }));
    await waitFor(() => expect(posts).toHaveBeenLastCalledWith('forum', { tag: 'idea' }));
    expect(await screen.findByText('No posts with this tag')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Idea', pressed: true })).toBeInTheDocument();
  });

  it('offers a new post only to who may start one', async () => {
    posts.mockResolvedValue(answer());
    const { unmount } = render(<ForumView channel={CHANNEL} />);
    await screen.findByText('No posts yet');
    expect(screen.queryByRole('button', { name: 'New post' })).not.toBeInTheDocument();
    unmount();
    mayPost();
    render(<ForumView channel={CHANNEL} />);
    expect(await screen.findByRole('button', { name: 'New post' })).toBeInTheDocument();
  });

  it('starts a post with a title, words and tags, and opens it', async () => {
    mayPost();
    posts.mockResolvedValue(answer());
    createPost.mockResolvedValue(post('p2', 'My question', ['idea']));
    render(<ForumView channel={CHANNEL} />);
    fireEvent.click(await screen.findByRole('button', { name: 'New post' }));
    const send = screen.getByRole('button', { name: 'Post' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  My question ' } });
    fireEvent.change(screen.getByLabelText("What's it about?"), { target: { value: 'Words' } });
    const inForm = send.closest('form');
    expect(inForm).not.toBeNull();
    fireEvent.click(within(inForm as HTMLElement).getByRole('button', { name: 'Idea', pressed: false }));
    fireEvent.click(send);
    await waitFor(() => expect(createPost).toHaveBeenCalledWith('forum', { title: 'My question', content: 'Words', tagIds: ['idea'] }));
    await waitFor(() => expect(openThreadView).toHaveBeenCalledTimes(1));
  });
});
