import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';

// The gate as a space sees it: who may do nothing there but read, and who is never asked.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let testDb: TestDb;
const mail = vi.hoisted(() => ({ on: true }));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, schema }));
vi.mock('./service.js', () => ({ emailEnabled: () => mail.on }));

const { accountNeedsVerifiedEmail } = await import('./gate.js');
const { memberActionRefusal } = await import('../utils/spaceModeration.js');
const { emailDomainBlocked } = await import('../utils/signupRules.js');
const { isThrowawayAddress } = await import('./throwaway.js');

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt.trim());
    }
  }
}

const SINCE = 1_000;
const user = (id: string, fields: Partial<typeof schema.users.$inferInsert> = {}) =>
  testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: SINCE + 1, ...fields }).run();

beforeEach(() => {
  mail.on = true;
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.instanceSettings).values({ id: 1, instanceId: 'test', updatedAt: 1, emailRequiredSince: SINCE }).run();
  testDb.insert(schema.users).values({ id: 'owner', username: 'owner', passwordHash: 'x', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: 'space', name: 'Space', ownerId: 'owner', createdAt: 1 }).run();
});

describe('a new account that has not confirmed its address', () => {
  it('does nothing in a space but read: every member action is refused', () => {
    user('fresh');
    expect(accountNeedsVerifiedEmail('fresh')).toBe(true);
    expect(memberActionRefusal('space', 'fresh')).toMatchObject({ status: 403, code: 'email_verification_required' });
  });

  it('is let through once confirmed', () => {
    user('confirmed', { emailVerifiedAt: SINCE + 2 });
    expect(memberActionRefusal('space', 'confirmed')).toBeNull();
  });
});

describe('the gate asks nobody else', () => {
  it('not accounts older than the switch, administrators, accounts from elsewhere, or programs', () => {
    user('old', { createdAt: SINCE - 1 });
    user('admin', { isAdmin: 1 });
    user('replica', { homeInstance: 'https://other.example' });
    user('bot', { accountKind: 'bot' });
    user('hook', { accountKind: 'webhook' });
    user('follow', { accountKind: 'follow' });
    for (const id of ['old', 'admin', 'replica', 'bot', 'hook', 'follow']) {
      expect(accountNeedsVerifiedEmail(id), id).toBe(false);
      expect(memberActionRefusal('space', id), id).toBeNull();
    }
  });

  it('nobody while mail is off or the gate is off', () => {
    user('fresh');
    mail.on = false;
    expect(memberActionRefusal('space', 'fresh')).toBeNull();
    mail.on = true;
    testDb.update(schema.instanceSettings).set({ emailRequiredSince: null }).run();
    expect(memberActionRefusal('space', 'fresh')).toBeNull();
  });
});

describe('a throwaway address', () => {
  it('is known, at its domain and below it, and a real provider is not one', () => {
    expect(isThrowawayAddress('someone@mailinator.com')).toBe(true);
    expect(isThrowawayAddress('someone@inbox.mailinator.com')).toBe(true);
    for (const real of ['gmail.com', 'outlook.com', 'gmx.de', 'web.de', 'proton.me', 'icloud.com']) {
      expect(isThrowawayAddress(`someone@${real}`), real).toBe(false);
    }
  });

  it('is refused while the instance refuses them, and taken when it does not', () => {
    expect(emailDomainBlocked('someone@yopmail.com')).toBe(true);
    expect(emailDomainBlocked('someone@example.org')).toBe(false);
    testDb.update(schema.instanceSettings).set({ blockThrowawayEmail: 0 }).run();
    expect(emailDomainBlocked('someone@yopmail.com')).toBe(false);
  });
});
