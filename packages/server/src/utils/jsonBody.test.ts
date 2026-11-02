import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerJsonBodyParser, registerRawJsonBodyParser } from './jsonBody.js';

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
