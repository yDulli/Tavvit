import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit from '@fastify/rate-limit';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { hashPassword, verifyPassword } from '../utils/auth.js';
import type { EmailTransport, OutgoingEmail, SendResult } from '../email/transport.js';

// Mail through the real routes, the real queue and the real templates. Only the last step,
// handing a mail to a provider, is replaced.

setWorkerId(9);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;

const sockets = vi.hoisted(() => ({ forced: [] as string[], updated: [] as Array<{ userId: string; event: { type: string; user?: Record<string, unknown> } }> }));

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    closeSessionSockets: vi.fn(),
    forceDisconnectUser: (id: string) => { sockets.forced.push(id); },
    sendToUser: (userId: string, event: { type: string; user?: Record<string, unknown> }) => { sockets.updated.push({ userId, event }); },
    sendToSpace: vi.fn(),
    addUserSpace: vi.fn(),
    removeUserSpace: vi.fn(),
    getUserRoom: () => undefined,
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
const { emailRoutes, _resetMailRequestLimits } = await import('./email.js');
const { authRoutes } = await import('./auth.js');
const { userRoutes } = await import('./users.js');
const { instanceRoutes } = await import('./instance.js');
const { settingsRoutes } = await import('./settings.js');
const { spaceRoutes } = await import('./spaces.js');
const { socialRoutes } = await import('./social.js');

const PASSWORD = 'correct horse battery';

function memoryMail() {
  const sent: Array<OutgoingEmail & { key: string }> = [];
  const answers: SendResult[] = [];
  const transport: EmailTransport = {
    name: 'memory',
    send: (mail, key) => {
      const result = answers.shift() ?? { status: 'accepted' as const };
      if (result.status === 'accepted') sent.push({ ...mail, key });
      return Promise.resolve(result);
    },
    check: () => Promise.resolve({ ok: true }),
  };
  return { sent, answers, transport };
}

let mail: ReturnType<typeof memoryMail>;
let app: FastifyInstance;

/** What happens next once a route answered: the reset's work runs after the answer, then the worker sends. */
async function deliver(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await drainEmailOutbox();
}

function tokenIn(message: OutgoingEmail | undefined): string {
  const token = /#([A-Za-z0-9_-]{43})/.exec(message?.text ?? '')?.[1];
  if (!token) throw new Error('no link in that mail');
  return token;
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const userRow = (id: string) => testDb.select().from(schema.users).where(eq(schema.users.id, id)).get()!;

async function signIn(username = 'alice', password = PASSWORD): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

const setAddress = (token: string, address: string, password = PASSWORD) =>
  app.inject({ method: 'PUT', url: '/api/users/@me/email', headers: as(token), payload: { address, password } });
const verify = (token: unknown) => app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token } });
const forgot = (email: unknown) => app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email } });
const reset = (token: unknown, password: unknown) => app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password } });

/** An address that went through the whole thing. */
async function confirmed(token: string, address: string, password = PASSWORD): Promise<void> {
  expect((await setAddress(token, address, password)).statusCode).toBe(200);
  await deliver();
  const res = await verify(tokenIn(mail.sent.at(-1)));
  expect(res.statusCode).toBe(200);
  await deliver();
  mail.sent.length = 0;
  sqlite.prepare('DELETE FROM email_outbox').run();
}

beforeEach(async () => {
  sockets.forced.length = 0;
  sockets.updated.length = 0;
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.instanceSettings).values({ id: 1, registrationOpen: 1, instanceId: 'test-instance', updatedAt: 1 }).run();
  const passwordHash = await hashPassword(PASSWORD);
  for (const id of ['alice', 'bob']) testDb.insert(schema.users).values({ id, username: id, passwordHash, createdAt: 1 }).run();
  testDb.insert(schema.users).values({ id: 'root', username: 'root', passwordHash, createdAt: 1, isAdmin: 1 }).run();
  mail = memoryMail();
  setEmailTransportForTests(mail.transport);
  _resetMailRequestLimits();
  app = Fastify();
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(emailRoutes);
  await app.register(instanceRoutes);
  await app.register(settingsRoutes);
  await app.register(spaceRoutes);
  await app.register(socialRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  setEmailTransportForTests(null);
});

