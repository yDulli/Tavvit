import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * The camera's background effects (`src/camera/`) find the person in the
 * picture with MediaPipe, which loads its WebAssembly from one directory by
 * fixed file names (`FilesetResolver.forVisionTasks`). The app serves that
 * directory itself, so nothing comes from a CDN, and nothing in it loads until
 * someone turns an effect on.
 *
 * Only the SIMD build is served. A browser without WebAssembly SIMD is told
 * the effects are not available on it (`src/camera/support.ts`), so MediaPipe
 * never asks for the other build.
 *
 * The directory is named by the version of `@mediapipe/tasks-vision`, taken
 * from the copy `@livekit/track-processors` itself imports. The JavaScript that
 * drives the WebAssembly and the WebAssembly are therefore always one release,
 * and a new release is a new address: the server lets browsers keep these
 * files for a year (`packages/server/src/index.ts`).
 *
 * Plain JavaScript, like `developers/plugin.mjs`: it runs in Node, and the web
 * package's TypeScript knows only the browser.
 */
export const VISION_DIRECTORY = 'mediapipe';

/** @type {readonly ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']} */
export const VISION_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];

/** @type {Record<(typeof VISION_FILES)[number], string>} */
const CONTENT_TYPES = {
  'vision_wasm_internal.js': 'text/javascript; charset=utf-8',
  'vision_wasm_internal.wasm': 'application/wasm',
};

const VIRTUAL_ID = 'virtual:vision-assets';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/**
 * The copy of `@mediapipe/tasks-vision` that `@livekit/track-processors` imports.
 *
 * @param {string} webRoot the web package's directory
 * @returns {{ dir: string, version: string }} the package's directory (its WebAssembly is in `wasm/`) and its version
 */
export function locateTasksVision(webRoot) {
  const fromWeb = createRequire(path.join(webRoot, 'package.json'));
  const fromProcessors = createRequire(fromWeb.resolve('@livekit/track-processors'));
  const dir = path.dirname(fromProcessors.resolve('@mediapipe/tasks-vision'));
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const version = manifest && typeof manifest === 'object' ? manifest.version : undefined;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`@mediapipe/tasks-vision in ${dir} names no usable version`);
  }
  return { dir, version };
}

/**
 * The address of the directory, under the build's base, without a slash at the end.
 *
 * @param {string} base the build's base (`config.base`)
 * @param {string} version the version of `@mediapipe/tasks-vision`
 */
export function visionBase(base, version) {
  return `${base.endsWith('/') ? base : `${base}/`}${VISION_DIRECTORY}/${version}`;
}

/**
 * Serves the directory during `vite dev`, writes it into the build, and tells
 * the app its address through `virtual:vision-assets`.
 *
 * @returns {import('vite').Plugin}
 */
export function visionAssets() {
  /** @type {{ dir: string, version: string } | null} */
  let vision = null;
  let base = '/';
  const located = () => {
    if (!vision) throw new Error('visionAssets: the config has not been resolved yet');
    return vision;
  };

  return {
    name: 'tavvit:vision-assets',
    configResolved(config) {
      vision = locateTasksVision(config.root);
      base = config.base;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export const VISION_WASM_BASE = ${JSON.stringify(visionBase(base, located().version))};\n`;
    },
    configureServer(server) {
      const { dir, version } = located();
      const prefix = `${visionBase(base, version)}/`;
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (!url.startsWith(prefix) || (req.method !== 'GET' && req.method !== 'HEAD')) {
          next();
          return;
        }
        const file = VISION_FILES.find((name) => name === url.slice(prefix.length));
        if (!file) {
          next();
          return;
        }
        res.setHeader('Content-Type', CONTENT_TYPES[file]);
        res.setHeader('Cache-Control', 'no-cache');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(path.join(dir, 'wasm', file)).on('error', next).pipe(res);
      });
    },
    generateBundle() {
      const { dir, version } = located();
      for (const file of VISION_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `${VISION_DIRECTORY}/${version}/${file}`,
          source: readFileSync(path.join(dir, 'wasm', file)),
        });
      }
    },
  };
}
