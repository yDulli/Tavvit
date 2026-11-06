import { describe, expect, it, vi } from 'vitest';

/** The listing, driven by hand: the watcher streamingSoftware.ts registers. */
const listing = vi.hoisted(() => ({ watcher: null as ((running: ReadonlySet<string> | null) => void) | null, stopped: false }));
vi.mock('./processWatch', () => ({
  watchProcesses: (watcher: (running: ReadonlySet<string> | null) => void) => {
    listing.watcher = watcher;
    listing.stopped = false;
    return () => { listing.stopped = true; };
  },
}));

import { streamingProgramRunning, watchStreamingPrograms } from './streamingSoftware';
import { processKey } from './gameMatching';

const running = (platform: NodeJS.Platform, ...names: string[]) => new Set(names.map((name) => processKey(name, platform)));

describe('the streaming programs', () => {
  it('are OBS, Streamlabs and XSplit, by the names Windows lists them under', () => {
    for (const name of ['obs64.exe', 'obs32.exe', 'Streamlabs Desktop.exe', 'Streamlabs OBS.exe', 'XSplit.Core.exe']) {
      expect(streamingProgramRunning(running('win32', name), 'win32'), name).toBe(true);
    }
    expect(streamingProgramRunning(running('win32', 'notepad.exe', 'obsidian.exe'), 'win32')).toBe(false);
  });

  it('are found on macOS and Linux too', () => {
    expect(streamingProgramRunning(running('darwin', 'OBS'), 'darwin')).toBe(true);
    expect(streamingProgramRunning(running('darwin', 'Streamlabs Desktop'), 'darwin')).toBe(true);
    expect(streamingProgramRunning(running('linux', 'obs'), 'linux')).toBe(true);
    expect(streamingProgramRunning(running('linux', 'bash'), 'linux')).toBe(false);
  });
});

describe('watching for them', () => {
  it('says what it finds first, then only a change; a failing listing changes nothing', () => {
    const onChange = vi.fn();
    const stop = watchStreamingPrograms(onChange);
    const obs = running(process.platform, process.platform === 'win32' ? 'obs64.exe' : 'obs');

    listing.watcher!(new Set());
    expect(onChange.mock.calls).toEqual([[false]]);
    listing.watcher!(obs);
    listing.watcher!(obs);
    expect(onChange.mock.calls).toEqual([[false], [true]]);
    listing.watcher!(null);
    expect(onChange.mock.calls).toEqual([[false], [true]]);
    listing.watcher!(new Set());
    expect(onChange.mock.calls).toEqual([[false], [true], [false]]);

    stop();
    expect(listing.stopped).toBe(true);
  });
});
