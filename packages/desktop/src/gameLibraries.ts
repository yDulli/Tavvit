import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { GameEntry } from './gameMatching';

/**
 * What the game launchers on this computer already know, so that a game is
 * found without being on any list: Steam says which of its games is running,
 * Epic Games and GOG say which games are installed and which program starts
 * each. All of it is read on this computer and nothing of it leaves it except
 * the name of the game being played. Windows only, like the desktop builds.
 */

/** A scan that takes longer than this is given up and tried again at the next poll. */
const SCAN_TIMEOUT_MS = 10_000;
/**
 * How a system tool runs: without a console window (a packaged GUI app would
 * otherwise flash one on every poll on Windows), with a deadline, and with room
 * for a long answer.
 */
const SCAN_OPTIONS = { maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: SCAN_TIMEOUT_MS } as const;

const STEAM_KEY = 'HKCU\\Software\\Valve\\Steam';
const GOG_GAMES_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';
/** The longest activity name the server accepts (`ACTIVITY_LIMITS` in the shared package). */
const MAX_NAME_LENGTH = 128;
/**
 * Names too common to say which game runs: a launcher left open, or any other
 * program of that name, must not read as this game.
 */
const GENERIC_EXECUTABLES = new Set([
  'launcher.exe', 'launch.exe', 'gamelauncher.exe', 'start.exe', 'game.exe', 'play.exe', 'run.exe', 'client.exe', 'setup.exe', 'app.exe', 'main.exe',
]);

export function runScan(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, SCAN_OPTIONS, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** A Windows tool by its full path: never one that happens to sit in the folder the app was started from. */
export function windowsTool(file: string): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', file);
}

function readText(file: string): Promise<string | null> {
  return fs.promises.readFile(file, 'utf-8').catch(() => null);
}

/**
 * A launcher's name for a game as others may see it. The system tools answer in
 * the console's code page, so a character that did not survive is dropped along
 * with the trademark signs, which nobody writes in a status.
 */
export function cleanGameName(raw: string): string | null {
  const name = raw.replace(/[\uFFFD\u00AE\u2122\u00A9]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
  return name === '' ? null : name;
}

export interface RegistryKey {
  path: string;
  /** By the value's name in lower case. */
  values: Map<string, string>;
}

/** The answer of `reg query`: a key's full path on its own line, its values indented below it. */
export function parseRegistryQuery(stdout: string): RegistryKey[] {
  const keys: RegistryKey[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('HKEY_')) {
      keys.push({ path: line.trim(), values: new Map() });
      continue;
    }
    const value = /^\s+(.+?)\s{4}REG_[A-Z_]+\s{4}(.*)$/.exec(line);
    const key = keys[keys.length - 1];
    if (value && key) key.values.set((value[1] ?? '').toLowerCase(), value[2] ?? '');
  }
  return keys;
}

export interface SteamRegistry {
  steamPath: string | null;
  /** What is running, the one Steam started last first. */
  running: number[];
  /** The names the registry holds, which is not every game's. */
  names: Map<number, string>;
}

/** `reg query HKCU\Software\Valve\Steam /s`: `RunningAppID`, and `Running` and `Name` per game. */
export function parseSteamRegistry(stdout: string): SteamRegistry {
  const steam: SteamRegistry = { steamPath: null, running: [], names: new Map() };
  const flagged: number[] = [];
  for (const key of parseRegistryQuery(stdout)) {
    const appId = /\\Apps\\(\d+)$/.exec(key.path)?.[1];
    if (appId) {
      const id = Number(appId);
      const name = key.values.get('name');
      if (name) steam.names.set(id, name);
      if (Number(key.values.get('running') ?? 0) > 0) flagged.push(id);
    } else if (/\\Valve\\Steam$/.test(key.path)) {
      steam.steamPath = key.values.get('steampath') ?? null;
      const active = Number(key.values.get('runningappid') ?? 0);
      if (active > 0) steam.running.push(active);
    }
  }
  steam.running = [...new Set([...steam.running, ...flagged])];
  return steam;
}

function unescapeVdf(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

/** `"name"` in a Steam `appmanifest_<id>.acf`, the name the game goes by in the person's library. */
export function parseManifestName(acf: string): string | null {
  const match = /^\s*"name"\s+"((?:[^"\\]|\\.)*)"/m.exec(acf);
  return match ? cleanGameName(unescapeVdf(match[1] ?? '')) : null;
}

