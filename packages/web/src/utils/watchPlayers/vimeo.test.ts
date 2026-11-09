import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWatchUrl } from '@backspace/shared/src/watch';
import { chooseTrack, createVimeoPlayer, parseTextTracks } from './vimeo';

// Vimeo's player is steered over postMessage only: methods go to its own origin, and only its
// own frame's messages are heard.

const PLAYER_ORIGIN = 'https://player.vimeo.com';
const source = parseWatchUrl('https://vimeo.com/76979871')!;

function setUp() {
  const events = { onEnded: vi.fn(), onBlocked: vi.fn(), onPlaying: vi.fn() };
  const player = createVimeoPlayer(source, 0, events);
  document.body.appendChild(player.element);
  const iframe = player.element as HTMLIFrameElement;
  const posted: Array<{ method: string; value?: unknown }> = [];
  vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(((message: string) => {
    posted.push(JSON.parse(message) as { method: string; value?: unknown });
  }) as Window['postMessage']);
  const fromPlayer = (data: unknown) => {
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), origin: PLAYER_ORIGIN, source: iframe.contentWindow }));
  };
  const trackCalls = () => posted.filter((entry) => /TextTrack/.test(entry.method));
  return { player, posted, events, fromPlayer, trackCalls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('subtitle tracks', () => {
  it('reads Vimeo\'s list and leaves out what is not a track', () => {
    expect(parseTextTracks([{ language: 'de', kind: 'subtitles', label: 'Deutsch' }, { language: 7 }, null, 'x'])).toEqual([{ language: 'de', kind: 'subtitles' }]);
    expect(parseTextTracks('nothing')).toEqual([]);
  });

  it('takes the browser\'s language, else English, else the first', () => {
    const tracks = [
      { language: 'fr', kind: 'subtitles' },
      { language: 'en-US', kind: 'captions' },
      { language: 'de', kind: 'subtitles' },
    ];
    expect(chooseTrack(tracks, 'de-DE')).toEqual({ language: 'de', kind: 'subtitles' });
    expect(chooseTrack(tracks, 'ru')).toEqual({ language: 'en-US', kind: 'captions' });
    expect(chooseTrack([{ language: 'fr', kind: 'subtitles' }], 'ru')).toEqual({ language: 'fr', kind: 'subtitles' });
    expect(chooseTrack([], 'de')).toBeNull();
  });
});

describe('the Vimeo player\'s sound', () => {
  it('is the person\'s volume once ready, a mute from before taken back', () => {
    const { player, posted, fromPlayer } = setUp();
    player.setVolume(80);
    expect(posted.filter((entry) => entry.method !== 'ping')).toEqual([]);
    fromPlayer({ event: 'ready' });
    expect(posted).toContainEqual({ method: 'setVolume', value: 0.8 });
    expect(posted).toContainEqual({ method: 'setMuted', value: false });
    player.setVolume(0);
    expect(posted.slice(-2)).toEqual([{ method: 'setVolume', value: 0 }, { method: 'setMuted', value: true }]);
    player.destroy();
  });

  it('says a start the browser refused, also while the room asks for it every second', () => {
    const { player, events, fromPlayer } = setUp();
    fromPlayer({ event: 'ready' });
    player.play();
    for (let second = 0; second < 3; second += 1) {
      vi.advanceTimersByTime(1_000);
      player.play();
    }
    expect(events.onBlocked).toHaveBeenCalledTimes(1);
    player.destroy();
  });

  it('asks whether it plays silent, takes silence against the volume as refused, and gets its sound from the click', () => {
    const { player, posted, events, fromPlayer } = setUp();
    const unmutes = () => posted.filter((entry) => entry.method === 'setMuted' && entry.value === false).length;
    player.setVolume(80);
    fromPlayer({ event: 'ready' });
    player.play();
    fromPlayer({ event: 'play' });
    expect(posted.at(-1)).toEqual({ method: 'getMuted' });

    // Vimeo says it plays muted: its sound is asked back once, and whether that took.
    fromPlayer({ method: 'getMuted', value: true });
    expect(unmutes()).toBe(2);
    expect(posted.at(-1)).toEqual({ method: 'getMuted' });
    fromPlayer({ method: 'getMuted', value: true });
    vi.advanceTimersByTime(3_000);
    expect(events.onBlocked).toHaveBeenCalledTimes(1);

    // Refused: a new volume does not ask again.
    player.setVolume(40);
    expect(unmutes()).toBe(2);

    player.resume();
    expect(unmutes()).toBe(3);
    expect(posted.slice(-2)).toEqual([{ method: 'play' }, { method: 'getMuted' }]);
    const playingBefore = events.onPlaying.mock.calls.length;
    fromPlayer({ method: 'getMuted', value: false });
    expect(events.onPlaying.mock.calls.length).toBe(playingBefore + 1);
    vi.advanceTimersByTime(3_000);
    expect(events.onBlocked).toHaveBeenCalledTimes(1);
    player.destroy();
  });
});

describe('the Vimeo player\'s subtitles', () => {
  it('are off once ready, also where the video\'s owner made a track the default', () => {
    const { player, fromPlayer, trackCalls } = setUp();
    expect(trackCalls()).toEqual([]);
    fromPlayer({ event: 'ready' });
    expect(trackCalls()).toEqual([{ method: 'disableTextTrack' }]);
    player.destroy();
  });

  it('come on with the viewer\'s track once Vimeo has named its tracks, and go off again', () => {
    const { player, fromPlayer, trackCalls } = setUp();
    fromPlayer({ event: 'ready' });
    player.setCaptions!(true);
    expect(trackCalls().at(-1)).toEqual({ method: 'getTextTracks' });

    fromPlayer({ method: 'getTextTracks', value: [{ language: 'en', kind: 'captions' }] });
    expect(trackCalls().at(-1)).toEqual({ method: 'enableTextTrack', value: { language: 'en', kind: 'captions' } });

    player.setCaptions!(false);
    expect(trackCalls().at(-1)).toEqual({ method: 'disableTextTrack' });
    player.destroy();
  });
});
