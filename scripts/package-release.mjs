#!/usr/bin/env node
/**
 * Packs this checkout into one archive you can upload to a server.
 *
 *   node scripts/package-release.mjs                 write dist/release/tavvit-<version>-<id>.tar.gz
 *   node scripts/package-release.mjs --out some/dir  write it somewhere else
 *   node scripts/package-release.mjs --verify FILE  check an archive against its own MANIFEST
 *
 * Why this exists. The server needs the source, a Dockerfile and a handful of
 * shell scripts, and nothing else: no git, no Node, no pnpm. Copying the working
 * folder by hand carries along node_modules, local databases and, worst of all,
 * Windows line endings and lost executable bits that break shell scripts. This
 * script builds the one archive that is right for the server:
 *
 *   - the file set is what git would track plus new files, minus whatever
 *     .gitignore excludes (so .env, data/ and node_modules never travel), minus
 *     the parts a server does not use (the marketing site, ...);
 *   - text files are written with LF line endings whatever the working tree has;
 *   - scripts get the executable bit, everything else does not;
 *   - MANIFEST lists a SHA-256 for every file, in `sha256sum -c` format. The
 *     server's update script verifies it before it touches anything, and uses it
 *     to remove files a newer release no longer ships.
 *
 * The archive is plain ustar (with PAX records for long or non-ASCII paths) and
 * gzip, written with node:zlib; no packages are needed.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Directories (and files) that never go to a server. Prefixes end with a slash.
 * `packages/desktop` is not among them although a server never runs it: this archive is
 * also the source offer (publish-source.sh), and the installers are offered too. The
 * image leaves it out (.dockerignore).
 */
export const EXCLUDED_PREFIXES = [
  '.git/',
  '.github/',
  '.claude/',
  '.vscode/',
  '.idea/',
  '.zap/',
  'node_modules/',
  'data/',
  'dist/',
  'site/',
  'flatpak/',
  'signatures/',
  'tests/',
  'docs/screenshots/',
];

/** Single files that never go to a server. */
export const EXCLUDED_FILES = new Set([
  'MANIFEST', // generated archive metadata, never source files
  'RELEASE', // generated archive metadata, never source files
  'orbit logo.png', // the source artwork also lives in assets/brand/
  'assets/brand/logo-orbit-retired.png', // the old mark, kept for its owner only
  'electronbuild.sh',
  'io.github.TheZwiss.backspace.yml', // Flatpak manifest of the desktop app
  'deploy.sh', // upstream's rsync-to-a-host script; see install.sh and update.sh
  'CLAUDE.md',
]);

/** Files whose name says they are secrets or local state, even if git does not ignore them. */
const EXCLUDED_NAME = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|db|db-journal|log))$/;
const ALLOWED_ENV = /(^|\/)\.env\.example$/;

/** Whether `relPath` (posix, relative to the repository root) belongs in a release. */
export function shouldInclude(relPath) {
  if (EXCLUDED_FILES.has(relPath)) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix))) return false;
  // A nested node_modules (packages/web/node_modules, ...) is never source.
  if (relPath.split('/').includes('node_modules')) return false;
  if (EXCLUDED_NAME.test(relPath) && !ALLOWED_ENV.test(relPath)) return false;
  return true;
}

/** Shell scripts are the only files that need the executable bit. */
export function modeFor(relPath) {
  return relPath.endsWith('.sh') ? 0o755 : 0o644;
}

/** git's own test: a NUL byte in the first 8000 bytes means binary. */
export function isBinary(buffer) {
  const end = Math.min(buffer.length, 8000);
  for (let i = 0; i < end; i += 1) if (buffer[i] === 0) return true;
  return false;
}

