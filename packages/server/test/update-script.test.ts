import { describe, it, expect, afterAll, vi } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error: a plain ES module without type declarations
import { buildArchive, manifestOf } from '../../../scripts/package-release.mjs';

// The update script is the way back from a bad release, so it is tested like
// code: the real update.sh and backup.sh run against a fake `docker`
// (test/fixtures/fake-docker/docker) that simulates the daemon. Each case below
// is one thing that can happen on a server at 11pm.
//
// Needs bash. Where there is none (a bare Windows machine) the suite skips
// rather than fails; Git for Windows provides one.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const FAKE_DOCKER = path.join(__dirname, 'fixtures', 'fake-docker', 'docker');
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

// Each case runs the real script, which polls for health. The slowest (a rollback)
// waits out the shortened 5 s health window twice.
vi.setConfig({ testTimeout: 90_000 });

const created: string[] = [];
afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

interface Install {
  dir: string;
  state: (name: string, value: string) => void;
  calls: () => string[];
  run: (...args: string[]) => SpawnSyncReturns<string>;
}

interface InstallOptions {
  /** The `BACKSPACE_INSTALL_CHANNEL` line of .env; omit to leave it unrecorded. */
  channel?: 'source' | 'prebuilt';
  oldVersion?: string;
  newVersion?: string;
}

/** A directory that looks like an install: the real scripts, a .env, and a fake daemon. */
function makeInstall(options: InstallOptions = {}): Install {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-update-'));
  created.push(root);
  const dir = path.join(root, 'install');
  const bin = path.join(root, 'bin');
  const stateDir = path.join(root, 'state');
  for (const d of [dir, bin, stateDir]) fs.mkdirSync(d, { recursive: true });

  for (const file of ['update.sh', 'backup.sh', 'docker-compose.yml']) {
    let text = fs.readFileSync(path.join(REPO, file), 'utf8');
    // The real script waits up to 180 s for health; a case that never turns healthy
    // would take minutes. The wait is the only thing shortened.
    if (file === 'update.sh') text = text.replace(/^HEALTH_TIMEOUT=\d+/m, 'HEALTH_TIMEOUT=5');
    fs.writeFileSync(path.join(dir, file), text, { mode: 0o755 });
  }
  const env = ['DOMAIN=example.test', 'JWT_SECRET=not-a-real-secret'];
  if (options.channel) env.push(`BACKSPACE_INSTALL_CHANNEL=${options.channel}`);
  fs.writeFileSync(path.join(dir, '.env'), `${env.join('\n')}\n`);

  fs.copyFileSync(FAKE_DOCKER, path.join(bin, 'docker'));
  fs.chmodSync(path.join(bin, 'docker'), 0o755);

  // Mirrors the fake's key(): a colon cannot appear in a Windows file name.
  const state = (name: string, value: string) => fs.writeFileSync(path.join(stateDir, name.replace(/:/g, '_')), value);
  state('running_image', 'sha256:old1');
  state('tag.tavvit:local', 'sha256:old1');
  state('next_image', 'sha256:new2');
  state('version.sha256:old1', options.oldVersion ?? '1.11.0 (aaaaaaa)');
  state('version.sha256:new2', options.newVersion ?? '1.11.0 (bbbbbbb)');

  return {
    dir,
    state,
    calls: () => {
      const log = path.join(stateDir, 'calls.log');
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    },
    run: (...args) => spawnSync('bash', ['update.sh', ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 90_000,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_DOCKER_STATE: stateDir,
      },
    }),
  };
}

const out = (r: SpawnSyncReturns<string>) => `${r.stdout}\n${r.stderr}`;
const index = (calls: string[], needle: string) => calls.findIndex((c) => c.includes(needle));

