import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { VISION_DIRECTORY, VISION_FILES, locateTasksVision, visionAssets, visionBase } from './visionAssets.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The version of MediaPipe that @livekit/track-processors asks for. */
function versionTheProcessorsWant(): string {
  const fromWeb = createRequire(path.join(webRoot, 'package.json'));
  const processorsDir = path.dirname(path.dirname(fromWeb.resolve('@livekit/track-processors')));
  const manifest = JSON.parse(readFileSync(path.join(processorsDir, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  return manifest.dependencies['@mediapipe/tasks-vision']!.replace(/^[\^~]/, '');
}

type Plugin = ReturnType<typeof visionAssets>;
type Hook = (...args: unknown[]) => unknown;
const hook = (plugin: Plugin, name: keyof Plugin): Hook => plugin[name] as unknown as Hook;

function resolvedPlugin(base = '/') {
  const plugin = visionAssets();
  hook(plugin, 'configResolved')({ root: webRoot, base });
  return plugin;
}

describe('MediaPipe\'s WebAssembly, served by the app itself', () => {
  it('is the copy the processor imports, so its JavaScript and WebAssembly are one release', () => {
    const { dir, version } = locateTasksVision(webRoot);
    expect(version).toBe(versionTheProcessorsWant());
    for (const file of VISION_FILES) expect(existsSync(path.join(dir, 'wasm', file)), file).toBe(true);
  });

  it('lives under the version, so a new release is a new address', () => {
    expect(visionBase('/', '0.10.14')).toBe(`/${VISION_DIRECTORY}/0.10.14`);
    expect(visionBase('/app/', '0.10.14')).toBe(`/app/${VISION_DIRECTORY}/0.10.14`);
    expect(visionBase('/app', '0.10.14')).toBe(`/app/${VISION_DIRECTORY}/0.10.14`);
  });

  it('tells the app its address', () => {
    const plugin = resolvedPlugin();
    const id = hook(plugin, 'resolveId')('virtual:vision-assets');
    expect(id).toBe('\0virtual:vision-assets');
    const { version } = locateTasksVision(webRoot);
    expect(hook(plugin, 'load')(id)).toBe(`export const VISION_WASM_BASE = "/mediapipe/${version}";\n`);
    expect(hook(plugin, 'resolveId')('./elsewhere')).toBeNull();
    expect(hook(plugin, 'load')('./elsewhere')).toBeNull();
  });

  it('writes both files into the build, and only the SIMD build', () => {
    const plugin = resolvedPlugin();
    const emitFile = vi.fn();
    hook(plugin, 'generateBundle').call({ emitFile });
    const { version } = locateTasksVision(webRoot);
    expect(emitFile.mock.calls.map(([asset]) => (asset as { fileName: string }).fileName)).toEqual([
      `mediapipe/${version}/vision_wasm_internal.js`,
      `mediapipe/${version}/vision_wasm_internal.wasm`,
    ]);
    for (const [asset] of emitFile.mock.calls) expect((asset as { source: Buffer }).source.length).toBeGreaterThan(1000);
  });

  it('serves the two files during development with their types, and nothing else', async () => {
    const plugin = resolvedPlugin();
    let middleware: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
    hook(plugin, 'configureServer')({ middlewares: { use: (handler: typeof middleware) => { middleware = handler; } } });
    const { version } = locateTasksVision(webRoot);
    const ask = (url: string, method = 'GET') => new Promise<{ headers: Record<string, string>; bytes: number; passed: boolean }>((resolve) => {
      const res = Object.assign(new PassThrough(), { headers: {} as Record<string, string> }) as PassThrough & { headers: Record<string, string>; setHeader: (k: string, v: string) => void };
      res.setHeader = (key, value) => { res.headers[key] = value; };
      let bytes = 0;
      res.on('data', (chunk: Buffer) => { bytes += chunk.length; });
      res.on('finish', () => resolve({ headers: res.headers, bytes, passed: false }));
      middleware!({ url, method }, res, () => resolve({ headers: res.headers, bytes, passed: true }));
    });

    const wasm = await ask(`/mediapipe/${version}/vision_wasm_internal.wasm?import`);
    expect(wasm.headers['Content-Type']).toBe('application/wasm');
    expect(wasm.bytes).toBeGreaterThan(1000);
    const loader = await ask(`/mediapipe/${version}/vision_wasm_internal.js`, 'HEAD');
    expect(loader.headers['Content-Type']).toBe('text/javascript; charset=utf-8');
    expect(loader.bytes).toBe(0);

    expect((await ask(`/mediapipe/${version}/../../package.json`)).passed).toBe(true);
    expect((await ask(`/mediapipe/${version}/vision_wasm_nosimd_internal.wasm`)).passed).toBe(true);
    expect((await ask(`/mediapipe/${version}/vision_wasm_internal.wasm`, 'POST')).passed).toBe(true);
    expect((await ask('/src/main.tsx')).passed).toBe(true);
  });
});
