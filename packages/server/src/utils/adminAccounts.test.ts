import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATAR_COLORS } from '@backspace/shared';
import { setWorkerId } from './snowflake.js';
import { verifyPassword } from './auth.js';
import {
  AccountOperationError,
  createAccount,
  generatePassword,
  listLocalAccounts,
  normalizeUsername,
  resetAccountPassword,
} from './adminAccounts.js';

setWorkerId(8);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function migratedDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
  return db;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  password_hash: string;
  is_admin: number;
  home_instance: string | null;
  avatar_color: string | null;
  password_changed_at: number | null;
}

const userRow = (db: Database.Database, username: string) =>
  db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;

let db: Database.Database;
beforeEach(() => {
  db = migratedDb();
});

const GOOD_PASSWORD = 'a perfectly fine passphrase';

describe('createAccount', () => {
  it('creates a local administrator whose password is stored hashed, never in clear', async () => {
    const created = await createAccount(db, { username: 'alice', password: GOOD_PASSWORD, isAdmin: true });
    const row = userRow(db, 'alice');
    expect(created).toEqual({ id: row?.id, username: 'alice' });
    expect(row?.is_admin).toBe(1);
    expect(row?.home_instance).toBeNull();
    expect(row?.password_hash).not.toContain(GOOD_PASSWORD);
    expect(await verifyPassword(GOOD_PASSWORD, row!.password_hash)).toBe(true);
    expect(await verifyPassword('not the password', row!.password_hash)).toBe(false);
  });

  it('creates a member without admin rights', async () => {
    await createAccount(db, { username: 'bob', password: GOOD_PASSWORD, isAdmin: false });
    expect(userRow(db, 'bob')?.is_admin).toBe(0);
  });

  it('stores the name the way registration does: trimmed and lowercased', async () => {
    await createAccount(db, { username: '  Carol_9 ', password: GOOD_PASSWORD, isAdmin: false });
    expect(userRow(db, 'carol_9')).toBeDefined();
    expect(normalizeUsername('  MiXeD ')).toBe('mixed');
  });

  it('gives the account a real avatar colour and keeps an optional display name', async () => {
    await createAccount(db, { username: 'dana', password: GOOD_PASSWORD, isAdmin: false, displayName: '  Dana D.  ' });
    const row = userRow(db, 'dana');
    expect(AVATAR_COLORS as readonly string[]).toContain(row?.avatar_color);
    expect(row?.display_name).toBe('Dana D.');
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(33)],
    ['with a space', 'two words'],
    ['with an at sign', 'a@b.example'],
    ['with a non-ASCII letter', 'héllo'],
    ['with a dash', 'no-dash'],
    ['empty', '   '],
  ])('refuses a username %s', async (_label, username) => {
    await expect(createAccount(db, { username, password: GOOD_PASSWORD, isAdmin: false }))
      .rejects.toMatchObject({ code: 'username_invalid' });
    expect(listLocalAccounts(db)).toHaveLength(0);
  });

  it('accepts the boundary lengths 3 and 32', async () => {
    await createAccount(db, { username: 'abc', password: GOOD_PASSWORD, isAdmin: false });
    await createAccount(db, { username: 'a'.repeat(32), password: GOOD_PASSWORD, isAdmin: false });
    expect(listLocalAccounts(db)).toHaveLength(2);
  });

  it('refuses a username that is taken, whatever its case', async () => {
    await createAccount(db, { username: 'erin', password: GOOD_PASSWORD, isAdmin: false });
    await expect(createAccount(db, { username: 'ERIN', password: GOOD_PASSWORD, isAdmin: true }))
      .rejects.toMatchObject({ code: 'username_taken' });
    expect(userRow(db, 'erin')?.is_admin).toBe(0);
  });

  it('refuses a password shorter than the registration minimum', async () => {
    await expect(createAccount(db, { username: 'frank', password: 'short', isAdmin: false }))
      .rejects.toMatchObject({ code: 'password_too_short' });
    expect(userRow(db, 'frank')).toBeUndefined();
  });

  it('throws an AccountOperationError, whose message is fit to show an operator', async () => {
    const error = await createAccount(db, { username: 'x', password: GOOD_PASSWORD, isAdmin: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountOperationError);
    expect((error as Error).message).toMatch(/3-32 characters/);
  });
});

