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

/** What the player says of itself (`initialDelivery`, `infoDelivery`, `onVolumeChange`); only what is read. */
interface PlayerInfo {
  currentTime?: unknown;
  duration?: unknown;
  playerState?: unknown;
  muted?: unknown;
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
  /** Whether the player says it is muted; null until it has said. */
  let muted: boolean | null = null;
  /** Its sound was asked back once, unbidden, since it was made or the person last clicked. */
  let unmuteAsked = false;
  /**
   * The browser would not play it with sound (`onBlocked`), until the person clicks: asking for
   * the sound again meanwhile would only stop a video a browser lets go on muted.
   */
  let refused = false;
  let captions = false;
  let destroyed = false;
  let blockTimer: ReturnType<typeof setTimeout> | null = null;

  const post = (message: Record<string, unknown>): void => {
    iframe.contentWindow?.postMessage(JSON.stringify({ ...message, id: 1, channel: 'widget' }), PLAYER_ORIGIN);
  };
  const command = (func: string, args: unknown[] = []): void => {
    if (ready) post({ event: 'command', func, args });
  };

  /**
   * The viewer's choice of subtitles, over YouTube's own: it turns them on by
   * itself when the video's language is not the browser's. Told once ready and
   * again each time the video starts to play, which is when YouTube loads its
   * captions module anew. The module was called "cc" in older players.
   */
  const applyCaptions = (): void => {
    if (captions) {
      command('loadModule', ['captions']);
      return;
    }
    command('unloadModule', ['captions']);
    command('unloadModule', ['cc']);
  };

  /**
   * The person's sound, all of it: the volume, and muted or not. A volume alone leaves muted a
   * player that was muted: YouTube keeps a mute on the device (also one of ours, from a call
   * deafened or a volume of 0 while a video ended) and starts every later video with it.
   */
  const applySound = (): void => {
    command('setVolume', [volume]);
    if (volume === 0) command('mute');
    else if (!refused) command('unMute');
  };

  /** Muted while the person's volume asks for sound. */
  const silenced = (): boolean => volume > 0 && muted === true;

  const clearBlockTimer = (): void => {
    if (blockTimer) clearTimeout(blockTimer);
    blockTimer = null;
  };
  /**
   * A while after a start was asked for, it must play with its sound, else the browser refused
   * it. Set going once per attempt: the room asks every second, and an ask that set it going anew
   * would keep it from ever coming.
   */
  const checkStart = (): void => {
    if (blockTimer) return;
    blockTimer = setTimeout(() => {
      blockTimer = null;
      if (destroyed || !wantPlaying || (state === PLAYING && !silenced())) return;
      refused = true;
      events.onBlocked();
    }, PLAY_START_GRACE_MS);
  };

  /** It plays: with its sound that is a start; silent against the person's volume it is not one yet. */
  const onPlayingNow = (): void => {
    if (silenced()) {
      if (wantPlaying) checkStart();
      return;
    }
    refused = false;
    clearBlockTimer();
    events.onPlaying();
  };

  const onMuted = (next: boolean): void => {
    if (next === muted) return;
    muted = next;
    if (!next) {
      if (state === PLAYING) onPlayingNow();
      return;
    }
    if (!silenced()) return;
    // Asked back once, not again and again: a browser that refuses the sound mutes it anew, and
    // each ask would stop the video for a moment.
    if (!unmuteAsked && !refused) {
      unmuteAsked = true;
      command('unMute');
    }
    if (wantPlaying) checkStart();
  };

  const onState = (next: number): void => {
    const started = next === PLAYING && state !== PLAYING;
    state = next;
    if (next === PLAYING) onPlayingNow();
    if (started) applyCaptions();
    if (next === ENDED) events.onEnded();
  };

  const onInfo = (info: PlayerInfo): void => {
    if (typeof info.currentTime === 'number') time = info.currentTime * 1000;
    if (typeof info.duration === 'number' && info.duration > 0) duration = info.duration * 1000;
    if (typeof info.muted === 'boolean') onMuted(info.muted);
    if (typeof info.playerState === 'number' && info.playerState !== state) onState(info.playerState);
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
        applySound();
        applyCaptions();
        if (wantPlaying) {
          command('playVideo');
          checkStart();
        }
      }
    }
    if (data.event === 'onStateChange' && typeof data.info === 'number') onState(data.info);
    if (
      (data.event === 'infoDelivery' || data.event === 'initialDelivery' || data.event === 'onVolumeChange')
      && typeof data.info === 'object' && data.info !== null
    ) {
      onInfo(data.info as PlayerInfo);
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
      if (ready) checkStart();
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
      applySound();
      // A volume of 0 makes a silent player one that plays as asked, and the other way round.
      if (state === PLAYING) onPlayingNow();
    },
    resume: () => {
      refused = false;
      unmuteAsked = false;
      wantPlaying = true;
      clearBlockTimer();
      applySound();
      command('playVideo');
      if (ready) checkStart();
    },
    setCaptions: (on) => {
      if (on === captions) return;
      captions = on;
      applyCaptions();
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