describe('on a server that sends no mail', () => {
  beforeEach(() => { setEmailTransportForTests(null); });

  it('says so, and nothing that needs mail pretends to work', async () => {
    const info = await app.inject({ method: 'GET', url: '/api/instance/info' });
    expect(info.json()).toMatchObject({ email: false, emailRequired: false });
    expect((await forgot('a@example.com')).json().code).toBe('email_not_configured');
    expect((await forgot('a@example.com')).statusCode).toBe(503);
    const token = await signIn();
    expect((await setAddress(token, 'a@example.com')).statusCode).toBe(503);
  });

  it('signs people up as it always did: an address is not even looked at', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: PASSWORD, email: 'not an address' } });
    expect(res.statusCode).toBe(201);
    expect(testDb.select().from(schema.users).where(eq(schema.users.username, 'carol')).get()!.email).toBeNull();
  });
});

describe('registering with an address', () => {
  const register = (username: string, extra: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: PASSWORD, ...extra } });

  it('refuses a domain the console blocked, and under it, at sign-up and when an address is set', async () => {
    testDb.insert(schema.signupRules).values({ kind: 'email_domain', value: 'spam.example', createdBy: 'admin', createdAt: 1 }).run();
    for (const email of ['a@spam.example', 'a@mail.spam.example']) {
      const res = await register('blocked_one', { email });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('email_domain_blocked');
    }
    expect(testDb.select().from(schema.users).where(eq(schema.users.username, 'blocked_one')).get()).toBeUndefined();
    const set = await setAddress(await signIn(), 'someone@spam.example');
    expect(set.statusCode).toBe(400);
    expect(set.json().code).toBe('email_domain_blocked');
  });

  it('sends a confirmation link and confirms nothing by itself', async () => {
    const res = await register('carol', { email: 'Carol@Example.COM', locale: 'de' });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ email: 'carol@example.com', emailVerified: false });
    await deliver();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe('carol@example.com');
    expect(mail.sent[0]!.subject).toContain('Bestätige');
    expect(mail.sent[0]!.html).toContain('/verify-email#');
    expect(mail.sent[0]!.text).toContain('/verify-email#');
  });

  it('refuses an address that cannot be one, before creating anything', async () => {
    const res = await register('carol', { email: 'not an address' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('email_invalid');
    expect(testDb.select().from(schema.users).where(eq(schema.users.username, 'carol')).get()).toBeUndefined();
  });

  it('works without an address while the server does not ask for one', async () => {
    expect((await register('carol', {})).statusCode).toBe(201);
    await deliver();
    expect(mail.sent).toHaveLength(0);
  });

  it('gets an account even when the mail fails: it can be asked for again, and confirms nothing', async () => {
    mail.answers.push({ status: 'rejected', code: 'whatever' });
    const res = await register('carol', { email: 'carol@example.com' });
    expect(res.statusCode).toBe(201);
    await deliver();
    expect(res.json().user.emailVerified).toBe(false);
    const status = await app.inject({ method: 'GET', url: '/api/users/@me/email', headers: as(res.json().token as string) });
    expect(status.json()).toMatchObject({ verified: false, lastSend: 'failed' });
  });
});

