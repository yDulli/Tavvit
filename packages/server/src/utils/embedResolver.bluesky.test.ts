import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import type { BlueskyPost } from '@backspace/shared/src/bluesky.js';
import * as schema from '../db/schema.js';
import { setWorkerId } from './snowflake.js';

setWorkerId(9);

// A message linking to a Bluesky post (docs/systems/embeds.md, "Bluesky posts"): the post becomes
// a card kept in `embeds.data`; one Bluesky withdrew gets no card; one it cannot give becomes an
// ordinary preview of its page.

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));

const sent = vi.hoisted(() => [] as unknown[][]);
vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToChannel: (...args: unknown[]) => { sent.push(args); },
    sendToDmMembers: (...args: unknown[]) => { sent.push(args); },
  },
}));

const readBlueskyPost = vi.hoisted(() => vi.fn());
vi.mock('./bluesky.js', () => ({ readBlueskyPost }));
const fetchUrlMetadata = vi.hoisted(() => vi.fn());
vi.mock('./metadataFetcher.js', () => ({ fetchUrlMetadata }));

import { embedRowToEmbed, resolveEmbeds } from './embedResolver.js';

const POST: BlueskyPost = {
  url: 'https://bsky.app/profile/bsky.app/post/3mzhhvhjfwk22',
  author: { did: 'did:plc:z72i7hdynmk6r22z27h6tvur', handle: 'bsky.app', displayName: 'Bluesky', avatar: null },
  text: [{ text: 'Traffic is up' }],
  createdAt: 1_793_765_020_249,
  images: [{ thumb: 'https://cdn.bsky.app/img/t', fullsize: 'https://cdn.bsky.app/img/f', alt: 'A chart', width: 2328, height: 1570 }],
  video: null,
  link: null,
  quote: null,
  replies: 1,
  reposts: 2,
  likes: 3,
  sensitive: false,
};
const LINK = 'https://bsky.app/profile/bsky.app/post/3mzhhvhjfwk22';

beforeEach(() => {
  sent.length = 0;
  readBlueskyPost.mockReset();
  fetchUrlMetadata.mockReset();
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve('drizzle') });
  db.insert(schema.users).values({ id: 'u1', username: 'mara', passwordHash: 'x', createdAt: 1 }).run();
  db.insert(schema.spaces).values({ id: 's1', name: 'Night Shift', ownerId: 'u1', createdAt: 1 }).run();
  db.insert(schema.channels).values({ id: 'c1', spaceId: 's1', name: 'general', type: 'text', createdAt: 1 }).run();
  db.insert(schema.messages).values({ id: 'm1', channelId: 'c1', userId: 'u1', content: LINK, createdAt: 2 }).run();
});

const rows = () => db.select().from(schema.embeds).all();

describe('a link to a post on Bluesky', () => {
  it('becomes a card, with a plain preview beside it for clients that draw no posts', async () => {
    readBlueskyPost.mockResolvedValueOnce(POST);
    await resolveEmbeds('m1', `Look: ${LINK}`, 'c1', false, 's1');
    expect(readBlueskyPost).toHaveBeenCalledWith({ actor: 'bsky.app', rkey: '3mzhhvhjfwk22' });
    expect(fetchUrlMetadata).not.toHaveBeenCalled();
    const [row] = rows();
    expect(row).toMatchObject({
      embedType: 'post',
      provider: 'bluesky',
      title: 'Bluesky (@bsky.app)',
      description: 'Traffic is up',
      image: 'https://cdn.bsky.app/img/t',
      width: 2328,
      height: 1570,
    });
    expect(embedRowToEmbed(row!).post).toEqual(POST);
    expect(sent).toEqual([['s1', 'c1', expect.objectContaining({ type: 'embeds_resolved', embeds: [expect.objectContaining({ post: POST })] })]]);
  });

  it('gets no card at all when Bluesky withdrew the post', async () => {
    readBlueskyPost.mockResolvedValueOnce('hidden');
    await resolveEmbeds('m1', LINK, 'c1', false, 's1');
    expect(rows()).toEqual([]);
    expect(fetchUrlMetadata).not.toHaveBeenCalled();
  });

  it('becomes an ordinary preview of its page when Bluesky cannot give the post', async () => {
    readBlueskyPost.mockResolvedValueOnce(null);
    fetchUrlMetadata.mockResolvedValueOnce({ title: 'Bluesky', description: 'Social media as it should be', image: null, siteName: 'Bluesky', url: LINK });
    await resolveEmbeds('m1', LINK, 'c1', false, 's1');
    expect(rows()).toEqual([expect.objectContaining({ embedType: 'generic', provider: null, title: 'Bluesky', data: null })]);
    expect(embedRowToEmbed(rows()[0]!).post).toBeUndefined();
  });

  it('shows nothing of a stored post that does not hold, as anything arriving is read', () => {
    db.insert(schema.embeds).values({
      id: 'e1', messageId: 'm1', url: LINK, embedType: 'post', provider: 'bluesky', title: 'x', createdAt: 3,
      data: JSON.stringify({ ...POST, url: 'https://evil.example/profile/bsky.app/post/3mzhhvhjfwk22' }),
    }).run();
    expect(embedRowToEmbed(rows()[0]!).post).toBeUndefined();
  });
});
