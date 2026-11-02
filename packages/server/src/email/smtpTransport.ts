import nodemailer from 'nodemailer';
import type { EmailTransport, SendResult } from './transport.js';

interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
  replyTo: string | null;
}

/** What a failed send means, from the SMTP code. The server's words may quote the address, so they stay out. */
export function classifySmtpError(error: unknown): SendResult {
  const { code, responseCode, command } = error as { code?: unknown; responseCode?: unknown; command?: unknown };
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534 || responseCode === 530) return { status: 'blocked', code: 'auth' };
  if (typeof responseCode === 'number' && responseCode >= 500) {
    // Only a refusal of the recipient says something about the address.
    return { status: 'rejected', code: `smtp_${responseCode}`, suppress: command === 'RCPT TO' };
  }
  if (typeof responseCode === 'number') return { status: 'retry', code: `smtp_${responseCode}` };
  return { status: 'retry', code: typeof code === 'string' ? code : 'network' };
}

export function createSmtpTransport(options: SmtpOptions): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    // A login is never sent in the clear. A relay on the internal network without one may go without TLS.
    requireTLS: options.user !== null && !options.secure,
    ...(options.user ? { auth: { user: options.user, pass: options.pass ?? '' } } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const fromDomain = /@([^>\s]+)/.exec(options.from)?.[1] ?? 'localhost';
  return {
    name: 'smtp',
    async send(mail, idempotencyKey) {
      try {
        const info = await transporter.sendMail({
          from: options.from,
          to: mail.to,
          ...(options.replyTo ? { replyTo: options.replyTo } : {}),
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          // The same id on a retry: a receiving server can tell it is the same mail.
          messageId: `<${idempotencyKey}@${fromDomain}>`,
          headers: { 'Auto-Submitted': 'auto-generated' },
        });
        return { status: 'accepted', providerId: typeof info.messageId === 'string' ? info.messageId : undefined };
      } catch (error) {
        return classifySmtpError(error);
      }
    },
    async check() {
      try {
        await transporter.verify();
        return { ok: true };
      } catch (error) {
        const result = classifySmtpError(error);
        return { ok: false, detail: result.status === 'accepted' ? undefined : result.code };
      }
    },
  };
}
