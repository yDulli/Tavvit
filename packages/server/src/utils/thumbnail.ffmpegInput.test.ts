import { describe, expect, it, vi } from 'vitest';

// Every ffmpeg and ffprobe run on an upload is recorded here instead of run.
const runs = vi.hoisted(() => [] as Array<{ program: string; args: string[] }>);

vi.mock('child_process', () => ({
  execFile: (program: string, args: string[], _options: unknown, callback: (err: Error | null, out: { stdout: string; stderr: string }) => void) => {
    runs.push({ program, args });
    callback(null, { stdout: '{"streams":[],"format":{}}', stderr: '' });
  },
}));

const { FFMPEG_INPUT_LIMITS, generateVideoThumbnail, probeMediaMeta } = await import('./thumbnail.js');

describe('ffmpeg and ffprobe on an uploaded file', () => {
  it('open nothing but the file, and only as a container people send', async () => {
    await probeMediaMeta('/tmp/clip.mp4', 'video/mp4');
    await generateVideoThumbnail('/tmp/clip.mp4', '/tmp');

    const onFiles = runs.filter((run) => run.args.includes('-i'));
    expect(onFiles.length).toBeGreaterThanOrEqual(3);
    for (const { args } of onFiles) {
      const input = args.indexOf('-i');
      const limits = args.indexOf('-protocol_whitelist');
      expect(limits).toBeGreaterThanOrEqual(0);
      expect(limits).toBeLessThan(input);
      expect(args.slice(limits, limits + FFMPEG_INPUT_LIMITS.length)).toEqual(FFMPEG_INPUT_LIMITS);
    }
    expect(FFMPEG_INPUT_LIMITS[1]).toBe('file');
    expect(FFMPEG_INPUT_LIMITS[3]).not.toMatch(/hls|concat|image2|http/);
  });
});
