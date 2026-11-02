#!/usr/bin/env node
/**
 * Everything a new version has to pass, in one run that prints only what failed.
 *
 *   node scripts/release-check.mjs               all steps
 *   node scripts/release-check.mjs --only tests  one step: types, catalogs, lint, tests or build
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
 * The browser check is its own script, because it needs a running demo instance
 * (scripts/release-check-browser.mjs).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

const STEPS = { types, catalogs, lint, tests, build };

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
  const { ok, detail, note } = step();
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${seconds}s${note ? `, ${note}` : ''})`);
  if (!ok) {
    failedSteps += 1;
    if (detail) console.log(detail);
  }
}
console.log(failedSteps === 0 ? 'All steps passed.' : `${failedSteps} step(s) failed.`);
process.exit(failedSteps === 0 ? 0 : 1);
