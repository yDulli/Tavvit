import crypto from 'node:crypto';

/**
 * The minute of the UTC day (0-1439) this instance's daily directory ping is
 * due, derived from a stable id so that instances spread over the day instead
 * of all calling the hub at midnight.
 */
export function slotMinute(id: string): number {
  const digest = crypto.createHash('sha256').update(id).digest();
  return digest.readUInt32BE(0) % 1440;
}

/** The hub's ping address. The endpoint is a base URL, so a trailing slash must not double up. */
export function pingUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, '')}/v1/ping`;
}
