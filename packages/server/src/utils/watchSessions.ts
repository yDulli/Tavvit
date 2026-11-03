import {
  WATCH_LIMITS,
  watchPositionAt,
  type WatchAction,
  type WatchItem,
  type WatchPresence,
  type WatchSession,
  type WatchSource,
} from '@backspace/shared/src/watch.js';
import { connectionManager, watchPresenceOf, type SpaceRoomMeta, type VoiceRoom } from '../ws/handler.js';
import { generateSnowflake } from './snowflake.js';

/**
 * A voice channel's session of watching together (docs/systems/watch-together.md). It lives on the
 * channel's room (`VoiceRoom.watch`), so it ends with the call: nothing of it is written anywhere.
 * The server holds where the video stands and who may steer it; each client plays it itself.
 */

/** The furthest a seek may go: a day, longer than any video a room watches. */
const MAX_POSITION_MS = 24 * 60 * 60 * 1000;

export type AddOutcome = { kind: 'started' | 'queued'; session: WatchSession } | { kind: 'queue_full' };

/** How large the session is when sent: every change goes to everyone in the call as this. */
function sentBytes(session: WatchSession): number {
  return JSON.stringify(session).length;
}

/**
 * Add a video to the room's session, or start one with it. Whoever starts a session is its starter,
 * and everyone in the call may steer it until the starter says otherwise. The queue holds at most
 * `QUEUE_MAX` videos and the session stays within `SESSION_MAX_BYTES` when sent, whichever comes
 * first: a queue of long links must not turn every change into a large frame for everyone.
 */
export function addToSession(room: VoiceRoom, source: WatchSource, title: string, userId: string, now: number = Date.now()): AddOutcome {
  const item: WatchItem = { ...source, id: generateSnowflake(), title };
  const session = room.watch;
  if (!session) {
    const meta = room.metadata as SpaceRoomMeta;
    room.watch = {
      channelId: room.roomId,
      spaceId: meta.spaceId,
      current: item,
      queue: [],
      playing: true,
      positionMs: item.startMs,
      stateAt: now,
      control: 'everyone',
      starterId: userId,
    };
    return { kind: 'started', session: room.watch };
  }
  if (!session.current) {
    play(session, item, now);
    return { kind: 'started', session };
  }
  if (session.queue.length >= WATCH_LIMITS.QUEUE_MAX) return { kind: 'queue_full' };
  session.queue.push(item);
  if (sentBytes(session) > WATCH_LIMITS.SESSION_MAX_BYTES) {
    session.queue.pop();
    return { kind: 'queue_full' };
  }
  return { kind: 'queued', session };
}

function play(session: WatchSession, item: WatchItem | null, now: number): void {
  session.current = item;
  session.positionMs = item?.startMs ?? 0;
  session.playing = item !== null;
  session.stateAt = now;
}

/** May `userId` steer the session: always its starter, anyone in the call while control is everyone's. */
export function mayControl(session: WatchSession, userId: string): boolean {
  return session.control === 'everyone' || session.starterId === userId;
}

/**
 * What a change did. `position`: only where the video stands changed, and the call is told that
 * alone (`watch_position`). `session`: what plays, the queue or who steers changed, and the call
 * gets the whole session (`watch_state`). `unchanged`: a change that changed nothing (a pause while
 * paused, a `next` for a video that no longer plays): nothing is sent for it, so a flood of such
 * requests cannot become a flood of frames to everyone in the call.
 */
export type ActionOutcome =
  | { kind: 'changed'; scope: 'position' | 'session'; session: WatchSession }
  | { kind: 'unchanged'; session: WatchSession }
  | { kind: 'not_controller' }
  | { kind: 'not_found' };

/**
 * Apply a change to the room's session. Who may control it is the starter's to decide; the rest
 * follows `mayControl`. A `next` that names the video it skips is ignored once another plays, so
 * the end of a video reported by several players at once skips one video, not several.
 */
export function applyWatchAction(room: VoiceRoom, action: WatchAction, userId: string, now: number = Date.now()): ActionOutcome {
  const session = room.watch;
  if (!session) return { kind: 'not_found' };
  if (action.action === 'control') {
    if (session.starterId !== userId) return { kind: 'not_controller' };
    if (session.control === action.control) return { kind: 'unchanged', session };
    session.control = action.control;
    return { kind: 'changed', scope: 'session', session };
  }
  if (!mayControl(session, userId)) return { kind: 'not_controller' };

  switch (action.action) {
    case 'play':
    case 'pause': {
      if (!session.current) return { kind: 'not_found' };
      const playing = action.action === 'play';
      if (session.playing === playing) return { kind: 'unchanged', session };
      session.positionMs = watchPositionAt(session, now);
      session.playing = playing;
      session.stateAt = now;
      return { kind: 'changed', scope: 'position', session };
    }
    case 'seek': {
      if (!session.current) return { kind: 'not_found' };
      const positionMs = Math.min(Math.max(0, Math.round(action.positionMs)), MAX_POSITION_MS);
      if (!session.playing && session.positionMs === positionMs) return { kind: 'unchanged', session };
      session.positionMs = positionMs;
      session.stateAt = now;
      return { kind: 'changed', scope: 'position', session };
    }
    case 'next':
      if (action.itemId !== undefined && action.itemId !== session.current?.id) return { kind: 'unchanged', session };
      play(session, session.queue.shift() ?? null, now);
      return { kind: 'changed', scope: 'session', session };
    case 'remove': {
      if (session.current?.id === action.itemId) {
        play(session, session.queue.shift() ?? null, now);
        return { kind: 'changed', scope: 'session', session };
      }
      const kept = session.queue.filter((item) => item.id !== action.itemId);
      if (kept.length === session.queue.length) return { kind: 'unchanged', session };
      session.queue = kept;
      return { kind: 'changed', scope: 'session', session };
    }
  }
}

/** End the room's session. False when there was none. */
export function endSession(room: VoiceRoom): boolean {
  if (!room.watch) return false;
  delete room.watch;
  return true;
}

function samePresence(a: WatchPresence | null, b: WatchPresence | null): boolean {
  return a === b || (a !== null && b !== null && a.title === b.title && a.provider === b.provider);
}

/**
 * Tell the call where the session stands (`watch_state`, null once it ended), and the channel list
 * what plays (`watch_presence`, to everyone who can see the channel) when that changed from
 * `before`, what `watchPresenceOf(room)` said before the change. Without `before` the list is told
 * either way.
 */
export function announceWatch(room: VoiceRoom, now: number = Date.now(), before?: WatchPresence | null): void {
  const meta = room.metadata as SpaceRoomMeta;
  connectionManager.sendToUsers(room.participants, { type: 'watch_state', channelId: room.roomId, session: room.watch ?? null, serverNow: now });
  const presence = watchPresenceOf(room);
  if (before !== undefined && samePresence(before, presence)) return;
  connectionManager.sendToChannel(meta.spaceId, room.roomId, {
    type: 'watch_presence',
    spaceId: meta.spaceId,
    channelId: room.roomId,
    presence,
  });
}

/** Tell the call where its video stands now, and nothing else: a play, pause or seek. */
export function announceWatchPosition(room: VoiceRoom, now: number = Date.now()): void {
  const session = room.watch;
  if (!session?.current) return;
  connectionManager.sendToUsers(room.participants, {
    type: 'watch_position',
    channelId: room.roomId,
    position: { itemId: session.current.id, playing: session.playing, positionMs: session.positionMs, stateAt: session.stateAt },
    serverNow: now,
  });
}
