import { describe, it, expect, afterAll, vi } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// doctor.sh is what an operator runs when something is wrong, so it must be
// right about what it reports, quiet about secrets, and honest in its exit
// code. It runs for real here, against the same fake docker as update.sh.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const FAKE_DOCKER = path.join(__dirname, 'fixtures', 'fake-docker', 'docker');
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;

vi.setConfig({ testTimeout: 60_000 });

const created: string[] = [];
afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

const SECRET = 'a-very-secret-value-that-must-never-be-printed-0123456789';
const LIVEKIT_KEY = 'APIkeyThatMustNeverBePrinted';

const GOOD_ENV = [
  'DOMAIN=chat.friends.test',
  'DEPLOY_MODE=proxy',
  `JWT_SECRET=${SECRET}`,
  'REGISTRATION_OPEN=false',
  'TAVVIT_SOURCE_URL=https://git.example.test/friends/orbit',
];

const HEALTHY_INFO = JSON.stringify({
  version: '1.11.0', commit: 'abc1234', registrationOpen: false, setupRequired: false,
  sourceCodeConfigured: true, federationEnabled: false,
});

interface Setup {
  env?: string[] | null;
  info?: string | null;
  state?: Record<string, string>;
  livekitYaml?: string;
  /** Extra files in the install directory (name -> content). */
  files?: Record<string, string>;
  /** Write a MANIFEST and RELEASE for these files, as the packager does; then `files` may differ from them. */
  release?: Record<string, string>;
  /** Names to delete after the release was written, to simulate an incomplete upload. */
  remove?: string[];
}

function run(setup: Setup = {}): { r: SpawnSyncReturns<string>; text: string; calls: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-doctor-'));
  created.push(root);
  const dir = path.join(root, 'install');
  const bin = path.join(root, 'bin');
  const stateDir = path.join(root, 'state');
  for (const d of [dir, bin, stateDir, path.join(dir, 'data', 'backups')]) fs.mkdirSync(d, { recursive: true });

  fs.writeFileSync(path.join(dir, 'doctor.sh'), fs.readFileSync(path.join(REPO, 'doctor.sh'), 'utf8'), { mode: 0o755 });
  if (setup.env !== null) {
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, `${(setup.env ?? GOOD_ENV).join('\n')}\n`);
    fs.chmodSync(envFile, 0o600);
  }
  if (setup.livekitYaml !== undefined) fs.writeFileSync(path.join(dir, 'livekit.yaml'), setup.livekitYaml);
  if (setup.release) {
    const lines: string[] = [];
    for (const [name, content] of Object.entries(setup.release)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), content);
      lines.push(`${createHash('sha256').update(content).digest('hex')}  ${name}`);
    }
    fs.writeFileSync(path.join(dir, 'MANIFEST'), `${lines.join('\n')}\n`);
    fs.writeFileSync(path.join(dir, 'RELEASE'), 'name=orbit-1.11.0-0badc0de\n');
  }
  for (const [name, content] of Object.entries(setup.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  for (const name of setup.remove ?? []) fs.rmSync(path.join(dir, name), { force: true });
  fs.writeFileSync(path.join(dir, 'data', 'backups', 'backspace-20260101T000000000-manual.db'), 'x');

  fs.copyFileSync(FAKE_DOCKER, path.join(bin, 'docker'));
  fs.chmodSync(path.join(bin, 'docker'), 0o755);
  const write = (name: string, value: string) => fs.writeFileSync(path.join(stateDir, name.replace(/:/g, '_')), value);
  if (setup.info !== null) write('info_json', setup.info ?? HEALTHY_INFO);
  for (const [k, v] of Object.entries(setup.state ?? {})) write(k, v);

  const r = spawnSync('bash', ['doctor.sh'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 50_000,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, FAKE_DOCKER_STATE: stateDir },
  });
  // Strip colour codes so assertions read like the screen.
  const text = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const log = path.join(stateDir, 'calls.log');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { r, text, calls };
}

