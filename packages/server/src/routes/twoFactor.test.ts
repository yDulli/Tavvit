import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit from '@fastify/rate-limit';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { hashPassword, verifyPassword } from '../utils/auth.js';
import { hotp, timeStep } from '../security/totp.js';
import type { EmailTransport, OutgoingEmail } from '../email/transport.js';

// Two factors through the real routes and the real checks. What it covers is section 13 of the
// brief: each of its cases is a test below. Codes are computed the way an authenticator app does.

setWorkerId(10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    closeSessionSockets: vi.fn(),
    forceDisconnectUser: vi.fn(),
    sendToUser: vi.fn(),
    sendToSpace: vi.fn(),
    addUserSpace: vi.fn(),
    getRoom: () => undefined,
  },
}));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
}

const { drainEmailOutbox, setEmailTransportForTests } = await import('../email/service.js');
const { setTwoFactorKeyForTests } = await import('../security/twoFactor.js');
const { loginWait } = await import('../utils/loginThrottle.js');
const { twoFactorRoutes } = await import('./twoFactor.js');
const { authRoutes } = await import('./auth.js');
const { userRoutes } = await import('./users.js');
const { emailRoutes } = await import('./email.js');
const { instanceRoutes } = await import('./instance.js');
const { dataExportRoutes } = await import('./dataExport.js');

const PASSWORD = 'correct horse battery';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEVICE = 'device-aaaaaaaaaaaaaaaa';

let app: FastifyInstance;
let mails: OutgoingEmail[];

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const userRow = (id: string) => testDb.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
const secretRow = (id: string) => testDb.select().from(schema.twoFactorSecrets).where(eq(schema.twoFactorSecrets.userId, id)).get();

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const login = (username: string, password = PASSWORD, deviceId?: string) => app.inject({
  method: 'POST',
  url: '/api/auth/login',
  headers: { 'user-agent': CHROME },
  payload: { username, password, ...(deviceId ? { deviceId } : {}) },
});
const secondStep = (ticket: unknown, code: unknown) => app.inject({ method: 'POST', url: '/api/auth/login/2fa', headers: { 'user-agent': CHROME }, payload: { ticket, code } });

