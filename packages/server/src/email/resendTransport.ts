import type { EmailTransport, SendResult } from './transport.js';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 15_000;

function numberHeader(headers: Headers, name: string): number | undefined {
  const value = Number(headers.get(name) ?? Number.NaN);
  return Number.isFinite(value) ? value : undefined;
}

/** The next midnight, UTC: when Resend's daily quota starts over. */
export function nextUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/** The first of the next month, UTC. */
export function nextUtcMonth(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/** What an answer other than success means. Only the error's name is read; its message may quote the mail. */
export function classifyResendError(status: number, name: string | undefined, retryAfterSeconds: number | undefined, now: number): SendResult {
  if (name === 'daily_quota_exceeded') return { status: 'hold', code: 'daily_quota', until: nextUtcDay(now) };
  if (name === 'monthly_quota_exceeded') return { status: 'hold', code: 'monthly_quota', until: nextUtcMonth(now) };
  if (status === 429) return { status: 'retry', code: name ?? 'rate_limited', afterMs: retryAfterSeconds === undefined ? undefined : retryAfterSeconds * 1000 };
  if (status === 401) return { status: 'blocked', code: 'auth' };
  // A key without sending rights, or a domain that is not verified.
  if (status === 403) return { status: 'blocked', code: name === 'validation_error' ? 'domain' : 'auth' };
  if (name === 'invalid_from_address') return { status: 'blocked', code: 'domain' };
  if (status >= 500 || status === 409 || status === 408) return { status: 'retry', code: name ?? `http_${status}` };
  return { status: 'rejected', code: name ?? `http_${status}` };
}

/**
 * Resend's HTTP API, in place of its SDK: this one request is all that is needed, and it
 * reads the quota headers. Open and click tracking are the provider's defaults: off, and
 * they have to stay off, because click tracking would rewrite the links in these mails.
 */
export function createResendTransport(options: { apiKey: string; from: string; replyTo: string | null; version: string }): EmailTransport {
  return {
    name: 'resend',
    async send(mail, idempotencyKey) {
      let response: Response;
      try {
        response = await fetch(RESEND_EMAILS_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
            // Resend answers 403 to a request without one.
            'user-agent': `Tavvit/${options.version}`,
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            from: options.from,
            to: [mail.to],
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            ...(options.replyTo ? { reply_to: options.replyTo } : {}),
            headers: { 'Auto-Submitted': 'auto-generated' },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        return { status: 'retry', code: 'network' };
      }
      const body = await response.json().catch(() => null) as { id?: unknown; name?: unknown } | null;
      if (response.ok) {
        return {
          status: 'accepted',
          providerId: typeof body?.id === 'string' ? body.id : undefined,
          usage: { day: numberHeader(response.headers, 'x-resend-daily-quota'), month: numberHeader(response.headers, 'x-resend-monthly-quota') },
        };
      }
      return classifyResendError(response.status, typeof body?.name === 'string' ? body.name : undefined, numberHeader(response.headers, 'retry-after'), Date.now());
    },
    async check() {
      // A sending-only key can do nothing else, so asking it anything would only say 403.
      return { ok: true };
    },
  };
}
