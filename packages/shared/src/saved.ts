import type { DmMessageWithUser, MessageWithUser } from './types.js';

/** Saved messages (docs/systems/saved.md): a person's own list, with a reminder if they want one. */

export const SAVED_LIMITS = {
  PER_ACCOUNT: 500,
  PAGE: 30,
  /** How far ahead a reminder can be. */
  REMIND_WITHIN_MS: 366 * 24 * 3600 * 1000,
} as const;

export type SavedKind = 'channel' | 'dm';

export type SavedItem = {
  id: string;
  remindAt: number | null;
  createdAt: number;
} & (
  | { kind: 'channel'; channelId: string; spaceId: string; message: MessageWithUser }
  | { kind: 'dm'; channelId: string; spaceId: null; message: DmMessageWithUser }
);

export interface SavedListResponse {
  items: SavedItem[];
  nextBefore: string | null;
}
