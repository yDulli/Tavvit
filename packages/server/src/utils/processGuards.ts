/**
 * What the process does when a promise nobody awaits is rejected (docs/systems/operations.md,
 * "When something fails"). Node ends the process for it, and with the process every call, every
 * watch session and every connection of the instance, which live in its memory. A background
 * task that failed has failed as a request that failed: it is written down and the instance goes
 * on. An exception thrown outside any promise still ends the process, since nothing says what
 * state it left; the container starts it again and the operator is told of the restart.
 */

interface ErrorLog {
  error: (details: Record<string, unknown>, message: string) => void;
}

let rejections = 0;
let installed: ((reason: unknown) => void) | null = null;

/** How many such failures this process has written down since it started. */
export function unhandledRejectionCount(): number {
  return rejections;
}

/** Writes one down. Its own failure (a log that throws) must not become the next one. */
export function reportUnhandledRejection(reason: unknown, log: ErrorLog): void {
  rejections += 1;
  try {
    log.error({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'A background task failed: a promise nobody awaited was rejected');
  } catch {
    // Nothing to write to.
  }
}

/** Once per process. A second call replaces the first listener rather than adding one. */
export function installProcessGuards(log: ErrorLog): void {
  if (installed) process.off('unhandledRejection', installed);
  installed = (reason: unknown) => reportUnhandledRejection(reason, log);
  process.on('unhandledRejection', installed);
}

/** Tests only. */
export function _resetProcessGuards(): void {
  if (installed) process.off('unhandledRejection', installed);
  installed = null;
  rejections = 0;
}
