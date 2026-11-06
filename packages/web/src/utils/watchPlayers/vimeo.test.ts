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
  return { player, posted, fromPlayer, trackCalls };
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
