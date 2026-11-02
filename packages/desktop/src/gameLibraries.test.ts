import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  cleanGameName,
  parseEpicManifest,
  parseGogRegistry,
  parseLibraryPaths,
  parseManifestName,
  parseRegistryQuery,
  parseSteamRegistry,
  resolveSteamGames,
} from './gameLibraries';

/** What `reg query HKCU\Software\Valve\Steam /s` answers, as read on a real Windows with Steam. */
const STEAM_REGISTRY = [
  'HKEY_CURRENT_USER\\Software\\Valve\\Steam',
  '    SteamExe    REG_SZ    c:/program files (x86)/steam/steam.exe',
  '    SteamPath    REG_SZ    c:/program files (x86)/steam',
  '    RunningAppID    REG_DWORD    0x2da',
  '',
  'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\ActiveProcess',
  '    pid    REG_DWORD    0x1f40',
  '',
  'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps',
  '',
  'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\730',
  '    Installed    REG_DWORD    0x1',
  '    Updating    REG_DWORD    0x0',
  '    Running    REG_DWORD    0x1',
  '',
  'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\431960',
  '    Installed    REG_DWORD    0x1',
  '    Updating    REG_DWORD    0x0',
  '    Running    REG_DWORD    0x1',
  '    Name    REG_SZ    Wallpaper Engine',
  '',
  'HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\1222670',
  '    Installed    REG_DWORD    0x1',
  '    Updating    REG_DWORD    0x0',
  '    Running    REG_DWORD    0x0',
  '    Name    REG_SZ    The Sims 4',
  '',
].join('\r\n');

describe('the registry', () => {
  it('is read key by key, with value names in lower case', () => {
    const [root, process] = parseRegistryQuery(STEAM_REGISTRY);
    expect(root?.values.get('steampath')).toBe('c:/program files (x86)/steam');
    expect(process?.path).toBe('HKEY_CURRENT_USER\\Software\\Valve\\Steam\\ActiveProcess');
    expect(process?.values.get('pid')).toBe('0x1f40');
  });

  it('reads nothing from a refusal', () => {
    expect(parseRegistryQuery('FEHLER: Der angegebene Registrierungsschlüssel wurde nicht gefunden.')).toEqual([]);
  });
});

describe('what Steam says', () => {
  it('names what it started last first, then the other games flagged as running', () => {
    const steam = parseSteamRegistry(STEAM_REGISTRY);
    expect(steam.steamPath).toBe('c:/program files (x86)/steam');
    expect(steam.running).toEqual([730, 431960]);
    expect(steam.names.get(1222670)).toBe('The Sims 4');
  });

  it('runs nothing while no game runs', () => {
    const idle = STEAM_REGISTRY.replace('0x2da', '0x0').replaceAll('Running    REG_DWORD    0x1', 'Running    REG_DWORD    0x0');
    expect(parseSteamRegistry(idle).running).toEqual([]);
  });

  it('reads a manifest and its library folders, escapes included', () => {
    const manifest = '"AppState"\n{\n\t"appid"\t\t"730"\n\t"LauncherPath"\t\t"C:\\\\Steam\\\\steam.exe"\n\t"name"\t\t"Say \\"Hi\\" Again"\n\t"installdir"\t\t"x"\n}\n';
    expect(parseManifestName(manifest)).toBe('Say "Hi" Again');
    expect(parseManifestName('"AppState" { }')).toBeNull();
    const folders = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t\t"label"\t\t""\n\t}\n}\n';
    expect(parseLibraryPaths(folders)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  });

  it('gives a game its name from any library, and leaves out tools and nameless apps', async () => {
    const steamPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-steam-'));
    const otherDrive = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-steam-d-'));
    fs.mkdirSync(path.join(steamPath, 'steamapps'));
    fs.mkdirSync(path.join(otherDrive, 'steamapps'));
    fs.writeFileSync(
      path.join(steamPath, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${otherDrive.replace(/\\/g, '\\\\')}"\n\t}\n}\n`,
    );
    fs.writeFileSync(path.join(otherDrive, 'steamapps', 'appmanifest_700001.acf'), '"AppState"\n{\n\t"name"\t\t"Far Away Game\u2122"\n}\n');

    const games = await resolveSteamGames({
      steamPath,
      running: [700001, 700002, 700003, 700004],
      names: new Map([[700002, 'Only In The Registry'], [700003, 'A Tool']]),
    }, new Set([700003]));

    expect(games).toEqual([
      { id: 'steam:700001', name: 'Far Away Game', processes: [], type: 'playing' },
      { id: 'steam:700002', name: 'Only In The Registry', processes: [], type: 'playing' },
    ]);
  });
});

describe('what Epic Games has installed', () => {
  const manifest = (fields: Record<string, unknown>) => JSON.stringify({
    DisplayName: 'Fortnite',
    AppName: 'Fortnite',
    LaunchExecutable: 'FortniteGame/Binaries/Win64/FortniteClient-Win64-Shipping.exe',
    AppCategories: ['public', 'games', 'applications'],
    bIsIncompleteInstall: false,
    ...fields,
  });

  it('is a game with the file that starts it', () => {
    expect(parseEpicManifest(manifest({}))).toEqual({
      id: 'epic:Fortnite',
      name: 'Fortnite',
      processes: ['fortniteclient-win64-shipping.exe'],
      type: 'playing',
    });
  });

  it('leaves out the engine, half an install, a launcher anyone could be called, and a broken file', () => {
    expect(parseEpicManifest(manifest({ AppCategories: ['engines'] }))).toBeNull();
    expect(parseEpicManifest(manifest({ bIsIncompleteInstall: true }))).toBeNull();
    expect(parseEpicManifest(manifest({ LaunchExecutable: 'Launcher/Launcher.exe' }))).toBeNull();
    expect(parseEpicManifest(manifest({ DisplayName: 7 }))).toBeNull();
    expect(parseEpicManifest('{ not json')).toBeNull();
  });
});

describe('what GOG has installed', () => {
  it('is a game per key, with the exact file, and never a launcher by a common name', () => {
    const stdout = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games',
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924',
      '    exe    REG_SZ    C:\\GOG Games\\The Witcher 3\\bin\\x64\\witcher3.exe',
      '    gameID    REG_SZ    1207658924',
      '    gameName    REG_SZ    The Witcher\uFFFD 3: Wild Hunt',
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658925',
      '    exe    REG_SZ    C:\\GOG Games\\Other\\Launcher.exe',
      '    gameName    REG_SZ    Other',
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658926',
      '    gameName    REG_SZ    No Program',
      '',
    ].join('\r\n');
    expect(parseGogRegistry(stdout)).toEqual([
      { id: 'gog:1207658924', name: 'The Witcher 3: Wild Hunt', processes: ['witcher3.exe'], type: 'playing' },
    ]);
  });
});

describe('a launcher\'s name for a game', () => {
  it('loses trademark signs and what the console could not spell', () => {
    expect(cleanGameName('Tom Clancy\u2019s Rainbow Six\u00AE  Siege\u2122')).toBe('Tom Clancy\u2019s Rainbow Six Siege');
    expect(cleanGameName('The Witcher\uFFFD 3')).toBe('The Witcher 3');
  });

  it('is nothing when nothing readable is left, and never longer than the server takes', () => {
    expect(cleanGameName('\uFFFD\uFFFD \uFFFD')).toBeNull();
    expect(cleanGameName('x'.repeat(300))).toHaveLength(128);
  });
});