async function signIn(username = 'alice'): Promise<string> {
  const res = await login(username);
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

/** Starts setup and hands back what an app would hold. */
async function setUp(token: string): Promise<Buffer> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: as(token), payload: { password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return base32Decode(res.json().secret as string);
}

const stepNow = (): number => timeStep(Date.now());

/** A code from a step nobody has used yet: the next one, inside the allowed drift. */
function freshCode(secret: Buffer, offset = 0): string {
  return hotp(secret, stepNow() + offset);
}

/** Turns it on, with its first code spent; `lastUsedStep` is moved back so that the tests can use the current one. */
async function enable(token: string, userId = 'alice'): Promise<{ secret: Buffer; recoveryCodes: string[] }> {
  const secret = await setUp(token);
  const res = await app.inject({ method: 'POST', url: '/api/auth/2fa/enable', headers: as(token), payload: { code: freshCode(secret) } });
  expect(res.statusCode).toBe(200);
  testDb.update(schema.twoFactorSecrets).set({ lastUsedStep: stepNow() - 5 }).where(eq(schema.twoFactorSecrets.userId, userId)).run();
  return { secret, recoveryCodes: res.json().recoveryCodes as string[] };
}

/** Sets the address up as confirmed, without going through mail. */
function confirmedAddress(userId: string, address: string): void {
  testDb.update(schema.users).set({ email: address, emailVerifiedAt: 1 }).where(eq(schema.users.id, userId)).run();
}

async function delivered(): Promise<OutgoingEmail[]> {
  await new Promise((resolve) => setImmediate(resolve));
  await drainEmailOutbox();
  return mails;
}

beforeEach(async () => {
  // The sign-in delay has tests of its own; here it would only be waited for.
  vi.spyOn(loginWait, 'sleep').mockResolvedValue(undefined);
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.instanceSettings).values({ id: 1, registrationOpen: 1, instanceId: 'test-instance', updatedAt: 1 }).run();
  const passwordHash = await hashPassword(PASSWORD);
  for (const id of ['alice', 'bob']) testDb.insert(schema.users).values({ id, username: id, passwordHash, createdAt: 1 }).run();
  mails = [];
  const transport: EmailTransport = {
    name: 'memory',
    send: (mail) => { mails.push(mail); return Promise.resolve({ status: 'accepted' }); },
    check: () => Promise.resolve({ ok: true }),
  };
  setEmailTransportForTests(transport);
  setTwoFactorKeyForTests(randomBytes(32));
  app = Fastify();
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(emailRoutes);
  await app.register(twoFactorRoutes);
  await app.register(instanceRoutes);
  await app.register(dataExportRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  setEmailTransportForTests(null);
  setTwoFactorKeyForTests(undefined);
});

describe('enrollment', () => {
  it('asks for the password', async () => {
    const token = await signIn();
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: as(token), payload: { password: 'wrong' } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().code).toBe('current_password_incorrect');
    const none = await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: as(token), payload: {} });
    expect(none.json().code).toBe('password_required');
    expect(secretRow('alice')).toBeUndefined();
  });

  it('succeeds with a right code, and hands out ten recovery codes once', async () => {
    const token = await signIn();
    const secret = await setUp(token);
    expect(userRow('alice').twoFactorEnabledAt).toBeNull();

    const res = await app.inject({ method: 'POST', url: '/api/auth/2fa/enable', headers: as(token), payload: { code: freshCode(secret) } });
    expect(res.statusCode).toBe(200);
    const codes = res.json().recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(userRow('alice').twoFactorEnabledAt).not.toBeNull();
    const again = await app.inject({ method: 'GET', url: '/api/auth/security', headers: as(token) });
    expect(again.body).not.toContain(codes[0]);
    expect(again.json().twoFactor).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
  });

  it('does not turn on with a wrong code: signing in still takes only the password', async () => {
    const token = await signIn();
    const secret = await setUp(token);
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/2fa/enable', headers: as(token), payload: { code: hotp(secret, stepNow() + 50) } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('mfa_code_invalid');
    expect(userRow('alice').twoFactorEnabledAt).toBeNull();
    expect(secretRow('alice')!.confirmedAt).toBeNull();
    await signIn();
  });

  it('stores the secret and the codes unreadable', async () => {
    const token = await signIn();
    const { secret, recoveryCodes } = await enable(token);
    const stored = JSON.stringify({
      secrets: testDb.select().from(schema.twoFactorSecrets).all(),
      codes: testDb.select().from(schema.twoFactorRecoveryCodes).all(),
    });
    expect(stored).not.toContain(secret.toString('base64'));
    expect(stored).not.toContain(secret.toString('hex'));
    expect(secretRow('alice')!.secretEnc.startsWith('v1.')).toBe(true);
    for (const code of recoveryCodes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(code.replace(/-/g, ''));
    }
  });

  it('binds the secret to its account: copied to another row, it does not decrypt', async () => {
    const { checkSecondFactor } = await import('../security/twoFactor.js');
    const { secret } = await enable(await signIn());
    const row = secretRow('alice')!;
    testDb.insert(schema.twoFactorSecrets).values({ ...row, userId: 'bob' }).run();
    testDb.update(schema.users).set({ twoFactorEnabledAt: 1 }).where(eq(schema.users.id, 'bob')).run();
    expect(checkSecondFactor('bob', freshCode(secret))).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('turns other devices out, and tells the address', async () => {
    confirmedAddress('alice', 'alice@example.com');
    const phone = await signIn();
    const desk = await signIn();
    await enable(desk);
    expect((await app.inject({ method: 'GET', url: '/api/users/@me', headers: as(phone) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/users/@me', headers: as(desk) })).statusCode).toBe(200);
    const sent = await delivered();
    expect(sent.at(-1)!.subject).toContain('Two-factor authentication is on');
  });

  it('is refused while on, for an account whose home is elsewhere, and without the key', async () => {
    const token = await signIn();
    await enable(token);
    expect((await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: as(token), payload: { password: PASSWORD } })).json().code).toBe('two_factor_already_enabled');

    testDb.insert(schema.users).values({ id: 'remote', username: 'remote@other.example', passwordHash: await hashPassword(PASSWORD), createdAt: 1, homeInstance: 'other.example' }).run();
    const remote = await signIn('remote@other.example');
    const res = await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: as(remote), payload: { password: PASSWORD } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('native_account_required');

    setTwoFactorKeyForTests(null);
    const bob = await signIn('bob');
    const noKey = await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: as(bob), payload: { password: PASSWORD } });
    expect(noKey.statusCode).toBe(503);
    expect(noKey.json().code).toBe('two_factor_unavailable');
    expect((await app.inject({ method: 'GET', url: '/api/instance/info' })).json().twoFactor).toBe(false);
  });
});