describe('a confirmation link', () => {
  it('confirms exactly the address it went to, and tells the account', async () => {
    const token = await signIn();
    expect((await setAddress(token, 'alice@example.com')).json()).toMatchObject({ address: 'alice@example.com', verified: false });
    await deliver();
    const res = await verify(tokenIn(mail.sent[0]));
    expect(res.statusCode).toBe(200);
    expect(res.json().address).toBe('alice@example.com');
    expect(userRow('alice').emailVerifiedAt).not.toBeNull();
    expect(sockets.updated.at(-1)).toMatchObject({ userId: 'alice', event: { type: 'user_updated', user: { emailVerified: true } } });
  });

  it('works once', async () => {
    const token = await signIn();
    await setAddress(token, 'alice@example.com');
    await deliver();
    const link = tokenIn(mail.sent[0]);
    expect((await verify(link)).statusCode).toBe(200);
    const again = await verify(link);
    expect(again.statusCode).toBe(410);
    expect(again.json().code).toBe('email_token_invalid');
  });

  it('runs out', async () => {
    const token = await signIn();
    await setAddress(token, 'alice@example.com');
    await deliver();
    testDb.update(schema.emailTokens).set({ expiresAt: Date.now() - 1 }).run();
    expect((await verify(tokenIn(mail.sent[0]))).statusCode).toBe(410);
    expect(userRow('alice').emailVerifiedAt).toBeNull();
  });

  it('stops working when a new one is sent', async () => {
    const token = await signIn();
    await setAddress(token, 'alice@example.com');
    await deliver();
    const first = tokenIn(mail.sent[0]);
    sqlite.prepare('UPDATE email_outbox SET created_at = created_at - 120000').run();
    expect((await app.inject({ method: 'POST', url: '/api/users/@me/email/resend', headers: as(token) })).statusCode).toBe(200);
    await deliver();
    const second = tokenIn(mail.sent[1]);
    expect(second).not.toBe(first);
    expect((await verify(first)).statusCode).toBe(410);
    expect((await verify(second)).statusCode).toBe(200);
  });

  it('is kept only as a hash, and the address leaves the queue once the mail went', async () => {
    const token = await signIn();
    await setAddress(token, 'alice@example.com');
    await deliver();
    const link = tokenIn(mail.sent[0]);
    const everything = JSON.stringify({
      tokens: testDb.select().from(schema.emailTokens).all(),
      outbox: testDb.select().from(schema.emailOutbox).all(),
    });
    expect(everything).not.toContain(link);
    const row = testDb.select().from(schema.emailOutbox).get()!;
    expect(row).toMatchObject({ status: 'sent', toAddress: null, linkNonce: null, params: '{}' });
  });

  it('cannot be made up: anything that is not a token gets the same answer as a dead one', async () => {
    for (const fake of ['', 'x', 123, null, 'A'.repeat(43)]) {
      const res = await verify(fake);
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('email_token_invalid');
    }
  });

  it('goes to the first of two accounts waiting on one address', async () => {
    const alice = await signIn('alice');
    const bob = await signIn('bob');
    await setAddress(alice, 'shared@example.com');
    await deliver();
    const aliceLink = tokenIn(mail.sent[0]);
    sqlite.prepare('UPDATE email_outbox SET created_at = created_at - 120000').run();
    await setAddress(bob, 'shared@example.com');
    await deliver();
    const bobLink = tokenIn(mail.sent[1]);
    expect((await verify(aliceLink)).statusCode).toBe(200);
    const late = await verify(bobLink);
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('email_address_in_use');
    expect(userRow('bob').emailVerifiedAt).toBeNull();
  });
});

