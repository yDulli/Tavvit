/**
 * Live on Twitch (docs/systems/activity-presence.md, "Live on Twitch").
 *
 * Someone who linked their Twitch account (docs/systems/linked-accounts.md: by signing in at
 * Twitch, so it is theirs) is shown as live while they stream, the way a game is shown while they
 * play. This instance asks Twitch itself, once a minute, about the linked accounts of its own
 * people who are signed in: a client could claim any stream, and a peer's people are their home's
 * to ask about. What Twitch answers becomes a `streaming` activity marked `source: 'twitch'`
 * beside what the person's client reports (`ConnectionManager.setDerivedActivities`), and goes
 * where any activity goes: their profile's audience, their own windows, and the peers that hold
 * their row, which keep the mark.
 *
 * Asking Twitch, and reading its answer, is utils/twitchApi.ts.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Activity } from '@backspace/shared';
import { linkedAccountName } from '@backspace/shared/src/linkedAccounts.js';
import { isTwitchLogin } from '@backspace/shared/src/twitch.js';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { presenceUpdateFor } from '../ws/presenceEvent.js';
import { noteLinkedAccountName } from './linkedAccounts.js';
import { batchInArray } from './sqlBatch.js';
import { askTwitch, liveActivityOf, twitchAvailable, TwitchUnavailable, type TwitchStream } from './twitchApi.js';

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
  if (!twitchAvailable()) return 'off';
  return failing ? 'failing' : 'ok';
}

/**
 * The people to ask about, with their Twitch account's id: this instance's
 * own, signed in, sharing what they do, with a linked Twitch account they let
 * show when they are live. A peer's people are left to their home, which
 * relays what it found.
 */
function accountsToAsk(): Map<string, string> {
  const online = connectionManager.getAllOnlineUserIds();
  const wanted = new Map<string, string>();
  if (online.length === 0) return wanted;
  const db = getDb();
  const rows = batchInArray(online, (ids) => db
    .select({ id: schema.users.id, accountId: schema.linkedAccounts.providerUserId })
    .from(schema.linkedAccounts)
    .innerJoin(schema.users, eq(schema.users.id, schema.linkedAccounts.userId))
    .where(and(
      inArray(schema.users.id, ids),
      eq(schema.linkedAccounts.provider, 'twitch'),
      eq(schema.linkedAccounts.showLive, 1),
      isNull(schema.users.homeInstance),
      eq(schema.users.accountKind, 'person'),
      eq(schema.users.showActivity, 1),
    ))
    .all());
  for (const row of rows) wanted.set(row.id, row.accountId);
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
    withdrawTwitchLive(userId);
  }
}

/**
 * Take a person's live stream away now, not at the next round: they unlinked
 * the account, or stopped letting it show (routes/linkedAccounts.ts). Nothing
 * when the check gave them none.
 */
export function withdrawTwitchLive(userId: string): void {
  if (!derivedFor.has(userId)) return;
  derivedFor.delete(userId);
  // Gone already when the person signed off or stopped sharing.
  if (connectionManager.isUserOnline(userId) && connectionManager.getDerivedActivities(userId).length > 0) show(userId, []);
}

function noteFailure(error: TwitchUnavailable): void {
  if (!failing) {
    const hint = error.credentials ? ' Check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.' : '';
    console.warn(`[twitch] Twitch did not answer (${error.reason}); live streams show again once it does.${hint}`);
  }
  failing = error;
}

/** A stream's answer names its account anew after a rename at Twitch: the linked account follows. */
function noteName(stream: TwitchStream): void {
  const name = linkedAccountName(stream.shownName);
  if (!isTwitchLogin(stream.login) || name === null) return;
  try {
    noteLinkedAccountName('twitch', stream.userId, stream.login, name);
  } catch (error) {
    console.warn('[twitch] could not note a renamed account', error);
  }
}

/**
 * One round: ask Twitch about everyone to ask about, and show or take away
 * what changed. When Twitch does not answer, what was shown stays for a few
 * minutes (one missed answer is not the end of a stream), then goes.
 */
export async function checkTwitchLive(now = Date.now()): Promise<void> {
  if (!twitchAvailable()) return;
  const wanted = accountsToAsk();
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
  for (const [userId, accountId] of wanted) {
    // Signed off, or stopped sharing, while Twitch was asked: their set is gone, and stays so.
    if (!connectionManager.isUserOnline(userId) || !connectionManager.getUserShowActivity(userId)) continue;
    const stream = live.get(accountId);
    if (stream) {
      keep.add(userId);
      noteName(stream);
    }
    show(userId, stream ? [liveActivityOf(stream, now)] : []);
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

let soon: ReturnType<typeof setTimeout> | null = null;

/**
 * A round in a moment, outside the minute's rhythm: someone just linked their
 * account or let it show while they may already be live. Nothing while the
 * check is not running, and one round for any number of asks in that moment.
 */
export function checkTwitchLiveSoon(delayMs = 2000): void {
  if (!timer || soon) return;
  soon = setTimeout(() => {
    soon = null;
    void checkAndReport();
  }, delayMs);
  soon.unref();
}

export function startTwitchLive(redirectUri: string): void {
  if (timer || !twitchAvailable()) return;
  console.log(`[twitch] Asking Twitch every ${TWITCH_CHECK_INTERVAL_MS / 1000}s whether linked accounts are live. Linking returns to ${redirectUri}; it must be an OAuth redirect URL of the Twitch application.`);
  timer = setInterval(() => { void checkAndReport(); }, TWITCH_CHECK_INTERVAL_MS);
  // The timer must never keep the process alive on its own.
  timer.unref();
}

export function stopTwitchLive(): void {
  if (soon) {
    clearTimeout(soon);
    soon = null;
  }
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
