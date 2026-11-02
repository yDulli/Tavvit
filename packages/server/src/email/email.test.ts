import { describe, expect, it } from 'vitest';
import { domainReceivesMail, hashAddress, maskEmail, normalizeEmail } from './address.js';
import { EMAIL_KINDS, MAIL_COPY, MAIL_LOCALES, type MailCopy } from './copy.js';
import { classifyResendError, nextUtcDay, nextUtcMonth } from './resendTransport.js';
import { classifySmtpError } from './smtpTransport.js';
import { escapeHtml, renderEmail } from './templates.js';

describe('an address', () => {
  it('keeps a domain in its one ASCII spelling, so no check sees two', () => {
    expect(normalizeEmail('A@Bücher.Example')).toBe('a@xn--bcher-kva.example');
    expect(normalizeEmail('a@xn--bcher-kva.example')).toBe('a@xn--bcher-kva.example');
    expect(normalizeEmail('a@例え。テスト')).toBe('a@xn--r8jz45g.xn--zckzah');
    expect(normalizeEmail('a@exa mple.com')).toBeNull();
  });

  it('is kept trimmed and in lower case', () => {
    expect(normalizeEmail('  Max.Mustermann+tag@Example.COM ')).toBe('max.mustermann+tag@example.com');
    expect(normalizeEmail('müller@bücher.example')).toBe('müller@xn--bcher-kva.example');
  });

  it('cannot be what is not one', () => {
    for (const bad of ['', 'plain', '@example.com', 'a@', 'a@b', 'a@@b.example', 'a b@example.com', 'a@exa mple.com', 'a@-x.example', 'a@x-.example', 'a@.example', 'a@example..com', 'a<b>@example.com', `${'a'.repeat(65)}@example.com`, `a@${'b'.repeat(250)}.example`, 42, null, undefined]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it('cannot carry a line break into a mail header', () => {
    for (const bad of ['a@example.com\r\nBcc: x@example.com', 'a\n@example.com', 'a@example.com\u0000', 'a\t@example.com']) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it('is shown to others only cut short', () => {
    expect(maskEmail('someone@example.com')).toBe('s***@example.com');
  });

  it('has one hash, whatever the mail is about', () => {
    expect(hashAddress('a@example.com')).toBe(hashAddress('a@example.com'));
    expect(hashAddress('a@example.com')).not.toContain('a@example.com');
  });

  it('is refused only on a clear no from DNS: the reserved .invalid has nothing, and our own trouble stops no one', async () => {
    expect(await domainReceivesMail('a@certainly-not-there.invalid')).toBe(false);
  }, 15_000);
});

describe('the words', () => {
  const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
  const textOf = (copy: MailCopy): string => [copy.subject, copy.heading, ...copy.lines, copy.action ?? '', ...(copy.after ?? [])].join(' ');

  it('exist for every kind in every language, naming the same things', () => {
    for (const kind of EMAIL_KINDS) {
      const english = MAIL_COPY.en.kinds[kind];
      for (const locale of MAIL_LOCALES) {
        const copy = MAIL_COPY[locale].kinds[kind];
        expect(copy, `${locale}/${kind}`).toBeDefined();
        expect(Boolean(copy.action), `${locale}/${kind} action`).toBe(Boolean(english.action));
        expect([...new Set(placeholders(textOf(copy)))], `${locale}/${kind}`).toEqual([...new Set(placeholders(textOf(english)))]);
      }
    }
  });

  it('never name a secret: no kind has a place for a password, code or token', () => {
    const allowed = new Set(['instance', 'username', 'newAddress', 'device', 'addressHint', 'time', 'detail']);
    for (const locale of MAIL_LOCALES) {
      for (const kind of EMAIL_KINDS) {
        for (const name of placeholders(textOf(MAIL_COPY[locale].kinds[kind]))) expect(allowed).toContain(name);
      }
    }
  });
});

describe('a rendered mail', () => {
  const base = { locale: 'en', params: { username: 'alice', newAddress: 'n***@example.com', device: 'Chrome · Windows', addressHint: '192.0.2.0', time: '1 Jan 2030, 10:00 UTC', detail: '91' }, instanceName: 'Tavvit', baseUrl: 'https://tavvit.example' } as const;

  it('leaves nothing unfilled, in any language, in either form', () => {
    for (const locale of MAIL_LOCALES) {
      for (const kind of EMAIL_KINDS) {
        const rendered = renderEmail({ ...base, kind, locale, actionUrl: 'https://tavvit.example/x#token' });
        for (const part of [rendered.subject, rendered.html, rendered.text]) expect(part, `${locale}/${kind}`).not.toMatch(/\{\w+\}/);
        expect(rendered.text.length, `${locale}/${kind}`).toBeGreaterThan(20);
      }
    }
  });

  it('has the button and the raw link in both forms', () => {
    const rendered = renderEmail({ ...base, kind: 'password_reset', actionUrl: 'https://tavvit.example/reset-password#abc' });
    expect(rendered.html).toContain('href="https://tavvit.example/reset-password#abc"');
    expect(rendered.html).toContain('Choose a new password');
    expect(rendered.text).toContain('Choose a new password: https://tavvit.example/reset-password#abc');
  });

  it('has no button where there is nowhere to go', () => {
    const rendered = renderEmail({ ...base, kind: 'email_changed' });
    expect(rendered.html).not.toContain('<a href="null"');
    expect(rendered.html).not.toContain('If the button');
  });

  it('escapes whatever a name brings, in the HTML only', () => {
    const rendered = renderEmail({ ...base, kind: 'verify_email', params: { username: '<img src=x onerror=alert(1)>' }, instanceName: 'A & B', actionUrl: 'https://tavvit.example/v#a' });
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered.html).toContain('A &amp; B');
    expect(rendered.text).toContain('<img src=x onerror=alert(1)>');
    expect(rendered.subject).toBe('Confirm your email address for A & B');
  });

  it('escapes the link too', () => {
    expect(escapeHtml('"><script>')).toBe('&quot;&gt;&lt;script&gt;');
    const rendered = renderEmail({ ...base, kind: 'verify_email', actionUrl: 'https://tavvit.example/v#"><script>' });
    expect(rendered.html).not.toContain('<script>');
  });
});

describe('what Resend answers', () => {
  const now = Date.UTC(2026, 9, 31, 15, 30);

  it('waits for the next day or month on a used-up quota', () => {
    expect(classifyResendError(429, 'daily_quota_exceeded', undefined, now)).toEqual({ status: 'hold', code: 'daily_quota', until: Date.UTC(2026, 10, 1) });
    expect(classifyResendError(429, 'monthly_quota_exceeded', undefined, now)).toEqual({ status: 'hold', code: 'monthly_quota', until: Date.UTC(2026, 10, 1) });
    expect(nextUtcDay(Date.UTC(2026, 11, 31, 23))).toBe(Date.UTC(2027, 0, 1));
    expect(nextUtcMonth(Date.UTC(2026, 11, 15))).toBe(Date.UTC(2027, 0, 1));
  });

  it('tries one mail again, honouring how long it was told to wait', () => {
    expect(classifyResendError(429, 'rate_limit_exceeded', 3, now)).toEqual({ status: 'retry', code: 'rate_limit_exceeded', afterMs: 3000 });
    expect(classifyResendError(500, 'application_error', undefined, now)).toMatchObject({ status: 'retry' });
    expect(classifyResendError(503, undefined, undefined, now)).toMatchObject({ status: 'retry', code: 'http_503' });
    expect(classifyResendError(409, 'concurrent_idempotent_requests', undefined, now)).toMatchObject({ status: 'retry' });
  });

  it('stops everything when the key or the domain is refused', () => {
    expect(classifyResendError(401, 'missing_api_key', undefined, now)).toEqual({ status: 'blocked', code: 'auth' });
    expect(classifyResendError(403, 'invalid_api_key', undefined, now)).toEqual({ status: 'blocked', code: 'auth' });
    expect(classifyResendError(403, 'validation_error', undefined, now)).toEqual({ status: 'blocked', code: 'domain' });
    expect(classifyResendError(422, 'invalid_from_address', undefined, now)).toEqual({ status: 'blocked', code: 'domain' });
  });

  it('gives up on one mail it will never take', () => {
    expect(classifyResendError(422, 'validation_error', undefined, now)).toEqual({ status: 'rejected', code: 'validation_error' });
  });
});

describe('what an SMTP server answers', () => {
  it('stops everything on a refused login', () => {
    expect(classifySmtpError({ code: 'EAUTH' })).toEqual({ status: 'blocked', code: 'auth' });
    expect(classifySmtpError({ responseCode: 535 })).toEqual({ status: 'blocked', code: 'auth' });
  });

  it('tries again on what may pass', () => {
    expect(classifySmtpError({ responseCode: 451 })).toEqual({ status: 'retry', code: 'smtp_451' });
    expect(classifySmtpError({ code: 'ETIMEDOUT' })).toEqual({ status: 'retry', code: 'ETIMEDOUT' });
    expect(classifySmtpError(new Error('boom'))).toEqual({ status: 'retry', code: 'network' });
  });

  it('marks the address only when it is the address that was refused', () => {
    expect(classifySmtpError({ responseCode: 550, command: 'RCPT TO' })).toEqual({ status: 'rejected', code: 'smtp_550', suppress: true });
    expect(classifySmtpError({ responseCode: 554, command: 'DATA' })).toEqual({ status: 'rejected', code: 'smtp_554', suppress: false });
  });

  it('never carries the server\'s words, which may quote the address', () => {
    const result = classifySmtpError({ responseCode: 550, response: '550 no such user someone@example.com', command: 'RCPT TO' });
    expect(JSON.stringify(result)).not.toContain('someone@example.com');
  });
});