describe('an address someone else has confirmed', () => {
  it('looks the same to whoever types it, and only its owner hears about it', async () => {
    const alice = await signIn('alice');
    await confirmed(alice, 'taken@example.com');
    const bob = await signIn('bob');

    const onTaken = await setAddress(bob, 'taken@example.com');
    const onFree = await setAddress(await signIn('root'), 'free@example.com');
    expect(onTaken.statusCode).toBe(onFree.statusCode);
    expect(Object.keys(onTaken.json())).toEqual(Object.keys(onFree.json()));
    expect(onTaken.json()).toMatchObject({ verified: false, pendingAddress: null, undeliverable: false, lastSend: 'queued' });
    expect(onFree.json()).toMatchObject({ verified: false, pendingAddress: null, undeliverable: false, lastSend: 'queued' });

    await deliver();
    const toOwner = mail.sent.find((message) => message.to === 'taken@example.com')!;
    expect(toOwner.subject).toContain('tried to use');
    expect(toOwner.text).not.toMatch(/#[A-Za-z0-9_-]{43}/);
    expect(userRow('bob').emailVerifiedAt).toBeNull();
  });

  it('gives the same answer when asked again within the minute, or it would tell', async () => {
    const alice = await signIn('alice');
    await confirmed(alice, 'taken@example.com');
    const bob = await signIn('bob');
    const root = await signIn('root');
    await setAddress(bob, 'taken@example.com');
    await setAddress(root, 'free@example.com');
    const takenAgain = await setAddress(bob, 'taken@example.com');
    const freeAgain = await setAddress(root, 'free@example.com');
    expect(takenAgain.statusCode).toBe(429);
    expect(freeAgain.statusCode).toBe(429);
  });
});

describe('forgetting a password', () => {
  it('answers the same whether the address belongs to anyone, and sends only to a confirmed one', async () => {
    const alice = await signIn('alice');
    await confirmed(alice, 'alice@example.com');
    const bob = await signIn('bob');
    await setAddress(bob, 'unconfirmed@example.com');
    await deliver();
    mail.sent.length = 0;

    const known = await forgot('alice@example.com');
    const unconfirmed = await forgot('unconfirmed@example.com');
    const unknown = await forgot('nobody@example.com');
    for (const res of [known, unconfirmed, unknown]) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(known.body);
    }
    await deliver();
    expect(mail.sent.map((message) => message.to)).toEqual(['alice@example.com']);
  });

  it('sets a new password once, ends every session and signs nobody in', async () => {
    const token = await signIn();
    await confirmed(token, 'alice@example.com');
    await forgot('alice@example.com');
    await deliver();
    const link = tokenIn(mail.sent[0]);
    expect(mail.sent[0]!.html).toContain('/reset-password#');

    const res = await reset(link, 'a brand new password');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(await verifyPassword('a brand new password', userRow('alice').passwordHash)).toBe(true);
    expect(testDb.select().from(schema.sessions).where(eq(schema.sessions.userId, 'alice')).all()).toHaveLength(0);
    expect(sockets.forced).toEqual(['alice']);
    expect((await app.inject({ method: 'GET', url: '/api/users/@me', headers: as(token) })).statusCode).toBe(401);

    await deliver();
    expect(mail.sent.at(-1)!.subject).toContain('changed');

    const again = await reset(link, 'yet another password');
    expect(again.statusCode).toBe(410);
    expect(again.json().code).toBe('email_token_invalid');
    await signIn('alice', 'a brand new password');
    const old = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: PASSWORD } });
    expect(old.statusCode).toBe(401);
  });

  it('runs out', async () => {
    const token = await signIn();
    await confirmed(token, 'alice@example.com');
    await forgot('alice@example.com');
    await deliver();
    testDb.update(schema.emailTokens).set({ expiresAt: Date.now() - 1 }).run();
    expect((await reset(tokenIn(mail.sent[0]), 'a brand new password')).statusCode).toBe(410);
    expect(await verifyPassword(PASSWORD, userRow('alice').passwordHash)).toBe(true);
  });

  it('does not use the link up on a password that is refused', async () => {
    const token = await signIn();
    await confirmed(token, 'alice@example.com');
    await forgot('alice@example.com');
    await deliver();
    const link = tokenIn(mail.sent[0]);
    expect((await reset(link, 'short')).json().code).toBe('password_too_short');
    expect((await reset(link, 'a brand new password')).statusCode).toBe(200);
  });

  it('has no use for a link of the other kind', async () => {
    const token = await signIn();
    await setAddress(token, 'alice@example.com');
    await deliver();
    expect((await reset(tokenIn(mail.sent[0]), 'a brand new password')).statusCode).toBe(410);
    expect(await verifyPassword(PASSWORD, userRow('alice').passwordHash)).toBe(true);
  });

  it('dies with the address it went to', async () => {
    const token = await signIn();
    await confirmed(token, 'alice@example.com');
    await forgot('alice@example.com');
    await deliver();
    const link = tokenIn(mail.sent[0]);
    expect((await app.inject({ method: 'DELETE', url: '/api/users/@me/email', headers: as(token), payload: { password: PASSWORD } })).statusCode).toBe(200);
    expect((await reset(link, 'a brand new password')).statusCode).toBe(410);
  });

  it('never reaches a replicated account, which has its password at home', async () => {
    testDb.insert(schema.users).values({ id: 'remote', username: 'remote@other.example', passwordHash: 'x', createdAt: 1, homeInstance: 'other.example', email: 'remote@example.com', emailVerifiedAt: 1 }).run();
    await forgot('remote@example.com');
    await deliver();
    expect(mail.sent).toHaveLength(0);
  });
});

