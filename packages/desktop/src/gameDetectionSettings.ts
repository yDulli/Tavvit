import fs from 'fs';
import path from 'path';

/**
 * The person's own game-detection settings, kept in userData on this computer:
 * whether detection runs at all (on until they turn it off in Settings →
 * Games; what is detected reaches others only while the Privacy switch
 * "Share activity status" is on) and the programs they added themselves while
 * the app still offered that, each shown under the name they gave it, until
 * they remove it.
 *
 * Pure apart from the two file functions, so the parsing can be tested without
 * Electron.
 */

export interface UserGame {
  /** What others see: "Playing <name>". */
  name: string;
  /** The process to look for, lower-case, e.g. `mygame.exe`. */
  process: string;
}

export interface GameDetectionSettings {
  enabled: boolean;
  userGames: UserGame[];
}

export const DEFAULT_SETTINGS: GameDetectionSettings = { enabled: true, userGames: [] };

/** Limits that keep the file and the presence payload small. */
export const USER_GAME_LIMITS = { MAX_GAMES: 50, MAX_NAME_LENGTH: 64, MAX_PROCESS_LENGTH: 128 } as const;

const FILE_NAME = 'game-detection.json';

/** A clean user game, or null when the input is not one. */
export function normalizeUserGame(input: { name?: unknown; process?: unknown }): UserGame | null {
  if (typeof input.name !== 'string' || typeof input.process !== 'string') return null;
  const name = input.name.trim();
  const process = input.process.trim().toLowerCase();
  if (name === '' || name.length > USER_GAME_LIMITS.MAX_NAME_LENGTH) return null;
  if (process === '' || process.length > USER_GAME_LIMITS.MAX_PROCESS_LENGTH) return null;
  // A process name, never a path: nothing with a separator or a control character.
  if (/[\\/\u0000-\u001f]/.test(process)) return null;
  return { name, process };
}

export function parseSettings(raw: unknown): GameDetectionSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS, userGames: [] };
  const obj = raw as Record<string, unknown>;
  const userGames: UserGame[] = [];
  if (Array.isArray(obj.userGames)) {
    for (const entry of obj.userGames) {
      const game = entry && typeof entry === 'object' ? normalizeUserGame(entry as Record<string, unknown>) : null;
      if (game && !userGames.some((g) => g.process === game.process)) userGames.push(game);
      if (userGames.length === USER_GAME_LIMITS.MAX_GAMES) break;
    }
  }
  // A file that does not say keeps the default; an explicit choice stands.
  return { enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_SETTINGS.enabled, userGames };
}

export function withoutUserGame(games: readonly UserGame[], process: string): UserGame[] {
  const key = process.trim().toLowerCase();
  return games.filter((g) => g.process !== key);
}

export function loadSettings(userDataDir: string): GameDetectionSettings {
  try {
    return parseSettings(JSON.parse(fs.readFileSync(path.join(userDataDir, FILE_NAME), 'utf-8')));
  } catch {
    return { ...DEFAULT_SETTINGS, userGames: [] };
  }
}

export function saveSettings(userDataDir: string, settings: GameDetectionSettings): void {
  const file = path.join(userDataDir, FILE_NAME);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings));
  fs.renameSync(tmp, file);
}
