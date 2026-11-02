import https from 'https';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { PRODUCTION_URL } from './appUrl';
import type { UserGame } from './gameDetectionSettings';
import { readInstalledGames, readRunningSteamGames, runScan, windowsTool } from './gameLibraries';
import {
  chooseGame,
  isRunning,
  parseDictionary,
  parseProcessList,
  parseWindowTitles,
  processKey,
  windowMatches,
  type GameDictionary,
  type GameEntry,
} from './gameMatching';

// ─── Local Activity type (structural match with @backspace/shared Activity) ─

interface ActivityTimestamps {
  start?: number;
  end?: number;
}

interface Activity {
  type: string;
  name: string;
  details?: string;
  state?: string;
  timestamps?: ActivityTimestamps;
}

const POLL_INTERVAL_MS = 15_000;
/** After this many failed listings in a row, nothing is known to be running any more. */
const FAILURES_BEFORE_CLEAR = 3;
/** How often the games installed through Epic and GOG are read again, so a new one is found without a restart. */
const INSTALLED_REFRESH_MS = 10 * 60_000;
const STEAM_PROCESS = processKey('steam.exe', 'win32');
/**
 * Newer game lists come from the server the app opens, never a third party:
 * every desktop release publishes its list beside the installers
 * (docs/systems/desktop.md, "Releases"). Without one the bundled list stands.
 */
const REMOTE_URL = `${PRODUCTION_URL}/downloads/desktop/games.json`;

// ─── Module state ───────────────────────────────────────────────────────────

let gameEntries: GameEntry[] = [];
let ignoredSteamApps: ReadonlySet<number> = new Set();
let dictionaryVersion = 0;
let hasSavedDictionary = false;
/** Programs the person added themselves; they win over everything else. */
let userEntries: GameEntry[] = [];
let installedEntries: GameEntry[] = [];
let installedReadAt = 0;
let currentGameId: string | null = null;
let currentActivity: Activity | null = null;
/** Everything found running at the last poll, and since when. */
const runningSince = new Map<string, number>();
let intervalId: NodeJS.Timeout | null = null;
let isPolling = false;
let consecutiveFailures = 0;
/**
 * Moves on every start and stop, so a scan that was still running when
 * detection stopped (or restarted) writes nothing: its answer is about a
 * session that is over.
 */
let generation = 0;
let onChangeCallback: ((activity: Activity | null) => void) | null = null;

// ─── Dictionary loading ────────────────────────────────────────────────────

function getCachePath(): string {
  return path.join(app.getPath('userData'), 'games-cache.json');
}

function getSeedPath(): string {
  return path.join(__dirname, '..', 'resources', 'games.json');
}

function getETagPath(): string {
  return path.join(app.getPath('userData'), 'games-cache-etag.txt');
}

