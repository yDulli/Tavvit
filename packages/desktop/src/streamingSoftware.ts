import { processKey } from './gameMatching';
import { watchProcesses } from './processWatch';

/**
 * The broadcasting programs whose start turns on the app's streamer mode, if
 * the person lets it (docs/systems/desktop.md, "Streaming programs"): OBS
 * Studio, Streamlabs Desktop (once called Streamlabs OBS) and XSplit
 * Broadcaster, by the names each system lists them under. `processKey` makes
 * them comparable with the listing (case, `.exe`, Linux's 15 characters).
 */
export const STREAMING_PROGRAMS: Readonly<Record<'win32' | 'darwin' | 'linux', readonly string[]>> = {
  win32: ['obs64.exe', 'obs32.exe', 'obs.exe', 'Streamlabs Desktop.exe', 'Streamlabs OBS.exe', 'XSplit.Core.exe', 'XSplitBroadcaster.exe'],
  darwin: ['OBS', 'Streamlabs Desktop', 'Streamlabs OBS'],
  linux: ['obs'],
};

function programsOf(platform: NodeJS.Platform): readonly string[] {
  if (platform === 'win32' || platform === 'darwin') return STREAMING_PROGRAMS[platform];
  return STREAMING_PROGRAMS.linux;
}

/** Whether one of the streaming programs is among those running. */
export function streamingProgramRunning(running: ReadonlySet<string>, platform: NodeJS.Platform = process.platform): boolean {
  return programsOf(platform).some((name) => running.has(processKey(name, platform)));
}

/**
 * Tells `onChange` whether a streaming program runs: with the first listing,
 * then each time that changes, until the returned function is called. A
 * listing that keeps failing changes nothing: streamer mode does not go off
 * because the machine was too busy to say.
 */
export function watchStreamingPrograms(onChange: (running: boolean) => void): () => void {
  let last: boolean | null = null;
  return watchProcesses((running) => {
    if (running === null) return;
    const now = streamingProgramRunning(running);
    if (now === last) return;
    last = now;
    onChange(now);
  });
}