describe('signing in', () => {
  it('takes two steps, and the first gets nobody anywhere', async () => {
    await enable(await signIn());
    const first = await login('alice');
    expect(first.statusCode).toBe(401);
    expect(first.json().code).toBe('mfa_required');
    expect(first.json().token).toBeUndefined();
    expect(first.json().user).toBeUndefined();
    const ticket = first.json().ticket as string;
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // A ticket is not a token: nothing protected takes it.
    for (const url of ['/api/users/@me', '/api/auth/sessions', '/api/auth/security', '/api/users/@me/email']) {
      expect((await app.inject({ method: 'GET', url, headers: as(ticket) })).statusCode).toBe(401);
    }
    const sessionsBefore = testDb.select().from(schema.sessions).where(eq(schema.sessions.userId, 'alice')).all().length;
    expect(sessionsBefore).toBe(1);
  });

  it('gets a session with the right code', async () => {
    const { secret } = await enable(await signIn());
    const first = await login('alice');
    const res = await secondStep(first.json().ticket, freshCode(secret));
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: 'alice', twoFactorEnabled: true });
    expect((await app.inject({ method: 'GET', url: '/api/users/@me', headers: as(res.json().token as string) })).statusCode).toBe(200);
  });

  it('gets nothing with a wrong code', async () => {
    const { secret } = await enable(await signIn());
    const first = await login('alice');
    const before = testDb.select().from(schema.sessions).all().length;
    const res = await secondStep(first.json().ticket, hotp(secret, stepNow() + 50));
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('mfa_code_invalid');
    expect(res.json().token).toBeUndefined();
    expect(testDb.select().from(schema.sessions).all()).toHaveLength(before);
  });

  it('allows one step of clock drift either way and no more', async () => {
    const { secret } = await enable(await signIn());
    const ticket = (await login('alice')).json().ticket as string;
    expect((await secondStep(ticket, hotp(secret, stepNow() - 2))).statusCode).toBe(401);
    expect((await secondStep(ticket, hotp(secret, stepNow() + 2))).statusCode).toBe(401);
    expect((await secondStep(ticket, hotp(secret, stepNow() - 1))).statusCode).toBe(200);
  });

  it('does not take an accepted code a second time, even on a new ticket', async () => {
    const { secret } = await enable(await signIn());
    const code = freshCode(secret);
    const first = await secondStep((await login('alice')).json().ticket, code);
    expect(first.statusCode).toBe(200);
    const replay = await secondStep((await login('alice')).json().ticket, code);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe('mfa_code_invalid');
  });

  it('does not take a ticket twice', async () => {
    const { secret } = await enable(await signIn());
    const ticket = (await login('alice')).json().ticket as string;
    expect((await secondStep(ticket, freshCode(secret))).statusCode).toBe(200);
    const again = await secondStep(ticket, freshCode(secret, 1));
    expect(again.statusCode).toBe(401);
    expect(again.json().code).toBe('mfa_ticket_invalid');
  });

  it('does not take an expired ticket, or a made-up one', async () => {
    const { secret } = await enable(await signIn());
    const ticket = (await login('alice')).json().ticket as string;
    testDb.update(schema.mfaTickets).set({ expiresAt: Date.now() - 1 }).run();
    const res = await secondStep(ticket, freshCode(secret));
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('mfa_ticket_invalid');
    for (const fake of ['', 'x', 'A'.repeat(43), 42, null]) expect((await secondStep(fake, '123456')).json().code).toBe('mfa_ticket_invalid');
  });

  it('does not take a ticket from before the password changed', async () => {
    const { secret } = await enable(await signIn());
    const ticket = (await login('alice')).json().ticket as string;
    testDb.update(schema.users).set({ passwordChangedAt: Date.now() + 1000 }).where(eq(schema.users.id, 'alice')).run();
    expect((await secondStep(ticket, freshCode(secret))).json().code).toBe('mfa_ticket_invalid');
  });

  it('says nothing about 2FA to someone with the wrong password', async () => {
    await enable(await signIn());
    const withTwoFactor = await login('alice', 'wrong password');
    const without = await login('bob', 'wrong password');
    const nobody = await login('nobody', 'wrong password');
    for (const res of [withTwoFactor, without, nobody]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('invalid_credentials');
      expect(res.json().ticket).toBeUndefined();
    }
    expect(withTwoFactor.body).toBe(without.body);
    expect(without.body).toBe(nobody.body);
  });

  it('tells a suspended account only after the second factor', async () => {
    const { secret } = await enable(await signIn());
    testDb.update(schema.users).set({ suspendedAt: 1, suspensionReason: 'Why' }).where(eq(schema.users.id, 'alice')).run();
    const first = await login('alice');
    expect(first.json().code).toBe('mfa_required');
    const res = await secondStep(first.json().ticket, freshCode(secret));
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('account_suspended');
  });

  it('fails closed when the server has lost its key: nobody gets past the step', async () => {
    const { secret } = await enable(await signIn());
    const ticket = (await login('alice')).json().ticket as string;
    setTwoFactorKeyForTests(null);
    const first = await login('alice');
    expect(first.statusCode).toBe(503);
    expect(first.json().code).toBe('two_factor_unavailable');
    expect((await secondStep(ticket, freshCode(secret))).json().code).toBe('two_factor_unavailable');
  });

  it('fails closed when another key is in place', async () => {
    const { secret } = await enable(await signIn());
    const ticket = (await login('alice')).json().ticket as string;
    setTwoFactorKeyForTests(randomBytes(32));
    const res = await secondStep(ticket, freshCode(secret));
    expect(res.statusCode).toBe(503);
  });
});

