import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blueskyPostOf,
  blueskyVideoAddress,
  parseBlueskyPostUrl,
} from '@backspace/shared/src/bluesky.js';

// Posts on Bluesky in a message (docs/systems/embeds.md, "Bluesky posts"): which links name one,
// how the server reads one from Bluesky's public interface, and that nothing in a post can make a
// client fetch from a host that is not Bluesky's own.

const safeFetch = vi.hoisted(() => vi.fn());
vi.mock('./ssrf.js', () => ({ safeFetch }));

import { fetchBlueskyPicture, postFromView, readBlueskyPost, textParts } from './bluesky.js';

const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';
const CDN = 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreia';
const AVATAR = 'https://cdn.bsky.app/img/avatar/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreib';

function view(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uri: `at://${DID}/app.bsky.feed.post/3mzhhvhjfwk22`,
    author: { did: DID, handle: 'bsky.app', displayName: 'Bluesky', avatar: AVATAR },
    record: { $type: 'app.bsky.feed.post', text: 'Hello', createdAt: '2026-11-04T05:03:40.249Z' },
    replyCount: 3,
    repostCount: 2,
    likeCount: 1,
    labels: [],
    ...overrides,
  };
}

describe('the links that name a post', () => {
  it.each([
    ['https://bsky.app/profile/bsky.app/post/3mzhhvhjfwk22', 'bsky.app'],
    ['https://www.bsky.app/profile/Bsky.App/post/3mzhhvhjfwk22/', 'bsky.app'],
    [`https://bsky.app/profile/${DID}/post/3mzhhvhjfwk22`, DID],
  ])('reads %s', (url, actor) => {
    expect(parseBlueskyPostUrl(url)).toEqual({ actor, rkey: '3mzhhvhjfwk22' });
  });

  it.each([
    'https://bsky.app/profile/bsky.app',
    'https://bsky.app/profile/bsky.app/post/',
    'https://evil.example/profile/bsky.app/post/3mzhhvhjfwk22',
    'https://bsky.app.evil.example/profile/bsky.app/post/3mzhhvhjfwk22',
    'https://bsky.app:8443/profile/bsky.app/post/3mzhhvhjfwk22',
    'https://user:pass@bsky.app/profile/bsky.app/post/3mzhhvhjfwk22',
    'https://bsky.app/profile/not a handle/post/3mzhhvhjfwk22',
    'https://bsky.app/profile/bsky.app/post/..',
    'javascript:alert(1)',
  ])('leaves %s alone', (url) => {
    expect(parseBlueskyPostUrl(url)).toBeNull();
  });
});

describe('a post as it arrives', () => {
  const stored = {
    url: 'https://bsky.app/profile/bsky.app/post/3mzhhvhjfwk22',
    author: { did: DID, handle: 'bsky.app', displayName: 'Bluesky', avatar: AVATAR },
    text: [{ text: 'See ' }, { text: 'this', href: 'https://example.org/a' }],
    createdAt: 1_793_765_020_249,
    images: [{ thumb: CDN, fullsize: CDN, alt: 'A chart', width: 2328, height: 1570 }],
    video: null,
    link: null,
    quote: null,
    replies: 3,
    reposts: 2,
    likes: 1,
    sensitive: false,
  };

  it('keeps a post that names only Bluesky\'s hosts', () => {
    expect(blueskyPostOf(stored)).toEqual(stored);
  });

  it('drops every address on another host, and a post that is not on Bluesky at all', () => {
    const post = blueskyPostOf({
      ...stored,
      author: { ...stored.author, avatar: 'https://evil.example/a.png' },
      images: [stored.images[0], { ...stored.images[0], thumb: 'https://evil.example/b.png' }],
      video: { playlist: 'https://evil.example/v.m3u8', thumbnail: null, alt: '', width: 1, height: 1, loops: false },
      link: { url: 'javascript:alert(1)', title: 'x', description: '', thumb: null },
      text: [{ text: 'bad', href: 'javascript:alert(1)' }],
      likes: -4,
    });
    expect(post?.author.avatar).toBeNull();
    expect(post?.images).toHaveLength(1);
    expect(post?.video).toBeNull();
    expect(post?.link).toBeNull();
    expect(post?.text).toEqual([{ text: 'bad' }]);
    expect(post?.likes).toBe(0);
    expect(blueskyPostOf({ ...stored, url: 'https://evil.example/profile/bsky.app/post/3mzhhvhjfwk22' })).toBeNull();
  });

  it('plays a video from Bluesky\'s video host and its CDN only', () => {
    expect(blueskyVideoAddress('https://video.bsky.app/watch/x/playlist.m3u8')).not.toBeNull();
    expect(blueskyVideoAddress('https://video.cdn.bsky.app/hls/x/playlist.m3u8')).not.toBeNull();
    expect(blueskyVideoAddress('https://video.evil.example/watch/x/playlist.m3u8')).toBeNull();
  });
});

