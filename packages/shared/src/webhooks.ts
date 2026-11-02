/** Webhooks (docs/systems/webhooks.md): an address that posts into one channel. Incoming only. */

export const WEBHOOK_LIMITS = {
  NAME_MAX_LENGTH: 32,
  PER_CHANNEL_MAX: 10,
  PER_SPACE_MAX: 50,
  POSTS_PER_MINUTE: 30,
} as const;

/** What those who manage a webhook see. The token is not here: it is shown once, when it is made. */
export interface WebhookInfo {
  id: string;
  spaceId: string;
  channelId: string;
  name: string;
  createdBy: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/** A webhook just made, or given a new token. The only moment the token leaves the server. */
export interface WebhookWithToken {
  webhook: WebhookInfo;
  token: string;
}

/** The address to post to, on the instance that hosts the channel. */
export function webhookPath(id: string, token: string): string {
  return `/api/webhooks/${id}/${token}`;
}
