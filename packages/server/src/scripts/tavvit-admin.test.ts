import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { setWorkerId } from '../utils/snowflake.js';
import { verifyPassword } from '../utils/auth.js';
import { CliError, openInstanceDatabase, parseArgs, runCli, type CliIo } from './tavvit-admin.js';

setWorkerId(9);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function migrate(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

interface FakeIoOptions {
  interactive?: boolean;
  stdin?: string;
  /** Answers handed to the hidden password prompt, in order. */
  prompts?: string[];
}

function fakeIo(options: FakeIoOptions = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const answers = [...(options.prompts ?? [])];
  const io: CliIo = {
    isInteractive: options.interactive ?? false,
    readStdin: async () => options.stdin ?? '',
    promptHidden: async (question) => {
      asked.push(question);
      const next = answers.shift();
      if (next === undefined) throw new Error('prompted more often than the test expected');
      return next;
    },
    out: (text) => { out.push(text); },
    err: (text) => { err.push(text); },
  };
  return { io, out, err, asked, all: () => [...out, ...err].join('\n') };
}

let db: Database.Database;
/** The CLI closes the handle it is given, so each command gets one over the same file-less database. */
let opens: number;
const openDb = (): Database.Database => {
  opens += 1;
  // Hand out a proxy whose close() is a no-op: an in-memory database is destroyed by close().
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'close') return () => undefined;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};

const row = (username: string) =>
  db.prepare('SELECT username, is_admin, password_hash, password_changed_at FROM users WHERE username = ?').get(username) as
    { username: string; is_admin: number; password_hash: string; password_changed_at: number | null } | undefined;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  opens = 0;
});

describe('parseArgs', () => {
  it('splits the command, positionals and flags', () => {
    const parsed = parseArgs(['create', 'alice', '--admin', '--display-name', 'Alice A.', '--generate']);
    expect(parsed.command).toBe('create');
    expect(parsed.positionals).toEqual(['alice']);
    expect(parsed.flags.get('admin')).toBe(true);
    expect(parsed.flags.get('generate')).toBe(true);
    expect(parsed.flags.get('display-name')).toBe('Alice A.');
  });

  it('accepts --flag=value for value flags', () => {
    expect(parseArgs(['create', 'a', '--display-name=Zed']).flags.get('display-name')).toBe('Zed');
  });

  it('rejects a value flag with no value, and a switch given a value', () => {
    expect(() => parseArgs(['create', 'a', '--display-name'])).toThrow(CliError);
    expect(() => parseArgs(['create', 'a', '--admin=yes'])).toThrow(CliError);
  });

  it('has no command when given nothing', () => {
    expect(parseArgs([]).command).toBeUndefined();
  });
});

