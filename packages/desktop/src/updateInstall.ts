import fs from 'fs';
import path from 'path';

/**
 * When and how a downloaded update installs itself (docs/systems/desktop.md,
 * "Auto-Update"). The app updates without being asked: once an update is
 * downloaded it installs silently and starts again, at a moment that
 * interrupts nobody. Never during a call; at once while the window is away in
 * the tray or minimised; otherwise after a few minutes in which nobody used
 * the computer. "Restart now" in the toast, the notification or the tray
 * installs at once, the same silent way.
 *
 * Pure apart from the file helpers, so the rule can be tested without Electron.
 */

/** How long nobody may have touched the computer before a visible window restarts. */
export const IDLE_BEFORE_INSTALL_SECONDS = 5 * 60;

/** How often a ready update looks for its moment. */
export const INSTALL_CHECK_INTERVAL_MS = 30_000;

export interface InstallMoment {
  /** A voice channel or DM call is open, ringing or connecting. */
  inCall: boolean;
  /** The window is shown and not minimised. */
  windowVisible: boolean;
  /** Seconds since the last keyboard or mouse input anywhere on the computer. */
  systemIdleSeconds: number;
}

/** Whether a downloaded update may install and restart the app now. */
export function shouldInstallNow(moment: InstallMoment): boolean {
  if (moment.inCall) return false;
  if (!moment.windowVisible) return true;
  return moment.systemIdleSeconds >= IDLE_BEFORE_INSTALL_SECONDS;
}

// ─── Starting hidden after an update ────────────────────────────────────────

const RESTART_HIDDEN_FILE = 'restart-hidden.json';
/** A marker older than this is from an install that never restarted; it is ignored. */
const RESTART_HIDDEN_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Remembers that the window was in the tray when the update installed, so
 * the restarted app goes back there instead of opening in front of the
 * person who had put it away. `fromVersion` is the version installing the
 * update: only a start under another version follows that install.
 */
export function markRestartHidden(userDataDir: string, fromVersion: string, now: number = Date.now()): void {
  try {
    fs.writeFileSync(path.join(userDataDir, RESTART_HIDDEN_FILE), JSON.stringify({ at: now, fromVersion }), 'utf8');
  } catch {
    // The restarted window then simply shows; nothing else depends on it.
  }
}

/**
 * Whether this start follows an update installed while the window was
 * hidden: a recent marker written by another version. An install that never
 * happened leaves the version as it was, so the next start shows its window
 * as usual. The marker is used up either way.
 */
export function consumeRestartHidden(userDataDir: string, currentVersion: string, now: number = Date.now()): boolean {
  const file = path.join(userDataDir, RESTART_HIDDEN_FILE);
  let marker: { at?: unknown; fromVersion?: unknown } = {};
  try {
    marker = JSON.parse(fs.readFileSync(file, 'utf8')) as { at?: unknown; fromVersion?: unknown };
  } catch {
    return false;
  }
  try {
    fs.unlinkSync(file);
  } catch {
    // A marker that cannot be removed is still read once more at most, and ages out.
  }
  const { at, fromVersion } = marker;
  return typeof at === 'number' && now - at >= 0 && now - at <= RESTART_HIDDEN_MAX_AGE_MS
    && typeof fromVersion === 'string' && fromVersion !== currentVersion;
}

// ─── The updater's log ──────────────────────────────────────────────────────

/** The logger electron-updater takes: info, warn, error, debug. */
export interface UpdaterLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug(message: string): void;
}

const LOG_MAX_BYTES = 1024 * 1024;

function lineOf(level: string, message: unknown, now: Date): string {
  const text = message instanceof Error
    ? `${message.message}${message.stack ? `\n${message.stack}` : ''}`
    : typeof message === 'string' ? message : JSON.stringify(message);
  return `${now.toISOString()} [${level}] ${text}\n`;
}

/**
 * A logger that keeps what the updater did in `{userData}/logs/updater.log`,
 * so a failed update can be explained on a packaged Windows build, where
 * nothing reads the console. The file starts over past 1 MB.
 */
export function createUpdaterLogger(userDataDir: string): UpdaterLogger {
  const dir = path.join(userDataDir, 'logs');
  const file = path.join(dir, 'updater.log');
  const write = (level: string, message: unknown) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      const line = lineOf(level, message, new Date());
      if (size + line.length > LOG_MAX_BYTES) fs.writeFileSync(file, line, 'utf8');
      else fs.appendFileSync(file, line, 'utf8');
    } catch {
      // Logging must never be what breaks an update.
    }
  };
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    debug: (message) => write('debug', message),
  };
}
