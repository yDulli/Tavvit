/** A space's soundboard (docs/systems/sounds.md, "Soundboard"): short clips each listener plays on their own device. */

import { isVisibleSingleLine } from './constants.js';

export const SOUNDBOARD_LIMITS = {
  PER_SPACE_MAX: 24,
  MAX_BYTES: 512 * 1024,
  MAX_SECONDS: 5,
  NAME_MAX_LENGTH: 32,
  /** How often one person can play a clip, in the window below. */
  PLAYS_PER_WINDOW: 6,
  WINDOW_MS: 10_000,
} as const;

/**
 * A clip's name as stored, or null when the value is not one: trimmed, at most
 * NAME_MAX_LENGTH, and following the rule nicknames follow (no control
 * character, line break or bidirectional control, something visible).
 */
export function normalizeSoundName(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  return name && name.length <= SOUNDBOARD_LIMITS.NAME_MAX_LENGTH && isVisibleSingleLine(name) ? name : null;
}

export interface SpaceSound {
  id: string;
  spaceId: string;
  name: string;
  duration: number;
  createdBy: string | null;
  createdAt: number;
}

export interface SpaceSoundRequest {
  name: string;
  /** The file, in base64. */
  audio: string;
  /** Its length as the browser measured it, for an instance without ffprobe. */
  duration?: number;
}
