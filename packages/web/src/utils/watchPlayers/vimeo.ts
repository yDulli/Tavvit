import type { WatchPlayer, WatchPlayerFactory } from './types';
import { PLAY_START_GRACE_MS } from './types';

/**
 * Vimeo's own player, steered over the postMessage protocol of its player API: no script of
 * Vimeo's runs on this page. `dnt=1` asks it not to track the viewer.
 */

const PLAYER_ORIGIN = 'https://player.vimeo.com';

interface PlayerMessage {
  event?: string;
  method?: string;
  value?: unknown;
  data?: { seconds?: unknown; duration?: unknown };
}

/** A subtitle track as Vimeo names it. */
export interface VimeoTextTrack {
  language: string;
  kind: string;
}

/** The tracks in Vimeo's answer to `getTextTracks`; anything malformed is left out. */
export function parseTextTracks(value: unknown): VimeoTextTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { language, kind } = entry as { language?: unknown; kind?: unknown };
    return typeof language === 'string' && typeof kind === 'string' ? [{ language, kind }] : [];
  });
}

/** The track for a viewer whose browser speaks `preferred`: theirs, else English, else the first. */
export function chooseTrack(tracks: readonly VimeoTextTrack[], preferred: string): VimeoTextTrack | null {
  const base = (language: string) => language.toLowerCase().split('-')[0];
  return tracks.find((track) => base(track.language) === base(preferred))
    ?? tracks.find((track) => base(track.language) === 'en')
    ?? tracks[0]
    ?? null;
}

export const createVimeoPlayer: WatchPlayerFactory = (source, startMs, events) => {
  const [id, key] = source.ref.split(':');
  const iframe = document.createElement('iframe');
  const params = new URLSearchParams({
    controls: '0',
    dnt: '1',
    playsinline: '1',
    autopause: '0',
    title: '0',
    byline: '0',
    portrait: '0',
    api: '1',
    ...(key ? { h: key } : {}),
  });
  iframe.src = `${PLAYER_ORIGIN}/video/${encodeURIComponent(id ?? '')}?${params.toString()}#t=${Math.floor(startMs / 1000)}s`;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.className = 'absolute inset-0 h-full w-full border-0';
  iframe.tabIndex = -1;

  let time: number | null = null;
  let duration: number | null = null;
  let ready = false;
  let playing = false;
  let wantPlaying = false;
  let volume = 100;
  let captions = false;
  /** The video's subtitle tracks, once Vimeo has said (`getTextTracks`). */
  let tracks: VimeoTextTrack[] | null = null;
  let destroyed = false;
  let blockTimer: ReturnType<typeof setTimeout> | null = null;

  const post = (method: string, value?: unknown): void => {
    if (!ready && method !== 'ping') return;
    iframe.contentWindow?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), PLAYER_ORIGIN);
  };

  /**
   * The viewer's choice of subtitles: off unless asked for, also where the
   * video's owner made a track the default. On takes the track in the
   * browser's language, else English, else the first; the tracks are asked
   * for the first time they are needed.
   */
  const applyCaptions = (): void => {
    if (!captions) {
      post('disableTextTrack');
      return;
    }
    if (tracks === null) {
      post('getTextTracks');
      return;
    }
    const track = chooseTrack(tracks, navigator.language);
    if (track) post('enableTextTrack', { language: track.language, kind: track.kind });
  };

  const clearBlockTimer = (): void => {
    if (blockTimer) clearTimeout(blockTimer);
    blockTimer = null;
  };
  const watchStart = (): void => {
    clearBlockTimer();
    blockTimer = setTimeout(() => {
      if (!destroyed && wantPlaying && !playing) events.onBlocked();
    }, PLAY_START_GRACE_MS);
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== PLAYER_ORIGIN || event.source !== iframe.contentWindow) return;
    let data: PlayerMessage;
    try {
      data = (typeof event.data === 'string' ? JSON.parse(event.data) : event.data) as PlayerMessage;
    } catch {
      return;
    }
    if (data.method === 'getTextTracks') {
      tracks = parseTextTracks(data.value);
      if (captions) applyCaptions();
      return;
    }
    switch (data.event) {
      case 'ready':
        if (ready) return;
        ready = true;
        for (const name of ['timeupdate', 'play', 'pause', 'ended']) post('addEventListener', name);
        post('setVolume', volume / 100);
        applyCaptions();
        if (wantPlaying) {
          post('play');
          watchStart();
        }
        return;
      case 'timeupdate':
      case 'playProgress':
        if (typeof data.data?.seconds === 'number') time = data.data.seconds * 1000;
        if (typeof data.data?.duration === 'number' && data.data.duration > 0) duration = data.data.duration * 1000;
        return;
      case 'play':
        playing = true;
        clearBlockTimer();
        events.onPlaying();
        return;
      case 'pause':
        playing = false;
        return;
      case 'ended':
      case 'finish':
        playing = false;
        events.onEnded();
        return;
    }
  };
  window.addEventListener('message', onMessage);

  const player: WatchPlayer = {
    element: iframe,
    play: () => {
      if (wantPlaying && playing) return;
      wantPlaying = true;
      post('play');
      if (ready) watchStart();
    },
    pause: () => {
      if (!wantPlaying && !playing) return;
      wantPlaying = false;
      clearBlockTimer();
      post('pause');
    },
    seek: (ms) => {
      time = ms;
      post('setCurrentTime', ms / 1000);
    },
    currentMs: () => (ready ? time : null),
    durationMs: () => duration,
    setVolume: (next) => {
      volume = Math.round(Math.min(100, Math.max(0, next)));
      post('setVolume', volume / 100);
    },
    setCaptions: (on) => {
      if (on === captions) return;
      captions = on;
      applyCaptions();
    },
    destroy: () => {
      destroyed = true;
      clearBlockTimer();
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
  return player;
};