describe('create', () => {
  it('makes the first administrator with a generated password, printed once', async () => {
    const t = fakeIo();
    const code = await runCli(['create', 'alice', '--admin', '--generate'], t.io, openDb);
    expect(code).toBe(0);
    expect(row('alice')?.is_admin).toBe(1);
    const printed = t.out.find((l) => l.startsWith('Password (shown once'));
    expect(printed).toBeDefined();
    const password = printed!.split(': ')[1]!;
    expect(await verifyPassword(password, row('alice')!.password_hash)).toBe(true);
    expect(t.out.join('\n')).toMatch(/Created administrator account "alice"/);
  });

  it('reads a password from stdin and prints nothing secret', async () => {
    const t = fakeIo({ stdin: 'correct horse battery\n' });
    const code = await runCli(['create', 'bob', '--member', '--password-stdin'], t.io, openDb);
    expect(code).toBe(0);
    expect(row('bob')?.is_admin).toBe(0);
    expect(await verifyPassword('correct horse battery', row('bob')!.password_hash)).toBe(true);
    expect(t.all()).not.toContain('correct horse battery');
  });

  it('strips a Windows line ending from a piped password', async () => {
    const t = fakeIo({ stdin: 'piped from windows\r\nignored second line\n' });
    await runCli(['create', 'cara', '--member', '--password-stdin'], t.io, openDb);
    expect(await verifyPassword('piped from windows', row('cara')!.password_hash)).toBe(true);
  });

  it('asks twice at a hidden prompt when a person is at a terminal', async () => {
    const t = fakeIo({ interactive: true, prompts: ['typed passphrase 1', 'typed passphrase 1'] });
    const code = await runCli(['create', 'dave', '--admin'], t.io, openDb);
    expect(code).toBe(0);
    expect(t.asked).toEqual(['Password: ', 'Repeat password: ']);
    expect(await verifyPassword('typed passphrase 1', row('dave')!.password_hash)).toBe(true);
    expect(t.all()).not.toContain('typed passphrase 1');
  });

  it('creates nothing when the two typed passwords differ', async () => {
    const t = fakeIo({ interactive: true, prompts: ['first try here', 'second try here'] });
    const code = await runCli(['create', 'eve', '--admin'], t.io, openDb);
    expect(code).toBe(2);
    expect(row('eve')).toBeUndefined();
    expect(t.err.join('\n')).toMatch(/do not match/);
  });

  it('refuses without a role, so nobody is made an administrator by accident', async () => {
    const t = fakeIo();
    expect(await runCli(['create', 'frank', '--generate'], t.io, openDb)).toBe(1);
    expect(row('frank')).toBeUndefined();
    expect(t.err.join('\n')).toMatch(/--admin or --member/);
  });

  it('refuses both roles at once', async () => {
    const t = fakeIo();
    expect(await runCli(['create', 'gus', '--admin', '--member', '--generate'], t.io, openDb)).toBe(1);
    expect(row('gus')).toBeUndefined();
  });

  it('refuses with no way to supply a password, instead of hanging on a prompt nobody can answer', async () => {
    const t = fakeIo({ interactive: false });
    expect(await runCli(['create', 'hal', '--admin'], t.io, openDb)).toBe(1);
    expect(t.err.join('\n')).toMatch(/exec -it|--generate|--password-stdin/);
    expect(t.asked).toEqual([]);
  });

  it('refuses --generate together with --password-stdin', async () => {
    const t = fakeIo({ stdin: 'whatever it is' });
    expect(await runCli(['create', 'ian', '--admin', '--generate', '--password-stdin'], t.io, openDb)).toBe(1);
  });

  it('refuses an empty stdin password', async () => {
    const t = fakeIo({ stdin: '\n' });
    expect(await runCli(['create', 'joan', '--admin', '--password-stdin'], t.io, openDb)).toBe(1);
    expect(row('joan')).toBeUndefined();
  });

  it('reports a taken username as a refusal, not a crash', async () => {
    await runCli(['create', 'kay', '--member', '--generate'], fakeIo().io, openDb);
    const t = fakeIo();
    expect(await runCli(['create', 'KAY', '--admin', '--generate'], t.io, openDb)).toBe(2);
    expect(t.err.join('\n')).toMatch(/already taken/);
    expect(row('kay')?.is_admin).toBe(0);
  });

  it('reports a malformed username in terms the operator can act on', async () => {
    const t = fakeIo();
    expect(await runCli(['create', 'no way!', '--admin', '--generate'], t.io, openDb)).toBe(2);
    expect(t.err.join('\n')).toMatch(/lowercase letters, digits and underscores/);
  });

  it('records a display name', async () => {
    await runCli(['create', 'lou', '--member', '--generate', '--display-name', 'Lou the Great'], fakeIo().io, openDb);
    const r = db.prepare('SELECT display_name FROM users WHERE username = ?').get('lou') as { display_name: string };
    expect(r.display_name).toBe('Lou the Great');
  });

  it('needs exactly one username', async () => {
    expect(await runCli(['create', '--admin', '--generate'], fakeIo().io, openDb)).toBe(1);
    expect(await runCli(['create', 'a1', 'b2', '--admin', '--generate'], fakeIo().io, openDb)).toBe(1);
  });

  it('opens the database before asking for a password', async () => {
    const t = fakeIo({ interactive: true, prompts: ['x'.repeat(10), 'x'.repeat(10)] });
    const failing = (): Database.Database => { throw new CliError('database not ready'); };
    expect(await runCli(['create', 'max', '--admin'], t.io, failing)).toBe(2);
    expect(t.asked).toEqual([]);
    expect(t.err.join('\n')).toMatch(/database not ready/);
  });
});

describe('reset-password', () => {
  it('changes the password and says everyone is signed out', async () => {
    await runCli(['create', 'nia', '--admin', '--password-stdin'], fakeIo({ stdin: 'the old passphrase' }).io, openDb);
    const t = fakeIo({ stdin: 'the new passphrase' });
    expect(await runCli(['reset-password', 'NIA', '--password-stdin'], t.io, openDb)).toBe(0);
    const r = row('nia')!;
    expect(await verifyPassword('the new passphrase', r.password_hash)).toBe(true);
    expect(await verifyPassword('the old passphrase', r.password_hash)).toBe(false);
    expect(r.password_changed_at).not.toBeNull();
    expect(r.is_admin).toBe(1);
    expect(t.out.join('\n')).toMatch(/signed out/);
  });

  it('refuses an account that is not there', async () => {
    const t = fakeIo();
    expect(await runCli(['reset-password', 'ghost', '--generate'], t.io, openDb)).toBe(2);
    expect(t.err.join('\n')).toMatch(/no account named "ghost"/);
  });

  it('prints a generated password once', async () => {
    await runCli(['create', 'ozzy', '--member', '--generate'], fakeIo().io, openDb);
    const t = fakeIo();
    expect(await runCli(['reset-password', 'ozzy', '--generate'], t.io, openDb)).toBe(0);
    const line = t.out.find((l) => l.startsWith('New password (shown once'))!;
    expect(await verifyPassword(line.split(': ')[1]!, row('ozzy')!.password_hash)).toBe(true);
  });
});

