import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerDeveloperDocs } from './developerDocs.js';

let app: FastifyInstance;
let dist: string;

beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-dist-'));
  fs.mkdirSync(path.join(dist, 'developers', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'developers', 'home.html'), '<!doctype html><title>Home</title>');
  fs.writeFileSync(path.join(dist, 'developers', 'docs', 'quickstart.html'), '<!doctype html><title>Quickstart</title>');
  fs.writeFileSync(path.join(dist, 'secret.html'), 'not a docs page');
  app = Fastify();
  registerDeveloperDocs(app, dist);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

describe('the developer docs', () => {
  it('answer with the start page', async () => {
    const res = await app.inject({ method: 'GET', url: '/developers' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Home</title>');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('answer with a page by its name', async () => {
    const res = await app.inject({ method: 'GET', url: '/developers/docs/quickstart' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Quickstart</title>');
  });

  it('lead from the folder to the first page', async () => {
    const res = await app.inject({ method: 'GET', url: '/developers/docs' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/developers/docs/overview');
  });

  it('take an address with a slash at its end to the same page, and not to the app', async () => {
    for (const [url, location] of [
      ['/developers/', '/developers'],
      ['/developers/docs/', '/developers/docs/overview'],
      ['/developers/docs/quickstart/', '/developers/docs/quickstart'],
    ] as const) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBeGreaterThanOrEqual(301);
      expect(res.statusCode, url).toBeLessThanOrEqual(302);
      expect(res.headers.location, url).toBe(location);
    }
    expect((await app.inject({ method: 'GET', url: '/developers/docs/..%2Fsecret/' })).statusCode).toBe(404);
  });

  it('carry a policy of their own, tighter than the app\'s', async () => {
    const res = await app.inject({ method: 'GET', url: '/developers/docs/quickstart' });
    const policy = String(res.headers['content-security-policy']);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('https:');
  });

  it('answer 404 for what is not a page, and reach nothing outside their folder', async () => {
    for (const url of [
      '/developers/docs/nothing',
      '/developers/docs/..%2f..%2fsecret',
      '/developers/docs/..%5c..%5csecret',
      '/developers/docs/quickstart.html',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('not a docs page');
    }
  });

  it('leave the portal to the app', async () => {
    expect((await app.inject({ method: 'GET', url: '/developers/bots' })).statusCode).toBe(404);
  });
});
