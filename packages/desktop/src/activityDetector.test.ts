import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** What the fake system answers: the detector asks it exactly as it asks Windows. */
const system = vi.hoisted(() => ({
  programs: [] as string[],
  listingFails: false,
  steamRegistry: null as string | null,
  titles: new Map<string, string[]>(),
  commands: [] as string[],
  remote: null as { status: number; body: string } | null,
  userData: '',
}));

vi.mock('electron', () => ({ app: { getPath: () => system.userData } }));

vi.mock('child_process', () => ({
  execFile: (executable: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
    const tool = path.win32.basename(executable).toLowerCase();
    const titleFilter = args.indexOf('/fi');
    system.commands.push(titleFilter >= 0 ? `titles ${args[titleFilter + 1]}` : `${tool} ${args[1] ?? ''}`);
    queueMicrotask(() => {
      if (tool === 'reg.exe') {
        if (args[1]?.includes('Valve') && system.steamRegistry !== null) callback(null, system.steamRegistry);
        else callback(new Error('not found'), '');
      } else if (titleFilter >= 0) {
        const program = String(args[titleFilter + 1]).replace('imagename eq ', '');
        const rows = (system.titles.get(program) ?? []).map((title, i) => `"${program}","${i + 8000}","Console","1","1 K","Running","PC\\me","0:00:01","${title}"`);
        callback(null, rows.join('\r\n'));
      } else if (system.listingFails) {
        callback(new Error('timed out'), '');
      } else {
        const row = (name: string, pid: number) => `"${name}","${pid}","Console","1","1 K"`;
        callback(null, [row('Tavvit.exe', process.pid), ...system.programs.map((name, i) => row(name, i + 5000))].join('\r\n'));
      }
    });
  },
}));

vi.mock('https', () => ({
  default: {
    get: (_url: string, _options: unknown, onResponse: (res: unknown) => void) => {
      queueMicrotask(() => {
        const remote = system.remote;
        onResponse({
          statusCode: remote?.status ?? 404,
          headers: {},
          resume: () => undefined,
          on: (event: string, handler: (chunk?: Buffer) => void) => {
            if (event === 'data' && remote) handler(Buffer.from(remote.body));
            if (event === 'end') handler();
          },
        });
      });
      return { on: () => undefined, destroy: () => undefined };
    },
  },
}));

import { getCurrentActivity, setUserGames, startActivityDetection, stopActivityDetection } from './activityDetector';

const realPlatform = process.platform;
const POLL = 15_000;

interface Shown {
  type: string;
  name: string;
  timestamps?: { start?: number };
}

const shown: Array<Shown | null> = [];

/** Run polls until `check` holds. A poll still in flight only delays the next one. */
const eventually = (check: () => void) => vi.waitFor(() => {
  vi.advanceTimersByTime(POLL);
  check();
}, { timeout: 4000, interval: 5 });

const lastName = () => shown[shown.length - 1]?.name ?? null;

function steamRegistry(steamPath: string, runningAppId: number, flagged: number[] = []): string {
  return [
    'HKEY_CURRENT_USER\\Software\\Valve\\Steam',
    `    SteamPath    REG_SZ    ${steamPath}`,
    `    RunningAppID    REG_DWORD    0x${runningAppId.toString(16)}`,
    '',
    ...flagged.flatMap((id) => [`HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\${id}`, '    Running    REG_DWORD    0x1', '']),
  ].join('\r\n');
}

function steamLibrary(games: Record<number, string>): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-library-'));
  fs.mkdirSync(path.join(folder, 'steamapps'));
  for (const [id, name] of Object.entries(games)) {
    fs.writeFileSync(path.join(folder, 'steamapps', `appmanifest_${id}.acf`), `"AppState"\n{\n\t"name"\t\t"${name}"\n}\n`);
  }
  return folder;
}

beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  system.programs = [];
  system.listingFails = false;
  system.steamRegistry = null;
  system.titles = new Map();
  system.commands = [];
  system.remote = null;
  system.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-detector-'));
  shown.length = 0;
  setUserGames([]);
});

afterEach(() => {
  stopActivityDetection();
  vi.useRealTimers();
});

