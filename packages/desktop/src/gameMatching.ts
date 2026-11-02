/**
 * What game detection decides once it knows what is running: how to read the
 * system's answer and the game list, and which game that makes. Pure, so all
 * of it can be tested without Electron or a real process list.
 */

export interface GameWindow {
  /** The program the game runs inside, which plenty of other things use too (`javaw.exe`). */
  process: string;
  /** Only a window of that program whose title starts like this is the game. */
  titleStartsWith: string;
}

export interface GameEntry {
  id: string;
  name: string;
  processes: string[];
  windows?: GameWindow[];
  type?: string;
}

export interface GameDictionary {
  version: number;
  games: GameEntry[];
  /** Steam apps that are tools, not games: running one says nothing about playing. */
  ignoredSteamApps: ReadonlySet<number>;
}

const VALID_TYPES = new Set(['playing', 'listening', 'watching', 'streaming']);
/** How much of a process name Linux keeps (`comm`); `ps` prints no more. */
const LINUX_NAME_LENGTH = 15;
/** A program's file name: all a list entry may name when Windows is asked about its windows. */
const FILE_NAME = /^[\w .!+-]+$/;

function parseGameWindows(raw: unknown): GameWindow[] {
  if (!Array.isArray(raw)) return [];
  const windows: GameWindow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { process: program, titleStartsWith } = item as Record<string, unknown>;
    if (typeof program !== 'string' || !FILE_NAME.test(program)) continue;
    if (typeof titleStartsWith !== 'string' || titleStartsWith.trim() === '') continue;
    windows.push({ process: program, titleStartsWith });
  }
  return windows;
}

/** A valid entry of the game list, or null when the entry is malformed. */
function parseGameEntry(entry: unknown): GameEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;

  if (typeof e.id !== 'string' || !e.id || typeof e.name !== 'string' || !e.name ||
      !Array.isArray(e.processes) || e.processes.length === 0 ||
      !e.processes.every((p: unknown) => typeof p === 'string')) {
    return null;
  }

  const type = typeof e.type === 'string' && VALID_TYPES.has(e.type) ? e.type : 'playing';
  const windows = parseGameWindows(e.windows);

  return {
    id: e.id,
    name: e.name,
    processes: e.processes as string[],
    ...(windows.length > 0 ? { windows } : {}),
    type,
  };
}

/**
 * A parsed game list: `{ version, games, ignoredSteamApps? }`, or the bare array
 * of the old format, which counts as version 0. Broken entries are left out;
 * null when nothing usable is left.
 */
export function parseDictionary(parsed: unknown): GameDictionary | null {
  let version = 0;
  let rawGames: unknown[];
  let rawIgnored: unknown;

  if (Array.isArray(parsed)) {
    rawGames = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.version !== 'number' || !Array.isArray(obj.games)) return null;
    version = obj.version;
    rawGames = obj.games;
    rawIgnored = obj.ignoredSteamApps;
  } else {
    return null;
  }

  const games: GameEntry[] = [];
  for (const entry of rawGames) {
    const game = parseGameEntry(entry);
    if (game) games.push(game);
  }
  if (games.length === 0) return null;

  const ignored = Array.isArray(rawIgnored) ? rawIgnored.filter((id): id is number => Number.isInteger(id)) : [];
  return { version, games, ignoredSteamApps: new Set(ignored) };
}

/**
 * The form in which process names are compared. A list entry need not spell a
 * program the way the system does: `Game.exe` and `game` are the same one, and
 * Linux keeps only the first 15 characters of a name, `.exe` included when
 * Proton runs it, so both sides are cut alike.
 */
export function processKey(name: string, platform: NodeJS.Platform = process.platform): string {
  const lower = name.trim().toLowerCase();
  const kept = platform === 'linux' ? lower.slice(0, LINUX_NAME_LENGTH) : lower;
  return kept.endsWith('.exe') ? kept.slice(0, -'.exe'.length) : kept;
}

function csvColumns(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
}

/**
 * `tasklist /fo csv /nh`: "ImageName","PID","SessionName","Session#","MemUsage".
 * Only this person's session counts: services and whatever another account on
 * this computer has running are not what they are playing. The session is told
 * by this app's own row, since session names are not the same on every system.
 */
function parseTasklist(stdout: string, ownPid: number): Set<string> {
  const rows = stdout.split(/\r?\n/).map(csvColumns).filter((columns) => columns.length >= 4);
  const ownSession = rows.find((columns) => columns[1] === String(ownPid))?.[3];
  const names = new Set<string>();
  for (const [name, , , session] of rows) {
    if (!name) continue;
    if (ownSession === undefined ? session !== '0' : session === ownSession) names.add(processKey(name, 'win32'));
  }
  return names;
}

/** `ps`: one process name per line, the first may be a header. */
function parsePsList(stdout: string, platform: NodeJS.Platform): Set<string> {
  const names = new Set<string>();
  stdout.split(/\r?\n/).forEach((line, index) => {
    const name = line.trim();
    if (!name || (index === 0 && (name === 'COMM' || name === 'COMMAND'))) return;
    names.add(processKey(name, platform));
  });
  return names;
}

/** The running programs in the form `processKey` gives them. */
export function parseProcessList(stdout: string, platform: NodeJS.Platform, ownPid: number): Set<string> {
  return platform === 'win32' ? parseTasklist(stdout, ownPid) : parsePsList(stdout, platform);
}

/** `tasklist /v /fo csv /nh`, whose last of nine columns is the window's title. */
export function parseWindowTitles(stdout: string): string[] {
  return stdout.split(/\r?\n/).map(csvColumns).filter((columns) => columns.length >= 9).map((columns) => columns[columns.length - 1] ?? '');
}

export function windowMatches(window: GameWindow, titles: readonly string[]): boolean {
  const wanted = window.titleStartsWith.toLowerCase();
  return titles.some((title) => title.toLowerCase().startsWith(wanted));
}

export function isRunning(entry: GameEntry, running: ReadonlySet<string>): boolean {
  return entry.processes.some((name) => running.has(processKey(name)));
}

/**
 * The game to show among those running, which come in order of priority. A game
 * that just started wins, since that is what the person turned to; while nothing
 * new starts, the one showing stays, so the status does not jump; when it ends,
 * the one with the highest priority takes over.
 */
export function chooseGame(
  running: readonly GameEntry[],
  currentId: string | null,
  seenBefore: ReadonlySet<string>,
): GameEntry | null {
  return running.find((entry) => !seenBefore.has(entry.id))
    ?? running.find((entry) => entry.id === currentId)
    ?? running[0]
    ?? null;
}
