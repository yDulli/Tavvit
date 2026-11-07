/**
 * Live on Twitch (docs/systems/activity-presence.md, "Live on Twitch").
 *
 * Someone who links a Twitch channel on their profile and shares what they are
 * doing is shown as live while they stream, the way a game is shown while they
 * play. This instance asks Twitch itself, once a minute, about the channels of
 * its own people who are signed in: a client could claim any stream, and a
 * peer's people are their home's to ask about. What Twitch answers becomes a
 * `streaming` activity marked `source: 'twitch'` beside what the person's
 * client reports (`ConnectionManager.setDerivedActivities`), and goes where any
 * activity goes: their profile's audience, their own windows, and the peers
 * that hold their row, which keep the mark.
 *
 * Asking Twitch, and reading its answer, is utils/twitchApi.ts.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Activity } from '@backspace/shared';
import { parseStoredProfileLinks } from '@backspace/shared/src/profileFields.js';
import { twitchChannelOfLinks } from '@backspace/shared/src/twitch.js';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { presenceUpdateFor } from '../ws/presenceEvent.js';
import { batchInArray } from './sqlBatch.js';
import { askTwitch, liveActivityOf, twitchLiveAvailable, TwitchUnavailable, type TwitchStream } from './twitchApi.js';

export const TWITCH_CHECK_INTERVAL_MS = 60_000;
/** Without an answer from Twitch for this long, a stream is no longer known to be live, and goes. */
export const STALE_AFTER_MS = 5 * 60_000;

/** What the admin console's system page says about the check (docs/systems/admin.md). */
export type TwitchLiveState = 'off' | 'ok' | 'failing';

let lastAnswerAt = 0;
let failing: TwitchUnavailable | null = null;
/** The people this check gave an activity: the only ones it ever takes one from. */
const derivedFor = new Set<string>();

export function twitchLiveState(): TwitchLiveState {
  if (!twitchLiveAvailable()) return 'off';
  return failing ? 'failing' : 'ok';
}

/**
 * The people to ask about, with their channel: this instance's own, signed in,
 * sharing what they do, with a Twitch channel among their profile's links. A
 * peer's people are left to their home, which relays what it found.
 */
function channelsToAsk(): Map<string, string> {
  const online = connectionManager.getAllOnlineUserIds();
  const wanted = new Map<string, string>();
  if (online.length === 0) return wanted;
  const db = getDb();
  const rows = batchInArray(online, (ids) => db
    .select({ id: schema.users.id, profileLinks: schema.users.profileLinks })
    .from(schema.users)
    .where(and(
      inArray(schema.users.id, ids),
      isNull(schema.users.homeInstance),
      eq(schema.users.accountKind, 'person'),
      eq(schema.users.showActivity, 1),
    ))
    .all());
  for (const row of rows) {
    if (!row.profileLinks) continue;
    const channel = twitchChannelOfLinks(parseStoredProfileLinks(row.profileLinks));
    if (channel) wanted.set(row.id, channel);
  }
  return wanted;
}

const keyOf = (activities: readonly Activity[]): string => JSON.stringify(activities);

/** Show `derived` as the derived part of `userId`'s set, to everyone their activities go to. Nothing when it is unchanged. */
function show(userId: string, derived: Activity[]): void {
  if (derived.length > 0) derivedFor.add(userId);
  else derivedFor.delete(userId);
  if (keyOf(connectionManager.getDerivedActivities(userId)) === keyOf(derived)) return;
  const activities = connectionManager.setDerivedActivities(userId, derived);
  const status = connectionManager.getUserStatus(userId);
  const payload = presenceUpdateFor(userId, status, activities);
  connectionManager.broadcastPresence(userId, payload);
  connectionManager.sendToUser(userId, payload);
  // Imported when used, as every presence relay is (federationPresence → db → ws/handler).
  void import('./federationPresence.js').then(({ queuePresenceRelay }) => {
    try {
      queuePresenceRelay(userId, status as 'online' | 'idle' | 'dnd' | 'offline', activities);
    } catch (error) {
      console.warn('[twitch] queuePresenceRelay failed', error);
    }
  });
}

/** Take what this check gave from everyone it gave it to who is not in `keep`. */
function withdrawExcept(keep: ReadonlySet<string>): void {
  for (const userId of [...derivedFor]) {
    if (keep.has(userId)) continue;
    derivedFor.delete(userId);
    // Gone already when the person signed off or stopped sharing.
    if (connectionManager.isUserOnline(userId) && connectionManager.getDerivedActivities(userId).length > 0) show(userId, []);
  }
}

function noteFailure(error: TwitchUnavailable): void {
  if (!failing) {
    const hint = error.credentials ? ' Check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.' : '';
    console.warn(`[twitch] Twitch did not answer (${error.reason}); live streams show again once it does.${hint}`);
  }
  failing = error;
}

/**
 * One round: ask Twitch about everyone to ask about, and show or take away
 * what changed. When Twitch does not answer, what was shown stays for a few
 * minutes (one missed answer is not the end of a stream), then goes.
 */
export async function checkTwitchLive(now = Date.now()): Promise<void> {
  if (!twitchLiveAvailable()) return;
  const wanted = channelsToAsk();
  if (wanted.size === 0) {
    withdrawExcept(new Set());
    return;
  }
  let live: Map<string, TwitchStream>;
  try {
    live = await askTwitch([...new Set(wanted.values())]);
  } catch (error) {
    if (!(error instanceof TwitchUnavailable)) throw error;
    noteFailure(error);
    if (now - lastAnswerAt > STALE_AFTER_MS) withdrawExcept(new Set());
    return;
  }
  if (failing) console.log('[twitch] Twitch answers again.');
  failing = null;
  lastAnswerAt = now;
  const keep = new Set<string>();
  for (const [userId, channel] of wanted) {
    // Signed off, or stopped sharing, while Twitch was asked: their set is gone, and stays so.
    if (!connectionManager.isUserOnline(userId) || !connectionManager.getUserShowActivity(userId)) continue;
    const stream = live.get(channel);
    if (stream) keep.add(userId);
    show(userId, stream ? [liveActivityOf(stream, channel, now)] : []);
  }
  withdrawExcept(keep);
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function checkAndReport(): Promise<void> {
  // A slow round is not overtaken by the next one.
  if (running) return;
  running = true;
  try {
    await checkTwitchLive();
  } catch (error) {
    console.error('[twitch] the live check failed:', error);
  } finally {
    running = false;
  }
}

export function startTwitchLive(): void {
  if (timer || !twitchLiveAvailable()) return;
  console.log(`[twitch] Asking Twitch every ${TWITCH_CHECK_INTERVAL_MS / 1000}s whether linked channels are live.`);
  timer = setInterval(() => { void checkAndReport(); }, TWITCH_CHECK_INTERVAL_MS);
  // The timer must never keep the process alive on its own.
  timer.unref();
}

export function stopTwitchLive(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Forget what was shown and whether Twitch answered (tests). */
export function resetTwitchLive(): void {
  lastAnswerAt = 0;
  failing = null;
  derivedFor.clear();
}
