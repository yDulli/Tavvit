import { and, eq, lte } from 'drizzle-orm';
import type { SpaceModerationSettings } from '@backspace/shared';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors';
import { DEFAULT_MODERATION_SETTINGS, countMentions, findModerationViolation } from '@backspace/shared/src/moderation.js';
import { getDb, schema, type DBHandle } from '../db/index.js';
import { getMember, hasPermission, isSpaceOwner, PermissionBits } from './permissions.js';
import { accountNeedsVerifiedEmail } from '../email/gate.js';

// Space moderation on the instance that hosts the space (docs/systems/spaces.md,
// "Moderation"): member timeouts, the minimum account and membership ages,
// slow mode and the automatic message rules. Every message write in a space
// channel goes through `spaceMessageRefusal`, from the REST routes and the
// WebSocket handlers alike, so both refuse the same things in the same order.
// DMs never come here.
//
// Every user id is a row id on this instance: a member whose home is another
// instance posts, reacts and is timed out through their replicated row here.
// Nothing in this module is relayed to peers.

/** A refused action in a space: the HTTP status and code REST answers with, and the details the code reads. */
export interface ModerationRefusal {
  status: 400 | 403 | 429;
  code: ErrorCode;
  details?: ErrorDetails;
}

const MINUTE_MS = 60_000;

// ─── Settings ───────────────────────────────────────────────────────────────

/** A stored blocked word list, read leniently: anything that is not a list of strings counts as empty. */
function parseBlockedWords(stored: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((word): word is string => typeof word === 'string') : [];
  } catch {
    return [];
  }
}

/** A space's rules; the defaults (with `updatedAt` null) for a space that has never changed them. */
export function readModerationSettings(spaceId: string, handle: DBHandle = getDb()): SpaceModerationSettings {
  const row = handle.select().from(schema.spaceModerationSettings)
    .where(eq(schema.spaceModerationSettings.spaceId, spaceId)).get();
  if (!row) return { ...DEFAULT_MODERATION_SETTINGS, blockedWords: [] };
  return {
    blockedWords: parseBlockedWords(row.blockedWords),
    blockLinks: row.blockLinks === 1,
    blockInvites: row.blockInvites === 1,
    maxMentions: row.maxMentions,
    minAccountAgeMinutes: row.minAccountAgeMinutes,
    minMemberAgeMinutes: row.minMemberAgeMinutes,
    updatedAt: row.updatedAt,
  };
}

/** Store a space's rules (already checked by `normalizeModerationSettings`) and answer them as stored. */
export function writeModerationSettings(spaceId: string, value: SpaceModerationSettings, now: number): SpaceModerationSettings {
  const columns = {
    blockedWords: JSON.stringify(value.blockedWords),
    blockLinks: value.blockLinks ? 1 : 0,
    blockInvites: value.blockInvites ? 1 : 0,
    maxMentions: value.maxMentions,
    minAccountAgeMinutes: value.minAccountAgeMinutes,
    minMemberAgeMinutes: value.minMemberAgeMinutes,
    updatedAt: now,
  };
  getDb().insert(schema.spaceModerationSettings).values({ spaceId, ...columns })
    .onConflictDoUpdate({ target: schema.spaceModerationSettings.spaceId, set: columns })
    .run();
  return { ...value, blockedWords: [...value.blockedWords], updatedAt: now };
}

/** Whether any automatic rule is switched on, so a message has something to be checked against. */
function hasAutomodRule(settings: SpaceModerationSettings): boolean {
  return settings.blockedWords.length > 0 || settings.blockLinks || settings.blockInvites || settings.maxMentions > 0;
}

// ─── Timeouts ───────────────────────────────────────────────────────────────

/** The end of a timeout that is still running at `now`, or null when there is none (never set, lifted or over). */
export function activeTimeoutUntil(timedOutUntil: number | null | undefined, now: number): number | null {
  return typeof timedOutUntil === 'number' && timedOutUntil > now ? timedOutUntil : null;
}

/**
 * `member_timed_out` while `userId` is timed out in `spaceId`, with `until`
 * (epoch ms, this server's clock); null otherwise. The owner is never timed
 * out (the timeout routes refuse them and ownership transfer clears it), and
 * someone without a member row (an instance admin who never joined) has no
 * timeout to be under.
 */
export function memberActionRefusal(spaceId: string, userId: string, now: number = Date.now()): ModerationRefusal | null {
  const member = getMember(spaceId, userId);
  const until = activeTimeoutUntil(member?.timedOutUntil, now);
  if (until !== null && !isSpaceOwner(spaceId, userId)) return { status: 403, code: 'member_timed_out', details: { until } };
  // A new account that still has to confirm its address reads, and does nothing else in a space
  // until it has: no message, reaction, poll vote, voice or anything else that goes through here
  // (docs/systems/email.md, "The gate"). An account made to throw away cannot post before then.
  if (accountNeedsVerifiedEmail(userId)) return { status: 403, code: 'email_verification_required' };
  if (member && mustAcceptRules(spaceId, member)) return { status: 403, code: 'rules_not_accepted' };
  return null;
}

