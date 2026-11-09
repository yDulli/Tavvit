import type { WatchPlayer, WatchPlayerFactory } from './types';

/**
 * A video file, in a plain `<video>`: the browser's own player, without its controls. Unlike a
 * provider's frame it can play on the output device the call uses.
 */
export const createFilePlayer: WatchPlayerFactory = (source, startMs, events) => {
  const video = document.createElement('video');
  video.src = source.ref;
  video.playsInline = true;
  video.preload = 'auto';
  video.controls = false;
  video.className = 'absolute inset-0 h-full w-full bg-black object-contain';
  video.tabIndex = -1;

  let wantPlaying = false;
  let ready = false;
  let volume = 100;
  const onLoaded = (): void => {
    ready = true;
    if (startMs > 0) video.currentTime = startMs / 1000;
  };
  const onEnded = (): void => events.onEnded();
  const onPlaying = (): void => events.onPlaying();
  video.addEventListener('loadedmetadata', onLoaded);
  video.addEventListener('ended', onEnded);
  video.addEventListener('playing', onPlaying);

  const start = (): void => {
    wantPlaying = true;
    video.play().catch((err: unknown) => {
      // Refused without a click (NotAllowedError); anything else is the file's own trouble.
      if (wantPlaying && err instanceof DOMException && err.name === 'NotAllowedError') events.onBlocked();
    });
  };

  const player: WatchPlayer = {
    element: video,
    play: () => {
      if (wantPlaying && !video.paused) return;
      start();
    },
    pause: () => {
      if (!wantPlaying && video.paused) return;
      wantPlaying = false;
      video.pause();
    },
    seek: (ms) => {
      video.currentTime = ms / 1000;
    },
    currentMs: () => (ready ? video.currentTime * 1000 : null),
    durationMs: () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : null),
    setVolume: (next) => {
      volume = Math.min(100, Math.max(0, next));
      video.volume = volume / 100;
      video.muted = volume === 0;
    },
    resume: () => {
      video.muted = volume === 0;
      start();
    },
    setOutputDevice: (deviceId) => {
      // Not every browser lets a page choose (Safari before 17); there it plays where the system does.
      if (typeof video.setSinkId !== 'function') return;
      video.setSinkId(deviceId === 'default' ? '' : deviceId).catch(() => {
        // A device gone since it was chosen: the system's default output plays it.
      });
    },
    destroy: () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('playing', onPlaying);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    },
  };
  return player;
};