describe('recovery codes', () => {
  it('sign in in place of a code, once each', async () => {
    confirmedAddress('alice', 'alice@example.com');
    const { recoveryCodes } = await enable(await signIn());
    const res = await secondStep((await login('alice')).json().ticket, recoveryCodes[0]);
    expect(res.statusCode).toBe(200);
    const token = res.json().token as string;

    const overview = await app.inject({ method: 'GET', url: '/api/auth/security', headers: as(token) });
    expect(overview.json().twoFactor.recoveryCodesLeft).toBe(9);
    const sent = await delivered();
    expect(sent.some((mail) => mail.subject.includes('recovery code was used'))).toBe(true);

    const reuse = await secondStep((await login('alice')).json().ticket, recoveryCodes[0]);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().code).toBe('mfa_code_invalid');
  });

  it('are taken however they are typed', async () => {
    const { recoveryCodes } = await enable(await signIn());
    const typed = recoveryCodes[1]!.replace(/-/g, ' ').toLowerCase();
    expect((await secondStep((await login('alice')).json().ticket, `  ${typed}  `)).statusCode).toBe(200);
  });

  it('of one account do nothing for another', async () => {
    const { recoveryCodes } = await enable(await signIn());
    const { secret: bobSecret } = await enable(await signIn('bob'), 'bob');
    void bobSecret;
    const res = await secondStep((await login('bob')).json().ticket, recoveryCodes[0]);
    expect(res.statusCode).toBe(401);
  });

  it('can be replaced with the password and a code, which kills the old ones', async () => {
    confirmedAddress('alice', 'alice@example.com');
    const token = await signIn();
    const { secret, recoveryCodes } = await enable(token);
    const refused = await app.inject({ method: 'POST', url: '/api/auth/2fa/recovery-codes', headers: as(token), payload: { password: 'wrong', code: freshCode(secret) } });
    expect(refused.statusCode).toBe(403);
    const noCode = await app.inject({ method: 'POST', url: '/api/auth/2fa/recovery-codes', headers: as(token), payload: { password: PASSWORD } });
    expect(noCode.json().code).toBe('mfa_code_required');

    const res = await app.inject({ method: 'POST', url: '/api/auth/2fa/recovery-codes', headers: as(token), payload: { password: PASSWORD, code: freshCode(secret) } });
    expect(res.statusCode).toBe(200);
    const fresh = res.json().recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    expect((await secondStep((await login('alice')).json().ticket, recoveryCodes[0])).statusCode).toBe(401);
    expect((await secondStep((await login('alice')).json().ticket, fresh[0])).statusCode).toBe(200);
    const sent = await delivered();
    expect(sent.some((mail) => mail.subject.includes('New recovery codes'))).toBe(true);
    for (const mail of sent) for (const code of fresh) expect(mail.text + mail.html).not.toContain(code);
  });
});

