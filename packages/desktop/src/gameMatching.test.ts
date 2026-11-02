import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  chooseGame,
  isRunning,
  parseDictionary,
  parseProcessList,
  parseWindowTitles,
  processKey,
  windowMatches,
  type GameEntry,
} from './gameMatching';

const OWN_PID = 4242;
const row = (name: string, pid: number, session: string, sessionName = 'Console') => `"${name}","${pid}","${sessionName}","${session}","1.234 K"`;
const game = (id: string, ...processes: string[]): GameEntry => ({ id, name: id, processes });

describe('process names', () => {
  it('are the same program with or without .exe, in any case', () => {
    expect(processKey('RuneLite.exe', 'win32')).toBe('runelite');
    expect(processKey('RuneLite', 'win32')).toBe('runelite');
    expect(processKey('  CS2.EXE ', 'win32')).toBe('cs2');
  });

  it('are cut where Linux cuts them, so long names and Proton games still match', () => {
    const fromPs = 'Cyberpunk2077.e';
    expect(processKey('Cyberpunk2077.exe', 'linux')).toBe(processKey(fromPs, 'linux'));
    expect(processKey('eldenring.exe', 'linux')).toBe('eldenring');
    expect(processKey('Cyberpunk2077.exe', 'win32')).not.toBe(processKey(fromPs, 'win32'));
  });
});

describe('the process list', () => {
  it('on Windows holds only the session this app runs in', () => {
    const stdout = [
      row('System', 4, '0', 'Services'),
      row('dedicated_server.exe', 700, '0', 'Services'),
      row('Tavvit.exe', OWN_PID, '1'),
      row('Mine.exe', 900, '1'),
      row('TheirGame.exe', 901, '2', 'RDP-Tcp#3'),
    ].join('\r\n');
    expect([...parseProcessList(stdout, 'win32', OWN_PID)].sort()).toEqual(['mine', 'tavvit']);
  });

  it('on Windows leaves out services when the app cannot find its own row', () => {
    const stdout = [row('dedicated_server.exe', 700, '0', 'Services'), row('Mine.exe', 900, '1')].join('\r\n');
    expect([...parseProcessList(stdout, 'win32', OWN_PID)]).toEqual(['mine']);
  });

  it('elsewhere is one name per line under an optional header', () => {
    expect([...parseProcessList('COMM\nbash\nfactorio\n\n', 'linux', OWN_PID)]).toEqual(['bash', 'factorio']);
    expect([...parseProcessList('COMMAND\nFactorio\n', 'darwin', OWN_PID)]).toEqual(['factorio']);
  });

  it('finds a game by any spelling the list gives', () => {
    const running = parseProcessList(row('RuneLite.exe', 9, '1'), 'win32', OWN_PID);
    expect(isRunning(game('osrs', 'RuneLite'), running)).toBe(true);
    expect(isRunning(game('rs3', 'rs2client.exe'), running)).toBe(false);
  });
});

describe('window titles', () => {
  it('come from the last column of the long listing, and a refusal holds none', () => {
    // As tasklist /v writes it on a German Windows.
    const stdout = [
      '"javaw.exe","8080","Console","1","124.464 K","Running","PC\\meyer","0:00:05","Minecraft* 1.21.4 - Multiplayer"',
      '"javaw.exe","8081","Console","1","24.464 K","Running","PC\\meyer","0:00:01","Nicht zutreffend"',
    ].join('\r\n');
    expect(parseWindowTitles(stdout)).toEqual(['Minecraft* 1.21.4 - Multiplayer', 'Nicht zutreffend']);
    expect(parseWindowTitles('INFORMATION: Es werden keine Aufgaben ausgeführt.')).toEqual([]);
  });

  it('decide by how they start, whatever the case', () => {
    const window = { process: 'javaw.exe', titleStartsWith: 'Minecraft' };
    expect(windowMatches(window, ['Nicht zutreffend', 'MINECRAFT 26.1'])).toBe(true);
    expect(windowMatches(window, ['Eclipse IDE', 'My Minecraft notes'])).toBe(false);
  });
});

describe('which game to show', () => {
  const first = game('first', 'a.exe');
  const second = game('second', 'b.exe');

  it('is the first by priority when several appear together', () => {
    expect(chooseGame([first, second], null, new Set())?.id).toBe('first');
  });

  it('moves to a game that just started, even one lower in the list', () => {
    expect(chooseGame([first, second], 'first', new Set(['first']))?.id).toBe('second');
  });

  it('stays with the game showing while nothing new starts', () => {
    expect(chooseGame([first, second], 'second', new Set(['first', 'second']))?.id).toBe('second');
  });

  it('falls back to what still runs, and to nothing', () => {
    expect(chooseGame([first], 'second', new Set(['first', 'second']))?.id).toBe('first');
    expect(chooseGame([], 'second', new Set(['second']))).toBeNull();
  });
});

