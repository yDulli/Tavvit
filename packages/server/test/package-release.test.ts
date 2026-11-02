import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  buildArchive,
  isBinary,
  manifestOf,
  modeFor,
  normalizeContent,
  parseManifest,
  readArchive,
  shouldInclude,
  verifyArchive,
  // @ts-expect-error: a plain ES module without type declarations
} from '../../../scripts/package-release.mjs';

// The archive is what actually reaches the server, so it is tested like code:
// the tar writer round-trips through a reader, the selection rules keep secrets
// and local state out, and a real run over this checkout produces an archive
// that verifies, has LF endings throughout and marks the scripts executable.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const hasGit = spawnSync('git', ['--version']).status === 0 && fs.existsSync(path.join(REPO, '.git'));

describe('shouldInclude', () => {
  it.each([
    'Dockerfile',
    'docker-compose.yml',
    'install.sh',
    '.env.example',
    'packages/server/src/index.ts',
    'packages/web/src/App.tsx',
    'packages/shared/package.json',
    'pnpm-lock.yaml',
    'scripts/check-i18n.mjs',
    'docs/tavvit/DEPLOYMENT.md',
  ])('ships %s', (file) => {
    expect(shouldInclude(file)).toBe(true);
  });

  it.each([
    '.env',
    '.env.production',
    '.env.local',
    'data/backspace.db',
    'data/uploads/a.png',
    'node_modules/x/index.js',
    'packages/web/node_modules/x.js',
    '.git/config',
    '.github/workflows/ci.yml',
    'site/index.html',
    'flatpak/x.yml',
    'deploy.sh',
    'orbit logo.png',
    'server.pem',
    'private.key',
    'backspace.db',
    'debug.log',
    'dist/release/x.tar.gz',
  ])('keeps %s off the server', (file) => {
    expect(shouldInclude(file)).toBe(false);
  });

  it('ships the desktop code: the archive is also the source offer, and the installers are offered too', () => {
    expect(shouldInclude('packages/desktop/src/main.ts')).toBe(true);
    expect(shouldInclude('packages/desktop/node_modules/x/index.js')).toBe(false);
  });
});

describe('modeFor', () => {
  it('makes only shell scripts executable', () => {
    expect(modeFor('install.sh')).toBe(0o755);
    expect(modeFor('docker-entrypoint.sh')).toBe(0o755);
    expect(modeFor('scripts/x.sh')).toBe(0o755);
    expect(modeFor('Dockerfile')).toBe(0o644);
    expect(modeFor('packages/web/src/App.tsx')).toBe(0o644);
  });
});

describe('line endings', () => {
  it('rewrites CRLF to LF in text', () => {
    expect(normalizeContent(Buffer.from('a\r\nb\r\n')).toString()).toBe('a\nb\n');
  });

  it('leaves a lone CR alone: only the pair is a Windows line ending', () => {
    expect(normalizeContent(Buffer.from('a\rb')).toString()).toBe('a\rb');
  });

  it('never touches binary data', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x0d, 0x0a]);
    expect(isBinary(png)).toBe(true);
    expect(normalizeContent(png).equals(png)).toBe(true);
  });

  it('keeps UTF-8 text intact through the rewrite', () => {
    const text = 'Gruß – 日本語 ✓\r\nzweite Zeile\r\n';
    expect(normalizeContent(Buffer.from(text, 'utf8')).toString('utf8')).toBe('Gruß – 日本語 ✓\nzweite Zeile\n');
  });
});

