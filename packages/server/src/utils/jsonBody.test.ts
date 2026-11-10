import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerEmptyBodyDefault, registerJsonBodyParser, registerRawJsonBodyParser } from './jsonBody.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify({ logger: false });
  registerJsonBodyParser(app);
  app.delete('/thing', async (request) => ({ body: request.body ?? null }));
  app.post('/thing', async (request) => ({ body: request.body ?? null }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('a JSON body', () => {
  it('that is empty is no body, as programs written before Fastify 5 send it on a DELETE', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/thing', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ body: null });
    const blank = await app.inject({ method: 'POST', url: '/thing', headers: { 'content-type': 'application/json; charset=utf-8' }, payload: '  ' });
    expect(blank.statusCode).toBe(200);
  });

  it('is read as before', async () => {
    const res = await app.inject({ method: 'POST', url: '/thing', payload: { a: 1 } });
    expect(res.json()).toEqual({ body: { a: 1 } });
  });

  it('still refuses keys that would reach an object\'s prototype, and what is not JSON', async () => {
    const poisoned = await app.inject({ method: 'POST', url: '/thing', headers: { 'content-type': 'application/json' }, payload: '{"__proto__":{"admin":true}}' });
    expect(poisoned.statusCode).toBe(400);
    const constructor = await app.inject({ method: 'POST', url: '/thing', headers: { 'content-type': 'application/json' }, payload: '{"constructor":{"prototype":{"admin":true}}}' });
    expect(constructor.statusCode).toBe(400);
    const broken = await app.inject({ method: 'POST', url: '/thing', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    expect(broken.statusCode).toBe(400);
  });
});

describe('a JSON body read as it came, in one scope', () => {
  it('cannot be had with a second JSON parser under ours: Fastify 5 refuses to start', async () => {
    const plain = Fastify({ logger: false });
    registerJsonBodyParser(plain);
    void plain.register(async (scope) => {
      scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => { done(null, body); });
    });
    await expect(plain.ready()).rejects.toMatchObject({ code: 'FST_ERR_CTP_ALREADY_PRESENT' });
  });

  it('can be had with registerRawJsonBodyParser, and stays in its scope', async () => {
    const scoped = Fastify({ logger: false });
    registerJsonBodyParser(scoped);
    await scoped.register(async (scope) => {
      registerRawJsonBodyParser(scope, 1024);
      scope.post('/raw', async (request) => ({ raw: request.body }));
    });
    scoped.post('/parsed', async (request) => ({ body: request.body ?? null }));
    await scoped.ready();

    const raw = await scoped.inject({ method: 'POST', url: '/raw', headers: { 'content-type': 'application/json' }, payload: '{"a": 1}' });
    expect(raw.json()).toEqual({ raw: '{"a": 1}' });
    const tooLarge = await scoped.inject({ method: 'POST', url: '/raw', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ a: 'x'.repeat(2048) }) });
    expect(tooLarge.statusCode).toBe(413);
    const parsed = await scoped.inject({ method: 'POST', url: '/parsed', payload: { a: 1 } });
    expect(parsed.json()).toEqual({ body: { a: 1 } });
    const empty = await scoped.inject({ method: 'POST', url: '/parsed', headers: { 'content-type': 'application/json' } });
    expect(empty.json()).toEqual({ body: null });
    await scoped.close();
  });
});

describe('a write without a body', () => {
  // Most handlers take their fields straight out of `request.body`, as this one does. Before
  // 1.41.4 a write with no body, or with JSON `null` for one, threw in them: a 500, on 26 routes.
  async function withDefault(): Promise<FastifyInstance> {
    const built = Fastify({ logger: false });
    registerJsonBodyParser(built);
    registerEmptyBodyDefault(built);
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      built[method]<{ Body: { name?: unknown } }>('/thing', async (request, reply) => {
        const { name } = request.body;
        if (typeof name !== 'string') return reply.code(400).send({ code: 'validation_failed' });
        return { name };
      });
    }
    built.get('/thing', async (request) => ({ body: request.body ?? null }));
    await built.register(async (scope) => {
      registerRawJsonBodyParser(scope, 1024);
      scope.post('/raw', async (request) => ({ raw: request.body }));
    });
    await built.ready();
    return built;
  }

  it('reads as an empty object, so a handler answers with its own check and not a 500', async () => {
    const built = await withDefault();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const none = await built.inject({ method, url: '/thing' });
      expect(none.statusCode, `${method} with no body`).toBe(400);
      const typed = await built.inject({ method, url: '/thing', headers: { 'content-type': 'application/json' } });
      expect(typed.statusCode, `${method} with the header and no body`).toBe(400);
      const nothing = await built.inject({ method, url: '/thing', headers: { 'content-type': 'application/json' }, payload: 'null' });
      expect(nothing.statusCode, `${method} with null`).toBe(400);
      expect(nothing.json()).toEqual({ code: 'validation_failed' });
    }
    await built.close();
  });

  it('leaves a body that is there as it came, and a request that carries none alone', async () => {
    const built = await withDefault();
    const full = await built.inject({ method: 'POST', url: '/thing', payload: { name: 'a' } });
    expect(full.json()).toEqual({ name: 'a' });
    const read = await built.inject({ method: 'GET', url: '/thing' });
    expect(read.json()).toEqual({ body: null });
    // A route that reads the bytes itself still gets them, also when they say `null`.
    const raw = await built.inject({ method: 'POST', url: '/raw', headers: { 'content-type': 'application/json' }, payload: 'null' });
    expect(raw.json()).toEqual({ raw: 'null' });
    await built.close();
  });
});
