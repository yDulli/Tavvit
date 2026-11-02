import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyError } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { apiErrorHandler } from './apiErrorHandler.js';
import { errorBody } from './httpErrors.js';

async function build() {
  const logged: unknown[] = [];
  const app = Fastify({ logger: false });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    vi.spyOn(request.log, 'error').mockImplementation(((entry: unknown) => { logged.push(entry); }) as never);
    return apiErrorHandler(error, request, reply);
  });
  await app.register(rateLimit, {
    max: 1,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({ ...errorBody(429, 'rate_limited'), retryAfter: Math.ceil(context.ttl / 1000) }),
  });
  app.post('/login', async (request) => {
    const { username } = request.body as { username: string };
    return { username };
  });
  app.get('/boom', { config: { rateLimit: false } }, async () => {
    throw new Error('SELECT secret FROM users WHERE password = hunter2');
  });
  await app.ready();
  return { app, logged };
}

describe('apiErrorHandler', () => {
  it('does not quote a body it could not read: the parser would, password and all', async () => {
    const { app, logged } = await build();
    const res = await app.inject({
      method: 'POST', url: '/login', headers: { 'content-type': 'application/json' },
      payload: '{"username":"a","password":"s3cr3t-val"',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
    expect(res.body).not.toContain('s3cr3t');
    expect(JSON.stringify(logged)).not.toContain('s3cr3t');
  });

  it('answers a fault of the server with no word of what went wrong, and logs it without its message', async () => {
    const { app, logged } = await build();
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe('internal_error');
    expect(res.body).not.toContain('hunter2');
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain('hunter2');
  });

  it('answers a route that fell over a missing body the same way', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'POST', url: '/login' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('destructure');
  });

  it('lets the rate limiter\'s own answer through', async () => {
    const { app } = await build();
    await app.inject({ method: 'POST', url: '/login', payload: { username: 'a' } });
    const res = await app.inject({ method: 'POST', url: '/login', payload: { username: 'a' } });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate_limited');
    expect(res.json().retryAfter).toBeGreaterThan(0);
  });
});
