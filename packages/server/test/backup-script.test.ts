import { describe, it, expect, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The real backup.sh, with real files, against a target on this disk. With a fake `docker` where a
// snapshot is asked for. Needs bash; where there is none (a bare Windows machine) the suite skips
// rather than fails.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const FAKE_DOCKER = path.join(__dirname, 'fixtures', 'fake-docker', 'docker');
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

vi.setConfig({ testTimeout: 60_000 });

const created: string[] = [];
afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function installed(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-backup-'));
  created.push(dir);
  fs.copyFileSync(path.join(REPO, 'backup.sh'), path.join(dir, 'backup.sh'));
  fs.mkdirSync(path.join(dir, 'data', 'backups'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data', 'uploads', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'backups', 'backspace-1-scheduled.db'), 'a snapshot');
  fs.writeFileSync(path.join(dir, 'data', 'uploads', 'a.png'), 'a picture');
  fs.writeFileSync(path.join(dir, 'data', 'uploads', 'nested', 'b.png'), 'another');
  return dir;
}

/** A path bash understands, on any system. */
const forBash = (where: string): string => where.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_all, drive: string) => `/${drive.toLowerCase()}`);

function run(dir: string, args: string[]) {
  const result = spawnSync('bash', ['backup.sh', ...args], { cwd: dir, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const statusOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'data', 'backups', 'offsite-status.json'), 'utf8')) as { ok: boolean; at: number; reason?: string };

describe.skipIf(!hasBash)('backup.sh', () => {
  it('copies the snapshots to another place, and says it left out the uploads', () => {
    const dir = installed();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-target-'));
    created.push(target);
    const { code, out } = run(dir, ['--copy-only', '--to', forBash(target)]);
    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(target, 'db', 'backspace-1-scheduled.db'), 'utf8')).toBe('a snapshot');
    expect(fs.existsSync(path.join(target, 'uploads'))).toBe(false);
    expect(out).toContain('--with-uploads');
  });

  it('copies the uploaded files too when asked, folders and all', () => {
    const dir = installed();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-target-'));
    created.push(target);
    const { code } = run(dir, ['--copy-only', '--with-uploads', '--to', forBash(target)]);
    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(target, 'uploads', 'a.png'), 'utf8')).toBe('a picture');
    expect(fs.readFileSync(path.join(target, 'uploads', 'nested', 'b.png'), 'utf8')).toBe('another');
  });

  it('leaves word of a copy that worked, for the warnings to read', () => {
    const dir = installed();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-target-'));
    created.push(target);
    run(dir, ['--copy-only', '--with-uploads', '--to', forBash(target)]);
    const status = statusOf(dir);
    expect(status.ok).toBe(true);
    expect(Math.abs(status.at - Date.now())).toBeLessThan(60_000);
    // The address of the other machine is nobody's business here.
    expect(JSON.stringify(status)).not.toContain(path.basename(target));
  });

  it('fails loudly when the copy fails, and leaves word of why, as valid JSON', () => {
    const dir = installed();
    const blocked = path.join(dir, 'a-file-not-a-folder');
    fs.writeFileSync(blocked, 'x');
    const { code, err } = run(dir, ['--copy-only', '--with-uploads', '--to', forBash(blocked)]);
    expect(code).toBe(1);
    expect(err).toContain('failed');
    const status = statusOf(dir);
    expect(status.ok).toBe(false);
    expect(typeof status.reason).toBe('string');
  });

  it('deletes nothing at the other end', () => {
    const dir = installed();
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-target-'));
    created.push(target);
    fs.mkdirSync(path.join(target, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(target, 'uploads', 'kept.png'), 'an older file');
    run(dir, ['--copy-only', '--with-uploads', '--to', forBash(target)]);
    expect(fs.existsSync(path.join(target, 'uploads', 'kept.png'))).toBe(true);
  });

  it('refuses what makes no sense, before doing anything', () => {
    const dir = installed();
    expect(run(dir, ['--with-uploads']).code).toBe(2);
    expect(run(dir, ['--copy-only']).code).toBe(2);
    expect(run(dir, ['--to']).code).toBe(2);
    expect(run(dir, ['--sideways']).code).toBe(2);
    expect(fs.existsSync(path.join(dir, 'data', 'backups', 'offsite-status.json'))).toBe(false);
  });

  /** The real script with a fake `docker` first on the path, which notes what it was asked. */
  function withFakeDocker(dir: string, args: string[]) {
    const bin = path.join(dir, 'bin');
    const state = path.join(dir, 'docker-state');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(state, { recursive: true });
    fs.copyFileSync(FAKE_DOCKER, path.join(bin, 'docker'));
    fs.chmodSync(path.join(bin, 'docker'), 0o755);
    const result = spawnSync('bash', ['backup.sh', ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, FAKE_DOCKER_STATE: state },
    });
    const log = path.join(state, 'calls.log');
    return { ...result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
  }

  it('with nothing asked, takes a snapshot on this machine and says that is all it is', () => {
    const result = withFakeDocker(installed(), []);
    expect(result.status).toBe(0);
    expect(result.calls).toContain('snapshot.ts');
    expect(result.stdout).toContain('Database only');
  });

  it('takes a snapshot first, and copies it', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-target-'));
    created.push(target);
    const result = withFakeDocker(installed(), ['--with-uploads', '--to', forBash(target)]);
    expect(result.status).toBe(0);
    expect(result.calls).toContain('snapshot.ts');
    expect(fs.existsSync(path.join(target, 'uploads', 'a.png'))).toBe(true);
  });

  it('asks nothing of Docker when it only copies', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-target-'));
    created.push(target);
    const result = withFakeDocker(installed(), ['--copy-only', '--to', forBash(target)]);
    expect(result.status).toBe(0);
    expect(result.calls).toBe('');
  });
});
