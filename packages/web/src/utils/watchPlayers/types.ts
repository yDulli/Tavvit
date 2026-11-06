import type { WatchSource } from '@backspace/shared/src/watch';

/**
 * One player of a session's video (docs/systems/watch-together.md): YouTube's and Vimeo's own
 * players, steered from outside over postMessage, and a plain `<video>` for a file. The room
 * steers them; nobody steers a player directly, so they show no controls of their own.
 */

export interface WatchPlayerEvents {
  /** The video reached its end. */
  onEnded: () => void;
  /** The browser would not start it with sound: the person has to press play once. */
  onBlocked: () => void;
  /** It plays (after a block, once the person pressed play). */
  onPlaying: () => void;
}

export interface WatchPlayer {
  /** What draws the video; the host places it. */
  readonly element: HTMLElement;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  /** Where it stands now, or null while it cannot say yet. */
  currentMs: () => number | null;
  /** How long the video is, or null while it cannot say (a live stream never can). */
  durationMs: () => number | null;
  /** 0 to 100. */
  setVolume: (volume: number) => void;
  /**
   * Subtitles on or off, for this viewer. Off until asked for: a provider left
   * to itself turns them on (YouTube does when the video's language is not the
   * browser's), and the room's own controls are the only ones there are.
   * Missing where the player has none to show (a plain file).
   */
  setCaptions?: (on: boolean) => void;
  destroy: () => void;
}

export type WatchPlayerFactory = (source: WatchSource, startMs: number, events: WatchPlayerEvents) => WatchPlayer;

/** How long a play may take to start before the browser is taken to have refused it. */
export const PLAY_START_GRACE_MS = 2_500;
