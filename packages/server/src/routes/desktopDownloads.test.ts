import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopReleaseResponse } from '@backspace/shared';
import { parseLatestYml, readDesktopRelease } from '../utils/desktopRelease.js';

const downloadsDir = await vi.hoisted(async () => {
  const [nodeFs, nodeOs, nodePath] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')]);
  return nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'orbit-downloads-'));
});

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return { config: { ...actual.config, downloadsDir } };
});

const { desktopDownloadRoutes } = await import('./desktopDownloads.js');

const desktopDir = path.join(downloadsDir, 'desktop');

/** latest.yml exactly as electron-builder 26 writes it for an NSIS build. */
function latestYml(version: string, file: string, size: number): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    '    sha512: c2hhNTEyLW9mLXRoZS1pbnN0YWxsZXI=',
    `    size: ${size}`,
    `path: ${file}`,
    'sha512: c2hhNTEyLW9mLXRoZS1pbnN0YWxsZXI=',
    "releaseDate: '2026-10-23T09:30:00.000Z'",
    '',
  ].join('\n');
}

function publish(version: string, withInstaller = true): string {
  const file = `Tavvit-${version}-win-x64.exe`;
  const body = Buffer.from('MZ installer bytes for the test');
  fs.mkdirSync(desktopDir, { recursive: true });
  if (withInstaller) fs.writeFileSync(path.join(desktopDir, file), body);
  fs.writeFileSync(path.join(desktopDir, 'latest.yml'), latestYml(version, file, body.length));
  return file;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(desktopDownloadRoutes);
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  await app.ready();
  return app;
}

beforeEach(() => {
  fs.rmSync(desktopDir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(downloadsDir, { recursive: true, force: true });
});

describe('parseLatestYml', () => {
  it('reads version, release date and the installer list electron-builder writes', () => {
    const parsed = parseLatestYml(latestYml('1.12.0', 'Tavvit-1.12.0-win-x64.exe', 1234));
    expect(parsed).toEqual({
      version: '1.12.0',
      releaseDate: '2026-10-23T09:30:00.000Z',
      files: [{ url: 'Tavvit-1.12.0-win-x64.exe', sha512: 'c2hhNTEyLW9mLXRoZS1pbnN0YWxsZXI=', size: 1234 }],
    });
  });

  it('rejects anything without a usable version', () => {
    expect(parseLatestYml('files:\n  - url: a.exe\n    sha512: x\n')).toBeNull();
    expect(parseLatestYml('<!doctype html><html></html>')).toBeNull();
  });
});

describe('readDesktopRelease', () => {
  it('is null before anything is published', () => {
    expect(readDesktopRelease(downloadsDir)).toBeNull();
  });

  it('leaves out an installer latest.yml names but the server does not have', () => {
    publish('1.12.0', false);
    expect(readDesktopRelease(downloadsDir)).toBeNull();
  });

  it('describes a published Windows installer with its real size', () => {
    const file = publish('1.12.0');
    const release = readDesktopRelease(downloadsDir);
    expect(release).toMatchObject({ version: '1.12.0', releasedAt: '2026-10-23T09:30:00.000Z' });
    expect(release?.files).toEqual([{
      platform: 'windows',
      arch: 'x64',
      fileName: file,
      url: `/downloads/desktop/${file}`,
      size: fs.statSync(path.join(desktopDir, file)).size,
      sha512: 'c2hhNTEyLW9mLXRoZS1pbnN0YWxsZXI=',
    }]);
  });

  it('never links a file name that could leave the directory', () => {
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'latest.yml'), latestYml('1.12.0', '../secret-win-x64.exe', 3));
    expect(readDesktopRelease(downloadsDir)).toBeNull();
  });
});

describe('desktop download routes', () => {
  it('answers with no release before one is published', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/desktop/release' });
    expect(res.statusCode).toBe(200);
    expect(res.json<DesktopReleaseResponse>()).toEqual({ release: null });
    expect(res.headers['cache-control']).toBe('no-cache');
    await app.close();
  });

  it('serves the installer as a download and latest.yml uncached, to anyone', async () => {
    const file = publish('1.12.0');
    const app = await buildApp();

    const release = (await app.inject({ method: 'GET', url: '/api/desktop/release' })).json<DesktopReleaseResponse>();
    expect(release.release?.files[0]?.url).toBe(`/downloads/desktop/${file}`);

    const exe = await app.inject({ method: 'GET', url: `/downloads/desktop/${file}` });
    expect(exe.statusCode).toBe(200);
    expect(exe.headers['content-disposition']).toBe(`attachment; filename="${file}"`);
    expect(exe.headers['content-type']).toBe('application/octet-stream');
    expect(exe.rawPayload.toString()).toBe('MZ installer bytes for the test');

    const yml = await app.inject({ method: 'GET', url: '/downloads/desktop/latest.yml' });
    expect(yml.statusCode).toBe(200);
    expect(yml.headers['cache-control']).toBe('no-cache');
    expect(yml.body).toContain('version: 1.12.0');
    await app.close();
  });

  it('serves the game list uncached, with a tag the app can ask with', async () => {
    publish('1.12.0');
    fs.writeFileSync(path.join(desktopDir, 'games.json'), '{"version":2,"games":[]}');
    const app = await buildApp();
    const list = await app.inject({ method: 'GET', url: '/downloads/desktop/games.json' });
    expect(list.statusCode).toBe(200);
    expect(list.headers['cache-control']).toBe('no-cache');
    expect(list.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(list.json()).toEqual({ version: 2, games: [] });
    const again = await app.inject({ method: 'GET', url: '/downloads/desktop/games.json', headers: { 'if-none-match': String(list.headers.etag) } });
    expect(again.statusCode).toBe(304);
    await app.close();
  });

  it('answers a byte range, which the updater uses for differential downloads', async () => {
    const file = publish('1.12.0');
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/downloads/desktop/${file}`, headers: { range: 'bytes=0-1' } });
    expect(res.statusCode).toBe(206);
    expect(res.body).toBe('MZ');
    await app.close();
  });

  it('is a 404 for a missing file or a path outside the directory, never a page', async () => {
    publish('1.12.0');
    fs.writeFileSync(path.join(downloadsDir, 'outside.txt'), 'not for download');
    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/downloads/desktop/Tavvit-9.9.9-win-x64.exe' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/downloads/desktop/../outside.txt' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/downloads/desktop/%2e%2e/outside.txt' })).statusCode).toBe(404);
    await app.close();
  });
});
