import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Embed } from '@backspace/shared';
import type { BlueskyPost } from '@backspace/shared/src/bluesky';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { initI18n } from '../../../i18n';
import { useExternalMediaStore } from '../../../stores/externalMediaStore';
import { useUIStore } from '../../../stores/uiStore';
import { BlueskyEmbed } from './BlueskyEmbed';

// A Bluesky post in a message (docs/systems/embeds.md, "Bluesky posts"): its text at once, its
// pictures and video only after a yes to Bluesky's hosts, covered while labelled sensitive, and
// opening the viewer with the message's Reply and Forward beside them.

const THUMB = (n: number) => `https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkrei${n}`;
const FULL = (n: number) => `https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkrei${n}`;

const POST: BlueskyPost = {
  url: 'https://bsky.app/profile/bsky.app/post/3mzhhvhjfwk22',
  author: { did: 'did:plc:z72i7hdynmk6r22z27h6tvur', handle: 'bsky.app', displayName: 'Bluesky', avatar: null },
  text: [{ text: 'Read ' }, { text: 'the notes', href: 'https://example.org/notes' }],
  createdAt: 1_793_765_020_249,
  images: [1, 2, 3].map((n) => ({ thumb: THUMB(n), fullsize: FULL(n), alt: n === 1 ? 'A chart' : '', width: 400, height: 300 })),
  video: null,
  link: null,
  quote: {
    url: 'https://bsky.app/profile/toni.bsky.team/post/3mquoted',
    author: { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', handle: 'toni.bsky.team', displayName: 'Toni', avatar: null },
    text: [{ text: '1980s era Gurgel.' }],
    createdAt: 1_793_700_000_000,
    images: [],
  },
  replies: 0,
  reposts: 1_234,
  likes: 15_508,
  sensitive: false,
};

function embedOf(post: unknown): Embed {
  return {
    id: 'e1', messageId: 'm1', dmMessageId: null, url: 'https://bsky.app/profile/bsky.app/post/3mzhhvhjfwk22',
    embedType: 'post', provider: 'bluesky', title: 'Bluesky (@bsky.app)', description: 'Read the notes',
    image: null, embedUrl: null, width: null, height: null, color: null, createdAt: 1, post: post as BlueskyPost,
  };
}

beforeAll(async () => {
  await initI18n();
});

beforeEach(() => {
  useExternalMediaStore.setState({ alwaysAllow: false, allowedHosts: [] });
  useUIStore.getState().closeImagePreview();
});

afterEach(cleanup);

describe('a Bluesky post', () => {
  it('shows who wrote it and its text with its links at once, and its pictures only after a yes', () => {
    render(<BlueskyEmbed embed={embedOf(POST)} />);
    expect(screen.getByRole('article', { name: 'Post by Bluesky on Bluesky' })).toBeInTheDocument();
    expect(screen.getByText('@bsky.app')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the notes' })).toHaveAttribute('href', 'https://example.org/notes');
    expect(screen.getByLabelText('1234 reposts')).toBeInTheDocument();
    expect(screen.queryByLabelText(/repl/)).toBeNull();
    expect(document.querySelector('img[src^="https://cdn.bsky.app"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(useExternalMediaStore.getState().allowedHosts).toEqual(['cdn.bsky.app']);
    expect(document.querySelectorAll('img[src^="https://cdn.bsky.app/img/feed_thumbnail"]')).toHaveLength(3);
  });

  it('opens its pictures in the viewer, on the one clicked, with the message\'s Reply and Forward', () => {
    useExternalMediaStore.setState({ alwaysAllow: true });
    const onReply = vi.fn();
    const onForward = vi.fn();
    render(<BlueskyEmbed embed={embedOf(POST)} onReply={onReply} onForward={onForward} />);
    fireEvent.click(screen.getByRole('button', { name: 'Picture 2 of 3' }));
    const viewer = useUIStore.getState().mediaViewer!;
    expect(viewer.index).toBe(1);
    expect(viewer.items.map((item) => item.url)).toEqual([FULL(1), FULL(2), FULL(3)]);
    expect(viewer.items[0]).toMatchObject({ alt: 'A chart', pageUrl: POST.url, filename: 'bluesky-bsky.app-1' });
    expect(viewer.onReply).toBe(onReply);
    expect(viewer.onForward).toBe(onForward);
  });

  it('keeps pictures labelled sensitive covered, and fetches nothing, until asked to show them', () => {
    useExternalMediaStore.setState({ alwaysAllow: true });
    render(<BlueskyEmbed embed={embedOf({ ...POST, sensitive: true })} />);
    expect(document.querySelector('img[src^="https://cdn.bsky.app"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(document.querySelectorAll('img[src^="https://cdn.bsky.app"]').length).toBeGreaterThan(0);
  });

  it('shows the post it quotes as a card that opens on Bluesky', () => {
    render(<BlueskyEmbed embed={embedOf(POST)} />);
    expect(screen.getByRole('link', { name: 'Quoted post by Toni' })).toHaveAttribute('href', 'https://bsky.app/profile/toni.bsky.team/post/3mquoted');
  });

  it('draws nothing from another host that a peer slipped into a post, and is a plain preview when it is not one', () => {
    useExternalMediaStore.setState({ alwaysAllow: true });
    const { unmount } = render(<BlueskyEmbed embed={embedOf({ ...POST, images: [{ ...POST.images[0], thumb: 'https://evil.example/x.png' }] })} />);
    expect(document.querySelector('img[src^="https://evil.example"]')).toBeNull();
    unmount();
    render(<BlueskyEmbed embed={embedOf({ url: 'https://evil.example/post' })} />);
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText('Bluesky (@bsky.app)')).toBeInTheDocument();
  });
});
