/**
 * The one place mail leaves this server (docs/systems/email.md). Routes put a row in the
 * outbox, in the same transaction as what the mail is about, and a worker sends it:
 *
 * - A route never waits on the network, so "forgot password" takes as long for an unknown
 *   address as for a known one, and a provider outage does not take sign-up with it.
 * - Limits, retries and duplicates are handled here and nowhere else.
 * - Nothing below logs an address, a link or a provider's words.
 *
 * With `EMAIL_TRANSPORT=none` there is no transport and all of this is off.
 */
import { hkdfSync, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, like, lt, sql } from 'drizzle-orm';
import type { AdminEmailStatus } from '@backspace/shared';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { hashAddress } from './address.js';
import { isMailLocale, type EmailKind, type MailLocale } from './copy.js';
import { createResendTransport } from './resendTransport.js';
import { createSmtpTransport } from './smtpTransport.js';
import { renderEmail } from './templates.js';
import type { EmailTransport, SendResult } from './transport.js';

export type EmailPriority = 'critical' | 'verify' | 'notice';
export type LinkPurpose = 'verify' | 'reset';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Who goes when the budget runs low. What anyone can trigger stops first; a password reset
 * may use the very last mail of the day. Each kind's row expires before its link does, so a
 * mail never arrives with a link that no longer works.
 *
 * `verify_email`, `change_email_confirm` and `address_in_use` share a priority and the limits
 * below on purpose. Which of them goes depends on whether someone else has confirmed the
 * address, and nothing a person can observe may depend on that.
 */
const KIND_RULES: Record<EmailKind, { priority: EmailPriority; lifetimeMs: number }> = {
  verify_email: { priority: 'verify', lifetimeMs: 23 * HOUR },
  change_email_confirm: { priority: 'verify', lifetimeMs: 23 * HOUR },
  change_requested: { priority: 'critical', lifetimeMs: DAY },
  email_changed: { priority: 'critical', lifetimeMs: DAY },
  email_removed: { priority: 'critical', lifetimeMs: DAY },
  password_reset: { priority: 'critical', lifetimeMs: 25 * MINUTE },
  password_changed: { priority: 'critical', lifetimeMs: DAY },
  username_changed: { priority: 'critical', lifetimeMs: DAY },
  address_in_use: { priority: 'verify', lifetimeMs: 23 * HOUR },
  new_device: { priority: 'notice', lifetimeMs: DAY },
  suspicious_login: { priority: 'notice', lifetimeMs: DAY },
  mfa_failures: { priority: 'critical', lifetimeMs: DAY },
  two_factor_on: { priority: 'critical', lifetimeMs: DAY },
  two_factor_off: { priority: 'critical', lifetimeMs: DAY },
  two_factor_reset: { priority: 'critical', lifetimeMs: DAY },
  recovery_regenerated: { priority: 'critical', lifetimeMs: DAY },
  recovery_used: { priority: 'critical', lifetimeMs: DAY },
  operator_disk_high: { priority: 'critical', lifetimeMs: DAY },
  operator_backup_failed: { priority: 'critical', lifetimeMs: DAY },
  operator_backup_old: { priority: 'critical', lifetimeMs: DAY },
  operator_offsite_failed: { priority: 'critical', lifetimeMs: DAY },
  operator_restart_loop: { priority: 'critical', lifetimeMs: DAY },
  test: { priority: 'verify', lifetimeMs: HOUR },
};

const BUDGET_SHARE: Record<EmailPriority, number> = { critical: 1, verify: 0.85, notice: 0.6 };
const PRIORITY_ORDER: readonly EmailPriority[] = ['critical', 'verify', 'notice'];

const LINK_LIFETIME: Record<LinkPurpose, number> = { verify: DAY, reset: 30 * MINUTE };
const LINK_PATH: Partial<Record<EmailKind, string>> = {
  verify_email: '/verify-email',
  change_email_confirm: '/verify-email',
  password_reset: '/reset-password',
};
/** Where a mail's button leads when it carries no token. */
const PLAIN_PATH: Partial<Record<EmailKind, string>> = {
  password_changed: '/forgot-password',
  username_changed: '/forgot-password',
};

/**
 * The same mail to the same address: once a minute. Mails of a priority to one address: this
 * many a day, so nobody's mailbox can be flooded through this server. Resets have room of
 * their own, so that using up an address's confirmations cannot lock its owner out.
 */