/**
 * Whether a member still has to agree to the space's rules: they are in force, the member
 * joined after they came into force, has not agreed, and does not run the space. Those who
 * were there before were not asked to: rules that arrive later do not lock anyone out.
 */
export function mustAcceptRules(
  spaceId: string,
  member: Pick<typeof schema.spaceMembers.$inferSelect, 'userId' | 'joinedAt' | 'rulesAcceptedAt'>,
): boolean {
  if (member.rulesAcceptedAt !== null) return false;
  const since = getDb().select({ since: schema.spaces.rulesRequiredSince }).from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId)).get()?.since;
  if (since === null || since === undefined || member.joinedAt <= since) return false;
  return !hasPermission(member.userId, spaceId, PermissionBits.MANAGE_SPACE);
}

/**
 * Keep the timeout of a member who is leaving `spaceId` (on their own or
 * kicked), so joining again does not lift it. Call before the member row is
 * deleted. Ended holds of the space are dropped on the way.
 */
export function holdDepartingTimeout(spaceId: string, userId: string, now: number = Date.now()): void {
  const db = getDb();
  db.delete(schema.spaceDepartedTimeouts).where(and(
    eq(schema.spaceDepartedTimeouts.spaceId, spaceId),
    lte(schema.spaceDepartedTimeouts.timedOutUntil, now),
  )).run();
  const until = activeTimeoutUntil(getMember(spaceId, userId)?.timedOutUntil, now);
  if (until === null) return;
  db.insert(schema.spaceDepartedTimeouts).values({ spaceId, userId, timedOutUntil: until })
    .onConflictDoUpdate({
      target: [schema.spaceDepartedTimeouts.spaceId, schema.spaceDepartedTimeouts.userId],
      set: { timedOutUntil: until },
    })
    .run();
}

/**
 * Put back the timeout `userId` left `spaceId` with, onto the member row a
 * join just created, and drop the hold. Answers the restored end, or null.
 * Every join path calls this right after inserting the member row.
 */
export function restoreHeldTimeout(spaceId: string, userId: string, now: number = Date.now(), handle: DBHandle = getDb()): number | null {
  const held = handle.select().from(schema.spaceDepartedTimeouts).where(and(
    eq(schema.spaceDepartedTimeouts.spaceId, spaceId),
    eq(schema.spaceDepartedTimeouts.userId, userId),
  )).get();
  if (!held) return null;
  handle.delete(schema.spaceDepartedTimeouts).where(and(
    eq(schema.spaceDepartedTimeouts.spaceId, spaceId),
    eq(schema.spaceDepartedTimeouts.userId, userId),
  )).run();
  const until = activeTimeoutUntil(held.timedOutUntil, now);
  if (until === null) return null;
  handle.update(schema.spaceMembers).set({ timedOutUntil: until }).where(and(
    eq(schema.spaceMembers.spaceId, spaceId),
    eq(schema.spaceMembers.userId, userId),
  )).run();
  return until;
}

/**
 * Forget a timeout `userId` left `spaceId` under. A ban calls this in its
 * write: a ban drops the timeout, so one held from an earlier leave does not
 * come back if the user is unbanned and joins again.
 */
export function dropHeldTimeout(spaceId: string, userId: string, handle: DBHandle = getDb()): void {
  handle.delete(schema.spaceDepartedTimeouts).where(and(
    eq(schema.spaceDepartedTimeouts.spaceId, spaceId),
    eq(schema.spaceDepartedTimeouts.userId, userId),
  )).run();
}

// ─── Slow mode ──────────────────────────────────────────────────────────────

/** A channel's slow mode interval in seconds, 0 when off or when there is no such channel. */
function slowmodeSecondsOf(channelId: string, handle: DBHandle): number {
  const channel = handle.select({ slowmodeSeconds: schema.channels.slowmodeSeconds })
    .from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  return channel?.slowmodeSeconds ?? 0;
}

/**
 * `slowmode_active` with `retryAfterSeconds` (rounded up) while `userId` must
 * still wait in a slow mode channel; null when the channel has none, they may
 * post, or they are exempt (MANAGE_MESSAGES or MANAGE_CHANNELS there; the
 * owner and ADMINISTRATOR hold both).
 */
function slowmodeRefusal(spaceId: string, channelId: string, userId: string, now: number): ModerationRefusal | null {
  const db = getDb();
  const seconds = slowmodeSecondsOf(channelId, db);
  if (seconds <= 0) return null;
  const last = db.select({ postedAt: schema.channelSlowmodePosts.postedAt })
    .from(schema.channelSlowmodePosts)
    .where(and(eq(schema.channelSlowmodePosts.channelId, channelId), eq(schema.channelSlowmodePosts.userId, userId)))
    .get();
  if (!last) return null;
  const waitMs = last.postedAt + seconds * 1000 - now;
  if (waitMs <= 0) return null;
  if (hasPermission(userId, spaceId, PermissionBits.MANAGE_MESSAGES, channelId)
    || hasPermission(userId, spaceId, PermissionBits.MANAGE_CHANNELS, channelId)) {
    return null;
  }
  return { status: 429, code: 'slowmode_active', details: { retryAfterSeconds: Math.ceil(waitMs / 1000) } };
}