describe('when the mail provider fails', () => {
  it('says so at once for what needs mail, before looking anyone up', async () => {
    const token = await signIn();
    await confirmed(token, 'alice@example.com');
    mail.answers.push({ status: 'blocked', code: 'auth' });
    await forgot('alice@example.com');
    await deliver();
    expect(mail.sent).toHaveLength(0);
    const known = await forgot('alice@example.com');
    const unknown = await forgot('nobody@example.com');
    expect(known.statusCode).toBe(503);
    expect(known.json().code).toBe('email_unavailable');
    expect(unknown.body).toBe(known.body);
  });

  it('never turns a failed mail into a confirmed address', async () => {
    const token = await signIn();
    mail.answers.push({ status: 'retry', code: 'network' });
    await setAddress(token, 'alice@example.com');
    await deliver();
    expect(mail.sent).toHaveLength(0);
    expect(userRow('alice').emailVerifiedAt).toBeNull();
    const row = testDb.select().from(schema.emailOutbox).get()!;
    expect(row).toMatchObject({ status: 'queued', attempts: 1, lastError: 'network' });
    expect(row.toAddress).toBe('alice@example.com');
    expect(row.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('marks an address that bounces, and sends nothing more there', async () => {
    const token = await signIn();
    mail.answers.push({ status: 'rejected', code: 'smtp_550', suppress: true });
    await setAddress(token, 'gone@example.com');
    await deliver();
    const status = await app.inject({ method: 'GET', url: '/api/users/@me/email', headers: as(token) });
    expect(status.json()).toMatchObject({ undeliverable: true, lastSend: 'failed' });
    sqlite.prepare('UPDATE email_outbox SET created_at = created_at - 120000').run();
    const again = await app.inject({ method: 'POST', url: '/api/users/@me/email/resend', headers: as(token) });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('email_undeliverable');
  });
});

describe('limits', () => {
  it('asks to wait between mails to one address', async () => {
    const token = await signIn();
    await setAddress(token, 'alice@example.com');
    const res = await app.inject({ method: 'POST', url: '/api/users/@me/email/resend', headers: as(token) });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate_limited');
    await deliver();
    expect(mail.sent).toHaveLength(1);
  });

  it('keeps nobody\'s mailbox from being flooded: a few a day to one address', async () => {
    const token = await signIn();
    await setAddress(token, 'alice@example.com');
    for (let sent = 1; sent < 5; sent += 1) {
      sqlite.prepare('UPDATE email_outbox SET created_at = created_at - 120000').run();
      expect((await app.inject({ method: 'POST', url: '/api/users/@me/email/resend', headers: as(token) })).statusCode).toBe(200);
    }
    sqlite.prepare('UPDATE email_outbox SET created_at = created_at - 120000').run();
    expect((await app.inject({ method: 'POST', url: '/api/users/@me/email/resend', headers: as(token) })).statusCode).toBe(429);
  });

  it('keeps one account from spending the day\'s mail on ever new addresses', async () => {
    const token = await signIn();
    const answers: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      answers.push((await setAddress(token, `alice+${attempt}@example.com`)).statusCode);
    }
    expect(answers.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(answers[6]).toBe(429);
  });

  it('does not repeat a reset within the minute, and the first link stays good', async () => {
    const token = await signIn();
    await confirmed(token, 'alice@example.com');
    await forgot('alice@example.com');
    await deliver();
    await forgot('alice@example.com');
    await deliver();
    expect(mail.sent).toHaveLength(1);
    expect((await reset(tokenIn(mail.sent[0]), 'a brand new password')).statusCode).toBe(200);
  });

  it('holds a confirmation back when the day runs low, and still sends a reset', async () => {
    const token = await signIn();
    await confirmed(token, 'alice@example.com');
    setEmailTransportForTests(mail.transport, { daily: 10, monthly: 0 });
    sqlite.prepare(`INSERT INTO email_usage_daily (day, accepted) VALUES (?, 8)
      ON CONFLICT(day) DO UPDATE SET accepted = 8`).run(new Date().toISOString().slice(0, 10));
    const bob = await signIn('bob');
    await setAddress(bob, 'bob@example.com');
    await forgot('alice@example.com');
    await deliver();
    expect(mail.sent.map((message) => message.to)).toEqual(['alice@example.com']);
    expect(testDb.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.kind, 'verify_email')).get()!.status).toBe('queued');
  });

  it('says "unavailable" when the last mail of the day is gone', async () => {
    setEmailTransportForTests(mail.transport, { daily: 10, monthly: 0 });
    sqlite.prepare('INSERT INTO email_usage_daily (day, accepted) VALUES (?, 10)').run(new Date().toISOString().slice(0, 10));
    const res = await forgot('alice@example.com');
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('email_unavailable');
  });

  it('limits the routes themselves too', async () => {
    const limited = Fastify();
    await limited.register(rateLimit, { global: false });
    await limited.register(emailRoutes);
    await limited.ready();
    const hit = () => limited.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: 'a@example.com' } });
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(429);
    await limited.close();
  });
});