const COOLDOWN_MS = MINUTE;
const PER_ADDRESS_PER_DAY: Record<EmailPriority, number> = { critical: 10, verify: 5, notice: 5 };

const CONFIRMATION_KINDS: readonly string[] = ['verify_email', 'change_email_confirm', 'address_in_use'];

function sameCooldown(a: string, b: string): boolean {
  return a === b || (CONFIRMATION_KINDS.includes(a) && CONFIRMATION_KINDS.includes(b));
}

const RETRY_SCHEDULE_MS = [30_000, MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR] as const;
const BLOCKED_RECHECK_MS = 15 * MINUTE;
const WORKER_INTERVAL_MS = 15_000;
const SWEEP_INTERVAL_MS = HOUR;
const DONE_ROWS_KEPT_MS = 7 * DAY;
const BOUNCE_SUPPRESSED_MS = 30 * DAY;
const USAGE_DAYS_KEPT_MS = 400 * DAY;
const USAGE_WARN_RATE_WINDOW_DAYS = 30;

// ─── Links ─────────────────────────────────────────────────────────────────

/**
 * A link's token is derived from a nonce with a key that is not in the database. The
 * database holds the nonce until the mail went and the token's hash until it is used, so
 * reading the database yields no working link; and a retry produces the same link, which
 * is what lets a provider treat it as the same mail.
 */
let linkKey: Buffer | null = null;