describe('tar round trip', () => {
  const long = `packages/${'deep/'.repeat(30)}file-with-a-very-long-name.ts`;
  const entries = [
    { name: 'install.sh', content: Buffer.from('#!/bin/sh\n'), mode: 0o755 },
    { name: 'a/b.txt', content: Buffer.from('hello\n'), mode: 0o644 },
    { name: 'empty.txt', content: Buffer.alloc(0), mode: 0o644 },
    { name: 'exactly-one-block.bin', content: Buffer.alloc(512, 7), mode: 0o644 },
    { name: long, content: Buffer.from('long path\n'), mode: 0o644 },
    { name: 'unicode/gruß.txt', content: Buffer.from('ü\n'), mode: 0o644 },
  ];

  it('reads back every file with its content, path and mode', () => {
    const files = readArchive(buildArchive(entries, 'orbit-x', 1_700_000_000));
    expect(files.map((f: { name: string }) => f.name)).toEqual(entries.map((e) => `orbit-x/${e.name}`));
    for (const [i, file] of files.entries()) {
      expect(file.content.equals(entries[i]!.content)).toBe(true);
      expect(file.mode).toBe(entries[i]!.mode);
    }
  });

  it('is readable by the system tar, which is what the server uses', () => {
    const tarCheck = spawnSync('tar', ['--version']);
    if (tarCheck.status !== 0) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-tar-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.tar.gz'), buildArchive(entries, 'orbit-x', 1_700_000_000));
      const out = path.join(dir, 'out');
      fs.mkdirSync(out);
      // Relative paths: GNU tar on Windows reads "C:" as a remote host name.
      const result = spawnSync('tar', ['xzf', 'a.tar.gz', '-C', 'out'], { cwd: dir, encoding: 'utf8' });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(fs.readFileSync(path.join(out, 'orbit-x', 'a', 'b.txt'), 'utf8')).toBe('hello\n');
      expect(fs.readFileSync(path.join(out, 'orbit-x', long), 'utf8')).toBe('long path\n');
      expect(fs.readFileSync(path.join(out, 'orbit-x', 'unicode', 'gruß.txt'), 'utf8')).toBe('ü\n');
      expect(fs.statSync(path.join(out, 'orbit-x', 'exactly-one-block.bin')).size).toBe(512);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('MANIFEST', () => {
  const entries = [
    { name: 'b.txt', content: Buffer.from('b'), mode: 0o644 },
    { name: 'a.txt', content: Buffer.from('a'), mode: 0o644 },
  ];

  it('is in sha256sum format, sorted by path', () => {
    const text = manifestOf(entries);
    expect(text.split('\n')[0]).toMatch(/^[0-9a-f]{64} {2}a\.txt$/);
    expect(text.split('\n')[1]).toMatch(/^[0-9a-f]{64} {2}b\.txt$/);
    expect(parseManifest(text).size).toBe(2);
  });

  it('refuses a malformed line rather than skipping it', () => {
    expect(() => parseManifest('not a hash  file\n')).toThrow(/malformed/);
  });

  it('verifies a sound archive', () => {
    const all = [...entries, { name: 'MANIFEST', content: Buffer.from(manifestOf(entries)), mode: 0o644 }];
    expect(verifyArchive(buildArchive(all, 'orbit-x', 1))).toEqual([]);
  });

  it('notices a file changed after the manifest was written', () => {
    const manifest = manifestOf(entries);
    const tampered = [
      { name: 'a.txt', content: Buffer.from('changed'), mode: 0o644 },
      entries[0]!,
      { name: 'MANIFEST', content: Buffer.from(manifest), mode: 0o644 },
    ];
    expect(verifyArchive(buildArchive(tampered, 'orbit-x', 1))).toEqual(['hash mismatch: a.txt']);
  });

  it('notices a missing file and an extra one', () => {
    const manifest = manifestOf(entries);
    const odd = [
      entries[0]!,
      { name: 'extra.txt', content: Buffer.from('x'), mode: 0o644 },
      { name: 'MANIFEST', content: Buffer.from(manifest), mode: 0o644 },
    ];
    const problems = verifyArchive(buildArchive(odd, 'orbit-x', 1));
    expect(problems).toContain('missing: a.txt');
    expect(problems).toContain('not in MANIFEST: extra.txt');
  });

  it('reports an archive with no manifest', () => {
    expect(verifyArchive(buildArchive(entries, 'orbit-x', 1))).toEqual(['the archive has no MANIFEST']);
  });

  it('does not accept garbage as an archive', () => {
    expect(() => verifyArchive(gzipSync(Buffer.from('not a tar')))).not.toThrow();
  });
});

describe.skipIf(!hasGit)('a real release of this checkout', () => {
  let outDir: string;
  let archivePath: string;
  let files: Array<{ name: string; content: Buffer; mode: number }>;

  beforeAll(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-release-'));
    const result = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'package-release.mjs'), '--out', outDir], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const names = fs.readdirSync(outDir).filter((n) => n.endsWith('.tar.gz'));
    expect(names).toHaveLength(1);
    archivePath = path.join(outDir, names[0]!);
    files = readArchive(fs.readFileSync(archivePath));
  }, 120_000);

  afterAll(() => {
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
  });

  const relative = (name: string) => name.slice(name.indexOf('/') + 1);

  it('verifies against its own MANIFEST', () => {
    expect(verifyArchive(fs.readFileSync(archivePath))).toEqual([]);
  });

  it('writes a checksum file next to the archive', () => {
    const sum = fs.readFileSync(`${archivePath}.sha256`, 'utf8');
    expect(sum).toMatch(/^[0-9a-f]{64} {2}tavvit-.*\.tar\.gz\n$/);
  });

  it('contains everything the image build needs', () => {
    const names = new Set(files.map((f) => relative(f.name)));
    for (const required of [
      'Dockerfile',
      'docker-compose.yml',
      'docker-entrypoint.sh',
      'install.sh',
      'update.sh',
      'backup.sh',
      'restore.sh',
      'tavvit-admin.sh',
      'doctor.sh',
      '.env.example',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      'packages/server/package.json',
      'packages/web/package.json',
      'packages/shared/package.json',
      'scripts/check-i18n.mjs',
      'scripts/i18n-allowlist.json',
      'MANIFEST',
      'RELEASE',
      'LICENSE',
      'NOTICE',
    ]) {
      expect(names, required).toContain(required);
    }
  });

  it('leaves out secrets, local state and what a server never uses', () => {
    for (const file of files) {
      const rel = relative(file.name);
      expect(rel, rel).not.toMatch(/(^|\/)\.env$/);
      expect(rel.startsWith('data/'), rel).toBe(false);
      expect(rel.includes('node_modules/'), rel).toBe(false);
      expect(rel.startsWith('.git/'), rel).toBe(false);
      expect(rel).not.toMatch(/\.(db|pem|key|log)$/);
    }
  });

  it('has LF line endings in every text file', () => {
    const offenders = files.filter((f) => !isBinary(f.content) && f.content.includes(0x0d) && f.content.toString('latin1').includes('\r\n'));
    expect(offenders.map((f) => relative(f.name))).toEqual([]);
  });

  it('marks every shell script executable and nothing else', () => {
    for (const file of files) {
      const rel = relative(file.name);
      expect(file.mode, rel).toBe(rel.endsWith('.sh') ? 0o755 : 0o644);
    }
  });

  it('starts every shell script with a shebang', () => {
    for (const file of files.filter((f) => relative(f.name).endsWith('.sh'))) {
      expect(file.content.toString('utf8').startsWith('#!'), relative(file.name)).toBe(true);
    }
  });
});
