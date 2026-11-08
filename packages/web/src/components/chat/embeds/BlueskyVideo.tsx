import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlueskyVideo as BlueskyVideoInfo } from '@backspace/shared/src/bluesky';
import { useFormatters } from '../../../i18n/formatters';
import { webAddress } from '../../../utils/webAddress';
import { Icon } from '../../ui/Icon';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { RangeSlider } from '../../ui/RangeSlider';
import { mediaBox } from '../mediaBox';

type Phase = 'idle' | 'loading' | 'ready' | 'failed';

/** What the player keeps of hls.js once it is loaded: only that it can be let go. */
interface Stream {
  destroy: () => void;
}

const SEEK_STEP_SECONDS = 5;

/** The light track of a slider on the dark video: white up to the thumb (`RangeSlider`'s `track`). */
function lightTrack(filled: number): string {
  return `linear-gradient(to right, rgb(255 255 255 / 0.9) ${filled}%, rgb(255 255 255 / 0.28) ${filled}%)`;
}

/**
 * A video of a Bluesky post (docs/systems/embeds.md, "Bluesky posts"): its still with a play
 * button until played, then Tavvit's own controls: play and pause, the time, a timeline, sound and
 * volume, picture in picture and full screen. Bluesky sends videos as HLS, which most browsers do
 * not play by themselves, so hls.js (its light build) is loaded when someone first presses play.
 * Its card renders it only after the person agreed to load from Bluesky's servers.
 */
