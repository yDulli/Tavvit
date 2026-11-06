import { afterEach, describe, expect, it } from 'vitest';
import { useStreamerModeStore } from './streamerModeStore';

const STORAGE_KEY = 'tavvit-streamer-mode';
const state = () => useStreamerModeStore.getState();

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  useStreamerModeStore.setState(useStreamerModeStore.getInitialState(), true);
});

describe('streamer mode by hand', () => {
  it('is off, and allowed to turn on by itself, until chosen', () => {
    expect(state()).toMatchObject({ on: false, automatic: true, bySoftware: false, programsRunning: null });
  });

  it('goes on and off by the switch and the shortcut, and is kept on this device', () => {
    state().setOn(true);
    expect(state().on).toBe(true);
    state().toggle();
    expect(state().on).toBe(false);
    state().toggle();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state).toEqual({ on: true, automatic: true, bySoftware: false });
  });
});

describe('streamer mode and the streaming programs', () => {
  it('goes on when one starts, and off when it stops', () => {
    state().reportStreamingPrograms(false);
    expect(state().on).toBe(false);
    state().reportStreamingPrograms(true);
    expect(state()).toMatchObject({ on: true, bySoftware: true });
    state().reportStreamingPrograms(true);
    expect(state().on).toBe(true);
    state().reportStreamingPrograms(false);
    expect(state()).toMatchObject({ on: false, bySoftware: false });
  });

  it('stays off when turned off by hand while the program runs, until it starts again', () => {
    state().reportStreamingPrograms(true);
    state().setOn(false);
    state().reportStreamingPrograms(true);
    expect(state().on).toBe(false);
    state().reportStreamingPrograms(false);
    state().reportStreamingPrograms(true);
    expect(state().on).toBe(true);
  });

  it('stays on when turned on by hand, whatever the programs do', () => {
    state().setOn(true);
    state().reportStreamingPrograms(true);
    state().reportStreamingPrograms(false);
    expect(state().on).toBe(true);
  });

  it('does nothing by itself when not allowed to', () => {
    state().setAutomatic(false);
    state().reportStreamingPrograms(true);
    expect(state().on).toBe(false);
  });

  it('goes on at once when allowed while a program already runs', () => {
    state().setAutomatic(false);
    state().reportStreamingPrograms(true);
    state().setAutomatic(true);
    expect(state()).toMatchObject({ on: true, bySoftware: true });
  });

  it('is left on when no longer allowed in the middle of a stream, now as if set by hand', () => {
    state().reportStreamingPrograms(true);
    state().setAutomatic(false);
    expect(state()).toMatchObject({ on: true, bySoftware: false });
    state().reportStreamingPrograms(false);
    expect(state().on).toBe(true);
  });

  it('goes off at the first word after a restart when the program it was on for has closed meanwhile', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { on: true, automatic: true, bySoftware: true }, version: 1 }));
    await useStreamerModeStore.persist.rehydrate();
    expect(state()).toMatchObject({ on: true, bySoftware: true, programsRunning: null });
    state().reportStreamingPrograms(false);
    expect(state().on).toBe(false);
  });

  it('forgets what the desktop app said once it no longer watches', () => {
    state().reportStreamingPrograms(true);
    state().forgetStreamingPrograms();
    expect(state().programsRunning).toBeNull();
  });
});

describe('what is kept', () => {
  it('is read safely: anything odd is the mode off and allowed to turn on by itself', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { on: 'yes', automatic: 0, bySoftware: true }, version: 1 }));
    await useStreamerModeStore.persist.rehydrate();
    expect(state()).toMatchObject({ on: false, automatic: true, bySoftware: false });
  });
});
