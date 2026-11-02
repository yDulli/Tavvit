import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Writes the public developer docs into the build (docs/systems/developers.md), so `vite build` and
 * the Docker image cannot leave them out. In a process of its own, because Node reads the shared
 * package's TypeScript as it is and Vite's bundling of its config would not. A page that cannot be
 * made fails the build.
 */
export function developerDocs() {
  let root = '';
  let outDir = '';
  return {
    name: 'tavvit-developer-docs',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      execFileSync(process.execPath, [path.join(root, 'developers', 'build.mjs'), path.join(outDir, 'developers')], { stdio: 'inherit' });
    },
  };
}