describe.skipIf(!hasBash)('doctor.sh', () => {
  it('passes a healthy, private installation and exits 0', () => {
    const { r, text } = run();
    expect(r.status, text).toBe(0);
    expect(text).toMatch(/PASS\s+Registration is closed/);
    expect(text).toMatch(/PASS\s+Federation is off/);
    expect(text).toMatch(/PASS\s+Container is running and healthy/);
    expect(text).toMatch(/PASS\s+The app answers requests/);
    expect(text).toMatch(/PASS\s+Running version 1\.11\.0 \(abc1234\)/);
    expect(text).toMatch(/0 failed/);
  });

  it('never prints a secret, only whether it is present and long enough', () => {
    const { text } = run({
      env: [...GOOD_ENV, 'LIVEKIT_URL=wss://chat.friends.test/livekit', `LIVEKIT_API_KEY=${LIVEKIT_KEY}`, 'LIVEKIT_API_SECRET=another-secret-value', 'COMPOSE_PROFILES=voice'],
      livekitYaml: `keys:\n  ${LIVEKIT_KEY}: another-secret-value\n`,
    });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(LIVEKIT_KEY);
    expect(text).not.toContain('another-secret-value');
    expect(text).toMatch(/JWT_SECRET is set \(\d+ characters\)/);
  });

  it('fails, and says how to generate one, when the JWT secret is a placeholder', () => {
    const { r, text } = run({ env: ['DOMAIN=chat.friends.test', 'JWT_SECRET=change_me_please'] });
    expect(r.status).toBe(1);
    expect(text).toMatch(/FAIL\s+JWT_SECRET is empty or a placeholder/);
    expect(text).toContain('openssl rand -hex 32');
  });

  it('fails when the JWT secret is shorter than the server will accept', () => {
    const { r, text } = run({ env: ['DOMAIN=chat.friends.test', 'JWT_SECRET=tooshort'] });
    expect(r.status).toBe(1);
    expect(text).toMatch(/FAIL\s+JWT_SECRET is only 8 characters/);
  });

  it('fails when there is no .env at all', () => {
    const { r, text } = run({ env: null });
    expect(r.status).toBe(1);
    expect(text).toMatch(/FAIL\s+There is no \.env/);
  });

  it('warns, but does not fail, when registration is open in .env', () => {
    const { r, text } = run({ env: [...GOOD_ENV.filter((l) => !l.startsWith('REGISTRATION_OPEN')), 'REGISTRATION_OPEN=true'] });
    expect(r.status, text).toBe(0);
    expect(text).toMatch(/WARN\s+REGISTRATION_OPEN=true: anyone who finds the address/);
  });

  it('warns that the AGPL source offer is incomplete until TAVVIT_SOURCE_URL is set', () => {
    const { r, text } = run({ env: GOOD_ENV.filter((l) => !l.startsWith('TAVVIT_SOURCE_URL')) });
    expect(r.status, text).toBe(0);
    expect(text).toMatch(/WARN\s+No source offer/);
  });

  it('warns when federation is switched on', () => {
    const { text } = run({ env: [...GOOD_ENV, 'FEDERATION_ENABLED=true'] });
    expect(text).toMatch(/WARN\s+Federation is ENABLED/);
  });

  it('fails, with the exact command, when no account exists yet', () => {
    const { r, text } = run({ info: JSON.stringify({ version: '1.11.0', setupRequired: true, registrationOpen: false, sourceCodeConfigured: true }) });
    expect(r.status).toBe(1);
    expect(text).toMatch(/FAIL\s+No account exists yet/);
    expect(text).toContain('./tavvit-admin.sh create <username> --admin');
  });

  it('fails when the container is not running', () => {
    const { r, text } = run({ state: { container_running: 'false' } });
    expect(r.status).toBe(1);
    expect(text).toMatch(/FAIL\s+The Tavvit container .* is not running/);
    expect(text).toContain('docker compose up -d');
  });

  it('fails when the container runs but is unhealthy, and points at the logs', () => {
    const { r, text } = run({ state: { container_health: 'unhealthy' } });
    expect(r.status).toBe(1);
    expect(text).toMatch(/FAIL\s+Container is running but its health check says: unhealthy/);
    expect(text).toContain('docker compose logs');
  });

  it('only warns while the container is still starting', () => {
    const { r, text } = run({ state: { container_health: 'starting' } });
    expect(r.status, text).toBe(0);
    expect(text).toMatch(/WARN\s+Container is still starting/);
  });

  it('fails when livekit.yaml does not carry the key from .env', () => {
    const { r, text } = run({
      env: [...GOOD_ENV, 'LIVEKIT_URL=wss://chat.friends.test/livekit', `LIVEKIT_API_KEY=${LIVEKIT_KEY}`, 'LIVEKIT_API_SECRET=s3cret', 'COMPOSE_PROFILES=voice'],
      livekitYaml: 'keys:\n  SomeOtherKey: s3cret\n',
    });
    expect(r.status).toBe(1);
    expect(text).toMatch(/FAIL\s+livekit\.yaml does not contain the API key/);
  });

  it('says voice is simply not configured, rather than failing, when LIVEKIT_URL is empty', () => {
    const { r, text } = run();
    expect(r.status, text).toBe(0);
    expect(text).toMatch(/PASS\s+Voice is not configured/);
  });

  it('is read-only: every docker command it runs only asks a question', () => {
    // Judged on what it RAN (the fake records every call), not on what it printed:
    // its hints legitimately mention `docker compose up`.
    for (const scenario of [{}, { state: { container_running: 'false' } }, { state: { container_health: 'unhealthy' } }]) {
      const { calls } = run(scenario);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, call).not.toMatch(/\bcompose (up|down|build|restart|pull|stop|start|rm)\b/);
        expect(call, call).not.toMatch(/^docker (run|rm|rmi|stop|start|restart|kill|tag|cp|pull|build)\b/);
        expect(call, call).not.toMatch(/tavvit-admin|snapshot\.ts/);
      }
    }
  });

  describe('program files', () => {
    const RELEASE_FILES = { 'install.sh': '#!/usr/bin/env bash\necho hi\n', 'src/a.txt': 'alpha\n' };

    it('says every file matches the release it came from', () => {
      const { r, text } = run({ release: RELEASE_FILES });
      expect(r.status, text).toBe(0);
      expect(text).toMatch(/PASS\s+Every program file matches release orbit-1\.11\.0-0badc0de/);
    });

    it('says what it cannot check when there is no MANIFEST', () => {
      const { r, text } = run();
      expect(r.status, text).toBe(0);
      expect(text).toContain('No MANIFEST here');
    });

    it('fails on a script with Windows line endings, and shows the fix', () => {
      const { r, text } = run({ files: { 'install.sh': '#!/usr/bin/env bash\r\necho hi\r\n' } });
      expect(r.status).toBe(1);
      expect(text).toMatch(/FAIL\s+These scripts have Windows line endings and will not run: .*install\.sh/);
      expect(text).toContain("sed -i 's/\\r$//'");
    });

    it('fails, naming the file, when part of the upload is missing', () => {
      const { r, text } = run({ release: RELEASE_FILES, remove: ['src/a.txt'] });
      expect(r.status).toBe(1);
      expect(text).toMatch(/FAIL\s+1 program file\(s\) are missing/);
      expect(text).toContain('src/a.txt');
      expect(text).toContain('bash update.sh --from');
    });

    it('warns, naming the file, when one was changed after the release', () => {
      const { r, text } = run({ release: RELEASE_FILES, files: { 'src/a.txt': 'edited\n' } });
      expect(r.status, text).toBe(0);
      expect(text).toMatch(/WARN\s+1 program file\(s\) differ from the release/);
      expect(text).toContain('src/a.txt');
    });
  });
});