describe('a game list', () => {
  it('reads both formats and leaves out what is broken', () => {
    expect(parseDictionary([game('a', 'a.exe')])?.version).toBe(0);
    const list = parseDictionary({
      version: 3,
      ignoredSteamApps: [10, 'x', 2.5],
      games: [game('a', 'a.exe'), { id: 'b', name: 'B' }, 7, { id: '', name: 'C', processes: ['c.exe'] }],
    });
    expect(list?.version).toBe(3);
    expect(list?.games.map((entry) => entry.id)).toEqual(['a']);
    expect([...(list?.ignoredSteamApps ?? [])]).toEqual([10]);
  });

  it('is refused when nothing usable is in it', () => {
    expect(parseDictionary({ version: 3, games: [] })).toBeNull();
    expect(parseDictionary({ games: [game('a', 'a.exe')] })).toBeNull();
    expect(parseDictionary('list')).toBeNull();
    expect(parseDictionary(null)).toBeNull();
  });

  it('keeps a window rule only when it names a plain program and a title', () => {
    const list = parseDictionary({
      version: 1,
      games: [{
        id: 'a',
        name: 'A',
        processes: ['a.exe'],
        windows: [
          { process: 'javaw.exe', titleStartsWith: 'A' },
          { process: 'x" /fi "y', titleStartsWith: 'A' },
          { process: '..\\javaw.exe', titleStartsWith: 'A' },
          { process: 'javaw.exe', titleStartsWith: ' ' },
          { process: 'javaw.exe' },
        ],
      }],
    });
    expect(list?.games[0]?.windows).toEqual([{ process: 'javaw.exe', titleStartsWith: 'A' }]);
  });
});

describe('the bundled game list', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'games.json'), 'utf-8')) as { games: GameEntry[] };
  const list = parseDictionary(raw);

  it('loads whole, under a version newer than the first one', () => {
    expect(list?.games).toHaveLength(raw.games.length);
    expect(list?.version).toBeGreaterThanOrEqual(2);
  });

  it('holds only games: a player in the tray is not someone playing', () => {
    expect(raw.games.filter((entry) => entry.type && entry.type !== 'playing')).toEqual([]);
    expect(raw.games.map((entry) => entry.id)).not.toEqual(expect.arrayContaining(['spotify']));
  });

  it('claims no name twice, which would make one of the two games impossible', () => {
    const owners = new Map<string, string>();
    for (const entry of raw.games) {
      for (const name of entry.processes) {
        const key = processKey(name, 'win32');
        const owner = owners.get(key);
        if (owner && owner !== entry.id) expect.fail(`${name} is in both ${owner} and ${entry.id}`);
        owners.set(key, entry.id);
      }
    }
  });

  it('claims no program that runs for many games or for none', () => {
    const shared = [
      'start_protected_game', 'easyanticheat', 'easyanticheat_launcher', 'beservice', 'unitycrashhandler64', 'crashreportclient',
      'client-win64-shipping', 'shootergame', 'launcher', 'game', 'java', 'javaw', 'steam', 'steamwebhelper', 'epicgameslauncher',
      'battle.net', 'origin', 'eadesktop', 'upc', 'minecraft', 'minecraft-launcher', 'minecraftlauncher', 'discovery', 'ds', 'acs',
    ];
    const claimed = new Set(raw.games.flatMap((entry) => entry.processes.map((name) => processKey(name, 'win32'))));
    expect(shared.filter((name) => claimed.has(name))).toEqual([]);
  });

  it('spells every game the way Windows does, which older apps compare exactly', () => {
    expect(raw.games.filter((entry) => !entry.processes.some((name) => name.toLowerCase().endsWith('.exe'))).map((entry) => entry.id)).toEqual([]);
  });

  it('knows the games people asked about', () => {
    const named = (id: string) => list?.games.find((entry) => entry.id === id);
    expect(named('roblox')?.processes).toContain('RobloxPlayerBeta.exe');
    expect(named('minecraft')?.windows).toContainEqual({ process: 'javaw.exe', titleStartsWith: 'Minecraft' });
    expect([...(list?.ignoredSteamApps ?? [])]).toContain(431960);
  });
});
