import { WATCH_LIMITS, watchPositionAt, type WatchSession } from '@backspace/shared/src/watch';

/**
 * Keeping a player with its room (docs/systems/watch-together.md). The server stamps where the
 * video stood with its own clock; a client turns that into its own time with the offset between
 * the two clocks it saw when the stamp arrived.
 */

/** How far the server's clock is ahead of this one: `serverNow` minus the local clock when it arrived. */
export function clockOffset(serverNow: number, localNow: number = Date.now()): number {
  return serverNow - localNow;
}

/** Where the room's video stands now, by this client's clock. */
export function roomPositionMs(
  session: Pick<WatchSession, 'playing' | 'positionMs' | 'stateAt'>,
  offsetMs: number,
  localNow: number = Date.now(),
): number {
  return watchPositionAt(session, localNow + offsetMs);
}

/**
 * How close a player is put to the room once, right after it starts or the room changes: a player
 * that just loaded starts behind by its loading time, and the wider drift tolerance would let it
 * stay there for the whole video.
 */
export const SETTLE_TOLERANCE_MS = 600;

/** Whether a player at `playerMs` has run far enough from the room to be moved back to it. */
export function needsSeek(playerMs: number | null, roomMs: number, toleranceMs: number = WATCH_LIMITS.DRIFT_TOLERANCE_MS): boolean {
  return playerMs === null || Math.abs(playerMs - roomMs) > toleranceMs;
}