describe('changing an address', () => {
  it('asks for the password', async () => {
    const token = await signIn();
    const res = await setAddress(token, 'alice@example.com', 'wrong password');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('current_password_incorrect');
    expect(userRow('alice').email).toBeNull();
    await deliver();
    expect(mail.sent).toHaveLength(0);
    const without = await app.inject({ method: 'PUT', url: '/api/users/@me/email', headers: as(token), payload: { address: 'alice@example.com' } });
    expect(without.json().code).toBe('password_required');
  });

  it('keeps the old address in force until the new one is confirmed, and tells the old one both times', async () => {
    const token = await signIn();
    await confirmed(token, 'old@example.com');

    const res = await setAddress(token, 'new@example.com');
    expect(res.json()).toMatchObject({ address: 'old@example.com', verified: true, pendingAddress: 'new@example.com' });
    await deliver();
    expect(userRow('alice').email).toBe('old@example.com');
    const toOld = mail.sent.find((message) => message.to === 'old@example.com')!;
    const toNew = mail.sent.find((message) => message.to === 'new@example.com')!;
    expect(toOld.text).not.toContain('new@example.com');
    expect(toOld.text).toContain('n***@example.com');
    expect(toOld.text).not.toMatch(/#[A-Za-z0-9_-]{43}/);

    // The old address still opens the way back in until then.
    await forgot('old@example.com');
    await forgot('new@example.com');
    await deliver();
    expect(mail.sent.filter((message) => message.subject.includes('Reset')).map((message) => message.to)).toEqual(['old@example.com']);

    mail.sent.length = 0;
    expect((await verify(tokenIn(toNew))).statusCode).toBe(200);
    expect(userRow('alice')).toMatchObject({ email: 'new@example.com', pendingEmail: null });
    await deliver();
    expect(mail.sent[0]).toMatchObject({ to: 'old@example.com' });
    expect(mail.sent[0]!.subject).toContain('was changed');
  });

  it('kills a reset link that went to the old address', async () => {
    const token = await signIn();
    await confirmed(token, 'old@example.com');
    await forgot('old@example.com');
    await deliver();
    const resetLink = tokenIn(mail.sent[0]);
    await setAddress(token, 'new@example.com');
    await deliver();
    const confirmLink = tokenIn(mail.sent.find((message) => message.to === 'new@example.com'));
    expect((await verify(confirmLink)).statusCode).toBe(200);
    expect((await reset(resetLink, 'a brand new password')).statusCode).toBe(410);
  });

  it('can be taken back, and then its link is dead', async () => {
    const token = await signIn();
    await confirmed(token, 'old@example.com');
    await setAddress(token, 'new@example.com');
    await deliver();
    const link = tokenIn(mail.sent.find((message) => message.to === 'new@example.com'));
    const res = await app.inject({ method: 'DELETE', url: '/api/users/@me/email/pending', headers: as(token) });
    expect(res.json()).toMatchObject({ address: 'old@example.com', pendingAddress: null });
    expect((await verify(link)).statusCode).toBe(410);
    expect(userRow('alice').email).toBe('old@example.com');
  });

  it('is not for an account whose home is elsewhere', async () => {
    testDb.insert(schema.users).values({ id: 'remote', username: 'remote@other.example', passwordHash: await hashPassword(PASSWORD), createdAt: 1, homeInstance: 'other.example' }).run();
    const token = await signIn('remote@other.example');
    const res = await setAddress(token, 'remote@example.com');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('native_account_required');
  });

  it('needs a token at all', async () => {
    const urls: Array<['GET' | 'PUT' | 'POST' | 'DELETE', string]> = [
      ['GET', '/api/users/@me/email'],
      ['PUT', '/api/users/@me/email'],
      ['POST', '/api/users/@me/email/resend'],
      ['DELETE', '/api/users/@me/email/pending'],
      ['DELETE', '/api/users/@me/email'],
      ['PUT', '/api/users/@me/locale'],
      ['GET', '/api/admin/email/status'],
      ['POST', '/api/admin/email/test'],
    ];
    for (const [method, url] of urls) {
      expect((await app.inject({ method, url, payload: method === 'GET' ? undefined : {} })).statusCode).toBe(401);
    }
  });
});

describe('a password change', () => {
  it('tells a confirmed address, and only that', async () => {
    const token = await signIn();
    const change = (t: string, next: string, current: string) => app.inject({ method: 'POST', url: '/api/users/@me/change-password', headers: as(t), payload: { currentPassword: current, newPassword: next } });

    const unconfirmed = await change(token, 'a second password', PASSWORD);
    expect(unconfirmed.statusCode).toBe(200);
    await deliver();
    expect(mail.sent).toHaveLength(0);

    const fresh = unconfirmed.json().token as string;
    await confirmed(fresh, 'alice@example.com', 'a second password');
    const res = await change(fresh, 'a third password', 'a second password');
    expect(res.statusCode).toBe(200);
    await deliver();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'alice@example.com' });
    expect(mail.sent[0]!.text).not.toContain('a third password');
  });
});

