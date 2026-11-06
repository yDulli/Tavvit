import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';

/** The fake system: what runs, whether listing fails, and every listing asked for. */
const system = vi.hoisted(() => ({
  programs: [] as string[],
  listingFails: false,
  listings: 0,
}));

vi.mock('child_process', () => ({
  execFile: (executable: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
    const tool = path.win32.basename(executable).toLowerCase();
    if (tool === 'tasklist.exe') system.listings += 1;
    queueMicrotask(() => {
      if (system.listingFails) {
        callback(new Error('timed out'), '');
        return;
      }
      const row = (name: string, pid: number) => `"${name}","${pid}","Console","1","1 K"`;
      callback(null, [row('Tavvit.exe', process.pid), ...system.programs.map((name, i) => row(name, i + 5000))].join('\r\n'));
    });
  },
}));

import { FAILURES_BEFORE_UNKNOWN, PROCESS_POLL_MS, listProcessesNow, watchProcesses } from './processWatch';

const realPlatform = process.platform;
const stops: Array<() => void> = [];
const watch = (watcher: Parameters<typeof watchProcesses>[0]) => {
  const stop = watchProcesses(watcher);
  stops.push(stop);
  return stop;
};
/** What a watcher heard last, as a list (the app's own program is in it too). */
const lastSeen = (watcher: ReturnType<typeof vi.fn>): string[] => {
  const running = watcher.mock.calls.at(-1)?.[0] as ReadonlySet<string> | null | undefined;
  return running ? [...running] : [];
};
/** Let the listing in flight finish and its watchers hear of it. */
const settle = () => vi.waitFor(() => undefined).then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  system.programs = ['obs64.exe'];
  system.listingFails = false;
  system.listings = 0;
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

describe('the listing of running programs', () => {
  it('answers a new watcher at once, then everyone once a round', async () => {
    const first = vi.fn();
    const second = vi.fn();
    watch(first);
    await settle();
    expect(lastSeen(first)).toContain('obs64');
    watch(second);
    await settle();
    expect(lastSeen(second)).toContain('obs64');

    const before = system.listings;
    first.mockClear();
    second.mockClear();
    vi.advanceTimersByTime(PROCESS_POLL_MS);
    await settle();
    expect(system.listings).toBe(before + 1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('says once that nothing is known after failures in a row, and what runs once it works again', async () => {
    system.listingFails = true;
    const watcher = vi.fn();
    watch(watcher);
    await settle();
    for (let round = 1; round < FAILURES_BEFORE_UNKNOWN + 2; round += 1) {
      vi.advanceTimersByTime(PROCESS_POLL_MS);
      await settle();
    }
    expect(watcher.mock.calls).toEqual([[null]]);

    system.listingFails = false;
    vi.advanceTimersByTime(PROCESS_POLL_MS);
    await settle();
    expect(lastSeen(watcher)).toContain('obs64');
  });

  it('stops listing with the last watcher', async () => {
    const stop = watch(vi.fn());
    await settle();
    stop();
    const before = system.listings;
    vi.advanceTimersByTime(PROCESS_POLL_MS * 3);
    await settle();
    expect(system.listings).toBe(before);
  });

  it('tells nothing to a watcher that left while the listing ran', async () => {
    const leaving = vi.fn();
    watch(vi.fn());
    const stop = watch(leaving);
    stop();
    await settle();
    expect(leaving).not.toHaveBeenCalled();
  });

  it('lists now when asked, only while someone watches', async () => {
    listProcessesNow();
    await settle();
    expect(system.listings).toBe(0);
    watch(vi.fn());
    await settle();
    const before = system.listings;
    listProcessesNow();
    await settle();
    expect(system.listings).toBe(before + 1);
  });
});
