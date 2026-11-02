#!/usr/bin/env node
/**
 * Everything a new version has to pass, in one run that prints only what failed.
 *
 *   node scripts/release-check.mjs               all steps
 *   node scripts/release-check.mjs --only tests  one step: types, catalogs, lint, tests, build or boot
 *
 * Why it exists: checking a release must not take a person, or an expensive tool,
 * reading through pages of green output. Each step keeps its output to itself and
 * says one line; a failing step adds what failed and nothing else. Tests run once,
 * and only the failed ones are named, with the first line of their error (`tests`
 * says what a second run means). The exit code is 0 only when every step passed.
 *
 * Lint covers the files changed since the last commit: what predates the lint step is
 * counted in eslint-suppressions.json, and linting the whole repository takes minutes.
 * With nothing changed there is nothing to lint.
 *
 * Boot starts the server the way the Docker image does, with NODE_ENV=production and
 * every optional part switched on: mail through Resend with its webhook, voice,
 * two-factor sign-in, translation, federation and the directory. It waits for
 * /api/health and asks the product page and the webhook's address. What a route
 * registers only when its part is configured is tested nowhere else: 1.32.5 passed
 * every test and did not start where mail went through Resend. The keys are made up
 * for the run and every address points at this machine, so nothing leaves it.
 *
 * The browser check is its own script, because it needs a running demo instance
 * (scripts/release-check-browser.mjs).
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_OUTPUT_LINES = 40;
const LINT_CHUNK = 70;

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: { ...process.env, CI: '1' },
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/** A path as an argument: on Windows the command goes through a shell, which would split it at a space. */
function quoted(file) {
  return process.platform === 'win32' ? `"${file}"` : file;
}

function tail(output) {
  const lines = output.split('\n');
  return (lines.length > MAX_OUTPUT_LINES ? [`… ${lines.length - MAX_OUTPUT_LINES} lines above`, ...lines.slice(-MAX_OUTPUT_LINES)] : lines).join('\n');
}

function types() {
  for (const name of ['shared', 'server', 'web', 'desktop']) {
    const { ok, output } = run('npx', ['tsc', '--noEmit', '-p', '.'], path.join(ROOT, 'packages', name));
    if (!ok) return { ok, detail: `packages/${name}\n${tail(output)}` };
  }
  return { ok: true };
}

function catalogs() {
  const { ok, output } = run('node', ['scripts/check-i18n.mjs']);
  return { ok, detail: ok ? '' : tail(output) };
}

function changedFiles() {
  const { output } = run('git', ['status', '--porcelain', '--untracked-files=all']);
  return output.split('\n')
    .filter((line) => line.length > 3 && !line.startsWith(' D') && !line.startsWith('D '))
    .map((line) => line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''))
    .filter((file) => /\.(ts|tsx|mjs|js)$/.test(file) && !file.startsWith('dist/'));
}

function lint() {
  const files = changedFiles();
  const problems = [];
  for (let start = 0; start < files.length; start += LINT_CHUNK) {
    const chunk = files.slice(start, start + LINT_CHUNK);
    const { ok, output } = run('npx', ['eslint', '--no-warn-ignored', '--pass-on-unpruned-suppressions', ...chunk.map(quoted)]);
    if (!ok) problems.push(output);
  }
  return { ok: problems.length === 0, detail: tail(problems.join('\n')), note: `${files.length} files` };
}

/** The first line of a failure, and what was expected when that is further down. */
function summaryOf(message) {
  const lines = String(message ?? '').split('\n').filter((line) => line.trim() !== '');
  const stack = lines.findIndex((line) => /^\s+at /.test(line));
  const text = stack === -1 ? lines : lines.slice(0, stack);
  const expected = text.find((line, index) => index > 0 && /expected .* to /.test(line));
  return [text[0], expected].filter(Boolean).map((line) => line.trim().slice(0, 200)).join(' ... ');
}

function readReport(reportFile, packageDir) {
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const failed = [];
  const files = new Set();
  for (const suite of report.testResults) {
    const file = path.relative(ROOT, suite.name).replace(/\\/g, '/');
    const inPackage = path.relative(packageDir, suite.name).replace(/\\/g, '/');
    if (suite.status === 'failed' && suite.assertionResults.length === 0) {
      failed.push(`${file}: ${summaryOf(suite.message)}`);
      files.add(inPackage);
    }
    for (const test of suite.assertionResults) {
      if (test.status !== 'failed') continue;
      failed.push(`${file} > ${test.title}: ${summaryOf(test.failureMessages?.[0])}`);
      files.add(inPackage);
    }
  }
  return { failed, files: [...files], total: report.numTotalTests };
}