describe.skipIf(!hasBash)('update.sh against a fake docker', () => {
  it('snapshots, rebuilds, restarts and reports the new build', () => {
    const install = makeInstall({ channel: 'source' });
    const r = install.run('--yes');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toContain('Updated from 1.11.0 (aaaaaaa) to 1.11.0 (bbbbbbb)');
    const calls = install.calls();
    expect(index(calls, 'snapshot.ts')).toBeGreaterThanOrEqual(0);
    expect(index(calls, 'compose build')).toBeGreaterThan(index(calls, 'snapshot.ts'));
    expect(index(calls, 'compose up -d backspace')).toBeGreaterThan(index(calls, 'compose build'));
  });

  it('never names another service or reaps orphans', () => {
    const install = makeInstall({ channel: 'source' });
    install.run('--yes');
    for (const call of install.calls().filter((c) => c.includes('compose up'))) {
      expect(call).toContain('backspace');
      expect(call).not.toContain('--remove-orphans');
    }
  });

  it('does not call an update a failure just because the version number did not change', () => {
    // The regression this guards: most commits in a fork do not touch the version,
    // and the script used to roll back any update that reported the same one.
    const install = makeInstall({ channel: 'source', oldVersion: '1.11.0', newVersion: '1.11.0' });
    const r = install.run('--yes');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toContain('Tavvit is running the new build');
    expect(install.calls().some((c) => c.startsWith('docker tag'))).toBe(false);
  });

  it('does nothing, and restarts nothing, when the build produced the same image', () => {
    const install = makeInstall({ channel: 'source' });
    install.state('build_mode', 'noop');
    const r = install.run('--yes');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toContain('Already running the newest image');
    expect(install.calls().some((c) => c.includes('compose up'))).toBe(false);
  });

  it('stops before restarting anything when the build fails', () => {
    const install = makeInstall({ channel: 'source' });
    install.state('build_mode', 'fail');
    const r = install.run('--yes');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('Nothing was restarted');
    expect(install.calls().some((c) => c.includes('compose up'))).toBe(false);
  });

  it('rolls back to the previous image when the new one never becomes healthy', () => {
    const install = makeInstall({ channel: 'source' });
    install.state('bad_image', 'sha256:new2');
    const r = install.run('--yes');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('Rolling back');
    expect(out(r)).toContain('Rolled back');
    const calls = install.calls();
    expect(calls.some((c) => c === 'docker tag old1 tavvit:local')).toBe(true);
    expect(calls.filter((c) => c.includes('compose up')).length).toBe(2);
  });

  it('rolls back when the container is healthy but is not running the image that was built', () => {
    const install = makeInstall({ channel: 'source' });
    install.state('up_mode', 'stale');
    const r = install.run('--yes');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('did not take effect');
    expect(install.calls().some((c) => c === 'docker tag old1 tavvit:local')).toBe(true);
  });

  it('refuses to update when the pre-update snapshot fails, and changes nothing', () => {
    const install = makeInstall({ channel: 'source' });
    install.state('snapshot_mode', 'fail');
    const r = install.run('--yes');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('The backup failed');
    const calls = install.calls();
    expect(calls.some((c) => c.includes('compose build'))).toBe(false);
    expect(calls.some((c) => c.includes('compose up'))).toBe(false);
  });

  it('skips the snapshot only when told to', () => {
    const install = makeInstall({ channel: 'source' });
    const r = install.run('--yes', '--no-backup');
    expect(r.status, out(r)).toBe(0);
    expect(install.calls().some((c) => c.includes('snapshot.ts'))).toBe(false);
  });

  it('rebuilds, rather than pulling nothing, when the install channel was never recorded', () => {
    // A hand-written .env with the default local image `tavvit:local`.
    const install = makeInstall({});
    const r = install.run('--yes');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toContain("using 'source'");
    const calls = install.calls();
    expect(calls.some((c) => c.includes('compose build'))).toBe(true);
    expect(calls.some((c) => c.includes('compose pull'))).toBe(false);
  });

  it('refuses to run unattended without --yes', () => {
    const install = makeInstall({ channel: 'source' });
    const r = install.run();
    expect(r.status).toBe(1);
    expect(out(r)).toContain('--yes');
    expect(install.calls().some((c) => c.includes('compose build'))).toBe(false);
  });

  it('rejects an unknown option', () => {
    const install = makeInstall({ channel: 'source' });
    const r = install.run('--frobnicate');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('Unknown option');
  });
});