/**
 * Note a message `userId` posted in `channelId` at `now`, for slow mode. Does
 * nothing while the channel has slow mode off. Call in the write that stores
 * the message (`handle` is its transaction), so a stored message always counts.
 */
export function recordSlowmodePost(handle: DBHandle, channelId: string, userId: string, now: number): void {
  if (slowmodeSecondsOf(channelId, handle) <= 0) return;
  handle.insert(schema.channelSlowmodePosts).values({ channelId, userId, postedAt: now })
    .onConflictDoUpdate({
      target: [schema.channelSlowmodePosts.channelId, schema.channelSlowmodePosts.userId],
      set: { postedAt: now },
    })
    .run();
}

/** Forget every post time of a channel whose slow mode was switched off: nobody waits there now. */
export function clearSlowmodePosts(channelId: string): void {
  getDb().delete(schema.channelSlowmodePosts).where(eq(schema.channelSlowmodePosts.channelId, channelId)).run();
}

// ─── Message writes ─────────────────────────────────────────────────────────

/** A message about to be written in a space channel. */
export interface SpaceMessageWrite {
  spaceId: string;
  channelId: string;
  userId: string;
  /** The text as it will be stored, or null for a message with attachments only. */
  content: string | null;
  /** A new message, or an edit of one (slow mode applies to new messages only). */
  /** `post` starts a post in a forum: like `create`, in a channel that takes nothing else. */
  kind: 'create' | 'edit' | 'post';
  now?: number;
}

/**
 * Why the space refuses this message write, or null when it may be stored.
 * In order: a timeout (`member_timed_out`); an account or a membership younger
 * than the space's minimum (`account_too_new`, `membership_too_new`); slow mode
 * on a new message (`slowmode_active`, 429); then the automatic rules
 * (`automod_*`). The ages and the rules do not apply to the owner,
 * ADMINISTRATOR, or members who may manage messages (in that channel) or the
 * space. An account's age counts from its row here, which for a member homed
 * on another instance is when this instance first saw them.
 */
export function spaceMessageRefusal(write: SpaceMessageWrite): ModerationRefusal | null {
  const { spaceId, channelId, userId } = write;
  const now = write.now ?? Date.now();

  const timeout = memberActionRefusal(spaceId, userId, now);
  if (timeout) return timeout;

  // Every way of writing a message comes through here. A forum holds posts, which are threads.
  if (write.kind === 'create') {
    const channel = getDb().select({ type: schema.channels.type }).from(schema.channels).where(eq(schema.channels.id, channelId)).get();
    if (channel?.type === 'forum') return { status: 400, code: 'forum_takes_posts' };
  }

  const settings = readModerationSettings(spaceId);
  // Computed once, and only when a rule is on: most spaces have none.
  let exempt: boolean | null = null;
  const isExempt = (): boolean => {
    if (exempt === null) {
      exempt = hasPermission(userId, spaceId, PermissionBits.MANAGE_MESSAGES, channelId)
        || hasPermission(userId, spaceId, PermissionBits.MANAGE_SPACE);
    }
    return exempt;
  };

  if ((settings.minAccountAgeMinutes > 0 || settings.minMemberAgeMinutes > 0) && !isExempt()) {
    const account = getDb().select({ createdAt: schema.users.createdAt, accountKind: schema.users.accountKind }).from(schema.users)
      .where(eq(schema.users.id, userId)).get();
    // A bot was let in on purpose by someone who may manage the space; the ages hold back those who arrive by themselves.
    if (account?.accountKind !== 'bot') {
      if (settings.minAccountAgeMinutes > 0 && account && now - account.createdAt < settings.minAccountAgeMinutes * MINUTE_MS) {
        return { status: 403, code: 'account_too_new' };
      }
      if (settings.minMemberAgeMinutes > 0) {
        const member = getMember(spaceId, userId);
        if (member && now - member.joinedAt < settings.minMemberAgeMinutes * MINUTE_MS) {
          return { status: 403, code: 'membership_too_new' };
        }
      }
    }
  }

  if (write.kind !== 'edit') {
    const slow = slowmodeRefusal(spaceId, channelId, userId, now);
    if (slow) return slow;
  }

  if (hasAutomodRule(settings) && !isExempt()) return automodVerdict(write.content, settings);
  return null;
}

function isOwnInviteAddress(name: string): boolean {
  return getDb().select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.vanityCode, name)).get() !== undefined;
}

function automodVerdict(content: string | null, settings: SpaceModerationSettings): ModerationRefusal | null {
  const violation = findModerationViolation(content, settings, countMentions(content), isOwnInviteAddress);
  if (!violation) return null;
  return violation.details
    ? { status: 403, code: violation.code, details: violation.details }
    : { status: 403, code: violation.code };
}

/** The space's automatic rules alone, for a webhook's words: it has no age, no timeout and no slow mode to meet. */
export function automodRefusal(spaceId: string, content: string): ModerationRefusal | null {
  const settings = readModerationSettings(spaceId);
  return hasAutomodRule(settings) ? automodVerdict(content, settings) : null;
}
