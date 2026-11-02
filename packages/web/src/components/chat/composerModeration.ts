import { HttpError } from '../../api/client';
import { useWelcomeStore, welcomeKey } from '../../stores/welcomeStore';
import { useCallback, useEffect, useState } from 'react';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { useSpaceStore } from '../../stores/spaceStore';
import { useSelfIdentity } from '../../stores/authStore';
import { slowmodeKey, useSlowmodeStore } from '../../stores/slowmodeStore';
import { activeTimeoutEnd, slowmodeRemainingMs, slowmodeRetryAfterSeconds } from './composerLimits';

// What the composer of a space channel has to respect besides the channel's
// permissions: the channel's slow mode and the viewer's timeout in the space
// (docs/systems/spaces.md, "Moderation"). The instance that hosts the space
// enforces both; the composer only keeps a message from being written for a
// refusal, and says how long is left.

/** setTimeout's ceiling; a later end is waited for in steps. */
const MAX_TIMER_MS = 2_147_483_647;

export interface ComposerModeration {
  /** The channel's slow-mode interval for the viewer, in seconds: 0 when it is off, in a DM, or when they are exempt. */
  slowmodeSeconds: number;
  /** Whole seconds until the viewer may post again; 0 when they may now. */
  waitSeconds: number;
  /** The end of the viewer's timeout in the channel's space (epoch ms), or null when they are not timed out. */
  timedOutUntil: number | null;
  /** The space's rules wait for the viewer's answer: they cannot post until they agree. */
  mustAcceptRules: boolean;
  /** Puts the space's welcome, with its rules, on screen. */
  openRules: () => void;
  /** A message the channel's instance accepted: the slow-mode wait starts. */
  noteSent: () => void;
  /**
   * A send the instance refused. A `slowmode_active` refusal starts the wait
   * it names; the answer is true when the composer now counts it down, so the
   * caller need not say anything else about the refusal.
   */
  noteRefused: (error: unknown) => boolean;
}

/**
 * Slow mode and timeout state of one channel's composer. Exempt from slow
 * mode are members who may manage messages or the channel (the channel's
 * resolved permissions, administrators included). The timeout is read from
 * the viewer's own row in the open space's roster, as the instance hosting
 * the space issued it; while that roster is not loaded nothing is known, and
 * a refused send says it instead.
 */
export function useComposerModeration(channelId: string, isDm: boolean | undefined): ComposerModeration {
  const origin = useSpaceStore((s) => s.channelOriginMap.get(channelId) ?? '');
  const spaceId = useSpaceStore((s) => s.channelToSpaceMap.get(channelId));
  const channelSlowmode = useSpaceStore((s) => s.channels.find((c) => c.id === channelId)?.slowmodeSeconds ?? 0);
  const channelPerms = useSpaceStore((s) => s.channelPermissions.get(channelId));
  const myId = useSelfIdentity()?.rowIds.get(origin);
  const ownTimeout = useSpaceStore((s) => {
    if (isDm !== false || !spaceId || !myId || s.currentSpaceId !== spaceId) return null;
    const open = s.spaces.find((space) => space.id === spaceId);
    if (!open || (open._instanceOrigin ?? '') !== origin) return null;
    return s.members.find((m) => m.spaceId === spaceId && m.userId === myId)?.timedOutUntil ?? null;
  });
  const mustAcceptRules = useWelcomeStore((s) => (
    isDm === false && spaceId ? s.bySpace.get(welcomeKey(origin, spaceId))?.mustAccept === true : false
  ));
  const readyAt = useSlowmodeStore((s) => s.readyAt.get(slowmodeKey(origin, channelId)));
  // Bumped to re-render while a wait counts down and when a timeout ends.
  const [tick, setTick] = useState(0);

  const exempt = hasPermissionBit(channelPerms, PermissionBits.MANAGE_MESSAGES)
    || hasPermissionBit(channelPerms, PermissionBits.MANAGE_CHANNELS);
  const slowmodeSeconds = isDm === false && !exempt && channelSlowmode > 0 ? channelSlowmode : 0;

  const now = Date.now();
  const remainingMs = slowmodeRemainingMs(readyAt, slowmodeSeconds, now);
  const timedOutUntil = activeTimeoutEnd(ownTimeout, now);

  // Count down: wake at the next whole second of the wait.
  useEffect(() => {
    if (remainingMs <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), remainingMs % 1000 || 1000);
    return () => clearTimeout(timer);
  }, [remainingMs]);

  // Wake when the timeout ends, so the composer comes back by itself.
  useEffect(() => {
    if (ownTimeout === null) return;
    const left = ownTimeout - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(left + 50, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [ownTimeout, tick]);

  const noteSent = useCallback(() => {
    if (slowmodeSeconds > 0) useSlowmodeStore.getState().startWait(origin, channelId, slowmodeSeconds * 1000);
  }, [origin, channelId, slowmodeSeconds]);

  const openRules = useCallback(() => {
    if (spaceId) useWelcomeStore.getState().openDialog(origin, spaceId);
  }, [origin, spaceId]);

  const noteRefused = useCallback((error: unknown): boolean => {
    if (error instanceof HttpError && error.code === 'rules_not_accepted' && spaceId) {
      // The rules came into force after this page loaded them.
      void useWelcomeStore.getState().load(origin, spaceId).then(() => useWelcomeStore.getState().openDialog(origin, spaceId));
      return true;
    }
    const seconds = slowmodeRetryAfterSeconds(error);
    if (seconds === null) return false;
    useSlowmodeStore.getState().startWait(origin, channelId, seconds * 1000);
    // Without a known interval (the channel row has not caught up yet) there
    // is no countdown to show, so the refusal still has to be said.
    return slowmodeSeconds > 0;
  }, [origin, channelId, slowmodeSeconds, spaceId]);

  return {
    slowmodeSeconds,
    waitSeconds: Math.ceil(remainingMs / 1000),
    timedOutUntil,
    mustAcceptRules,
    openRules,
    noteSent,
    noteRefused,
  };
}