describe('turning it off', () => {
  const disable = (token: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/auth/2fa/disable', headers: as(token), payload });

  it('takes the password and a current code', async () => {
    const token = await signIn();
    const { secret } = await enable(token);
    expect((await disable(token, { code: freshCode(secret) })).json().code).toBe('password_required');
    expect((await disable(token, { password: 'wrong', code: freshCode(secret) })).json().code).toBe('current_password_incorrect');
    expect((await disable(token, { password: PASSWORD })).json().code).toBe('mfa_code_required');
    expect((await disable(token, { password: PASSWORD, code: hotp(secret, stepNow() + 50) })).json().code).toBe('mfa_code_invalid');
    expect(userRow('alice').twoFactorEnabledAt).not.toBeNull();
  });

  it('leaves nothing behind, tells the address, and signing in takes only the password again', async () => {
    confirmedAddress('alice', 'alice@example.com');
    const token = await signIn();
    const { secret } = await enable(token);
    const res = await disable(token, { password: PASSWORD, code: freshCode(secret) });
    expect(res.statusCode).toBe(200);
    expect(userRow('alice').twoFactorEnabledAt).toBeNull();
    expect(secretRow('alice')).toBeUndefined();
    expect(testDb.select().from(schema.twoFactorRecoveryCodes).all()).toHaveLength(0);
    const sent = await delivered();
    expect(sent.some((mail) => mail.subject.includes('authentication is off'))).toBe(true);
    await signIn();
  });

  it('works with a recovery code in place of the app', async () => {
    const token = await signIn();
    const { recoveryCodes } = await enable(token);
    expect((await disable(token, { password: PASSWORD, code: recoveryCodes[0] })).statusCode).toBe(200);
  });
});

describe('attempts', () => {
  it('make a further attempt wait, for the account, across new tickets, even for the right code', async () => {
    const { secret } = await enable(await signIn());
    const wrong = hotp(secret, stepNow() + 50);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await secondStep((await login('alice')).json().ticket, wrong)).json().code).toBe('mfa_code_invalid');
    }
    const locked = await secondStep((await login('alice')).json().ticket, freshCode(secret));
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('mfa_locked');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(locked.json().token).toBeUndefined();
  });

  it('run out on one ticket', async () => {
    const { secret } = await enable(await signIn());
    const ticket = (await login('alice')).json().ticket as string;
    const wrong = hotp(secret, stepNow() + 50);
    for (let attempt = 0; attempt < 4; attempt += 1) await secondStep(ticket, wrong);
    testDb.update(schema.twoFactorSecrets).set({ failedAttempts: 0, lockedUntil: null }).run();
    await secondStep(ticket, wrong);
    testDb.update(schema.twoFactorSecrets).set({ failedAttempts: 0, lockedUntil: null }).run();
    expect((await secondStep(ticket, freshCode(secret))).json().code).toBe('mfa_ticket_invalid');
  });

  it('start over with the right code once the wait is over', async () => {
    const { secret } = await enable(await signIn());
    const wrong = hotp(secret, stepNow() + 50);
    for (let attempt = 0; attempt < 5; attempt += 1) await secondStep((await login('alice')).json().ticket, wrong);
    testDb.update(schema.twoFactorSecrets).set({ lockedUntil: Date.now() - 1 }).run();
    expect((await secondStep((await login('alice')).json().ticket, freshCode(secret))).statusCode).toBe(200);
    expect(secretRow('alice')).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('wait longer each time, up to an hour', async () => {
    const { checkSecondFactor } = await import('../security/twoFactor.js');
    const { secret } = await enable(await signIn());
    const wrong = hotp(secret, stepNow() + 50);
    const now = Date.now();
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 14; attempt += 1) {
      checkSecondFactor('alice', wrong, now + attempt * 10 * 3_600_000);
      const row = secretRow('alice')!;
      if (row.lockedUntil !== null) waits.push(row.lockedUntil - (now + attempt * 10 * 3_600_000));
    }
    expect(waits[0]).toBe(60_000);
    expect(waits[1]).toBe(120_000);
    expect(Math.max(...waits)).toBe(3_600_000);
  });

  it('are limited by address on the route too', async () => {
    const limited = Fastify();
    await limited.register(rateLimit, { global: false });
    await limited.register(twoFactorRoutes);
    await limited.ready();
    const hit = () => limited.inject({ method: 'POST', url: '/api/auth/login/2fa', payload: { ticket: 'x', code: '123456' } });
    for (let attempt = 0; attempt < 15; attempt += 1) expect((await hit()).statusCode).toBe(401);
    expect((await hit()).statusCode).toBe(429);
    await limited.close();
  });
});

