import { runScan, windowsTool } from './gameLibraries';
import { parseProcessList } from './gameMatching';

/**
 * The one listing of running programs the desktop app makes: every 15
 * seconds, and only while something watches (docs/systems/desktop.md,
 * "Watching running programs"). Game detection (activityDetector.ts) and the
 * streaming programs that turn on streamer mode (streamingSoftware.ts) both
 * read it, so a machine that wants both is still asked once a round.
 *
 * A listing that fails (a timeout, a busy machine) is tried again at the next
 * round. After a few failures in a row the watchers are told, once, that
 * nothing is known to run (`null`); a listing that works again tells them
 * what runs.
 */

export const PROCESS_POLL_MS = 15_000;

/** Failed listings in a row after which nothing is known to run any more. */
export const FAILURES_BEFORE_UNKNOWN = 3;

/** What runs, by `processKey`, or `null` when the listing keeps failing. */
export type ProcessWatcher = (running: ReadonlySet<string> | null) => void | Promise<void>;

const watchers = new Set<ProcessWatcher>();
let intervalId: NodeJS.Timeout | null = null;
let polling = false;
/** A listing was asked for while one ran: it runs right after. */
let askedAgain = false;
let failures = 0;

/** The system's own listing of this person's programs. */
export function processCommand(platform: NodeJS.Platform = process.platform): { executable: string; args: string[] } {
  if (platform === 'win32') return { executable: windowsTool('tasklist.exe'), args: ['/fo', 'csv', '/nh'] };
  if (platform === 'darwin') return { executable: 'ps', args: ['-c', '-A', '-o', 'comm'] };
  // Linux and other Unix
  return { executable: 'ps', args: ['-A', '-o', 'comm'] };
}

async function poll(): Promise<void> {
  if (polling) {
    askedAgain = true;
    return;
  }
  polling = true;
  try {
    const { executable, args } = processCommand();
    let running: Set<string> | null;
    try {
      running = parseProcessList(await runScan(executable, args), process.platform, process.pid);
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures === 1) {
        console.warn('[processWatch] listing processes failed:', error instanceof Error ? error.message : error, '— trying again');
      }
      if (failures !== FAILURES_BEFORE_UNKNOWN) return;
      running = null;
    }
    // Whoever stopped watching while the listing ran hears nothing of it.
    await Promise.allSettled([...watchers].map(async (watcher) => watcher(running)));
  } finally {
    polling = false;
    if (askedAgain) {
      askedAgain = false;
      pollSoon();
    }
  }
}

function pollSoon(): void {
  poll().catch((error: unknown) => {
    console.warn('[processWatch] poll failed:', error);
  });
}

/**
 * Watch the running programs. The watcher hears at once, then every round,
 * until the returned function is called. The listing stops with the last
 * watcher.
 */
export function watchProcesses(watcher: ProcessWatcher): () => void {
  watchers.add(watcher);
  if (!intervalId) {
    failures = 0;
    intervalId = setInterval(pollSoon, PROCESS_POLL_MS);
  }
  pollSoon();
  return () => {
    watchers.delete(watcher);
    if (watchers.size === 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

/** List now rather than at the next round, when anyone watches (a game was added or removed). */
export function listProcessesNow(): void {
  if (intervalId) pollSoon();
}