describe('signing in by address', () => {
  it('works with a confirmed one, on the same count as the username', async () => {
    const token = await signIn();
    await confirmed(token, 'alice@example.com');
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ALICE@example.com', password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('alice');
  });

  it('does not work with one that is not confirmed: typing an address proves nothing', async () => {
    const token = await signIn();
    await setAddress(token, 'alice@example.com');
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice@example.com', password: PASSWORD } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_credentials');
  });
});

describe('the address stays private', () => {
  it('is in the account\'s own view only', async () => {
    const alice = await signIn('alice');
    await confirmed(alice, 'alice@example.com');
    const bob = await signIn('bob');
    const seen = await app.inject({ method: 'GET', url: '/api/users/alice', headers: as(bob) });
    expect(seen.statusCode).toBe(200);
    expect(seen.body).not.toContain('alice@example.com');
    expect(seen.json()).not.toHaveProperty('email');
    expect(seen.json()).not.toHaveProperty('emailVerified');
    const own = await app.inject({ method: 'GET', url: '/api/users/@me', headers: as(alice) });
    expect(own.json()).toMatchObject({ email: 'alice@example.com', emailVerified: true });
  });

  it('goes when the account goes, with everything about it', async () => {
    const { tombstoneUser } = await import('../utils/userDeletion.js');
    const token = await signIn();
    await confirmed(token, 'alice@example.com');
    await setAddress(token, 'next@example.com');
    tombstoneUser('alice');
    expect(userRow('alice')).toMatchObject({ email: null, emailVerifiedAt: null, pendingEmail: null, locale: null });
    expect(testDb.select().from(schema.emailTokens).all()).toHaveLength(0);
    expect(testDb.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.userId, 'alice')).all()).toHaveLength(0);
  });
});

describe('the gate', () => {
  const requireAddress = async () => {
    const root = await signIn('root');
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/instance', headers: as(root), payload: { emailRequired: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().emailRequired).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2));
  };
  const register = (username: string, email?: string) => app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: PASSWORD, ...(email ? { email } : {}) } });
  const createSpace = (token: string) => app.inject({ method: 'POST', url: '/api/spaces', headers: as(token), payload: { name: 'A space' } });
  const befriend = (token: string) => app.inject({ method: 'POST', url: '/api/social/requests', headers: as(token), payload: { username: 'bob' } });

  it('is off until an admin turns it on, and only an admin can', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/instance', headers: as(await signIn('bob')), payload: { emailRequired: true } });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/instance/info' })).json().emailRequired).toBe(false);
    const carol = await register('carol');
    expect((await createSpace(carol.json().token as string)).statusCode).toBe(201);
  });

  it('asks a new account for an address', async () => {
    await requireAddress();
    expect((await app.inject({ method: 'GET', url: '/api/instance/info' })).json().emailRequired).toBe(true);
    const res = await register('carol');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('email_required');
  });

  it('keeps a new account from creating spaces and approaching strangers until it is confirmed', async () => {
    await requireAddress();
    const res = await register('carol', 'carol@example.com');
    expect(res.json().user.emailVerificationRequired).toBe(true);
    const token = res.json().token as string;
    for (const refused of [await createSpace(token), await befriend(token)]) {
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe('email_verification_required');
    }
    await deliver();
    expect((await verify(tokenIn(mail.sent[0]))).statusCode).toBe(200);
    expect((await createSpace(token)).statusCode).toBe(201);
    expect((await befriend(token)).statusCode).toBe(201);
  });

  it('takes nothing from an account older than the switch', async () => {
    await requireAddress();
    const bob = await signIn('bob');
    expect((await createSpace(bob)).statusCode).toBe(201);
    const own = await app.inject({ method: 'GET', url: '/api/users/@me', headers: as(bob) });
    expect(own.json().emailVerificationRequired).toBe(false);
  });
});