/** Text files are shipped with LF endings; binary files are shipped untouched. */
export function normalizeContent(buffer) {
  if (isBinary(buffer)) return buffer;
  if (!buffer.includes(0x0d)) return buffer;
  const text = buffer.toString('latin1').replace(/\r\n/g, '\n');
  return Buffer.from(text, 'latin1');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// ── tar ──────────────────────────────────────────────────────────────────────

const BLOCK = 512;

function writeOctal(header, value, offset, length) {
  const digits = value.toString(8).padStart(length - 1, '0');
  if (digits.length > length - 1) throw new Error(`value ${value} does not fit a ${length}-byte tar field`);
  header.write(digits, offset, 'ascii');
  header[offset + length - 1] = 0;
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  let record = `${length}${body}`;
  while (Buffer.byteLength(record) !== length) {
    length = Buffer.byteLength(record);
    record = `${length}${body}`;
  }
  return record;
}

function headerBlock({ name, size, mode, mtime, type }) {
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100, 'utf8');
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8); // uid
  writeOctal(header, 0, 116, 8); // gid
  writeOctal(header, size, 124, 12);
  writeOctal(header, mtime, 136, 12);
  header.fill(0x20, 148, 156); // checksum field counts as spaces
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  header.write('root', 265, 'ascii');
  header.write('root', 297, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0'), 148, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function padTo(buffer) {
  const rest = buffer.length % BLOCK;
  return rest === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(BLOCK - rest)]);
}

function isPlainAscii(value) {
  return /^[\x20-\x7e]*$/.test(value);
}

/** One tar member. A path that does not fit the 100-byte name field travels in a PAX record. */
function tarEntry({ name, content, mode, mtime }) {
  const parts = [];
  const short = isPlainAscii(name) && Buffer.byteLength(name) <= 100;
  if (!short) {
    const pax = Buffer.from(paxRecord('path', name), 'utf8');
    parts.push(headerBlock({ name: 'PaxHeader/entry', size: pax.length, mode: 0o644, mtime, type: 'x' }), padTo(pax));
  }
  const storedName = short ? name : `${name.slice(0, 60).replace(/[^\x20-\x7e]/g, '_')}`;
  parts.push(headerBlock({ name: storedName, size: content.length, mode, mtime, type: '0' }), padTo(content));
  return Buffer.concat(parts);
}

/** Builds the gzip-compressed tar of `entries` ({ name, content, mode }) under `topDir`. */
export function buildArchive(entries, topDir, mtime) {
  const members = entries.map((entry) =>
    tarEntry({ name: `${topDir}/${entry.name}`, content: entry.content, mode: entry.mode, mtime }),
  );
  members.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(members), { level: 9 });
}

/** Reads every regular file out of a gzip-compressed tar. Returns [{ name, content }]. */
export function readArchive(gz) {
  const tar = gunzipSync(gz);
  const files = [];
  let offset = 0;
  let pendingPath = null;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 135).toString('ascii'), 8);
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + BLOCK;
    const content = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x') {
      const match = /\d+ path=([^\n]*)\n/.exec(content.toString('utf8'));
      pendingPath = match ? match[1] : null;
      continue;
    }
    if (type === '0' || type === '\0') {
      files.push({ name: pendingPath ?? rawName, content: Buffer.from(content), mode: parseInt(header.subarray(100, 107).toString('ascii'), 8) });
      pendingPath = null;
    }
  }
  return files;
}

// ── manifest ─────────────────────────────────────────────────────────────────

/** `sha256sum`-format manifest: "<hash>  <path>" per file, sorted by path. */
export function manifestOf(entries) {
  return entries
    .map((entry) => `${sha256(entry.content)}  ${entry.name}`)
    .sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1))
    .join('\n') + '\n';
}

export function parseManifest(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match) throw new Error(`malformed MANIFEST line: ${line}`);
    rows.set(match[2], match[1]);
  }
  return rows;
}

/**
 * Checks an archive against the MANIFEST it carries: every listed file is there
 * with the listed hash, and nothing unlisted came along. Returns a list of
 * problems; empty means the archive is sound.
 */
export function verifyArchive(gz) {
  const problems = [];
  const files = readArchive(gz);
  const top = files.length > 0 ? files[0].name.split('/')[0] : '';
  const byName = new Map(files.map((file) => [file.name.slice(top.length + 1), file]));
  const manifestFile = byName.get('MANIFEST');
  if (!manifestFile) return ['the archive has no MANIFEST'];
  let manifest;
  try {
    manifest = parseManifest(manifestFile.content.toString('utf8'));
  } catch (error) {
    return [error.message];
  }
  for (const [name, hash] of manifest) {
    const file = byName.get(name);
    if (!file) problems.push(`missing: ${name}`);
    else if (sha256(file.content) !== hash) problems.push(`hash mismatch: ${name}`);
  }
  for (const name of byName.keys()) {
    if (name !== 'MANIFEST' && name !== 'RELEASE' && !manifest.has(name)) problems.push(`not in MANIFEST: ${name}`);
  }
  return problems;
}