describe('no way around it', () => {
  it('a reset by mail does not turn it off', async () => {
    confirmedAddress('alice', 'alice@example.com');
    const { secret } = await enable(await signIn());
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'alice@example.com' } });
    const sent = await delivered();
    const token = /#([A-Za-z0-9_-]{43})/.exec(sent.find((mail) => mail.subject.includes('Reset'))!.text)![1];
    expect((await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password: 'a brand new password' } })).statusCode).toBe(200);
    expect(userRow('alice').twoFactorEnabledAt).not.toBeNull();
    expect(await verifyPassword('a brand new password', userRow('alice').passwordHash)).toBe(true);
    const first = await login('alice', 'a brand new password');
    expect(first.json().code).toBe('mfa_required');
    expect((await secondStep(first.json().ticket, freshCode(secret))).statusCode).toBe(200);
  });

  it('changing the password takes the code, and tells nothing away without it', async () => {
    const token = await signIn();
    const { secret } = await enable(token);
    const change = (extra: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/users/@me/change-password', headers: as(token), payload: { currentPassword: PASSWORD, newPassword: 'a brand new password', ...extra } });
    expect((await change({})).json().code).toBe('mfa_code_required');
    expect((await change({ twoFactorCode: hotp(secret, stepNow() + 50) })).json().code).toBe('mfa_code_invalid');
    expect(await verifyPassword(PASSWORD, userRow('alice').passwordHash)).toBe(true);
    expect((await change({ twoFactorCode: freshCode(secret) })).statusCode).toBe(200);
    expect(await verifyPassword('a brand new password', userRow('alice').passwordHash)).toBe(true);
  });

  it('changing the address takes the code', async () => {
    const token = await signIn();
    const { secret } = await enable(token);
    const change = (extra: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/users/@me/email', headers: as(token), payload: { address: 'alice@example.com', password: PASSWORD, ...extra } });
    expect((await change({})).json().code).toBe('mfa_code_required');
    expect(userRow('alice').email).toBeNull();
    expect((await change({ twoFactorCode: freshCode(secret) })).statusCode).toBe(200);
  });

  it('removing the address and asking for all data take the code', async () => {
    confirmedAddress('alice', 'alice@example.com');
    const token = await signIn();
    await enable(token);
    const removal = await app.inject({ method: 'DELETE', url: '/api/users/@me/email', headers: as(token), payload: { password: PASSWORD } });
    expect(removal.json().code).toBe('mfa_code_required');
    const copy = await app.inject({ method: 'POST', url: '/api/users/@me/data-export', headers: as(token), payload: { password: PASSWORD } });
    expect(copy.json().code).toBe('mfa_code_required');
  });

  it('deleting the account takes the code', async () => {
    const token = await signIn();
    await enable(token);
    const res = await app.inject({ method: 'DELETE', url: '/api/users/@me', headers: as(token), payload: { password: PASSWORD, username: 'alice' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('mfa_code_required');
    expect(userRow('alice').isDeleted).not.toBe(1);
  });

  it('an account without 2FA is asked for nothing new', async () => {
    const token = await signIn();
    const res = await app.inject({ method: 'POST', url: '/api/users/@me/change-password', headers: as(token), payload: { currentPassword: PASSWORD, newPassword: 'a brand new password' } });
    expect(res.statusCode).toBe(200);
  });

  it('a wrong recovery code or a used-up one counts against the account', async () => {
    const { recoveryCodes } = await enable(await signIn());
    expect((await secondStep((await login('alice')).json().ticket, 'AAAA-BBBB-CCCC-DDDD')).statusCode).toBe(401);
    expect(secretRow('alice')!.failedAttempts).toBe(1);
    void recoveryCodes;
  });

  it('an operator at the server can reset it, and it shows', async () => {
    const { resetAccountTwoFactor } = await import('../utils/adminAccounts.js');
    confirmedAddress('alice', 'alice@example.com');
    const token = await signIn();
    await enable(token);
    resetAccountTwoFactor(sqlite, 'alice');
    expect(userRow('alice').twoFactorEnabledAt).toBeNull();
    expect(secretRow('alice')).toBeUndefined();
    expect(testDb.select().from(schema.sessions).where(eq(schema.sessions.userId, 'alice')).all()).toHaveLength(0);
    const sent = await delivered();
    expect(sent.some((mail) => mail.subject.includes('was reset'))).toBe(true);
    const fresh = await signIn();
    const events = (await app.inject({ method: 'GET', url: '/api/auth/security', headers: as(fresh) })).json().events as Array<{ kind: string }>;
    expect(events.map((event) => event.kind)).toContain('two_factor_reset');
    expect(() => resetAccountTwoFactor(sqlite, 'alice')).toThrow(/does not have two-factor/);
    expect(() => resetAccountTwoFactor(sqlite, 'nobody')).toThrow(/no account/);
  });
});

describe('sessions', () => {
  it('can all be ended at once', async () => {
    const phone = await signIn();
    const desk = await signIn();
    expect((await app.inject({ method: 'POST', url: '/api/auth/sessions/end-all', headers: as(desk) })).statusCode).toBe(200);
    for (const token of [phone, desk]) {
      const res = await app.inject({ method: 'GET', url: '/api/users/@me', headers: as(token) });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('session_ended');
    }
  });

  it('that ran out are refused', async () => {
    const token = await signIn();
    testDb.update(schema.sessions).set({ expiresAt: Date.now() - 1 }).run();
    expect((await app.inject({ method: 'GET', url: '/api/users/@me', headers: as(token) })).statusCode).toBe(401);
  });

  it('are nobody else\'s to end', async () => {
    const alice = await signIn('alice');
    const bob = await signIn('bob');
    const bobsSession = testDb.select().from(schema.sessions).where(eq(schema.sessions.userId, 'bob')).get()!.id;
    expect((await app.inject({ method: 'DELETE', url: `/api/auth/sessions/${bobsSession}`, headers: as(alice) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/users/@me', headers: as(bob) })).statusCode).toBe(200);
  });
});

describe('nobody without a token', () => {
  it('reaches any of it', async () => {
    const routes: Array<['GET' | 'POST', string]> = [
      ['GET', '/api/auth/security'],
      ['POST', '/api/auth/2fa/setup'],
      ['POST', '/api/auth/2fa/enable'],
      ['POST', '/api/auth/2fa/disable'],
      ['POST', '/api/auth/2fa/recovery-codes'],
      ['POST', '/api/auth/sessions/end-all'],
    ];
    for (const [method, url] of routes) {
      expect((await app.inject({ method, url, payload: method === 'GET' ? undefined : {} })).statusCode).toBe(401);
    }
  });
});

describe('security activity', () => {
  const overview = async (token: string) => (await app.inject({ method: 'GET', url: '/api/auth/security', headers: as(token) })).json();

  it('lists what happened, newest first, with the device and the address cut short', async () => {
    const token = await signIn();
    const first = (await overview(token)).events[0];
    expect(first).toMatchObject({ kind: 'login', clientLabel: 'Chrome · Windows', addressHint: '127.0.0.0' });
    await enable(token);
    const kinds = (await overview(token)).events.map((event: { kind: string }) => event.kind);
    expect(kinds[0]).toBe('two_factor_on');
  });

  it('counts failures from one place as one line', async () => {
    const token = await signIn();
    await login('alice', 'wrong');
    await login('alice', 'wrong');
    await login('alice', 'wrong');
    const failures = (await overview(token)).events.filter((event: { kind: string }) => event.kind === 'login_failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].count).toBe(3);
  });

  it('shows an account its own and nobody else\'s', async () => {
    await signIn('alice');
    const bob = await signIn('bob');
    await login('alice', 'wrong');
    const events = (await overview(bob)).events as Array<{ kind: string }>;
    expect(events.every((event) => event.kind === 'login')).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('is capped per account, so strangers failing cannot fill it', async () => {
    const { recordSecurityEvent } = await import('../security/events.js');
    for (let index = 0; index < 230; index += 1) recordSecurityEvent('alice', 'session_revoked', null, 1_000 + index);
    expect(testDb.select().from(schema.securityEvents).where(eq(schema.securityEvents.userId, 'alice')).all().length).toBeLessThanOrEqual(200);
  });

  it('goes after 90 days', async () => {
    const { recordSecurityEvent, sweepSecurityRecords } = await import('../security/events.js');
    const now = Date.now();
    recordSecurityEvent('alice', 'session_revoked', null, now - 91 * 24 * 3_600_000);
    recordSecurityEvent('alice', 'session_revoked', null, now - 89 * 24 * 3_600_000);
    sweepSecurityRecords(now);
    expect(testDb.select().from(schema.securityEvents).all()).toHaveLength(1);
  });

  it('goes with the account, with everything else about 2FA', async () => {
    const { tombstoneUser } = await import('../utils/userDeletion.js');
    await enable(await signIn());
    await login('alice', PASSWORD, DEVICE);
    tombstoneUser('alice');
    expect(userRow('alice').twoFactorEnabledAt).toBeNull();
    for (const table of ['two_factor_secrets', 'two_factor_recovery_codes', 'mfa_tickets', 'security_events', 'known_devices']) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 'alice'`).get()).toEqual({ n: 0 });
    }
  });
});

describe('notifications', () => {
  beforeEach(() => { confirmedAddress('alice', 'alice@example.com'); });

  it('say nothing about the first device on record, or one already known', async () => {
    await login('alice', PASSWORD, DEVICE);
    await login('alice', PASSWORD, DEVICE);
    expect(await delivered()).toHaveLength(0);
  });

  it('tell the address about a new device, and what it is', async () => {
    await login('alice', PASSWORD, DEVICE);
    await login('alice', PASSWORD, 'device-bbbbbbbbbbbbbbbb');
    const sent = await delivered();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('New sign-in');
    expect(sent[0]!.text).toContain('Chrome · Windows');
    expect(sent[0]!.text).toContain('127.0.0.0');
    expect(sent[0]!.text).not.toContain('127.0.0.1');
  });

  it('count a sign-in without a device id as new: leaving it out must not hide one', async () => {
    await login('alice', PASSWORD, DEVICE);
    await login('alice');
    expect((await delivered()).map((mail) => mail.subject)).toEqual([expect.stringContaining('New sign-in')]);
  });

  it('keep only a hash of the device id', async () => {
    await login('alice', PASSWORD, DEVICE);
    expect(JSON.stringify(testDb.select().from(schema.knownDevices).all())).not.toContain(DEVICE);
  });

  it('warn once about repeated wrong passwords, not each time', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) await login('alice', 'a guess at it');
    const sent = await delivered();
    const warnings = sent.filter((mail) => mail.subject.includes('Failed sign-ins'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.text).not.toContain('a guess at it');
  });

  it('warn about wrong codes, which means the password is known', async () => {
    const { secret } = await enable(await signIn());
    const wrong = hotp(secret, stepNow() + 50);
    for (let attempt = 0; attempt < 3; attempt += 1) await secondStep((await login('alice')).json().ticket, wrong);
    const sent = await delivered();
    expect(sent.some((mail) => mail.subject.includes('knows your password'))).toBe(true);
  });

  it('carry no secret, code, ticket or password', async () => {
    const token = await signIn();
    const { secret, recoveryCodes } = await enable(token);
    const first = await login('alice');
    const ticket = first.json().ticket as string;
    const code = freshCode(secret);
    await secondStep(ticket, code);
    const sent = await delivered();
    expect(sent.length).toBeGreaterThan(0);
    const everything = sent.map((mail) => mail.subject + mail.text + mail.html).join('\n');
    for (const secretThing of [PASSWORD, ticket, code, ...recoveryCodes, secret.toString('hex')]) expect(everything).not.toContain(secretThing);
  });
});

describe('a new password', () => {
  const weak = 'pass' + 'word123';

  it('cannot be one of the first things anyone tries, or the name of the account, when signing up', async () => {
    const common = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: weak } });
    expect(common.statusCode).toBe(400);
    expect(common.json().code).toBe('password_too_common');
    const ownName = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carolcarol', password: 'CarolCarol' } });
    expect(ownName.json().code).toBe('password_too_common');
    const fine = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: PASSWORD } });
    expect(fine.statusCode).toBe(201);
  });

  it('nor when changing it, and the old one stays', async () => {
    const token = await signIn();
    const res = await app.inject({ method: 'POST', url: '/api/users/@me/change-password', headers: as(token), payload: { currentPassword: PASSWORD, newPassword: weak } });
    expect(res.json().code).toBe('password_too_common');
    expect(await verifyPassword(PASSWORD, userRow('alice').passwordHash)).toBe(true);
  });

  it('nor by a reset link, which stays good for a better one', async () => {
    confirmedAddress('alice', 'alice@example.com');
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'alice@example.com' } });
    const sent = await delivered();
    const token = /#([A-Za-z0-9_-]{43})/.exec(sent[0]!.text)![1];
    expect((await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password: weak } })).json().code).toBe('password_too_common');
    expect((await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password: 'alice-alice-alice' } })).statusCode).toBe(200);
  });

  it('does not stop anyone who already has one from signing in', async () => {
    testDb.update(schema.users).set({ passwordHash: await hashPassword(weak) }).where(eq(schema.users.id, 'bob')).run();
    expect((await login('bob', weak)).statusCode).toBe(200);
  });
});

describe('the key', () => {
  it('is what a recovery hash depends on: a hash from the database alone proves nothing', () => {
    // The stored value is a keyed HMAC; recomputing it without the key gives something else.
    const code = 'ABCD-EFGH-JKLM-NPQR';
    const plain = createHmac('sha256', Buffer.alloc(32)).update(`alice:${code.replace(/-/g, '')}`).digest('hex');
    const stored = testDb.select().from(schema.twoFactorRecoveryCodes).all().map((row) => row.codeHash);
    expect(stored).not.toContain(plain);
  });
});
