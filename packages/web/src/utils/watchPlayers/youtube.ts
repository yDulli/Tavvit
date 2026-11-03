import type { WatchPlayer, WatchPlayerFactory } from './types';
import { PLAY_START_GRACE_MS } from './types';

/**
 * YouTube's own player, from the privacy-enhanced host the client may embed (`EMBED_FRAME_ORIGINS`),
 * steered over the postMessage protocol its iframe API speaks: no script of YouTube's runs on this
 * page, and the content security policy stays as it is.
 */

const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com';

/** The player's states in its info messages: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
const ENDED = 0;
const PLAYING = 1;
const BUFFERING = 3;

interface PlayerMessage {
  event?: string;
  info?: unknown;
}

export const createYouTubePlayer: WatchPlayerFactory = (source, startMs, events) => {
  const iframe = document.createElement('iframe');
  const params = new URLSearchParams({
    enablejsapi: '1',
    origin: window.location.origin,
    controls: '0',
    disablekb: '1',
    playsinline: '1',
    rel: '0',
    iv_load_policy: '3',
    fs: '0',
    start: String(Math.floor(startMs / 1000)),
  });
  iframe.src = `${PLAYER_ORIGIN}/embed/${encodeURIComponent(source.ref)}?${params.toString()}`;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.className = 'absolute inset-0 h-full w-full border-0';
  iframe.tabIndex = -1;

  let time: number | null = null;
  let duration: number | null = null;
  let state = -1;
  let ready = false;
  let wantPlaying = false;
  let volume = 100;
  let destroyed = false;
  let blockTimer: ReturnType<typeof setTimeout> | null = null;

  const post = (message: Record<string, unknown>): void => {
    iframe.contentWindow?.postMessage(JSON.stringify({ ...message, id: 1, channel: 'widget' }), PLAYER_ORIGIN);
  };
  const command = (func: string, args: unknown[] = []): void => {
    if (ready) post({ event: 'command', func, args });
  };

  const clearBlockTimer = (): void => {
    if (blockTimer) clearTimeout(blockTimer);
    blockTimer = null;
  };
  const watchStart = (): void => {
    clearBlockTimer();
    blockTimer = setTimeout(() => {
      if (!destroyed && wantPlaying && state !== PLAYING) events.onBlocked();
    }, PLAY_START_GRACE_MS);
  };

  const onState = (next: number): void => {
    state = next;
    if (next === PLAYING) {
      clearBlockTimer();
      events.onPlaying();
    }
    if (next === ENDED) events.onEnded();
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== PLAYER_ORIGIN || event.source !== iframe.contentWindow) return;
    let data: PlayerMessage;
    try {
      data = (typeof event.data === 'string' ? JSON.parse(event.data) : event.data) as PlayerMessage;
    } catch {
      return;
    }
    if (data.event === 'onReady' || data.event === 'initialDelivery') {
      if (!ready) {
        ready = true;
        command('setVolume', [volume]);
        if (wantPlaying) {
          command('playVideo');
          watchStart();
        }
      }
    }
    if (data.event === 'onStateChange' && typeof data.info === 'number') onState(data.info);
    if (data.event === 'infoDelivery' && typeof data.info === 'object' && data.info !== null) {
      const info = data.info as { currentTime?: unknown; duration?: unknown; playerState?: unknown };
      if (typeof info.currentTime === 'number') time = info.currentTime * 1000;
      if (typeof info.duration === 'number' && info.duration > 0) duration = info.duration * 1000;
      if (typeof info.playerState === 'number' && info.playerState !== state) onState(info.playerState);
    }
  };
  window.addEventListener('message', onMessage);

  // The player answers once it is told someone listens; until it has, it is asked again.
  const listen = setInterval(() => {
    if (ready || destroyed) {
      clearInterval(listen);
      return;
    }
    post({ event: 'listening' });
  }, 250);

  const player: WatchPlayer = {
    element: iframe,
    play: () => {
      if (wantPlaying && state === PLAYING) return;
      wantPlaying = true;
      command('playVideo');
      if (ready) watchStart();
    },
    pause: () => {
      // Told again and again while the room is paused: only a player that moves hears of it.
      if (!wantPlaying && state !== PLAYING && state !== BUFFERING) return;
      wantPlaying = false;
      clearBlockTimer();
      command('pauseVideo');
    },
    seek: (ms) => {
      time = ms;
      command('seekTo', [ms / 1000, true]);
    },
    currentMs: () => (ready ? time : null),
    durationMs: () => duration,
    setVolume: (next) => {
      volume = Math.round(Math.min(100, Math.max(0, next)));
      command('setVolume', [volume]);
      command(volume === 0 ? 'mute' : 'unMute');
    },
    destroy: () => {
      destroyed = true;
      clearInterval(listen);
      clearBlockTimer();
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
  return player;
};
