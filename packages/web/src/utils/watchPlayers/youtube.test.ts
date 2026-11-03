import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWatchUrl } from '@backspace/shared/src/watch';
import { createYouTubePlayer } from './youtube';

// YouTube's player is steered over postMessage only: commands go to its own origin, and only its
// own frame's messages are heard.

const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com';
const source = parseWatchUrl('https://youtu.be/dQw4w9WgXcQ')!;

function setUp() {
  const events = { onEnded: vi.fn(), onBlocked: vi.fn(), onPlaying: vi.fn() };
  const player = createYouTubePlayer(source, 90_000, events);
  document.body.appendChild(player.element);
  const iframe = player.element as HTMLIFrameElement;
  const posted: Array<{ message: Record<string, unknown>; origin: string }> = [];
  vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(((message: string, origin: string) => {
    posted.push({ message: JSON.parse(message) as Record<string, unknown>, origin });
  }) as Window['postMessage']);
  const fromPlayer = (data: unknown, origin = PLAYER_ORIGIN, from: MessageEventSource | null = iframe.contentWindow) => {
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), origin, source: from }));
  };
  return { player, iframe, posted, events, fromPlayer };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the YouTube player', () => {
  it('loads the video on the privacy-enhanced host, where its link starts, without its controls', () => {
    const { iframe, player } = setUp();
    const address = new URL(iframe.src);
    expect(address.origin).toBe(PLAYER_ORIGIN);
    expect(address.pathname).toBe('/embed/dQw4w9WgXcQ');
    expect(address.searchParams.get('enablejsapi')).toBe('1');
    expect(address.searchParams.get('controls')).toBe('0');
    expect(address.searchParams.get('start')).toBe('90');
    player.destroy();
  });

  it('asks to be told, steers only once ready, and posts only to its own origin', () => {
    const { player, posted, fromPlayer } = setUp();
    player.play();
    vi.advanceTimersByTime(300);
    expect(posted.some((entry) => entry.message.event === 'listening')).toBe(true);
    expect(posted.some((entry) => entry.message.event === 'command')).toBe(false);

    fromPlayer({ event: 'onReady' });
    expect(posted.some((entry) => entry.message.func === 'playVideo')).toBe(true);
    expect(posted.every((entry) => entry.origin === PLAYER_ORIGIN)).toBe(true);
    player.destroy();
  });

  it('hears only its own frame', () => {
    const { player, posted, events, fromPlayer } = setUp();
    fromPlayer({ event: 'onReady' }, 'https://evil.example');
    fromPlayer({ event: 'onReady' }, PLAYER_ORIGIN, window);
    fromPlayer({ event: 'onStateChange', info: 0 }, 'https://evil.example');
    expect(player.currentMs()).toBeNull();
    expect(events.onEnded).not.toHaveBeenCalled();
    player.play();
    expect(posted.some((entry) => entry.message.event === 'command')).toBe(false);
    player.destroy();
  });

  it('reports where it stands, its length, its end, and a start the browser refused', () => {
    const { player, events, fromPlayer } = setUp();
    fromPlayer({ event: 'onReady' });
    fromPlayer({ event: 'infoDelivery', info: { currentTime: 12.5, duration: 212, playerState: 2 } });
    expect(player.currentMs()).toBe(12_500);
    expect(player.durationMs()).toBe(212_000);

    player.play();
    vi.advanceTimersByTime(3_000);
    expect(events.onBlocked).toHaveBeenCalledTimes(1);
    fromPlayer({ event: 'onStateChange', info: 1 });
    expect(events.onPlaying).toHaveBeenCalled();
    fromPlayer({ event: 'onStateChange', info: 0 });
    expect(events.onEnded).toHaveBeenCalledTimes(1);
    player.destroy();
  });

  it('says nothing when told what it already does, so the player shows its marks only on a change', () => {
    const { player, posted, fromPlayer } = setUp();
    fromPlayer({ event: 'onReady' });
    const commands = () => posted.filter((entry) => entry.message.event === 'command').map((entry) => entry.message.func);

    // Paused already: no pause goes out, however often the room says so.
    fromPlayer({ event: 'onStateChange', info: 2 });
    player.pause();
    player.pause();
    expect(commands()).toEqual(['setVolume']);

    player.play();
    fromPlayer({ event: 'onStateChange', info: 1 });
    player.play();
    player.play();
    expect(commands()).toEqual(['setVolume', 'playVideo']);

    player.pause();
    expect(commands()).toEqual(['setVolume', 'playVideo', 'pauseVideo']);
    player.destroy();
  });

  it('stops listening once it is gone', () => {
    const { player, events, fromPlayer, iframe } = setUp();
    player.destroy();
    fromPlayer({ event: 'onStateChange', info: 0 });
    expect(events.onEnded).not.toHaveBeenCalled();
    expect(iframe.isConnected).toBe(false);
  });
});