function tokenOf(nonce: string): string {
  linkKey ??= Buffer.from(hkdfSync('sha256', config.jwtSecret, '', 'tavvit-email-links', 32));
  return createHmac('sha256', linkKey).update(nonce).digest('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 32 bytes in base64url. Anything else is not worth a database lookup. */
export function isLinkToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * A new link for this account and purpose, replacing any earlier one. Call it inside the
 * transaction that also queues the mail. Returns the nonce the mail's row carries.
 */
export function issueLink(userId: string, purpose: LinkPurpose, address: string, now: number = Date.now()): string {
  const db = getDb();
  const nonce = randomBytes(32).toString('base64url');
  db.delete(schema.emailTokens).where(and(eq(schema.emailTokens.userId, userId), eq(schema.emailTokens.purpose, purpose))).run();
  db.insert(schema.emailTokens).values({
    tokenHash: hashToken(tokenOf(nonce)),
    userId,
    purpose,
    address,
    createdAt: now,
    expiresAt: now + LINK_LIFETIME[purpose],
  }).run();
  return nonce;
}

function liveLink(token: string, purpose: LinkPurpose, now: number) {
  const row = getDb().select().from(schema.emailTokens).where(eq(schema.emailTokens.tokenHash, hashToken(token))).get();
  return row && row.purpose === purpose && row.expiresAt > now ? row : null;
}

/** Whose a link is while it would work, without using it up: for what is too costly to do for nothing. */
export function linkOwner(token: string, purpose: LinkPurpose, now: number = Date.now()): string | null {
  return liveLink(token, purpose, now)?.userId ?? null;
}

/** Uses the link up and says what it was for. Once only: a second call finds nothing. */
export function takeLink(token: string, purpose: LinkPurpose, now: number = Date.now()) {
  const row = liveLink(token, purpose, now);
  if (!row) return null;
  const taken = getDb().delete(schema.emailTokens).where(eq(schema.emailTokens.tokenHash, row.tokenHash)).run();
  return taken.changes === 1 ? row : null;
}

export function dropLinks(userId: string, purposes: readonly LinkPurpose[] = ['verify', 'reset']): void {
  getDb().delete(schema.emailTokens).where(and(eq(schema.emailTokens.userId, userId), inArray(schema.emailTokens.purpose, [...purposes]))).run();
}

// ─── Transport and state ───────────────────────────────────────────────────

function configuredTransport(settings: typeof config.email): EmailTransport | null {
  const { transport, from, replyTo, resend, smtp } = settings;
  if (transport === 'resend') return createResendTransport({ apiKey: resend.apiKey, from, replyTo, version: config.version });
  if (transport === 'smtp') return createSmtpTransport({ ...smtp, from, replyTo });
  return null;
}

/** Decided on first use, so that importing this module asks nothing of the configuration. */
let transportState: { transport: EmailTransport | null; limits: { daily: number; monthly: number } } | null = null;

function current(): NonNullable<typeof transportState> {
  // Missing only where a test replaces the configuration with part of it: that server sends nothing.
  const settings: typeof config.email | undefined = config.email;
  transportState ??= {
    transport: settings ? configuredTransport(settings) : null,
    limits: { daily: settings?.dailyLimit ?? 0, monthly: settings?.monthlyLimit ?? 0 },
  };
  return transportState;
}

/** The provider refuses this server: nothing goes until a retry says otherwise. */
let blocked: { code: string; retryAt: number } | null = null;
/** A quota the provider enforces is used up. */
let held: { code: string; until: number } | null = null;
let lastError: string | null = null;

/** A transport that records instead of sending, and limits to go with it. Nothing outside the tests calls this. */
export function setEmailTransportForTests(next: EmailTransport | null, nextLimits: { daily: number; monthly: number } = { daily: 0, monthly: 0 }): void {
  transportState = { transport: next, limits: nextLimits };
  blocked = null;
  held = null;
  lastError = null;
}

export function emailEnabled(): boolean {
  return current().transport !== null;
}

/** Whether the test transport is in use, for what asks the outside world about real addresses. */
export function emailTransportName(): string | null {
  return current().transport?.name ?? null;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

interface Usage {
  day: number;
  month: number;
}

function currentUsage(now: number): Usage {
  const db = getDb();
  const today = utcDay(now);
  const row = db.select().from(schema.emailUsageDaily).where(eq(schema.emailUsageDaily.day, today)).get();
  const month = db.select({ total: sql<number>`COALESCE(SUM(${schema.emailUsageDaily.accepted}), 0)` }).from(schema.emailUsageDaily)
    .where(like(schema.emailUsageDaily.day, `${today.slice(0, 7)}-%`)).get();
  // The provider's own count is larger when someone sent tests from its dashboard, and it is the one that counts.
  return {
    day: Math.max(row?.accepted ?? 0, row?.providerDay ?? 0),
    month: Math.max(month?.total ?? 0, row?.providerMonth ?? 0),
  };
}

function withinBudget(priority: EmailPriority, usage: Usage): boolean {
  const share = BUDGET_SHARE[priority];
  const { limits } = current();
  if (limits.daily > 0 && usage.day >= Math.floor(limits.daily * share)) return false;
  if (limits.monthly > 0 && usage.month >= Math.floor(limits.monthly * share)) return false;
  return true;
}

/**
 * Whether mail can go at all right now. `held` and `blocked` are the instance's state and say
 * nothing about any account, so a route may answer honestly with them before it looks anyone up.
 */
export function emailState(now: number = Date.now()): 'off' | 'ok' | 'held' | 'blocked' {
  if (!current().transport) return 'off';
  if (blocked) return 'blocked';
  if (held && held.until > now) return 'held';
  return withinBudget('critical', currentUsage(now)) ? 'ok' : 'held';
}

function bumpUsage(column: 'accepted' | 'failed' | 'bounced' | 'complained', now: number, provider?: { day?: number; month?: number }): void {
  const counter = schema.emailUsageDaily[column];
  getDb().insert(schema.emailUsageDaily)
    .values({ day: utcDay(now), [column]: 1, providerDay: provider?.day ?? null, providerMonth: provider?.month ?? null })
    .onConflictDoUpdate({
      target: schema.emailUsageDaily.day,
      set: {
        [column]: sql`${counter} + 1`,
        ...(provider?.day !== undefined ? { providerDay: provider.day } : {}),
        ...(provider?.month !== undefined ? { providerMonth: provider.month } : {}),
      },
    })
    .run();
}

// ─── Queueing ──────────────────────────────────────────────────────────────

export type MailDecision = 'ok' | 'off' | 'suppressed' | 'cooldown' | 'limit';

function isSuppressed(addressHash: string): boolean {
  return getDb().select({ hash: schema.emailSuppressions.addressHash }).from(schema.emailSuppressions)
    .where(eq(schema.emailSuppressions.addressHash, addressHash)).get() !== undefined;
}

/** Whether this account was sent this kind lately, so that a flood of failures is one mail. */
export function mailedRecently(userId: string, kind: EmailKind, withinMs: number, now: number = Date.now()): boolean {
  return getDb().select({ id: schema.emailOutbox.id }).from(schema.emailOutbox)
    .where(and(eq(schema.emailOutbox.userId, userId), eq(schema.emailOutbox.kind, kind), sql`${schema.emailOutbox.createdAt} > ${now - withinMs}`))
    .limit(1).get() !== undefined;
}

export function addressUndeliverable(address: string): boolean {
  return isSuppressed(hashAddress(address));
}

/** Whether a mail of this kind may go to this address now, without queueing anything. */
export function mailDecision(kind: EmailKind, address: string, now: number = Date.now()): MailDecision {
  if (!current().transport) return 'off';
  const toHash = hashAddress(address);
  if (isSuppressed(toHash)) return 'suppressed';
  const recent = getDb().select({ kind: schema.emailOutbox.kind, createdAt: schema.emailOutbox.createdAt }).from(schema.emailOutbox)
    .where(and(eq(schema.emailOutbox.toHash, toHash), sql`${schema.emailOutbox.createdAt} > ${now - DAY}`)).all();
  if (recent.some((row) => sameCooldown(row.kind, kind) && row.createdAt > now - COOLDOWN_MS)) return 'cooldown';
  const priority = KIND_RULES[kind].priority;
  const samePriority = recent.filter((row) => KIND_RULES[row.kind as EmailKind]?.priority === priority).length;
  return samePriority >= PER_ADDRESS_PER_DAY[priority] ? 'limit' : 'ok';
}

export interface MailRequest {
  kind: EmailKind;
  to: string;
  userId: string | null;
  locale: MailLocale;
  params?: Readonly<Record<string, string>>;
  /** From `issueLink`, for a mail with a link. */
  linkNonce?: string;
}

/**
 * Puts a mail in the queue if it may go, and says if not. Call it in the transaction of the
 * change it reports; the worker wakes when the current turn of the event loop is done, by
 * which time that transaction has committed.
 */
export function enqueueEmail(request: MailRequest, now: number = Date.now()): MailDecision {
  const decision = mailDecision(request.kind, request.to, now);
  if (decision !== 'ok') return decision;
  const rules = KIND_RULES[request.kind];
  getDb().insert(schema.emailOutbox).values({
    id: randomUUID(),
    kind: request.kind,
    priority: rules.priority,
    userId: request.userId,
    toAddress: request.to,
    toHash: hashAddress(request.to),
    locale: request.locale,
    params: JSON.stringify(request.params ?? {}),
    linkNonce: request.linkNonce ?? null,
    nextAttemptAt: now,
    expiresAt: now + rules.lifetimeMs,
    createdAt: now,
  }).run();
  wakeEmailWorker();
  return 'ok';
}

// ─── Sending ───────────────────────────────────────────────────────────────

type OutboxRow = typeof schema.emailOutbox.$inferSelect;

/** What is left of a row once it is done: no address, no way to rebuild the link. */
const DONE = { toAddress: null, linkNonce: null, params: '{}' } as const;

function instanceName(): string {
  return getDb().select({ name: schema.instanceSettings.instanceName }).from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1)).get()?.name ?? DEFAULT_INSTANCE_NAME;
}

function baseUrl(): string {
  return config.email.baseUrl || `http://localhost:${config.port}`;
}

function actionUrlOf(row: OutboxRow): string | null {
  const kind = row.kind as EmailKind;
  const linkPath = LINK_PATH[kind];
  // In the fragment: it reaches no server log and no Referer. The page sends it when someone clicks.
  if (linkPath && row.linkNonce) return `${baseUrl()}${linkPath}#${tokenOf(row.linkNonce)}`;
  const plainPath = PLAIN_PATH[kind];
  return plainPath ? `${baseUrl()}${plainPath}` : null;
}

function nextDueRow(now: number): OutboxRow | undefined {
  const usage = currentUsage(now);
  const allowed = PRIORITY_ORDER.filter((priority) => withinBudget(priority, usage));
  if (allowed.length === 0) return undefined;
  const due = getDb().select().from(schema.emailOutbox)
    .where(and(eq(schema.emailOutbox.status, 'queued'), sql`${schema.emailOutbox.nextAttemptAt} <= ${now}`, inArray(schema.emailOutbox.priority, allowed)))
    .orderBy(asc(schema.emailOutbox.createdAt)).all();
  return allowed.map((priority) => due.find((row) => row.priority === priority)).find((row) => row !== undefined);
}

function finish(row: OutboxRow, status: 'sent' | 'failed', now: number, extra: Partial<OutboxRow> = {}): void {
  getDb().update(schema.emailOutbox).set({ ...DONE, status, sentAt: status === 'sent' ? now : null, ...extra })
    .where(eq(schema.emailOutbox.id, row.id)).run();
}

function applyResult(row: OutboxRow, result: SendResult, now: number): void {
  const db = getDb();
  switch (result.status) {
    case 'accepted':
      blocked = null;
      held = null;
      db.transaction(() => {
        finish(row, 'sent', now, { providerId: result.providerId ?? null, attempts: row.attempts + 1, lastError: null });
        bumpUsage('accepted', now, result.usage);
      });
      return;
    case 'retry': {
      lastError = result.code;
      const attempts = row.attempts + 1;
      const wait = Math.max(RETRY_SCHEDULE_MS[attempts - 1] ?? Number.POSITIVE_INFINITY, result.afterMs ?? 0);
      if (now + wait >= row.expiresAt) {
        console.warn(`[email] ${row.kind} ${row.id} gave up after ${attempts} attempts: ${result.code}`);
        db.transaction(() => {
          finish(row, 'failed', now, { attempts, lastError: result.code });
          bumpUsage('failed', now);
        });
        return;
      }
      db.update(schema.emailOutbox).set({ attempts, nextAttemptAt: now + wait, lastError: result.code })
        .where(eq(schema.emailOutbox.id, row.id)).run();
      return;
    }
    case 'hold':
      lastError = result.code;
      held = { code: result.code, until: result.until };
      console.warn(`[email] holding the queue: ${result.code}`);
      return;
    case 'blocked':
      lastError = result.code;
      if (!blocked) console.error(`[email] the provider refuses this server (${result.code}); mail stops until this is fixed`);
      blocked = { code: result.code, retryAt: now + BLOCKED_RECHECK_MS };
      return;
    case 'rejected':
      lastError = result.code;
      console.warn(`[email] ${row.kind} ${row.id} rejected: ${result.code}`);
      db.transaction(() => {
        finish(row, 'failed', now, { attempts: row.attempts + 1, lastError: result.code });
        bumpUsage('failed', now);
        if (result.suppress) suppressHash(row.toHash, 'bounce', now);
      });
      return;
  }
}

function expireDue(now: number): void {
  getDb().update(schema.emailOutbox).set({ ...DONE, status: 'expired' })
    .where(and(eq(schema.emailOutbox.status, 'queued'), lt(schema.emailOutbox.expiresAt, now))).run();
}

let draining: Promise<void> | null = null;

async function drain(): Promise<void> {
  for (;;) {
    const now = Date.now();
    const active = current().transport;
    if (!active) return;
    if (blocked && blocked.retryAt > now) return;
    if (held && held.until > now) return;
    if (held) held = null;
    expireDue(now);
    const row = nextDueRow(now);
    if (!row?.toAddress) return;
    const rendered = renderEmail({
      kind: row.kind as EmailKind,
      locale: isMailLocale(row.locale) ? row.locale : 'en',
      params: JSON.parse(row.params) as Record<string, string>,
      instanceName: instanceName(),
      baseUrl: baseUrl(),
      actionUrl: actionUrlOf(row),
    });
    const result = await active.send({ to: row.toAddress, ...rendered }, row.id)
      .catch((): SendResult => ({ status: 'retry', code: 'transport_error' }));
    applyResult(row, result, Date.now());
    if (result.status === 'blocked' || result.status === 'hold') return;
  }
}

/** Sends what is due, one at a time. Resolves when nothing more can go now. */
export function drainEmailOutbox(): Promise<void> {
  draining ??= drain()
    .catch((error: unknown) => { console.error('[email] worker failed:', error instanceof Error ? error.name : 'unknown error'); })
    .finally(() => { draining = null; });
  return draining;
}

let wakePending = false;

function wakeEmailWorker(): void {
  if (wakePending || !workerTimer) return;
  wakePending = true;
  setImmediate(() => {
    wakePending = false;
    void drainEmailOutbox();
  });
}

// ─── Bounces ───────────────────────────────────────────────────────────────

function suppressHash(addressHash: string, reason: 'bounce' | 'complaint', now: number): void {
  // A complaint outranks a bounce, and stays.
  getDb().insert(schema.emailSuppressions).values({ addressHash, reason, createdAt: now })
    .onConflictDoUpdate({ target: schema.emailSuppressions.addressHash, set: { reason: sql`CASE WHEN ${schema.emailSuppressions.reason} = 'complaint' THEN 'complaint' ELSE excluded.reason END`, createdAt: now } })
    .run();
}

/** A provider told us an address failed for good, or that its owner complained: no more mail goes there. */
export function recordDeliveryProblem(address: string, reason: 'bounce' | 'complaint', now: number = Date.now()): void {
  getDb().transaction(() => {
    suppressHash(hashAddress(address), reason, now);
    bumpUsage(reason === 'bounce' ? 'bounced' : 'complained', now);
  });
}

// ─── What an admin sees ────────────────────────────────────────────────────

export function adminEmailStatus(now: number = Date.now()): AdminEmailStatus {
  const db = getDb();
  const state = emailState(now);
  const usage = currentUsage(now);
  const { limits } = current();
  const today = db.select().from(schema.emailUsageDaily).where(eq(schema.emailUsageDaily.day, utcDay(now))).get();
  const window = db.select({
    accepted: sql<number>`COALESCE(SUM(${schema.emailUsageDaily.accepted}), 0)`,
    bounced: sql<number>`COALESCE(SUM(${schema.emailUsageDaily.bounced}), 0)`,
    complained: sql<number>`COALESCE(SUM(${schema.emailUsageDaily.complained}), 0)`,
  }).from(schema.emailUsageDaily).where(sql`${schema.emailUsageDaily.day} >= ${utcDay(now - USAGE_WARN_RATE_WINDOW_DAYS * DAY)}`).get();
  const accepted = window?.accepted ?? 0;
  const queued = db.select({ total: sql<number>`COUNT(*)` }).from(schema.emailOutbox).where(eq(schema.emailOutbox.status, 'queued')).get();
  return {
    transport: config.email.transport,
    from: config.email.from,
    state,
    heldUntil: held && held.until > now ? held.until : null,
    lastError,
    queued: queued?.total ?? 0,
    today: { accepted: usage.day, failed: today?.failed ?? 0, bounced: today?.bounced ?? 0, complained: today?.complained ?? 0, limit: limits.daily },
    month: { accepted: usage.month, limit: limits.monthly },
    bounceRate: accepted > 0 ? (window?.bounced ?? 0) / accepted : 0,
    complaintRate: accepted > 0 ? (window?.complained ?? 0) / accepted : 0,
    webhookConfigured: config.email.transport === 'resend' && config.email.resend.webhookSecret !== null,
  };
}

// ─── Housekeeping ──────────────────────────────────────────────────────────

/** What stays no longer than it has to: used-up links, finished rows, old bounces, old counts. */
export function sweepEmailData(now: number = Date.now()): void {
  const db = getDb();
  db.delete(schema.emailTokens).where(lt(schema.emailTokens.expiresAt, now)).run();
  db.delete(schema.emailOutbox).where(and(inArray(schema.emailOutbox.status, ['sent', 'failed', 'expired']), lt(schema.emailOutbox.createdAt, now - DONE_ROWS_KEPT_MS))).run();
  db.delete(schema.emailSuppressions).where(and(eq(schema.emailSuppressions.reason, 'bounce'), lt(schema.emailSuppressions.createdAt, now - BOUNCE_SUPPRESSED_MS))).run();
  db.delete(schema.emailUsageDaily).where(lt(schema.emailUsageDaily.day, utcDay(now - USAGE_DAYS_KEPT_MS))).run();
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startEmailWorker(): void {
  // Links must keep working when a mail takes its time, and data must still go on an instance that stopped sending.
  sweepTimer ??= setInterval(() => {
    try {
      sweepEmailData();
    } catch (error) {
      console.error('[email] sweep failed:', error instanceof Error ? error.name : 'unknown error');
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  sweepEmailData();

  const active = current().transport;
  if (!active || workerTimer) return;
  workerTimer = setInterval(() => { void drainEmailOutbox(); }, WORKER_INTERVAL_MS);
  workerTimer.unref();
  void drainEmailOutbox();
  void active.check().then((result) => {
    if (!result.ok) console.warn(`[email] the ${active.name} transport does not answer (${result.detail ?? 'unknown'}); chat runs on, mail waits`);
  });
}

export function stopEmailWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  workerTimer = null;
  sweepTimer = null;
}