describe('resetAccountPassword', () => {
  it('replaces the password and stamps password_changed_at, which signs out every old session', async () => {
    await createAccount(db, { username: 'gina', password: GOOD_PASSWORD, isAdmin: true });
    const before = Date.now();
    await resetAccountPassword(db, 'GINA', 'a brand new passphrase');
    const row = userRow(db, 'gina')!;
    expect(await verifyPassword('a brand new passphrase', row.password_hash)).toBe(true);
    expect(await verifyPassword(GOOD_PASSWORD, row.password_hash)).toBe(false);
    expect(row.password_changed_at).toBeGreaterThanOrEqual(before);
    expect(row.is_admin).toBe(1); // a reset never changes the role
  });

  it('refuses an account that does not exist', async () => {
    await expect(resetAccountPassword(db, 'nobody', GOOD_PASSWORD)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a deleted account', async () => {
    await createAccount(db, { username: 'hank', password: GOOD_PASSWORD, isAdmin: false });
    db.prepare('UPDATE users SET is_deleted = 1 WHERE username = ?').run('hank');
    await expect(resetAccountPassword(db, 'hank', GOOD_PASSWORD)).rejects.toMatchObject({ code: 'deleted' });
  });

  it('refuses an account that belongs to another instance, which holds its password', async () => {
    db.prepare(
      "INSERT INTO users (id, username, password_hash, home_instance, created_at) VALUES ('f1', 'ivy@peer.test', '!federation-replicated', 'peer.test', 1)",
    ).run();
    await expect(resetAccountPassword(db, 'ivy@peer.test', GOOD_PASSWORD)).rejects.toMatchObject({ code: 'not_local' });
    expect(userRow(db, 'ivy@peer.test')?.password_hash).toBe('!federation-replicated');
  });

  it('refuses a short password and leaves the old one working', async () => {
    await createAccount(db, { username: 'jack', password: GOOD_PASSWORD, isAdmin: false });
    await expect(resetAccountPassword(db, 'jack', 'tiny')).rejects.toMatchObject({ code: 'password_too_short' });
    expect(await verifyPassword(GOOD_PASSWORD, userRow(db, 'jack')!.password_hash)).toBe(true);
  });
});

describe('listLocalAccounts', () => {
  it('lists administrators first, then oldest first, and leaves out deleted and federated accounts', async () => {
    await createAccount(db, { username: 'zoe', password: GOOD_PASSWORD, isAdmin: false });
    await createAccount(db, { username: 'amy', password: GOOD_PASSWORD, isAdmin: true });
    await createAccount(db, { username: 'gone', password: GOOD_PASSWORD, isAdmin: false });
    db.prepare('UPDATE users SET is_deleted = 1 WHERE username = ?').run('gone');
    db.prepare("INSERT INTO users (id, username, password_hash, home_instance, created_at) VALUES ('f2', 'far@peer.test', 'x', 'peer.test', 1)").run();
    const names = listLocalAccounts(db).map((a) => `${a.username}:${a.isAdmin ? 'admin' : 'member'}`);
    expect(names).toEqual(['amy:admin', 'zoe:member']);
  });

  it('never exposes a password hash', async () => {
    await createAccount(db, { username: 'kim', password: GOOD_PASSWORD, isAdmin: false });
    expect(JSON.stringify(listLocalAccounts(db))).not.toMatch(/\$2[aby]\$/);
  });
});

describe('generatePassword', () => {
  it('makes a long, URL-safe, different password every time', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(a).not.toBe(b);
  });
});