describe('the admin area', () => {
  it('is for admins, and holds no address', async () => {
    const alice = await signIn('alice');
    await confirmed(alice, 'alice@example.com');
    expect((await app.inject({ method: 'GET', url: '/api/admin/email/status', headers: as(alice) })).statusCode).toBe(403);
    const test = await app.inject({ method: 'POST', url: '/api/admin/email/test', headers: as(alice), payload: { to: 'x@example.com' } });
    expect(test.statusCode).toBe(403);
    const root = await signIn('root');
    const status = await app.inject({ method: 'GET', url: '/api/admin/email/status', headers: as(root) });
    expect(status.statusCode).toBe(200);
    expect(status.body).not.toContain('alice@example.com');
    expect(status.json()).toMatchObject({ state: 'ok', today: { accepted: 1 } });
  });

  it('can send a test', async () => {
    const root = await signIn('root');
    const res = await app.inject({ method: 'POST', url: '/api/admin/email/test', headers: as(root), payload: { to: 'test@example.com' } });
    expect(res.statusCode).toBe(202);
    await deliver();
    expect(mail.sent[0]).toMatchObject({ to: 'test@example.com' });
  });
});

describe('a report from Resend', () => {
  const SECRET = `whsec_${Buffer.from('a webhook secret of some length').toString('base64')}`;
  let hook: FastifyInstance;

  const sign = (id: string, timestamp: string, body: string): string => {
    const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64');
    return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
  };
  const post = (body: string, overrides: Record<string, string> = {}) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return hook.inject({
      method: 'POST',
      url: '/api/email/webhooks/resend',
      headers: { 'content-type': 'application/json', 'svix-id': 'msg_1', 'svix-timestamp': timestamp, 'svix-signature': sign('msg_1', timestamp, body), ...overrides },
      payload: body,
    });
  };
  const suppressions = () => testDb.select().from(schema.emailSuppressions).all();

  // Set up as index.ts does it: the root's JSON parser first, then the route in a scope of its
  // own. Without the root parser this passed while the server would not start (1.32.5).
  beforeEach(async () => {
    const { registerResendWebhook } = await import('./email.js');
    const { registerJsonBodyParser } = await import('../utils/jsonBody.js');
    hook = Fastify();
    registerJsonBodyParser(hook);
    await hook.register(async (scope) => { await registerResendWebhook(scope, SECRET); });
    hook.delete('/elsewhere', async (request) => ({ body: request.body ?? null }));
    hook.post('/elsewhere', async (request) => ({ body: request.body ?? null }));
    await hook.ready();
  });
  afterEach(async () => { await hook.close(); });

  it('stops mail to an address that bounced for good', async () => {
    const res = await post(JSON.stringify({ type: 'email.bounced', data: { to: ['Gone@Example.com'], bounce: { type: 'Permanent' } } }));
    expect(res.statusCode).toBe(200);
    expect(suppressions()).toMatchObject([{ reason: 'bounce' }]);
    expect(JSON.stringify(suppressions())).not.toContain('gone@example.com');
  });

  it('does not hold a passing problem against anyone', async () => {
    expect((await post(JSON.stringify({ type: 'email.bounced', data: { to: ['a@example.com'], bounce: { type: 'Transient' } } }))).statusCode).toBe(200);
    expect((await post(JSON.stringify({ type: 'email.delivered', data: { to: ['a@example.com'] } }))).statusCode).toBe(200);
    expect(suppressions()).toHaveLength(0);
  });

  it('stops mail to someone who called it spam, for good', async () => {
    await post(JSON.stringify({ type: 'email.complained', data: { to: ['a@example.com'] } }));
    await post(JSON.stringify({ type: 'email.bounced', data: { to: ['a@example.com'], bounce: { type: 'Permanent' } } }));
    expect(suppressions()).toMatchObject([{ reason: 'complaint' }]);
  });

  it('believes nothing without the right signature', async () => {
    const body = JSON.stringify({ type: 'email.complained', data: { to: ['victim@example.com'] } });
    expect((await post(body, { 'svix-signature': 'v1,AAAA' })).statusCode).toBe(401);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect((await post(body, { 'svix-timestamp': old, 'svix-signature': sign('msg_1', old, body) })).statusCode).toBe(401);
    const res = await hook.inject({ method: 'POST', url: '/api/email/webhooks/resend', headers: { 'content-type': 'application/json' }, payload: body });
    expect(res.statusCode).toBe(401);
    expect(suppressions()).toHaveLength(0);
  });

  it('keeps its raw body to itself: every other route still reads JSON with the root parser', async () => {
    const res = await hook.inject({ method: 'DELETE', url: '/elsewhere', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ body: null });
    const parsed = await hook.inject({ method: 'POST', url: '/elsewhere', payload: { a: 1 } });
    expect(parsed.json()).toEqual({ body: { a: 1 } });
  });
});
