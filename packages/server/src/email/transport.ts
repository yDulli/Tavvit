/** What a transport is handed. Rendered at send time; nothing of it is ever stored or logged. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * How a send ended, in the terms the queue acts on:
 * - `accepted`: the provider took it. Not "delivered": that is never known for sure.
 * - `retry`: this mail failed for now.
 * - `hold`: a quota is used up; the whole queue waits until then.
 * - `blocked`: the provider refuses this server's key or domain; the whole queue stops and an admin is told.
 * - `rejected`: this mail will never go. `suppress` when the address itself is what failed.
 */
export type SendResult =
  | { status: 'accepted'; providerId?: string; usage?: { day?: number; month?: number } }
  | { status: 'retry'; code: string; afterMs?: number }
  | { status: 'hold'; code: 'daily_quota' | 'monthly_quota'; until: number }
  | { status: 'blocked'; code: 'auth' | 'domain' | 'suspended' }
  | { status: 'rejected'; code: string; suppress?: boolean };

export interface EmailTransport {
  name: string;
  /** `idempotencyKey` is the same on every retry of one mail. */
  send(mail: OutgoingEmail, idempotencyKey: string): Promise<SendResult>;
  /** Whether the transport answers at all. Only ever a warning: chat starts without mail. */
  check(): Promise<{ ok: boolean; detail?: string }>;
}
