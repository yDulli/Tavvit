import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWatchUrl } from '@backspace/shared/src/watch';
import { createFilePlayer } from './file';

// A file plays in the page's own <video>: a refused start is the browser's answer to play(), the
// person's click starts it with its sound, and it can play on the call's output device.

const source = parseWatchUrl('https://media.example/night-sky.mp4')!;

function setUp() {
  // jsdom plays nothing: what the player asks of the element is stood in for.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  const events = { onEnded: vi.fn(), onBlocked: vi.fn(), onPlaying: vi.fn() };
  const player = createFilePlayer(source, 0, events);
  return { player, events, video: player.element as HTMLVideoElement };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId');
});

describe('the player of a file', () => {
  it('says a start the browser refused, and starts from the click with its sound', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('No click yet', 'NotAllowedError'));
    const { player, events, video } = setUp();
    player.setVolume(70);
    player.play();
    await vi.waitFor(() => expect(events.onBlocked).toHaveBeenCalledTimes(1));

    play.mockResolvedValue(undefined);
    player.resume();
    expect(play).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(false);
    expect(video.volume).toBeCloseTo(0.7);
    player.destroy();
  });

  it('plays on the output device the call uses, the system\'s own for the default', () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: setSinkId, configurable: true, writable: true });
    const { player } = setUp();
    player.setOutputDevice!('headset-1');
    player.setOutputDevice!('default');
    expect(setSinkId.mock.calls).toEqual([['headset-1'], ['']]);
    player.destroy();
  });

  it('plays where the system does in a browser that lets no page choose', () => {
    const { player } = setUp();
    expect(() => player.setOutputDevice!('headset-1')).not.toThrow();
    player.destroy();
  });
});