describe('a post\'s text', () => {
  it('turns links, mentions and hashtags into links, counting bytes as Bluesky does', () => {
    const text = '🦋 hi @alice.bsky.social #tavvit example.org';
    const at = (part: string) => Buffer.byteLength(text.slice(0, text.indexOf(part)), 'utf8');
    const span = (part: string) => ({ byteStart: at(part), byteEnd: at(part) + Buffer.byteLength(part, 'utf8') });
    const parts = textParts(text, [
      { index: span('@alice.bsky.social'), features: [{ $type: 'app.bsky.richtext.facet#mention', did: DID }] },
      { index: span('#tavvit'), features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tavvit' }] },
      { index: span('example.org'), features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.org' }] },
    ]);
    expect(parts).toEqual([
      { text: '🦋 hi ' },
      { text: '@alice.bsky.social', href: `https://bsky.app/profile/${DID}` },
      { text: ' ' },
      { text: '#tavvit', href: 'https://bsky.app/hashtag/tavvit' },
      { text: ' ' },
      { text: 'example.org', href: 'https://example.org/' },
    ]);
  });

  it('leaves as plain text a facet inside a character, past the end, over another, or to a script', () => {
    const text = '🦋 abc';
    expect(textParts(text, [
      { index: { byteStart: 1, byteEnd: 3 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.org' }] },
      { index: { byteStart: 5, byteEnd: 99 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.org' }] },
      { index: { byteStart: 5, byteEnd: 7 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert(1)' }] },
    ])).toEqual([{ text }]);
    expect(textParts(text, [
      { index: { byteStart: 5, byteEnd: 7 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://a.example' }] },
      { index: { byteStart: 6, byteEnd: 8 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://b.example' }] },
    ])).toEqual([{ text: '🦋 ' }, { text: 'ab', href: 'https://a.example/' }, { text: 'c' }]);
  });
});

describe('Bluesky\'s view of a post', () => {
  it('keeps its pictures with their descriptions and sizes', () => {
    const post = postFromView(view({
      embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: CDN, fullsize: CDN, alt: 'A chart', aspectRatio: { width: 4, height: 3 } }] },
    }));
    expect(post).toMatchObject({
      url: 'https://bsky.app/profile/bsky.app/post/3mzhhvhjfwk22',
      author: { handle: 'bsky.app', displayName: 'Bluesky', avatar: AVATAR },
      text: [{ text: 'Hello' }],
      images: [{ thumb: CDN, fullsize: CDN, alt: 'A chart', width: 4, height: 3 }],
      replies: 3,
      reposts: 2,
      likes: 1,
      sensitive: false,
    });
  });

  it('keeps a video, and a GIF as one that loops', () => {
    const post = postFromView(view({
      embed: {
        $type: 'app.bsky.embed.video#view',
        playlist: 'https://video.bsky.app/watch/x/playlist.m3u8',
        thumbnail: 'https://video.bsky.app/watch/x/thumbnail.jpg',
        aspectRatio: { width: 16, height: 9 },
        presentation: 'gif',
      },
    }));
    expect(post).toMatchObject({ video: { playlist: 'https://video.bsky.app/watch/x/playlist.m3u8', width: 16, height: 9, loops: true } });
  });

  it('keeps a link card, and a quoted post with its pictures', () => {
    const quoted = {
      $type: 'app.bsky.embed.record#viewRecord',
      uri: `at://${DID}/app.bsky.feed.post/3mquoted`,
      author: { did: DID, handle: 'bsky.app', displayName: null },
      value: { text: 'Quoted', createdAt: '2026-11-03T12:00:00.000Z' },
      embeds: [{ $type: 'app.bsky.embed.images#view', images: [{ thumb: CDN, fullsize: CDN, alt: '' }] }],
    };
    const post = postFromView(view({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia#view',
        record: { record: quoted },
        media: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://example.org/story', title: 'A story', description: 'About it', thumb: CDN } },
      },
    }));
    expect(post).toMatchObject({
      link: { url: 'https://example.org/story', title: 'A story', thumb: CDN },
      quote: { url: 'https://bsky.app/profile/bsky.app/post/3mquoted', text: [{ text: 'Quoted' }], images: [{ thumb: CDN }] },
    });
  });

  it('shows no quote of something that is not a post, or that is gone', () => {
    expect(postFromView(view({ embed: { $type: 'app.bsky.embed.record#view', record: { $type: 'app.bsky.graph.defs#starterPackViewBasic' } } })))
      .toMatchObject({ quote: null });
    expect(postFromView(view({ embed: { $type: 'app.bsky.embed.record#view', record: { $type: 'app.bsky.embed.record#viewNotFound' } } })))
      .toMatchObject({ quote: null });
  });

  it('covers a post labelled sensitive, and withdraws one Bluesky withdrew', () => {
    expect(postFromView(view({ labels: [{ val: 'sexual' }] }))).toMatchObject({ sensitive: true });
    expect(postFromView(view({ labels: [{ val: '!hide' }] }))).toBe('hidden');
    expect(postFromView(view({ author: { did: DID, handle: 'bsky.app', labels: [{ val: '!takedown' }] } }))).toBe('hidden');
  });

  it('is nothing when it is not a post view', () => {
    expect(postFromView({ uri: 'at://x/app.bsky.feed.like/1' })).toBeNull();
    expect(postFromView(null)).toBeNull();
  });
});

describe('reading a post from Bluesky', () => {
  beforeEach(() => safeFetch.mockReset());

  it('finds the account behind a handle, then the post, from the public interface only', async () => {
    safeFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ did: DID })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ posts: [view()] })));
    const post = await readBlueskyPost({ actor: 'bsky.app', rkey: '3mzhhvhjfwk22' });
    expect(post).toMatchObject({ author: { did: DID }, text: [{ text: 'Hello' }] });
    const asked = safeFetch.mock.calls.map(([url]) => new URL(url as string));
    expect(asked.map((url) => url.origin)).toEqual(['https://public.api.bsky.app', 'https://public.api.bsky.app']);
    expect(asked[0]!.searchParams.get('handle')).toBe('bsky.app');
    expect(asked[1]!.searchParams.get('uris')).toBe(`at://${DID}/app.bsky.feed.post/3mzhhvhjfwk22`);
  });

  it('is nothing when Bluesky does not answer with the post', async () => {
    safeFetch.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    expect(await readBlueskyPost({ actor: 'nobody.bsky.social', rkey: '3abc' })).toBeNull();
    safeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ posts: [] })));
    expect(await readBlueskyPost({ actor: DID, rkey: '3abc' })).toBeNull();
  });

  it('fetches a picture for Copy and Save only when it is an image', async () => {
    safeFetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
    expect(await fetchBlueskyPicture(CDN)).toEqual({ type: 'image/jpeg', bytes: Buffer.from([1, 2, 3]) });
    safeFetch.mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect(await fetchBlueskyPicture(CDN)).toBeNull();
  });
});
