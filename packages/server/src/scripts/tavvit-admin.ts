import Database from 'better-sqlite3';
import fs from 'node:fs';
import { config } from '../config.js';
import { setWorkerId } from '../utils/snowflake.js';
import {
  AccountOperationError,
  createAccount,
  generatePassword,
  listLocalAccounts,
  resetAccountPassword,
  resetAccountTwoFactor,
} from '../utils/adminAccounts.js';
import { buildStartupSummary } from '../utils/startupSummary.js';

/**
 * Tavvit's operator tool: create the first administrator, add or recover
 * accounts, and see where an instance stands, all from the server's shell.
 *
 *   docker compose exec -it backspace node --import tsx/esm src/scripts/tavvit-admin.ts <command>
 *   (or `./tavvit-admin.sh <command>` from the repository, which runs exactly that)
 *
 * It exists because a private instance has no open registration, so the first
 * account cannot be made through the browser. See docs/tavvit/FIRST-ADMIN.md.
 *
 * Passwords are never taken as command-line arguments (they would sit in shell
 * history and the process list). They are typed at a hidden prompt, piped on
 * stdin, or generated and printed once.
 */

const USAGE = `Tavvit operator tool

Usage:
  tavvit-admin create <username> --admin|--member [--display-name "Name"] [PASSWORD]
  tavvit-admin reset-password <username> [PASSWORD]
  tavvit-admin reset-2fa <username>
  tavvit-admin list
  tavvit-admin status

PASSWORD is one of:
  (nothing)         type it at a hidden prompt (needs a terminal: use \`exec -it\`)
  --generate        make a random password and print it once
  --password-stdin  read it from standard input (first line)

create needs --admin or --member, so an account is never made an administrator by accident.
Usernames are 3-32 characters: lowercase letters, digits and underscores.
`;

export class CliError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message);
    this.name = 'CliError';
  }
}

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Map<string, string | true>;
}

/** Flags that take a value; every other `--flag` is a switch. */
const VALUE_FLAGS = new Set(['display-name']);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq));
    if (VALUE_FLAGS.has(name)) {
      const value = eq === -1 ? argv[(i += 1)] : arg.slice(eq + 1);
      if (value === undefined || value === '') throw new CliError(`--${name} needs a value.`, 1);
      flags.set(name, value);
    } else {
      if (eq !== -1) throw new CliError(`--${name} does not take a value.`, 1);
      flags.set(name, true);
    }
  }
  const [command, ...rest] = positionals;
  return { command, positionals: rest, flags };
}

/** Everything the commands need from the outside world, so tests can supply it. */
export interface CliIo {
  /** Whether a person is at a terminal that can type a hidden password. */
  isInteractive: boolean;
  readStdin(): Promise<string>;
  promptHidden(question: string): Promise<string>;
  out(text: string): void;
  err(text: string): void;
}

const KNOWN_FLAGS = new Set(['admin', 'member', 'generate', 'password-stdin', 'display-name', 'help']);

function assertKnownFlags(flags: ParsedArgs['flags']): void {
  for (const name of flags.keys()) {
    if (!KNOWN_FLAGS.has(name)) throw new CliError(`Unknown option --${name}.\n\n${USAGE}`, 1);
  }
}

async function resolvePassword(
  flags: ParsedArgs['flags'],
  io: CliIo,
): Promise<{ password: string; generated: boolean }> {
  const generate = flags.has('generate');
  const fromStdin = flags.has('password-stdin');
  if (generate && fromStdin) throw new CliError('Use either --generate or --password-stdin, not both.', 1);

  if (generate) return { password: generatePassword(), generated: true };

  if (fromStdin) {
    const first = (await io.readStdin()).split('\n')[0]?.replace(/\r$/, '') ?? '';
    if (first === '') throw new CliError('--password-stdin got no input.', 1);
    return { password: first, generated: false };
  }

  if (!io.isInteractive) {
    throw new CliError(
      'No terminal to type a password into. Run with `exec -it`, or pass --generate or --password-stdin.',
      1,
    );
  }
  const first = await io.promptHidden('Password: ');
  const again = await io.promptHidden('Repeat password: ');
  if (first !== again) throw new CliError('The two passwords do not match. Nothing was changed.');
  return { password: first, generated: false };
}