describe.skipIf(!hasBash)('update.sh --check against a git remote', () => {
  function git(cwd: string, ...args: string[]): string {
    const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args], {
      cwd, encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  }

  /** An install that is a clone of a bare remote, plus a second clone to push from. */
  function installWithRemote() {
    const install = makeInstall({ channel: 'source' });
    const root = path.dirname(install.dir);
    const remote = path.join(root, 'origin.git');
    git(root, 'init', '--bare', '--initial-branch=main', remote);
    const seed = path.join(root, 'seed');
    git(root, 'clone', remote, seed);
    fs.writeFileSync(path.join(seed, 'a.txt'), 'one\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'first');
    git(seed, 'push', 'origin', 'HEAD:main');
    // The install directory becomes a clone of the same remote; the scripts already there stay untracked.
    git(install.dir, 'init', '--initial-branch=main');
    git(install.dir, 'remote', 'add', 'origin', remote);
    git(install.dir, 'fetch', 'origin');
    git(install.dir, 'checkout', '-B', 'main', '--track', 'origin/main');
    return { install, seed };
  }

  it('says it is up to date when the remote has nothing new', () => {
    const { install } = installWithRemote();
    const r = install.run('--check');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toMatch(/up to date with origin\/main/);
    expect(out(r)).toContain('Nothing was changed');
  });

  it('counts the commits the remote has that this checkout lacks, and changes nothing', () => {
    const { install, seed } = installWithRemote();
    fs.writeFileSync(path.join(seed, 'a.txt'), 'two\n');
    git(seed, 'commit', '-am', 'second');
    fs.writeFileSync(path.join(seed, 'a.txt'), 'three\n');
    git(seed, 'commit', '-am', 'third');
    git(seed, 'push', 'origin', 'HEAD:main');
    const r = install.run('--check');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toContain('2 newer commit(s) are available on origin/main');
    const calls = install.calls();
    expect(calls.some((c) => c.includes('compose build') || c.includes('compose up') || c.includes('snapshot'))).toBe(false);
  });

  it('never asks upstream Backspace for its releases', () => {
    const { install } = installWithRemote();
    const r = install.run('--check');
    expect(out(r)).not.toMatch(/api\.github\.com|TheZwiss/);
  });

  it('explains itself when this is not a git checkout', () => {
    const install = makeInstall({ channel: 'source' });
    const r = install.run('--check');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toContain('not a git checkout');
  });
});

describe.skipIf(!hasBash)('update.sh --from a release archive', () => {
  interface ReleaseFile { name: string; content: string; mode?: number }

  /** Writes a release archive next to the install and returns its path relative to the install directory. */
  function makeRelease(install: Install, files: ReleaseFile[], options: { id?: string; extra?: ReleaseFile[]; breakHash?: string } = {}): string {
    const id = options.id ?? 'deadbeef';
    const entries = files.map((f) => ({ name: f.name, content: Buffer.from(f.content), mode: f.mode ?? 0o644 }));
    const manifest = manifestOf(entries);
    const all = [
      ...entries,
      ...(options.extra ?? []).map((f) => ({ name: f.name, content: Buffer.from(f.content), mode: f.mode ?? 0o644 })),
      { name: 'MANIFEST', content: Buffer.from(manifest), mode: 0o644 },
      { name: 'RELEASE', content: Buffer.from(`name=orbit-1.12.0-${id}\nversion=1.12.0\nfiles=${files.length}\ncreated=2026-01-01T00:00:00.000Z\n`), mode: 0o644 },
    ];
    // A damaged archive: a file's bytes change after the manifest was written.
    const damaged = options.breakHash
      ? all.map((e) => (e.name === options.breakHash ? { ...e, content: Buffer.from('tampered\n') } : e))
      : all;
    const file = path.join(path.dirname(install.dir), `orbit-1.12.0-${id}.tar.gz`);
    fs.writeFileSync(file, buildArchive(damaged, `orbit-1.12.0-${id}`, 1_700_000_000));
    return path.relative(install.dir, file).split(path.sep).join('/');
  }

  /** The real scripts, so the archive replaces update.sh with a (changed) copy of itself. */
  function realFiles(extraUpdateLine = '\n# changed by the new release\n'): ReleaseFile[] {
    return [
      { name: 'update.sh', content: fs.readFileSync(path.join(REPO, 'update.sh'), 'utf8').replace(/^HEALTH_TIMEOUT=\d+/m, 'HEALTH_TIMEOUT=5') + extraUpdateLine, mode: 0o755 },
      { name: 'backup.sh', content: fs.readFileSync(path.join(REPO, 'backup.sh'), 'utf8'), mode: 0o755 },
      { name: 'docker-compose.yml', content: fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8') },
      { name: 'Dockerfile', content: 'FROM scratch\n' },
      { name: 'src/new.txt', content: 'new\n' },
    ];
  }

  /** An install that already has a release on disk: its MANIFEST and one file that will go away. */
  function installedWithRelease(): Install {
    const install = makeInstall({ channel: 'source' });
    const old: ReleaseFile[] = [
      { name: 'src/old-only.txt', content: 'goes away\n' },
      { name: 'src/kept.txt', content: 'old kept\n' },
    ];
    for (const f of old) {
      fs.mkdirSync(path.dirname(path.join(install.dir, f.name)), { recursive: true });
      fs.writeFileSync(path.join(install.dir, f.name), f.content);
    }
    fs.writeFileSync(path.join(install.dir, 'MANIFEST'), manifestOf(old.map((f) => ({ name: f.name, content: Buffer.from(f.content), mode: 0o644 }))));
    fs.writeFileSync(path.join(install.dir, 'RELEASE'), 'name=orbit-1.11.0-11111111\n');
    fs.mkdirSync(path.join(install.dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(install.dir, 'data', 'keep.db'), 'database');
    return install;
  }

  const read = (install: Install, file: string) => fs.readFileSync(path.join(install.dir, file), 'utf8');
  const exists = (install: Install, file: string) => fs.existsSync(path.join(install.dir, file));

  it('replaces the source, drops files the new release no longer ships, and rebuilds', () => {
    const install = installedWithRelease();
    const archive = makeRelease(install, [...realFiles(), { name: 'src/kept.txt', content: 'new kept\n' }]);
    const r = install.run('--from', archive, '--yes');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toContain('Applying release orbit-1.12.0-deadbeef');
    expect(read(install, 'src/new.txt')).toBe('new\n');
    expect(read(install, 'src/kept.txt')).toBe('new kept\n');
    expect(exists(install, 'src/old-only.txt')).toBe(false);
    // The running script was replaced by the archive's copy while it ran, and still finished.
    expect(read(install, 'update.sh')).toContain('# changed by the new release');
    expect(out(r)).toContain('Updated from 1.11.0 (aaaaaaa) to 1.11.0 (bbbbbbb)');
  });

  it('never touches .env or data/', () => {
    const install = installedWithRelease();
    const archive = makeRelease(install, realFiles(), {
      extra: [{ name: '.env', content: 'JWT_SECRET=attacker\n' }, { name: 'data/keep.db', content: 'overwritten' }],
    });
    const before = read(install, '.env');
    const r = install.run('--from', archive, '--yes');
    expect(r.status, out(r)).toBe(0);
    expect(read(install, '.env')).toBe(before);
    expect(read(install, 'data/keep.db')).toBe('database');
  });

  it('takes the database snapshot before it replaces anything, and builds afterwards', () => {
    const install = installedWithRelease();
    const archive = makeRelease(install, realFiles());
    const r = install.run('--from', archive, '--yes');
    expect(r.status, out(r)).toBe(0);
    const calls = install.calls();
    expect(index(calls, 'snapshot.ts')).toBeGreaterThanOrEqual(0);
    expect(index(calls, 'compose build')).toBeGreaterThan(index(calls, 'snapshot.ts'));
    // The previous source is kept so a bad release can be undone by hand.
    const saved = fs.readdirSync(path.join(install.dir, 'data', 'backups')).filter((n) => n.startsWith('source-'));
    expect(saved).toHaveLength(1);
  });

  it('gives the image the id of the release, since there is no git commit to use', () => {
    const install = installedWithRelease();
    const archive = makeRelease(install, realFiles(), { id: 'cafebabe' });
    const r = install.run('--from', archive, '--yes');
    expect(r.status, out(r)).toBe(0);
    expect(install.calls().some((c) => c.includes('compose build') && c.includes('BACKSPACE_COMMIT=cafebabe'))).toBe(true);
  });

  it('keeps a copy of a file that was edited on the server before replacing it', () => {
    const install = installedWithRelease();
    fs.writeFileSync(path.join(install.dir, 'src', 'kept.txt'), 'edited on the server\n');
    const archive = makeRelease(install, [...realFiles(), { name: 'src/kept.txt', content: 'new kept\n' }]);
    const r = install.run('--from', archive, '--yes');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toContain('You had changed src/kept.txt');
    const dirs = fs.readdirSync(path.join(install.dir, 'data', 'backups')).filter((n) => n.startsWith('local-edits-'));
    expect(dirs).toHaveLength(1);
    expect(fs.readFileSync(path.join(install.dir, 'data', 'backups', dirs[0]!, 'src', 'kept.txt'), 'utf8')).toBe('edited on the server\n');
  });

  it('refuses a damaged archive and changes nothing', () => {
    const install = installedWithRelease();
    const archive = makeRelease(install, realFiles(), { breakHash: 'src/new.txt' });
    const r = install.run('--from', archive, '--yes');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('MANIFEST');
    expect(exists(install, 'src/new.txt')).toBe(false);
    expect(exists(install, 'src/old-only.txt')).toBe(true);
    expect(install.calls().some((c) => c.includes('compose build') || c.includes('snapshot.ts'))).toBe(false);
  });

  it('refuses an archive whose checksum file does not match', () => {
    const install = installedWithRelease();
    const archive = makeRelease(install, realFiles());
    fs.writeFileSync(path.join(install.dir, archive) + '.sha256', `${'0'.repeat(64)}  x.tar.gz\n`);
    const r = install.run('--from', archive, '--yes');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('damaged');
    expect(exists(install, 'src/new.txt')).toBe(false);
  });

  it('refuses a file that is not a release', () => {
    const install = installedWithRelease();
    fs.writeFileSync(path.join(path.dirname(install.dir), 'junk.tar.gz'), 'not an archive');
    const r = install.run('--from', '../junk.tar.gz', '--yes');
    expect(r.status).toBe(1);
    expect(out(r)).toMatch(/Could not unpack|not an Tavvit release/);
  });

  it('says so when the archive is not there', () => {
    const install = installedWithRelease();
    const r = install.run('--from', 'missing.tar.gz', '--yes');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('No such file');
  });

  it('needs the path after --from', () => {
    const install = installedWithRelease();
    const r = install.run('--from');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('--from needs the path');
  });

  it('will not replace source files under a prebuilt image', () => {
    const install = makeInstall({ channel: 'prebuilt' });
    fs.writeFileSync(path.join(install.dir, 'MANIFEST'), '');
    const archive = makeRelease(install, realFiles());
    const r = install.run('--from', archive, '--yes');
    expect(r.status).toBe(1);
    expect(out(r)).toContain('prebuilt image');
    expect(exists(install, 'src/new.txt')).toBe(false);
    expect(install.calls().some((c) => c.includes('snapshot.ts'))).toBe(false);
  });

  it('--check --from reports what would change and changes nothing', () => {
    const install = installedWithRelease();
    const archive = makeRelease(install, [...realFiles(), { name: 'src/kept.txt', content: 'new kept\n' }]);
    const r = install.run('--from', archive, '--check');
    expect(r.status, out(r)).toBe(0);
    expect(out(r)).toContain('orbit-1.12.0-deadbeef');
    expect(out(r)).toMatch(/\d+ new, 1 changed, 1 removed/);
    expect(exists(install, 'src/new.txt')).toBe(false);
    expect(exists(install, 'src/old-only.txt')).toBe(true);
    expect(install.calls().some((c) => c.includes('compose build') || c.includes('snapshot.ts'))).toBe(false);
  });

  it('works when the scripts have lost their executable bit', () => {
    const install = installedWithRelease();
    fs.chmodSync(path.join(install.dir, 'backup.sh'), 0o644);
    const archive = makeRelease(install, realFiles());
    const r = install.run('--from', archive, '--yes');
    expect(r.status, out(r)).toBe(0);
  });

  it('resolves a relative archive path from where the operator ran it, not from the install directory', () => {
    const install = installedWithRelease();
    const archive = makeRelease(install, realFiles());
    const elsewhere = path.join(path.dirname(install.dir), 'elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.copyFileSync(path.join(install.dir, archive), path.join(elsewhere, 'r.tar.gz'));
    const bin = path.join(path.dirname(install.dir), 'bin');
    const r = spawnSync('bash', [path.join(install.dir, 'update.sh').split(path.sep).join('/'), '--from', 'r.tar.gz', '--yes'], {
      cwd: elsewhere,
      encoding: 'utf8',
      timeout: 90_000,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_DOCKER_STATE: path.join(path.dirname(install.dir), 'state'),
      },
    });
    expect(r.status, out(r)).toBe(0);
    expect(read(install, 'src/new.txt')).toBe('new\n');
  });
});
