#!/usr/bin/env node
/**
 * Packs a finished desktop build into one archive for the server.
 *
 *   pnpm --filter @backspace/desktop build          build the Windows installer first
 *   node scripts/package-desktop.mjs                 write dist/release/tavvit-desktop-<version>.tar.gz
 *   node scripts/package-desktop.mjs --out some/dir  write it somewhere else
 *
 * electron-builder leaves three files that matter in packages/desktop/dist-electron:
 * the installer, its .blockmap (for the updater's differential downloads) and
 * latest.yml (the version, the installer's name, size and SHA-512). The server
 * serves exactly those from data/downloads/desktop/ (docs/systems/desktop.md,
 * "Releases"): the download page reads latest.yml to know what to offer, and
 * every installed app reads it to know whether there is an update. The game
 * list goes along, so installed apps get a better one without an update.
 *
 * Before packing, the installer is hashed and compared with what latest.yml
 * says, so an archive can never pair a description with a different file.
 * On the server:
 *
 *   tar -xzf tavvit-desktop-<version>.tar.gz -C <tavvit folder>/data
 *
 * which lands the files in data/downloads/desktop/. No restart is needed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArchive } from './package-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD_DIR = path.join(ROOT, 'packages', 'desktop', 'dist-electron');
const GAME_LIST = path.join(ROOT, 'packages', 'desktop', 'resources', 'games.json');

/** The fields of latest.yml this script checks: version, installer name, its hash and size. */
export function readLatestYml(text) {
  const field = (name) => {
    const match = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(text);
    return match ? match[1].trim().replace(/^'(.*)'$/, '$1') : null;
  };
  const sizeMatch = /^\s+size:\s*(\d+)\s*$/m.exec(text);
  return {
    version: field('version'),
    path: field('path'),
    sha512: field('sha512'),
    size: sizeMatch ? Number(sizeMatch[1]) : null,
  };
}

function fail(message) {
  console.error(`package-desktop: ${message}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 && args[outIndex + 1]
    ? path.resolve(args[outIndex + 1])
    : path.join(ROOT, 'dist', 'release');

  const ymlPath = path.join(BUILD_DIR, 'latest.yml');
  if (!existsSync(ymlPath)) fail(`no ${path.relative(ROOT, ymlPath)}; build the installer first (pnpm --filter @backspace/desktop build)`);
  const ymlText = readFileSync(ymlPath, 'utf8');
  const latest = readLatestYml(ymlText);
  if (!latest.version || !latest.path || !latest.sha512) fail('latest.yml is missing version, path or sha512');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(latest.path)) fail(`unexpected installer name in latest.yml: ${latest.path}`);

  const installerPath = path.join(BUILD_DIR, latest.path);
  const blockmapPath = `${installerPath}.blockmap`;
  if (!existsSync(installerPath)) fail(`latest.yml names ${latest.path}, which is not in dist-electron`);
  if (!existsSync(blockmapPath)) fail(`${latest.path}.blockmap is missing`);

  const installer = readFileSync(installerPath);
  const actual = createHash('sha512').update(installer).digest('base64');
  if (actual !== latest.sha512) fail(`${latest.path} does not match the SHA-512 in latest.yml; rebuild instead of mixing builds`);
  if (latest.size !== null && latest.size !== installer.length) fail(`${latest.path} is ${installer.length} bytes, latest.yml says ${latest.size}`);

  const entries = [
    { name: `desktop/${latest.path}`, content: installer, mode: 0o644 },
    { name: `desktop/${latest.path}.blockmap`, content: readFileSync(blockmapPath), mode: 0o644 },
    { name: 'desktop/games.json', content: readFileSync(GAME_LIST), mode: 0o644 },
    // Last, so a half-extracted archive never announces an installer that is not there yet.
    { name: 'desktop/latest.yml', content: Buffer.from(ymlText.replace(/\r\n/g, '\n'), 'utf8'), mode: 0o644 },
  ];

  mkdirSync(outDir, { recursive: true });
  const archivePath = path.join(outDir, `tavvit-desktop-${latest.version}.tar.gz`);
  writeFileSync(archivePath, buildArchive(entries, 'downloads', Math.floor(Date.now() / 1000)));
  console.log(`wrote ${path.relative(ROOT, archivePath)} (${latest.path}, ${(installer.length / 1048576).toFixed(1)} MB)`);
  console.log('on the server: tar -xzf <archive> -C <tavvit folder>/data');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