function readETag(): string | null {
  try {
    return fs.readFileSync(getETagPath(), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function writeETag(etag: string): void {
  try {
    fs.writeFileSync(getETagPath(), etag, 'utf-8');
  } catch {
    // Non-critical — next sync will just re-download
  }
}

function readDictionary(filePath: string): GameDictionary | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const dictionary = parseDictionary(JSON.parse(raw));
    if (!dictionary) console.warn('[ActivityDetector] No usable game list at', filePath);
    return dictionary;
  } catch {
    console.warn('[ActivityDetector] Game list contains malformed JSON at', filePath);
    return null;
  }
}

/**
 * Replaces the list without resetting detection state, so a game being shown
 * stays shown when a newer list arrives in the background.
 */
function applyDictionary(dictionary: GameDictionary): void {
  gameEntries = dictionary.games;
  ignoredSteamApps = dictionary.ignoredSteamApps;
  dictionaryVersion = dictionary.version;
  console.log(`[ActivityDetector] Using ${dictionary.games.length} games, list v${dictionary.version}`);
}

/**
 * The newer of the list the last sync saved and the one this build brought: a
 * list saved by an older version of the app must not outlive a better one that
 * an update brought along.
 */
function loadLocalDictionary(): void {
  const saved = readDictionary(getCachePath());
  const bundled = readDictionary(getSeedPath());
  hasSavedDictionary = saved !== null;
  const best = saved && bundled ? (saved.version > bundled.version ? saved : bundled) : saved ?? bundled;
  if (best) {
    applyDictionary(best);
  } else {
    // Steam, the other launchers and the programs the person added work without a list.
    console.warn('[ActivityDetector] No valid game list found');
    gameEntries = [];
    ignoredSteamApps = new Set();
    dictionaryVersion = 0;
  }
}

// ─── Remote sync ────────────────────────────────────────────────────────────

/**
 * Fetch a URL over HTTPS and return the response body and headers.
 * Supports conditional requests via If-None-Match.
 */
function fetchRemote(url: string, etag: string | null): Promise<{
  status: number;
  body: string;
  etag: string | null;
} | null> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {
      'User-Agent': 'Tavvit-Desktop/1.0',
    };
    if (etag) {
      headers['If-None-Match'] = etag;
    }

    const req = https.get(url, { headers, timeout: 10_000 }, (res) => {
      if (res.statusCode === 304) {
        resolve({ status: 304, body: '', etag: null });
        res.resume(); // Drain the response
        return;
      }

      // Follow a redirect, which a proxy in front of the server may send
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        res.resume();
        fetchRemote(res.headers.location, etag).then(resolve).catch(() => resolve(null));
        return;
      }

      if (res.statusCode !== 200) {
        resolve(null);
        res.resume();
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        const responseEtag = typeof res.headers.etag === 'string' ? res.headers.etag : null;
        resolve({ status: 200, body, etag: responseEtag });
      });
      res.on('error', () => resolve(null));
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Atomically write data to a file by writing to a .tmp file first,
 * then renaming it into place.
 */
function atomicWrite(filePath: string, data: string): void {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, data, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Sync the game list from the app's own server, in the background, after the
 * best local list is already in use. A newer one is saved and takes over at once.
 */
async function syncDictionary(): Promise<void> {
  // The tag belongs to the saved copy: without that copy, "unchanged" would keep the older bundled list.
  const response = await fetchRemote(REMOTE_URL, hasSavedDictionary ? readETag() : null);

  if (!response) {
    console.log('[ActivityDetector] Remote sync failed or no list published — continuing with local list');
    return;
  }
  if (response.status === 304) {
    console.log('[ActivityDetector] Remote list unchanged (304)');
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    console.warn('[ActivityDetector] Remote list contains malformed JSON — skipping');
    return;
  }
  const remote = parseDictionary(parsed);
  if (!remote) {
    console.warn('[ActivityDetector] Remote list validation failed — skipping');
    return;
  }

  // Saved either way, so the next start gets a 304.
  if (response.etag) writeETag(response.etag);

  if (remote.version <= dictionaryVersion) {
    console.log(`[ActivityDetector] Remote list v${remote.version} is not newer than local v${dictionaryVersion} — skipping`);
    return;
  }

  try {
    atomicWrite(getCachePath(), response.body);
    hasSavedDictionary = true;
  } catch (err) {
    // Non-fatal — it is still used until the app quits
    console.warn('[ActivityDetector] Failed to write cache:', err);
  }
  applyDictionary(remote);
}

// ─── Platform-specific process listing ──────────────────────────────────────

function getProcessCommand(): { executable: string; args: string[] } {
  if (process.platform === 'win32') {
    return { executable: windowsTool('tasklist.exe'), args: ['/fo', 'csv', '/nh'] };
  }
  if (process.platform === 'darwin') {
    return { executable: 'ps', args: ['-c', '-A', '-o', 'comm'] };
  }
  // Linux and other Unix
  return { executable: 'ps', args: ['-A', '-o', 'comm'] };
}

/**
 * The games of the list that run inside a program plenty of other things use,
 * told by the title of its window. Asked only while that program runs, and only
 * about it: the listing with titles is far slower than the plain one. The title
 * decides here and goes no further.
 */
async function gamesByWindowTitle(running: ReadonlySet<string>): Promise<Set<string>> {
  const found = new Set<string>();
  if (process.platform !== 'win32') return found;
  const titlesOf = new Map<string, string[]>();
  for (const entry of gameEntries) {
    for (const window of entry.windows ?? []) {
      const program = processKey(window.process);
      if (!running.has(program)) continue;
      let titles = titlesOf.get(program);
      if (!titles) {
        titles = await runScan(windowsTool('tasklist.exe'), ['/v', '/fi', `imagename eq ${window.process}`, '/fo', 'csv', '/nh'])
          .then(parseWindowTitles, (): string[] => []);
        titlesOf.set(program, titles);
      }
      if (windowMatches(window, titles)) found.add(entry.id);
    }
  }
  return found;
}

async function refreshInstalledGames(): Promise<void> {
  if (process.platform !== 'win32' || Date.now() - installedReadAt < INSTALLED_REFRESH_MS) return;
  installedReadAt = Date.now();
  installedEntries = await readInstalledGames();
}

/**
 * Everything that is being played, in order of priority: what the person added,
 * then what Steam says, then what the launchers have installed, then the list.
 * A launcher knows its own games by their exact names, the list only by a
 * process name that some other program might share.
 */
async function findRunningGames(running: ReadonlySet<string>): Promise<GameEntry[]> {
  const steam = process.platform === 'win32' && running.has(STEAM_PROCESS)
    ? await readRunningSteamGames(ignoredSteamApps)
    : [];
  const titled = await gamesByWindowTitle(running);
  await refreshInstalledGames();
  return [
    ...userEntries.filter((entry) => isRunning(entry, running)),
    ...steam,
    ...installedEntries.filter((entry) => isRunning(entry, running)),
    ...gameEntries.filter((entry) => isRunning(entry, running) || titled.has(entry.id)),
  ];
}

// ─── Poll logic ─────────────────────────────────────────────────────────────

function clearCurrentGame(): void {
  currentGameId = null;
  runningSince.clear();
  if (currentActivity) {
    currentActivity = null;
    onChangeCallback?.(null);
  }
}

/** Show the game that won. The same name from another source is the same game: no change, same start time. */
function showGame(running: readonly GameEntry[]): void {
  const seenBefore = new Set(runningSince.keys());
  const now = Date.now();
  const stillRunning = new Set(running.map((entry) => entry.id));
  for (const id of seenBefore) {
    if (!stillRunning.has(id)) runningSince.delete(id);
  }
  for (const id of stillRunning) {
    if (!runningSince.has(id)) runningSince.set(id, now);
  }

  const game = chooseGame(running, currentGameId, seenBefore);
  if (!game) {
    clearCurrentGame();
    return;
  }

  currentGameId = game.id;
  const type = game.type ?? 'playing';
  if (currentActivity?.name === game.name && currentActivity.type === type) return;
  currentActivity = { type, name: game.name, timestamps: { start: runningSince.get(game.id) ?? now } };
  onChangeCallback?.(currentActivity);
}

async function poll(): Promise<void> {
  if (isPolling) return; // Previous poll still in-flight
  isPolling = true;
  const scanGeneration = generation;

  try {
    const { executable, args } = getProcessCommand();
    let stdout: string;
    try {
      stdout = await runScan(executable, args);
    } catch (error) {
      if (scanGeneration !== generation) return;
      // A failed listing (a timeout, a busy machine) is tried again at the next
      // poll; detection never stops on its own. After a few failures in a row
      // the last game is no longer known to be running, so it is not shown.
      consecutiveFailures += 1;
      if (consecutiveFailures === 1) {
        console.warn('[ActivityDetector] listing processes failed:', error instanceof Error ? error.message : error, '— trying again');
      }
      if (consecutiveFailures === FAILURES_BEFORE_CLEAR) clearCurrentGame();
      return;
    }
    if (scanGeneration !== generation) return;
    consecutiveFailures = 0;

    const running = await findRunningGames(parseProcessList(stdout, process.platform, process.pid));
    if (scanGeneration !== generation) return;
    showGame(running);
  } finally {
    isPolling = false;
  }
}

function pollInBackground(): void {
  poll().catch((err: unknown) => {
    console.warn('[ActivityDetector] Poll failed:', err);
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function startActivityDetection(
  onActivityChange: (activity: Activity | null) => void,
): void {
  if (intervalId) return; // Already running

  loadLocalDictionary();

  onChangeCallback = onActivityChange;
  consecutiveFailures = 0;
  installedReadAt = 0;
  generation += 1;

  // Run first poll immediately
  pollInBackground();

  // Then poll every 15 seconds
  intervalId = setInterval(pollInBackground, POLL_INTERVAL_MS);

  // Fire-and-forget: sync from remote in background
  syncDictionary().catch((err) => {
    console.warn('[ActivityDetector] Sync failed:', err);
  });
}

export function stopActivityDetection(): void {
  generation += 1;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  onChangeCallback = null;
  // Nothing is being watched any more, so nothing is being played as far as anyone knows.
  currentGameId = null;
  currentActivity = null;
  runningSince.clear();
}

export function getCurrentActivity(): Activity | null {
  return currentActivity;
}

/**
 * Replace the programs the person added in an earlier version, which still count
 * until they remove them. A game that is no longer listed is forgotten at once,
 * and the next poll runs now rather than in 15 seconds, so what else is running
 * shows straight away.
 */
export function setUserGames(games: readonly UserGame[]): void {
  userEntries = games.map((game) => ({ id: `user:${game.process}`, name: game.name, processes: [game.process], type: 'playing' }));
  if (currentGameId?.startsWith('user:') && !userEntries.some((entry) => entry.id === currentGameId)) {
    clearCurrentGame();
  }
  if (intervalId) pollInBackground();
}