function describeAge(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Run one command. Returns the process exit code: 0 done, 1 wrong usage,
 * 2 the operation was refused or failed. Output goes through `io`.
 */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  openDatabase: () => Database.Database,
): Promise<number> {
  try {
    const { command, positionals, flags } = parseArgs(argv);
    assertKnownFlags(flags);

    if (command === undefined || command === 'help' || flags.has('help')) {
      io.out(USAGE);
      return command === undefined && !flags.has('help') ? 1 : 0;
    }

    switch (command) {
      case 'create': {
        const [rawUsername, ...extra] = positionals;
        if (!rawUsername || extra.length > 0) throw new CliError(`create takes exactly one username.\n\n${USAGE}`, 1);
        const wantsAdmin = flags.has('admin');
        const wantsMember = flags.has('member');
        if (wantsAdmin === wantsMember) {
          throw new CliError('Say what the account is: pass --admin or --member (exactly one).', 1);
        }
        const displayName = typeof flags.get('display-name') === 'string' ? (flags.get('display-name') as string) : null;
        // Open the database first: better to learn it is not ready before typing a password than after.
        const db = openDatabase();
        try {
          const { password, generated } = await resolvePassword(flags, io);
          const created = await createAccount(db, { username: rawUsername, password, isAdmin: wantsAdmin, displayName });
          io.out(`Created ${wantsAdmin ? 'administrator' : 'member'} account "${created.username}".`);
          if (generated) {
            io.out(`Password (shown once, copy it now): ${password}`);
            io.out('They can change it under Settings, Account, after signing in.');
          }
          if (config.domain) io.out(`Sign in at https://${config.domain}`);
        } finally {
          db.close();
        }
        return 0;
      }

      case 'reset-password': {
        const [rawUsername, ...extra] = positionals;
        if (!rawUsername || extra.length > 0) throw new CliError(`reset-password takes exactly one username.\n\n${USAGE}`, 1);
        const db = openDatabase();
        try {
          const { password, generated } = await resolvePassword(flags, io);
          const done = await resetAccountPassword(db, rawUsername, password);
          io.out(`Password changed for "${done.username}". Everyone signed in as them is signed out.`);
          if (generated) io.out(`New password (shown once, copy it now): ${password}`);
        } finally {
          db.close();
        }
        return 0;
      }

      case 'reset-2fa': {
        const [rawUsername, ...extra] = positionals;
        if (!rawUsername || extra.length > 0) throw new CliError(`reset-2fa takes exactly one username.\n\n${USAGE}`, 1);
        const db = openDatabase();
        try {
          const done = resetAccountTwoFactor(db, rawUsername);
          io.out(`Two-factor authentication is off for "${done.username}", and every device is signed out. Their confirmed address, if any, is told.`);
        } finally {
          db.close();
        }
        return 0;
      }

      case 'list': {
        const db = openDatabase();
        try {
          const accounts = listLocalAccounts(db);
          if (accounts.length === 0) {
            io.out('No accounts yet. Create the first administrator with:  create <username> --admin');
          } else {
            const width = Math.max(8, ...accounts.map((a) => a.username.length));
            io.out(`${'USERNAME'.padEnd(width)}  ROLE    CREATED     DISPLAY NAME`);
            for (const a of accounts) {
              io.out(`${a.username.padEnd(width)}  ${(a.isAdmin ? 'admin' : 'member').padEnd(6)}  ${describeAge(a.createdAt)}  ${a.displayName ?? ''}`);
            }
          }
        } finally {
          db.close();
        }
        return 0;
      }

      case 'status': {
        const db = openDatabase();
        try {
          for (const line of buildStartupSummary(db, config)) io.out(line);
        } finally {
          db.close();
        }
        return 0;
      }

      default:
        throw new CliError(`Unknown command "${command}".\n\n${USAGE}`, 1);
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.err(error.message);
      return error.exitCode;
    }
    if (error instanceof AccountOperationError) {
      io.err(error.message);
      return 2;
    }
    throw error;
  }
}

/** Open the live database file the way the server does, refusing anything that is not a migrated Tavvit database. */
export function openInstanceDatabase(dbPath: string = config.dbPath): Database.Database {
  if (!fs.existsSync(dbPath)) {
    throw new CliError(
      `There is no database at ${dbPath}. Start the server once so it can create and migrate it, then run this again.`,
    );
  }
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    // The server holds this file open in WAL mode; wait briefly rather than fail if it is mid-write.
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    const worker = hasUsers
      ? db.prepare('SELECT worker_id FROM instance_settings WHERE id = 1').get() as { worker_id: number | null } | undefined
      : undefined;
    if (!hasUsers || worker?.worker_id === undefined || worker.worker_id === null) {
      throw new CliError(
        `${dbPath} has not been set up by the server yet. Start the server once so it can finish creating it, then run this again.`,
      );
    }
    // New account ids come from the same Snowflake sequence the server uses.
    setWorkerId(worker.worker_id);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function terminalIo(): CliIo {
  const stdin = process.stdin;
  return {
    isInteractive: Boolean(stdin.isTTY && process.stdout.isTTY),
    out: (text) => { process.stdout.write(`${text}\n`); },
    err: (text) => { process.stderr.write(`${text}\n`); },
    readStdin: () => new Promise<string>((resolve, reject) => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => { data += chunk; });
      stdin.on('end', () => resolve(data));
      stdin.on('error', reject);
    }),
    promptHidden: (question) => new Promise<string>((resolve, reject) => {
      process.stdout.write(question);
      let value = '';
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      const finish = (): void => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
      };
      const onData = (chunk: string): void => {
        for (const ch of chunk) {
          if (ch === '\u0003') { finish(); reject(new CliError('Cancelled. Nothing was changed.')); return; }
          if (ch === '\r' || ch === '\n') { finish(); resolve(value); return; }
          if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue; }
          value += ch;
        }
      };
      stdin.on('data', onData);
    }),
  };
}

// CLI entrypoint. Run inside the container, where the server's environment
// (DB_PATH, JWT_SECRET) is already set:
//   docker compose exec -it backspace node --import tsx/esm src/scripts/tavvit-admin.ts create alice --admin
const isMain = process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('/tavvit-admin.ts');
if (isMain) {
  runCli(process.argv.slice(2), terminalIo(), () => openInstanceDatabase())
    .then((code) => { process.exit(code); })
    .catch((error: unknown) => {
      if (error instanceof CliError) {
        process.stderr.write(`${error.message}\n`);
        process.exit(error.exitCode);
      }
      process.stderr.write(`tavvit-admin failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    });
}