describe('list and status', () => {
  it('points an empty instance at the first-admin command', async () => {
    const t = fakeIo();
    expect(await runCli(['list'], t.io, openDb)).toBe(0);
    expect(t.out.join('\n')).toMatch(/create <username> --admin/);
  });

  it('lists accounts with their roles', async () => {
    await runCli(['create', 'pat', '--admin', '--generate'], fakeIo().io, openDb);
    await runCli(['create', 'quin', '--member', '--generate'], fakeIo().io, openDb);
    const t = fakeIo();
    await runCli(['list'], t.io, openDb);
    const text = t.out.join('\n');
    expect(text).toMatch(/pat\s+admin/);
    expect(text).toMatch(/quin\s+member/);
    expect(text).not.toMatch(/\$2[aby]\$/);
  });

  it('reports the posture of the instance, and the first-admin step while there is no account', async () => {
    // The suite turns federation on globally (test/setup-env.ts); a private instance has it off.
    const federation = config.federation as { enabled: boolean };
    federation.enabled = false;
    try {
      db.prepare("INSERT INTO instance_settings (id, registration_open, updated_at) VALUES (1, 0, 1)").run();
      const t = fakeIo();
      expect(await runCli(['status'], t.io, openDb)).toBe(0);
      const text = t.out.join('\n');
      expect(text).toMatch(/registration\s*: closed/);
      expect(text).toMatch(/federation\s*: disabled/);
      expect(text).toMatch(/NEXT STEP/);
      // The step names the wrapper an operator runs on the server, not the TypeScript file behind it.
      expect(text).toMatch(/tavvit-admin\.sh create <username> --admin/);
    } finally {
      federation.enabled = true;
    }
  });

  it('stops naming the first-admin step once an account exists, and counts the administrators', async () => {
    db.prepare("INSERT INTO instance_settings (id, registration_open, updated_at) VALUES (1, 0, 1)").run();
    await runCli(['create', 'rhea', '--admin', '--generate'], fakeIo().io, openDb);
    const t = fakeIo();
    await runCli(['status'], t.io, openDb);
    const text = t.out.join('\n');
    expect(text).toMatch(/accounts\s*: 1 \(1 admin\)/);
    expect(text).not.toMatch(/NEXT STEP/);
  });
});

describe('usage', () => {
  it('prints usage and exits 1 when run with no command', async () => {
    const t = fakeIo();
    expect(await runCli([], t.io, openDb)).toBe(1);
    expect(t.out.join('\n')).toMatch(/Usage:/);
  });

  it('prints usage and exits 0 for help', async () => {
    const t = fakeIo();
    expect(await runCli(['help'], t.io, openDb)).toBe(0);
    expect(await runCli(['create', '--help'], fakeIo().io, openDb)).toBe(0);
  });

  it('rejects an unknown command and an unknown option', async () => {
    expect(await runCli(['frobnicate'], fakeIo().io, openDb)).toBe(1);
    expect(await runCli(['list', '--force'], fakeIo().io, openDb)).toBe(1);
  });

  it('never touched the database for a usage error', async () => {
    await runCli(['create'], fakeIo().io, openDb);
    await runCli(['bogus'], fakeIo().io, openDb);
    expect(opens).toBe(0);
  });
});

describe('openInstanceDatabase', () => {
  it('refuses a path with no database, telling the operator to start the server first', () => {
    expect(() => openInstanceDatabase(path.join(os.tmpdir(), 'orbit-no-such-db.sqlite')))
      .toThrow(/Start the server once/);
  });

  it('refuses a database the server has not finished setting up', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-cli-')), 'empty.db');
    new Database(file).close();
    expect(() => openInstanceDatabase(file)).toThrow(/has not been set up by the server yet/);
  });

  it('opens a migrated, initialised database and uses its Snowflake worker id', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-cli-')), 'ok.db');
    const seeded = new Database(file);
    migrate(seeded);
    seeded.prepare('INSERT INTO instance_settings (id, worker_id, updated_at) VALUES (1, 12, 1)').run();
    seeded.close();
    const opened = openInstanceDatabase(file);
    try {
      const t = fakeIo();
      expect(await runCli(['list'], t.io, () => opened)).toBe(0);
    } finally {
      // runCli closed it; a second close on a closed handle is harmless
    }
    // Runs every migration on a real file, which under a loaded full run takes its time.
  }, 30_000);
});