export function BlueskyVideo({ video, postUrl }: { video: BlueskyVideoInfo; postUrl: string }) {
  const { t } = useTranslation('chat');
  const f = useFormatters();
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<Stream | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(video.loops);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const pipAvailable = typeof document !== 'undefined' && document.pictureInPictureEnabled === true && !video.loops;

  useEffect(() => () => {
    streamRef.current?.destroy();
    streamRef.current = null;
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const start = useCallback(async () => {
    const element = videoRef.current;
    if (!element || phase === 'loading') return;
    setPhase('loading');
    try {
      // hls.js wherever the browser has Media Source; a browser's own HLS (Safari on an iPhone) only
      // where it has not, since some report HLS they then do not play.
      const { default: Hls } = await import('hls.js/light');
      if (!Hls.isSupported()) {
        if (!element.canPlayType('application/vnd.apple.mpegurl')) throw new Error('This browser plays no HLS');
        element.src = video.playlist;
      } else {
        const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 30 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          hls.destroy();
          streamRef.current = null;
          setPhase('failed');
        });
        hls.loadSource(video.playlist);
        hls.attachMedia(element);
        streamRef.current = hls;
      }
      element.muted = video.loops;
      await element.play();
      setPhase('ready');
    } catch {
      streamRef.current?.destroy();
      streamRef.current = null;
      setPhase('failed');
    }
  }, [phase, video.loops, video.playlist]);

  const toggle = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (phase !== 'ready') {
      void start();
      return;
    }
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  }, [phase, start]);

  const seekTo = (seconds: number) => {
    const element = videoRef.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = Math.min(Math.max(seconds, 0), element.duration);
  };

  const toggleMute = () => {
    const element = videoRef.current;
    if (!element) return;
    element.muted = !element.muted;
    if (!element.muted && element.volume === 0) element.volume = 0.5;
  };

  const changeVolume = (next: number) => {
    const element = videoRef.current;
    if (!element) return;
    element.volume = next;
    element.muted = next === 0;
  };

  const toggleFullscreen = () => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void frame.requestFullscreen().catch(() => {});
  };

  const togglePictureInPicture = () => {
    const element = videoRef.current;
    if (!element) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void element.requestPictureInPicture().catch(() => {});
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget && (event.target as HTMLElement).tagName === 'INPUT') return;
    switch (event.key) {
      case ' ':
      case 'k':
        event.preventDefault();
        toggle();
        break;
      case 'm':
        if (phase === 'ready' && !video.loops) { event.preventDefault(); toggleMute(); }
        break;
      case 'f':
        if (phase === 'ready') { event.preventDefault(); toggleFullscreen(); }
        break;
      case 'ArrowLeft':
        if (phase === 'ready') { event.preventDefault(); seekTo(time - SEEK_STEP_SECONDS); }
        break;
      case 'ArrowRight':
        if (phase === 'ready') { event.preventDefault(); seekTo(time + SEEK_STEP_SECONDS); }
        break;
    }
  };

  const box = mediaBox(video.width, video.height, { enlarge: true });
  const shownVolume = muted ? 0 : volume;
  const progress = duration > 0 ? (time / duration) * 100 : 0;
  const label = video.alt || t('embed.videoTitle');

  return (
    <div
      ref={frameRef}
      tabIndex={0}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      data-playing={playing ? 'true' : undefined}
      className={`group/video relative max-w-full overflow-hidden rounded-md bg-black outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60 ${fullscreen ? 'flex items-center justify-center' : ''}`}
      style={fullscreen ? undefined : box ?? { aspectRatio: '16/9', width: '100%' }}
    >
      <video
        ref={videoRef}
        poster={video.thumbnail ?? undefined}
        playsInline
        loop={video.loops}
        preload="none"
        aria-label={label}
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onVolumeChange={(event) => { setMuted(event.currentTarget.muted); setVolume(event.currentTarget.volume); }}
        onError={() => { if (phase !== 'idle') setPhase('failed'); }}
        className="h-full w-full cursor-pointer object-contain"
      />

      {video.loops && (
        <span className="glass-pill pointer-events-none absolute left-2 top-2 rounded px-1.5 py-0.5 font-mono text-2xs text-txt-primary">
          {t('embed.bluesky.gif')}
        </span>
      )}

      {phase === 'failed' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-4 text-center">
          <p className="text-ui text-white/85">{t('embed.player.failed')}</p>
          <a href={webAddress(postUrl)} target="_blank" rel="noopener noreferrer" className="btn-outline btn-sm">
            {t('embed.player.watchOnBluesky')}
          </a>
        </div>
      ) : (phase !== 'ready' || !playing) && (
        <button
          type="button"
          onClick={toggle}
          aria-label={t('embed.player.play')}
          className="absolute left-1/2 top-1/2 z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg glass-bubble text-txt-primary transition-colors hover:bg-surface-chat"
        >
          {phase === 'loading'
            ? <span role="status" aria-label={t('embed.player.loading')}><LoadingSpinner size={18} /></span>
            : <Icon name="play" size={18} strokeWidth={1.75} />}
        </button>
      )}

      {phase === 'ready' && (
        <div
          className={`absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-7 transition-opacity duration-150 ${playing ? 'opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100' : 'opacity-100'}`}
        >
          <button type="button" onClick={toggle} aria-label={playing ? t('embed.player.pause') : t('embed.player.play')} className="icon-btn h-7 w-7 flex-shrink-0 text-white">
            <Icon name={playing ? 'pause' : 'play'} size={16} />
          </button>
          <span className="tabular flex-shrink-0 font-mono text-label text-white/85">
            {f.formatDuration(time)} / {f.formatDuration(duration)}
          </span>
          <RangeSlider
            value={Math.min(time, duration || 0)}
            min={0}
            max={duration || 1}
            step={0.1}
            onChange={seekTo}
            track={lightTrack(progress)}
            aria-label={t('embed.player.seek')}
            aria-valuetext={`${f.formatDuration(time)} / ${f.formatDuration(duration)}`}
            className="min-w-0 flex-1"
          />
          {!video.loops && (
            <>
              <button type="button" onClick={toggleMute} aria-label={muted ? t('embed.player.unmute') : t('embed.player.mute')} className="icon-btn h-7 w-7 flex-shrink-0 text-white">
                <Icon name={muted || volume === 0 ? 'volume-off' : 'volume'} size={16} />
              </button>
              <RangeSlider
                value={shownVolume}
                min={0}
                max={1}
                step={0.05}
                onChange={changeVolume}
                track={lightTrack(shownVolume * 100)}
                aria-label={t('embed.player.volume')}
                className="hidden w-16 flex-shrink-0 desktop:block"
              />
            </>
          )}
          {pipAvailable && (
            <button type="button" onClick={togglePictureInPicture} aria-label={t('embed.player.pip')} className="icon-btn h-7 w-7 flex-shrink-0 text-white">
              <Icon name="pip" size={16} />
            </button>
          )}
          <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? t('embed.player.exitFullscreen') : t('embed.player.fullscreen')} className="icon-btn h-7 w-7 flex-shrink-0 text-white">
            <Icon name={fullscreen ? 'minimize' : 'maximize'} size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
