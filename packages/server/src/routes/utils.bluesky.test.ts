import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// `GET /api/embeds/bluesky-picture` (docs/systems/embeds.md, "Bluesky posts"): one picture of a
// Bluesky post, fetched by this server for someone copying or saving it. Only signed in, only from
// Bluesky's picture host, only an image.

vi.mock('../utils/auth.js', () => ({
  authenticate: async (request: { userId?: string; headers: Record<string, string | undefined> }, reply: { code: (code: number) => { send: (body: unknown) => void } }) => {
    if (!request.headers.authorization) return reply.code(401).send({ code: 'unauthorized' });
    request.userId = 'u1';
  },
}));

const fetchBlueskyPicture = vi.hoisted(() => vi.fn());
vi.mock('../utils/bluesky.js', () => ({ fetchBlueskyPicture }));
vi.mock('../utils/metadataFetcher.js', () => ({ fetchUrlMetadata: vi.fn() }));

import { utilRoutes } from './utils.js';

const PICTURE = 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreia';
let app: FastifyInstance;

beforeEach(async () => {
  fetchBlueskyPicture.mockReset();
  app = Fastify({ logger: false });
  await app.register(utilRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const get = (url: string, signedIn = true) => app.inject({ method: 'GET', url, headers: signedIn ? { authorization: 'u1' } : {} });
const route = (address: string) => `/api/embeds/bluesky-picture?url=${encodeURIComponent(address)}`;

describe('a picture of a Bluesky post, for Copy and Save', () => {
  it('is only for someone signed in', async () => {
    expect((await get(route(PICTURE), false)).statusCode).toBe(401);
    expect(fetchBlueskyPicture).not.toHaveBeenCalled();
  });

  it('is only ever fetched from Bluesky\'s picture host', async () => {
    for (const address of ['https://evil.example/a.png', 'http://cdn.bsky.app/img/a', 'https://video.bsky.app/watch/x/thumbnail.jpg', 'not a url']) {
      expect((await get(route(address))).json()).toMatchObject({ code: 'validation_failed', details: { field: 'url' } });
    }
    expect((await get('/api/embeds/bluesky-picture')).statusCode).toBe(400);
    expect(fetchBlueskyPicture).not.toHaveBeenCalled();
  });

  it('comes back as the picture, which a browser will not run as a page', async () => {
    fetchBlueskyPicture.mockResolvedValueOnce({ type: 'image/webp', bytes: Buffer.from([1, 2, 3]) });
    const res = await get(route(PICTURE));
    expect(fetchBlueskyPicture).toHaveBeenCalledWith(PICTURE);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.rawPayload).toEqual(Buffer.from([1, 2, 3]));
  });

  it('is not found when Bluesky gives no picture', async () => {
    fetchBlueskyPicture.mockResolvedValueOnce(null);
    expect((await get(route(PICTURE))).json()).toMatchObject({ code: 'file_not_found' });
  });
});
