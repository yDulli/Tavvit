import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

// Who is signed in and which peers exist are other files' business; here only whether the
// server reads a body before it knows who sent it.
vi.mock('./auth.js', () => ({
  authenticate: async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization === 'Bearer good') return;
    await reply.code(401).send({ error: 'Invalid or expired token', code: 'unauthorized', statusCode: 401 });
  },
}));
vi.mock('../routes/federation/handlers/s2sAuth.js', () => ({
  peerNamedByHeaders: (request: FastifyRequest) => request.headers['x-federation-origin'] === 'https://peer.example',
}));

const { ANONYMOUS_BODY_LIMIT, registerBodyGuard } = await import('./bodyGuard.js');

let app: FastifyInstance;
let bodiesRead = 0;

beforeEach(async () => {
  bodiesRead = 0;
  app = Fastify({ logger: false });
  registerBodyGuard(app);
  app.addHook('preParsing', async (_request, _reply, payload) => {
    bodiesRead += 1;
    return payload;
  });
  app.post('/big', { bodyLimit: 1024 * 1024 }, async () => ({ ok: true }));
  app.post('/small', { bodyLimit: 32 * 1024 }, async () => ({ ok: true }));
  app.post('/api/federation/relay', { bodyLimit: 10 * 1024 * 1024 }, async () => ({ ok: true }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const large = JSON.stringify({ text: 'x'.repeat(ANONYMOUS_BODY_LIMIT) });
const post = (url: string, payload: string | Readable, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json', ...headers } });

describe('a body larger than a stranger may send', () => {
  it('is not read from someone who has not said who they are', async () => {
    const res = await post('/big', large);
    expect(res.statusCode).toBe(413);
    expect(bodiesRead).toBe(0);
  });

  it('is not read on a token that does not hold', async () => {
    const res = await post('/big', large, { authorization: 'Bearer forged' });
    expect(res.statusCode).toBe(401);
    expect(bodiesRead).toBe(0);
  });

  it('is read from someone signed in', async () => {
    const res = await post('/big', large, { authorization: 'Bearer good' });
    expect(res.statusCode).toBe(200);
    expect(bodiesRead).toBe(1);
  });

  it('without a stated length is not read from a stranger either', async () => {
    const res = await post('/big', Readable.from([large]), { 'transfer-encoding': 'chunked' });
    expect(res.statusCode).toBe(411);
    expect(bodiesRead).toBe(0);
  });

  it('for federation, is read only when the headers name a peer this instance knows', async () => {
    expect((await post('/api/federation/relay', large)).statusCode).toBe(401);
    expect(bodiesRead).toBe(0);
    const known = await post('/api/federation/relay', large, { 'x-federation-origin': 'https://peer.example' });
    expect(known.statusCode).toBe(200);
    expect(bodiesRead).toBe(1);
  });
});

describe('everything else', () => {
  it('is read as before: a small body, and any body on a route that takes no more than the limit', async () => {
    expect((await post('/big', JSON.stringify({ text: 'hello' }))).statusCode).toBe(200);
    expect((await post('/small', Readable.from([JSON.stringify({ text: 'hello' })]), { 'transfer-encoding': 'chunked' })).statusCode).toBe(200);
    expect(bodiesRead).toBe(2);
  });
});