const start = () => startActivityDetection((activity) => { shown.push(activity); });

describe('game detection', () => {
  it('finds a game of the list by a program of this session, and sees it end', async () => {
    system.programs = ['RobloxPlayerBeta.exe'];
    start();
    await eventually(() => expect(lastName()).toBe('Roblox'));
    expect(shown[0]).toMatchObject({ type: 'playing', name: 'Roblox' });
    expect(getCurrentActivity()?.name).toBe('Roblox');

    const before = shown.length;
    vi.advanceTimersByTime(POLL * 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shown).toHaveLength(before);

    system.programs = [];
    await eventually(() => expect(shown[shown.length - 1]).toBeNull());
    expect(getCurrentActivity()).toBeNull();
  });

  it('reads nothing into a player, a launcher or an anti-cheat starter', async () => {
    system.programs = ['Spotify.exe', 'vlc.exe', 'obs64.exe', 'start_protected_game.exe', 'MinecraftLauncher.exe', 'steam.exe'];
    system.steamRegistry = steamRegistry('C:/nowhere', 0);
    start();
    await eventually(() => expect(system.commands.filter((command) => command.startsWith('tasklist')).length).toBeGreaterThan(2));
    expect(shown).toEqual([]);
  });

  describe('with Steam', () => {
    it('shows the game Steam runs, by the name in the library, on no list at all', async () => {
      const library = steamLibrary({ 900001: 'A Game Nobody Listed\u00AE' });
      system.programs = ['steam.exe', 'nobody_listed.exe'];
      system.steamRegistry = steamRegistry(library, 900001);
      start();
      await eventually(() => expect(lastName()).toBe('A Game Nobody Listed'));

      system.steamRegistry = steamRegistry(library, 0);
      await eventually(() => expect(shown[shown.length - 1]).toBeNull());
    });

    it('ignores what the registry says while Steam does not run: it may be left over from a crash', async () => {
      const library = steamLibrary({ 900002: 'Left Over' });
      system.programs = ['notepad.exe'];
      system.steamRegistry = steamRegistry(library, 900002);
      start();
      await eventually(() => expect(system.commands.filter((command) => command.startsWith('tasklist')).length).toBeGreaterThan(2));
      expect(shown).toEqual([]);
      expect(system.commands.some((command) => command.includes('Valve'))).toBe(false);
    });

    it('does not count a tool of the ignore list, but the game next to it', async () => {
      const library = steamLibrary({ 431960: 'Wallpaper Engine', 900003: 'The Real Game' });
      system.programs = ['steam.exe'];
      system.steamRegistry = steamRegistry(library, 431960);
      start();
      await eventually(() => expect(system.commands.filter((command) => command.includes('Valve')).length).toBeGreaterThan(2));
      expect(shown).toEqual([]);

      system.steamRegistry = steamRegistry(library, 431960, [900003]);
      await eventually(() => expect(lastName()).toBe('The Real Game'));
    });

    it('does not restart a game that the list knows as well', async () => {
      const library = steamLibrary({ 730: 'Counter-Strike 2' });
      system.programs = ['cs2.exe'];
      start();
      await eventually(() => expect(lastName()).toBe('Counter-Strike 2'));
      const count = shown.length;

      system.programs = ['cs2.exe', 'steam.exe'];
      system.steamRegistry = steamRegistry(library, 730);
      await eventually(() => expect(system.commands.filter((command) => command.includes('Valve')).length).toBeGreaterThan(1));
      expect(shown).toHaveLength(count);
    });
  });

  describe('Minecraft on Java', () => {
    it('is told by the window of the Java program, not by Java running', async () => {
      system.programs = ['javaw.exe'];
      system.titles.set('javaw.exe', ['Nicht zutreffend', 'Eclipse IDE']);
      start();
      await eventually(() => expect(system.commands.filter((command) => command.startsWith('titles')).length).toBeGreaterThan(1));
      expect(shown).toEqual([]);

      system.titles.set('javaw.exe', ['Minecraft* 1.21.4 - Multiplayer']);
      await eventually(() => expect(lastName()).toBe('Minecraft'));

      system.programs = [];
      await eventually(() => expect(shown[shown.length - 1]).toBeNull());
    });

    it('asks for titles only while that program runs', async () => {
      system.programs = ['notepad.exe'];
      start();
      await eventually(() => expect(system.commands.filter((command) => command.startsWith('tasklist')).length).toBeGreaterThan(2));
      expect(system.commands.filter((command) => command.startsWith('titles'))).toEqual([]);
    });
  });

  it('moves to a second game when it starts, and back with the first one\'s start time when it ends', async () => {
    system.programs = ['cs2.exe'];
    start();
    await eventually(() => expect(lastName()).toBe('Counter-Strike 2'));
    const firstStart = shown[shown.length - 1]?.timestamps?.start;

    // Lower in the list than cs2, and it still wins by having just started.
    system.programs = ['cs2.exe', 'RobloxPlayerBeta.exe'];
    await eventually(() => expect(lastName()).toBe('Roblox'));

    system.programs = ['cs2.exe'];
    await eventually(() => expect(lastName()).toBe('Counter-Strike 2'));
    expect(shown[shown.length - 1]?.timestamps?.start).toBe(firstStart);
  });

  it('keeps a game added in an earlier version until the person removes it', async () => {
    setUserGames([{ name: 'My Game', process: 'mygame.exe' }]);
    system.programs = ['mygame.exe'];
    start();
    await eventually(() => expect(lastName()).toBe('My Game'));

    setUserGames([]);
    expect(shown[shown.length - 1]).toBeNull();
    expect(getCurrentActivity()).toBeNull();
  });

  it('forgets the game after three failed listings in a row, and keeps trying', async () => {
    system.programs = ['cs2.exe'];
    start();
    await eventually(() => expect(lastName()).toBe('Counter-Strike 2'));

    system.listingFails = true;
    await eventually(() => expect(shown[shown.length - 1]).toBeNull());

    system.listingFails = false;
    await eventually(() => expect(lastName()).toBe('Counter-Strike 2'));
  });

  it('writes nothing from a scan that was running when detection stopped', async () => {
    system.programs = ['cs2.exe'];
    start();
    stopActivityDetection();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shown).toEqual([]);
    expect(getCurrentActivity()).toBeNull();
  });

  describe('its list', () => {
    const listWith = (version: number, name: string, program: string) => JSON.stringify({
      version,
      games: [{ id: name, name, processes: [program] }],
    });

    it('is the one this build brought when the saved one is older', async () => {
      fs.writeFileSync(path.join(system.userData, 'games-cache.json'), listWith(1, 'Old Saved', 'cs2.exe'));
      system.programs = ['cs2.exe'];
      start();
      await eventually(() => expect(lastName()).toBe('Counter-Strike 2'));
    });

    it('is the saved one when that is newer', async () => {
      fs.writeFileSync(path.join(system.userData, 'games-cache.json'), listWith(1000, 'New Saved', 'cs2.exe'));
      system.programs = ['cs2.exe'];
      start();
      await eventually(() => expect(lastName()).toBe('New Saved'));
    });

    it('survives a broken saved copy', async () => {
      fs.writeFileSync(path.join(system.userData, 'games-cache.json'), '{ broken');
      system.programs = ['cs2.exe'];
      start();
      await eventually(() => expect(lastName()).toBe('Counter-Strike 2'));
    });

    it('takes a newer one from the server at once, and saves it', async () => {
      system.remote = { status: 200, body: listWith(1000, 'From The Server', 'fromserver.exe') };
      system.programs = ['fromserver.exe'];
      start();
      await eventually(() => expect(lastName()).toBe('From The Server'));
      const saved = JSON.parse(fs.readFileSync(path.join(system.userData, 'games-cache.json'), 'utf-8')) as { version: number };
      expect(saved.version).toBe(1000);
    });

    it('stays with what it has when the server holds an older one or none', async () => {
      system.remote = { status: 200, body: listWith(1, 'Older', 'cs2.exe') };
      system.programs = ['cs2.exe'];
      start();
      await eventually(() => expect(lastName()).toBe('Counter-Strike 2'));
      expect(fs.existsSync(path.join(system.userData, 'games-cache.json'))).toBe(false);
    });
  });
});
