import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  USER_GAME_LIMITS,
  loadSettings,
  normalizeUserGame,
  parseSettings,
  saveSettings,
  withoutUserGame,
} from './gameDetectionSettings';

describe('game detection settings', () => {
  it('are on until the person turns them off, and keep an explicit choice', () => {
    expect(parseSettings(undefined)).toEqual({ enabled: true, userGames: [] });
    expect(parseSettings({ enabled: 'yes' }).enabled).toBe(true);
    expect(parseSettings({ enabled: false }).enabled).toBe(false);
    expect(parseSettings({ enabled: true }).enabled).toBe(true);
  });

  it('accept a program by its process name only, never a path', () => {
    expect(normalizeUserGame({ name: '  My Game ', process: 'MyGame.EXE' })).toEqual({ name: 'My Game', process: 'mygame.exe' });
    expect(normalizeUserGame({ name: 'x', process: 'C:\\Games\\x.exe' })).toBeNull();
    expect(normalizeUserGame({ name: 'x', process: '../x' })).toBeNull();
    expect(normalizeUserGame({ name: '', process: 'x.exe' })).toBeNull();
    expect(normalizeUserGame({ name: 'x'.repeat(USER_GAME_LIMITS.MAX_NAME_LENGTH + 1), process: 'x.exe' })).toBeNull();
  });

  it('keep one entry per process, forget one on request, and drop broken ones from a file', () => {
    const games = [{ name: 'B', process: 'b.exe' }, { name: 'A', process: 'a.exe' }];
    expect(withoutUserGame(games, 'A.EXE').map((g) => g.process)).toEqual(['b.exe']);
    expect(parseSettings({ enabled: true, userGames: [{ name: 'A', process: 'a.exe' }, { name: 'A2', process: 'a.exe' }, 7, { name: 'B' }] }).userGames)
      .toEqual([{ name: 'A', process: 'a.exe' }]);
  });

  it('round-trip through userData, and read a missing or corrupt file as the defaults', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-games-'));
    expect(loadSettings(dir)).toEqual({ enabled: true, userGames: [] });
    saveSettings(dir, { enabled: false, userGames: [{ name: 'A', process: 'a.exe' }] });
    expect(loadSettings(dir)).toEqual({ enabled: false, userGames: [{ name: 'A', process: 'a.exe' }] });
    fs.writeFileSync(path.join(dir, 'game-detection.json'), '{nope');
    expect(loadSettings(dir)).toEqual({ enabled: true, userGames: [] });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