// ── collecting the files ─────────────────────────────────────────────────────

function listCandidateFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    maxBuffer: 256 * 1024 * 1024,
  });
  return [...new Set(out.toString('utf8').split('\0').filter(Boolean))].sort();
}

/** The release's files, read from disk and normalized. Throws when a required file is missing. */
export function collectEntries(candidates = listCandidateFiles()) {
  const entries = [];
  for (const relPath of candidates) {
    if (!shouldInclude(relPath)) continue;
    const abs = path.join(ROOT, relPath);
    // git still lists a tracked file that was deleted in the working tree.
    if (!existsSync(abs)) continue;
    const stat = lstatSync(abs);
    if (!stat.isFile()) continue;
    const content = normalizeContent(readFileSync(abs));
    entries.push({ name: relPath, content, mode: modeFor(relPath) });
  }
  return entries;
}

const REQUIRED = [
  'Dockerfile',
  'docker-compose.yml',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'install.sh',
  'update.sh',
  '.env.example',
  'packages/server/package.json',
  'packages/web/package.json',
  'packages/shared/package.json',
];

function parseArgs(argv) {
  const args = { out: path.join(ROOT, 'dist', 'release'), verify: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = path.resolve(argv[++i] ?? '');
    else if (argv[i] === '--verify') args.verify = path.resolve(argv[++i] ?? '');
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/package-release.mjs [--out DIR] | --verify ARCHIVE');
    return;
  }

  if (args.verify) {
    const problems = verifyArchive(readFileSync(args.verify));
    if (problems.length > 0) {
      for (const problem of problems) console.error(`  ${problem}`);
      console.error(`${args.verify}: ${problems.length} problem(s).`);
      process.exit(1);
    }
    console.log(`${args.verify}: every file matches its MANIFEST.`);
    return;
  }

  const entries = collectEntries();
  const present = new Set(entries.map((entry) => entry.name));
  const missing = REQUIRED.filter((name) => !present.has(name));
  if (missing.length > 0) {
    console.error(`Refusing to package: required file(s) missing: ${missing.join(', ')}`);
    process.exit(1);
  }

  const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const manifest = manifestOf(entries);
  // The id changes exactly when the content does, so two archives with the same
  // name are the same release.
  const id = sha256(Buffer.from(manifest)).slice(0, 8);
  const name = `tavvit-${version}-${id}`;
  const created = new Date();

  const release = [
    `name=${name}`,
    `version=${version}`,
    `files=${entries.length}`,
    `created=${created.toISOString()}`,
    '',
  ].join('\n');
  const all = [
    ...entries,
    { name: 'MANIFEST', content: Buffer.from(manifest), mode: 0o644 },
    { name: 'RELEASE', content: Buffer.from(release), mode: 0o644 },
  ];

  const gz = buildArchive(all, name, Math.floor(created.getTime() / 1000));
  const problems = verifyArchive(gz);
  if (problems.length > 0) {
    console.error('The archive failed its own verification:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  mkdirSync(args.out, { recursive: true });
  const file = path.join(args.out, `${name}.tar.gz`);
  writeFileSync(file, gz);
  writeFileSync(`${file}.sha256`, `${sha256(gz)}  ${path.basename(file)}\n`);

  const mb = (gz.length / (1024 * 1024)).toFixed(1);
  console.log(`Wrote ${file}`);
  console.log(`  ${entries.length} files, ${mb} MB, verified against its MANIFEST.`);
  console.log('');
  console.log('Upload it and install (first time) or update:');
  console.log(`  scp "${file}" you@server:/tmp/`);
  console.log(`  # first install:   mkdir -p /opt/tavvit && tar xzf /tmp/${name}.tar.gz -C /opt/tavvit --strip-components=1 && cd /opt/tavvit && bash install.sh`);
  console.log(`  # later updates:   cd /opt/tavvit && bash update.sh --from /tmp/${name}.tar.gz`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
