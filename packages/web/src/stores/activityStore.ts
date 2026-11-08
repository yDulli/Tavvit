import { create } from 'zustand';
import type { Activity } from '@backspace/shared';
import { wsSendAll } from '../hooks/useWebSocket';
import { userKey, type PresenceSubject } from '../utils/identity';
import { ACTIVITY_LIMITS } from '@backspace/shared/src/activities.js';

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** Wait after a game is detected: a change of window should not flicker the status. */
const DETECTED_PUSH_DELAY_MS = 5000;
/** Wait after the person turned sharing back on: they are watching for it. */
const SHARING_PUSH_DELAY_MS = 600;

/** An activity list delivered for one user by one origin. */
export interface ActivityEntry {
  subject: PresenceSubject;
  activities: Activity[];
}

/**
 * The activities held for `subject` as delivered or listed by `origin`.
 * Every reader goes through this, so all views of one person agree.
 */
export function activitiesFor(
  userActivities: Map<string, Activity[]>,
  subject: PresenceSubject,
  origin: string,
): Activity[] {
  return userActivities.get(userKey(subject, origin)) ?? [];
}

/** Whether `activities` hold a live stream (a `streaming` activity, such as live on Twitch). */
export function streamingIn(activities: readonly Activity[]): boolean {
  return activities.some((activity) => activity.type === 'streaming');
}

/**
 * Whether the person `subject` names, as `origin` delivered them, is streaming now, for the status
 * dot (Avatar's `streaming`). Only the dot shows it: their status, and with it what alerts them,
 * stays as they chose.
 */
export function useStreaming(subject: PresenceSubject | null | undefined, origin: string): boolean {
  return useActivityStore((s) => (subject ? streamingIn(activitiesFor(s.userActivities, subject, origin)) : false));
}

interface ActivityState {
  /** Keyed by `userKey` (the person's home identity), never by a raw row id. */
  userActivities: Map<string, Activity[]>;
  /**
   * `userKey` → the origin whose delivery set that entry last. A `ready`
   * is an origin's full snapshot, so it replaces exactly the entries that
   * origin set (`initActivities`); an entry another origin set last is that
   * origin's to change.
   */
  activityWriters: Map<string, string>;
  /**
   * origin → (row id → subject), from the members an older server's `ready`
   * listed. Such a server sends `presence_update` with its row id only; this
   * is how `presenceSubjectOf` names a row of a space that is not open
   * (`utils/presenceSubject.ts`). No entry for a server that sends the
   * identity fields itself.
   */
  originRows: Map<string, Map<string, PresenceSubject>>;
  showActivity: boolean;
  /** What this client sends: what the desktop app detected, when sharing is on. */
  myActivities: Activity[] | null;
  /** What the desktop app detected (always empty in a browser, and while game detection is off). */
  detectedActivities: Activity[];

  setUserActivities: (subject: PresenceSubject, origin: string, activities: Activity[]) => void;
  clearUserActivities: (subject: PresenceSubject, origin: string) => void;
  /**
   * Replace what `origin` set with its `ready` snapshot `entries`.
   * `coveredRows` is null for a current server, whose snapshot covers everyone
   * it reports on: every entry it set is replaced. An older server's snapshot
   * covered only the space and DM members its `ready` lists (`readyRowIndex`),
   * so only the entries of those rows are replaced; a friend it reports on
   * only live keeps what it last reported.
   */
  initActivities: (entries: ActivityEntry[], origin: string, coveredRows?: ReadonlyMap<string, PresenceSubject> | null) => void;
  /** Record (or, with null, drop) the rows an older server's `ready` listed. */
  setOriginRows: (origin: string, rows: Map<string, PresenceSubject> | null) => void;
  setShowActivity: (show: boolean) => void;
  /** The desktop app's detected activities, replacing the previous detection. */
  pushActivities: (activities: Activity[]) => void;
  reset: () => void;
}

type StoreSet = (partial: Partial<ActivityState>) => void;
type StoreGet = () => ActivityState;

/**
 * Send the composed list after `delayMs`, restarting the wait if another change
 * arrives first, so only the final state goes out. Nothing is recorded or sent
 * while sharing is off.
 */
function publish(set: StoreSet, get: StoreGet, delayMs: number): void {
  const { showActivity, detectedActivities } = get();
  if (!showActivity) return;
  const activities = detectedActivities.slice(0, ACTIVITY_LIMITS.MAX_ACTIVITIES_PER_USER);
  set({ myActivities: activities });
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    wsSendAll({ type: 'activity_update', activities });
    pushTimer = null;
  }, delayMs);
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  userActivities: new Map(),
  activityWriters: new Map(),
  originRows: new Map(),
  showActivity: true,
  myActivities: null,
  detectedActivities: [],

  setUserActivities: (subject, origin, activities) => {
    const key = userKey(subject, origin);
    set((state) => {
      const next = new Map(state.userActivities);
      const writers = new Map(state.activityWriters);
      if (activities.length === 0) {
        next.delete(key);
        writers.delete(key);
      } else {
        next.set(key, activities);
        writers.set(key, origin);
      }
      return { userActivities: next, activityWriters: writers };
    });
  },

  clearUserActivities: (subject, origin) => {
    const key = userKey(subject, origin);
    set((state) => {
      const next = new Map(state.userActivities);
      const writers = new Map(state.activityWriters);
      next.delete(key);
      writers.delete(key);
      return { userActivities: next, activityWriters: writers };
    });
  },

  initActivities: (entries, origin, coveredRows) => {
    set((state) => {
      const next = new Map(state.userActivities);
      const writers = new Map(state.activityWriters);
      const covered = coveredRows
        ? new Set([...coveredRows.values()].map((subject) => userKey(subject, origin)))
        : null;
      // What this origin reported before and its snapshot no longer lists has
      // ended while the client was not hearing from it.
      for (const [key, writer] of state.activityWriters) {
        if (writer !== origin) continue;
        if (covered && !covered.has(key)) continue;
        next.delete(key);
        writers.delete(key);
      }
      for (const { subject, activities } of entries) {
        const key = userKey(subject, origin);
        if (activities.length > 0) {
          next.set(key, activities);
          writers.set(key, origin);
        } else {
          next.delete(key);
          writers.delete(key);
        }
      }
      return { userActivities: next, activityWriters: writers };
    });
  },

  setOriginRows: (origin, rows) => {
    set((state) => {
      if (!rows && !state.originRows.has(origin)) return state;
      const originRows = new Map(state.originRows);
      if (rows) originRows.set(origin, rows);
      else originRows.delete(origin);
      return { originRows };
    });
  },

  setShowActivity: (show) => {
    set({ showActivity: show });
    if (!show) {
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      wsSendAll({ type: 'activity_update', activities: [] });
      set({ myActivities: null });
    } else {
      // What was set while sharing was off is sent now that it is on.
      publish(set, get, SHARING_PUSH_DELAY_MS);
    }
  },

  pushActivities: (activities) => {
    set({ detectedActivities: activities });
    publish(set, get, DETECTED_PUSH_DELAY_MS);
  },

  reset: () => {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    set({
      userActivities: new Map(),
      activityWriters: new Map(),
      originRows: new Map(),
      showActivity: true,
      myActivities: null,
      detectedActivities: [],
    });
  },
}));
