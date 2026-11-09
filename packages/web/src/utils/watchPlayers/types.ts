import type { WatchSource } from '@backspace/shared/src/watch';

/**
 * One player of a session's video (docs/systems/watch-together.md): YouTube's and Vimeo's own
 * players, steered from outside over postMessage, and a plain `<video>` for a file. The room
 * steers them; nobody steers a player directly, so they show no controls of their own.
 */

export interface WatchPlayerEvents {
  /** The video reached its end. */
  onEnded: () => void;
  /**
   * The browser would not play it with sound: it did not start, or it plays only silent (a
   * browser that refuses sound may let a provider's player go on muted). The person has to click
   * once, and the click calls `resume`.
   */
  onBlocked: () => void;
  /** It plays with its sound, or muted where the person's volume is 0 (after a block, once they clicked). */
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
  /** 0 to 100; 0 mutes it, anything else also takes back a mute. */
  setVolume: (volume: number) => void;
  /**
   * After `onBlocked`, from the person's click, which is what lets a page start sound: its sound
   * as the volume asks, and play.
   */
  resume: () => void;
  /**
   * Plays on this output device (the call's, Settings; `default` is the system's own), where the
   * browser lets a page choose one. Missing where it cannot: a provider's player plays in a frame
   * of its own, whose sound always goes to the system's default output.
   */
  setOutputDevice?: (deviceId: string) => void;
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

/**
 * How long a play may take to start with its sound before the browser is taken to have refused
 * it. Counted once per attempt: the room asks a player to play every second, and an ask that
 * started the count anew would keep it from ever ending.
 */
export const PLAY_START_GRACE_MS = 2_500;
