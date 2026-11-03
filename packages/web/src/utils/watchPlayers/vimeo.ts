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
  let destroyed = false;
  let blockTimer: ReturnType<typeof setTimeout> | null = null;

  const post = (method: string, value?: unknown): void => {
    if (!ready && method !== 'ping') return;
    iframe.contentWindow?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), PLAYER_ORIGIN);
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
    switch (data.event) {
      case 'ready':
        if (ready) return;
        ready = true;
        for (const name of ['timeupdate', 'play', 'pause', 'ended']) post('addEventListener', name);
        post('setVolume', volume / 100);
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
    destroy: () => {
      destroyed = true;
      clearBlockTimer();
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
  return player;
};