/** The library folders in Steam's `libraryfolders.vdf`: games are often on another drive. */
export function parseLibraryPaths(vdf: string): string[] {
  return [...vdf.matchAll(/^\s*"path"\s+"((?:[^"\\]|\\.)*)"/gm)].map((match) => unescapeVdf(match[1] ?? ''));
}

/** Steam's names once found: a running game asks again every 15 seconds. */
const steamNames = new Map<number, string>();

async function steamAppName(appId: number, steam: SteamRegistry): Promise<string | null> {
  const known = steamNames.get(appId);
  if (known) return known;

  let name: string | null = null;
  if (steam.steamPath) {
    const libraries = await readText(path.join(steam.steamPath, 'steamapps', 'libraryfolders.vdf'));
    for (const library of new Set([steam.steamPath, ...(libraries ? parseLibraryPaths(libraries) : [])])) {
      const manifest = await readText(path.join(library, 'steamapps', `appmanifest_${appId}.acf`));
      name = manifest ? parseManifestName(manifest) : null;
      if (name) break;
    }
  }
  name ??= cleanGameName(steam.names.get(appId) ?? '');
  if (name) steamNames.set(appId, name);
  return name;
}

/** The games Steam has running, by the names they have in the library. One without a name is left out. */
export async function resolveSteamGames(steam: SteamRegistry, ignored: ReadonlySet<number>): Promise<GameEntry[]> {
  const games: GameEntry[] = [];
  for (const appId of steam.running) {
    if (ignored.has(appId)) continue;
    const name = await steamAppName(appId, steam);
    if (name) games.push({ id: `steam:${appId}`, name, processes: [], type: 'playing' });
  }
  return games;
}

/**
 * What Steam says is running. The caller asks only while Steam itself runs:
 * after a crash the registry can go on naming a game that ended long ago.
 */
export async function readRunningSteamGames(ignored: ReadonlySet<number>): Promise<GameEntry[]> {
  try {
    return await resolveSteamGames(parseSteamRegistry(await runScan(windowsTool('reg.exe'), ['query', STEAM_KEY, '/s'])), ignored);
  } catch {
    return [];
  }
}

function installedGame(id: string, rawName: string, executable: string): GameEntry | null {
  const name = cleanGameName(rawName);
  const file = executable.split(/[\\/]/).pop()?.trim().toLowerCase();
  if (!name || !file || GENERIC_EXECUTABLES.has(file)) return null;
  return { id, name, processes: [file], type: 'playing' };
}

/**
 * One of Epic's `<id>.item` manifests. The launcher keeps the same kind of file
 * for the Unreal Engine and for plugins, whose categories say they are no games.
 */
export function parseEpicManifest(text: string): GameEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { DisplayName, LaunchExecutable, AppCategories, AppName, bIsIncompleteInstall } = parsed as Record<string, unknown>;
  if (bIsIncompleteInstall === true) return null;
  if (Array.isArray(AppCategories) && !AppCategories.includes('games')) return null;
  if (typeof DisplayName !== 'string' || typeof LaunchExecutable !== 'string') return null;
  return installedGame(`epic:${typeof AppName === 'string' ? AppName : DisplayName}`, DisplayName, LaunchExecutable);
}

async function readEpicGames(): Promise<GameEntry[]> {
  const folder = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  const files = await fs.promises.readdir(folder).catch((): string[] => []);
  const manifests = await Promise.all(files.filter((file) => file.endsWith('.item')).map((file) => readText(path.join(folder, file))));
  return manifests.flatMap((manifest) => {
    const game = manifest ? parseEpicManifest(manifest) : null;
    return game ? [game] : [];
  });
}

/** `reg query HKLM\SOFTWARE\WOW6432Node\GOG.com\Games /s`: one key per game, with its name and program. */
export function parseGogRegistry(stdout: string): GameEntry[] {
  return parseRegistryQuery(stdout).flatMap((key) => {
    const id = /\\Games\\(\d+)$/.exec(key.path)?.[1];
    const name = key.values.get('gamename');
    const executable = key.values.get('exefile') ?? key.values.get('exe');
    const game = id && name && executable ? installedGame(`gog:${id}`, name, executable) : null;
    return game ? [game] : [];
  });
}

async function readGogGames(): Promise<GameEntry[]> {
  try {
    return parseGogRegistry(await runScan(windowsTool('reg.exe'), ['query', GOG_GAMES_KEY, '/s']));
  } catch {
    return [];
  }
}

/** The games installed through Epic Games and GOG; empty for a launcher that is not there. */
export async function readInstalledGames(): Promise<GameEntry[]> {
  const [epic, gog] = await Promise.all([readEpicGames(), readGogGames()]);
  return [...epic, ...gog];
}
