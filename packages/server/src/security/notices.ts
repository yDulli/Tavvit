/**
 * What an account is told, and what its activity list records, when something happens to its
 * security. Failures are told once, not each time; a sign-in from a known device not at all.
 * No mail here carries a password, a code, a secret or a token.
 */
import type { SecurityEventKind } from '@backspace/shared';
import { mailLocaleOf } from '../email/account.js';
import { MAIL_COPY, type EmailKind, type MailLocale } from '../email/copy.js';
import { enqueueEmail, mailedRecently } from '../email/service.js';
import { schema } from '../db/index.js';
import { describeClient, maskAddress } from '../utils/sessions.js';
import { noteDevice, recentFailures, recordSecurityEvent } from './events.js';

type UserRow = typeof schema.users.$inferSelect;

interface Source {
  headers: { 'user-agent'?: string };
  ip?: string;
}

const HOUR = 60 * 60_000;
/** Failed passwords before the owner hears about it, and how often at most. */
const FAILED_PASSWORDS_TO_WARN = 5;
const WARN_LOGIN_EVERY_MS = 24 * HOUR;
/** Whoever gets a second factor wrong has the password, so this is said sooner and more often. */
const FAILED_CODES_TO_WARN = 3;
const WARN_MFA_EVERY_MS = 6 * HOUR;

/** Whatever goes wrong while recording this stays here: nobody is refused a sign-in over a log line. */
function quietly(work: () => void): void {
  try {
    work();
  } catch (error) {
    console.error('[security] could not record an event:', error instanceof Error ? error.name : 'unknown error');
  }
}

function tell(user: UserRow, kind: EmailKind, params: Readonly<Record<string, string>> = {}, now: number = Date.now()): void {
  if (!user.email || user.emailVerifiedAt === null) return;
  enqueueEmail({ kind, to: user.email, userId: user.id, locale: mailLocaleOf(user), params: { username: user.username, ...params } }, now);
}

function whereFrom(locale: MailLocale, source: Source, now: number): Record<string, string> {
  return {
    device: describeClient(source.headers['user-agent']) ?? MAIL_COPY[locale].unknownDevice,
    addressHint: maskAddress(source.ip) ?? '-',
    time: `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(now)} UTC`,
  };
}

/** A wrong password for an account that exists. Unknown names have nobody to tell. */
export function noteFailedPassword(user: UserRow, source: Source, now: number = Date.now()): void {
  quietly(() => {
    recordSecurityEvent(user.id, 'login_failed', source, now);
    if (recentFailures(user.id, 'login_failed', now) >= FAILED_PASSWORDS_TO_WARN && !mailedRecently(user.id, 'suspicious_login', WARN_LOGIN_EVERY_MS, now)) {
      tell(user, 'suspicious_login', whereFrom(mailLocaleOf(user), source, now), now);
    }
  });
}

export function noteFailedSecondFactor(user: UserRow, source: Source, now: number = Date.now()): void {
  quietly(() => {
    recordSecurityEvent(user.id, 'mfa_failed', source, now);
    if (recentFailures(user.id, 'mfa_failed', now) >= FAILED_CODES_TO_WARN && !mailedRecently(user.id, 'mfa_failures', WARN_MFA_EVERY_MS, now)) {
      tell(user, 'mfa_failures', whereFrom(mailLocaleOf(user), source, now), now);
    }
  });
}

/** Someone got in. The list hears every time; the address only for a device it has not seen. */
export function noteSignIn(user: UserRow, source: Source, deviceId: string | null, now: number = Date.now()): void {
  quietly(() => {
    const device = noteDevice(user.id, deviceId, now);
    recordSecurityEvent(user.id, device === 'new' ? 'login_new_device' : 'login', source, now);
    if (device === 'new') tell(user, 'new_device', whereFrom(mailLocaleOf(user), source, now), now);
  });
}

/** A change to the account's security: into the list, and to the address where one is confirmed. */
export function noteSecurityChange(user: UserRow, event: SecurityEventKind, mail: EmailKind | null, source: Source | null, now: number = Date.now()): void {
  quietly(() => {
    recordSecurityEvent(user.id, event, source, now);
    if (mail) tell(user, mail, {}, now);
  });
}
