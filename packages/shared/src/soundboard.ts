/** A space's soundboard (docs/systems/sounds.md, "Soundboard"): short clips each listener plays on their own device. */

export const SOUNDBOARD_LIMITS = {
  PER_SPACE_MAX: 24,
  MAX_BYTES: 512 * 1024,
  MAX_SECONDS: 5,
  NAME_MAX_LENGTH: 32,
  /** How often one person can play a clip, in the window below. */
  PLAYS_PER_WINDOW: 6,
  WINDOW_MS: 10_000,
} as const;

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