function vitest(packageDir, reportFile, files = []) {
  const { output } = run('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${quoted(reportFile)}`, '--passWithNoTests', ...files.map(quoted)], packageDir);
  try {
    return readReport(reportFile, packageDir);
  } catch {
    return { error: tail(output) };
  }
}

/**
 * Every test once. Those that fail get one more run, by file and without the rest of
 * the suite beside them: some start real shells and move real files, which on a busy
 * machine can fail for reasons that are not the test's. Passing alone does not make such
 * a test fine, so it is named; but it does not fail the release.
 */
function tests() {
  const folder = mkdtempSync(path.join(tmpdir(), 'release-check-'));
  try {
    const failed = [];
    const shaky = [];
    const counts = [];
    for (const name of ['server', 'web']) {
      const packageDir = path.join(ROOT, 'packages', name);
      const first = vitest(packageDir, path.join(folder, `${name}.json`));
      if (first.error) return { ok: false, detail: `packages/${name} wrote no report\n${first.error}` };
      counts.push(`${name} ${first.total}`);
      if (first.failed.length === 0) continue;
      const again = vitest(packageDir, path.join(folder, `${name}-again.json`), first.files);
      if (again.error) return { ok: false, detail: `packages/${name} wrote no report\n${again.error}` };
      failed.push(...again.failed);
      shaky.push(...first.failed.filter((line) => !again.failed.some((still) => still.split(': ')[0] === line.split(': ')[0])));
    }
    const note = [counts.join(', '), shaky.length ? `\n     passed only alone:\n     ${shaky.join('\n     ')}` : ''].join('');
    return { ok: failed.length === 0, detail: failed.join('\n'), note };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function build() {
  const { ok, output } = run('npx', ['vite', 'build'], path.join(ROOT, 'packages', 'web'));
  return { ok, detail: ok ? '' : tail(output) };
}

const BOOT_TIMEOUT_MS = 120_000;
/** What a process needs from the shell around it to run at all; nothing the server reads as its configuration. */
const SYSTEM_KEYS = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA']);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** A port on the loopback address that the system just handed out and took back. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Every optional part on. Port 9 on this machine is where nothing answers. */
function productionLikeEnv(folder, port) {
  const nowhere = 'http://127.0.0.1:9';
  const system = Object.entries(process.env).filter(([key]) => SYSTEM_KEYS.has(key.toUpperCase()));
  return {
    ...Object.fromEntries(system),
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DOMAIN: 'release-check.localhost',
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    JWT_SECRET: randomBytes(32).toString('hex'),
    DB_PATH: path.join(folder, 'boot.db'),
    UPLOAD_DIR: path.join(folder, 'uploads'),
    BACKUP_DIR: path.join(folder, 'backups'),
    DOWNLOADS_DIR: path.join(folder, 'downloads'),
    EXPORT_DIR: path.join(folder, 'exports'),
    FEDERATION_ENABLED: 'true',
    TOTP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    EMAIL_TRANSPORT: 'resend',
    EMAIL_FROM: 'Tavvit <no-reply@release-check.localhost>',
    RESEND_API_KEY: `re_${randomBytes(16).toString('hex')}`,
    RESEND_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString('base64')}`,
    TRANSLATION_PROVIDER: 'deepl',
    DEEPL_API_KEY: `${randomBytes(16).toString('hex')}:fx`,
    LIVEKIT_URL: 'ws://127.0.0.1:9',
    LIVEKIT_API_URL: nowhere,
    LIVEKIT_API_KEY: 'release-check',
    LIVEKIT_API_SECRET: randomBytes(32).toString('hex'),
    DIRECTORY_ENDPOINT: nowhere,
  };
}

async function statusOf(port, urlPath, init = {}) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { ...init, signal: AbortSignal.timeout(5_000) });
    return { status: res.status, type: res.headers.get('content-type') ?? '' };
  } catch {
    return null;
  }
}

async function boot() {
  const folder = mkdtempSync(path.join(tmpdir(), 'release-check-boot-'));
  const port = await freePort();
  const output = [];
  const child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], {
    cwd: path.join(ROOT, 'packages', 'server'),
    env: productionLikeEnv(folder, port),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exited = false;
  const gone = new Promise((resolve) => { child.once('exit', () => { exited = true; resolve(); }); });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  const failed = (why) => ({ ok: false, detail: `${why}\n${tail(output.join('').trim())}` });

  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let health = null;
    while (!exited && Date.now() < deadline) {
      health = await statusOf(port, '/api/health');
      if (health?.status === 200) break;
      await sleep(250);
    }
    if (exited) return failed('The server stopped while starting.');
    if (health?.status !== 200) return failed(`No answer from /api/health within ${BOOT_TIMEOUT_MS / 1000}s.`);

    const unsigned = await statusOf(port, '/api/email/webhooks/resend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (unsigned?.status !== 401) return failed(`The Resend webhook answered ${unsigned?.status ?? 'nothing'} to an unsigned report, not 401.`);
    const info = await statusOf(port, '/api/instance/info');
    if (info?.status !== 200) return failed(`/api/instance/info answered ${info?.status ?? 'nothing'}.`);
    if (!existsSync(path.join(ROOT, 'packages', 'web', 'dist', 'index.html'))) return { ok: true, note: 'no web build, the page was not asked' };
    const page = await statusOf(port, '/');
    if (page?.status !== 200 || !page.type.startsWith('text/html')) return failed(`The product page answered ${page?.status ?? 'nothing'} (${page?.type ?? ''}).`);
    return { ok: true };
  } finally {
    if (!exited) child.kill();
    await Promise.race([gone, sleep(10_000)]);
    rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

const STEPS = { types, catalogs, lint, tests, build, boot };

const onlyAt = process.argv.indexOf('--only');
const only = onlyAt === -1 ? null : process.argv[onlyAt + 1];
if (only && !STEPS[only]) {
  console.error(`Unknown step "${only}". Steps: ${Object.keys(STEPS).join(', ')}`);
  process.exit(2);
}

let failedSteps = 0;
for (const [name, step] of Object.entries(STEPS)) {
  if (only && only !== name) continue;
  const started = Date.now();
  const { ok, detail, note } = await step();
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${seconds}s${note ? `, ${note}` : ''})`);
  if (!ok) {
    failedSteps += 1;
    if (detail) console.log(detail);
  }
}
console.log(failedSteps === 0 ? 'All steps passed.' : `${failedSteps} step(s) failed.`);
process.exit(failedSteps === 0 ? 0 : 1);
