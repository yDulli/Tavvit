import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n/formatters';
import { Icon } from '../ui/Icon';

const SPEEDS = [1, 1.5, 2] as const;
const STEP_SECONDS = 5;
const BAR_AREA_PX = 28;

/** The bars of a voice message. Those already played take the signal colour. */
export function VoiceBars({ bars, progress }: { bars: readonly number[]; progress: number }) {
  return (
    <div aria-hidden="true" className="flex h-7 min-w-0 flex-1 items-center gap-[2px]">
      {bars.map((bar, at) => (
        <span
          key={at}
          className={`min-w-[2px] flex-1 rounded-sm transition-colors duration-[var(--dur-fast)] ${(at + 0.5) / bars.length <= progress ? 'bg-accent-soft' : 'bg-txt-tertiary/50'}`}
          style={{ height: `${Math.max(2, (bar / 100) * BAR_AREA_PX)}px` }}
        />
      ))}
    </div>
  );
}

interface VoiceMessagePlayerProps {
  url: string;
  bars: readonly number[];
  /** From the server; a recording in the browser's own format often states no length of its own. */
  duration: number | null | undefined;
}

/** A voice message: play, the waveform to jump around in, how far along, and how fast. */
export function VoiceMessagePlayer({ url, bars, duration }: VoiceMessagePlayerProps) {
  const { t } = useTranslation('chat');
  const { formatDuration, formatNumber } = useFormatters();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [ownDuration, setOwnDuration] = useState<number | null>(null);

  const length = duration && duration > 0 ? duration : ownDuration ?? 0;
  const progress = length > 0 ? Math.min(1, elapsed / length) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };

  const seekTo = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || length <= 0) return;
    const target = Math.max(0, Math.min(length, seconds));
    audio.currentTime = target;
    setElapsed(target);
  };

  const onBarsClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    seekTo(((event.clientX - box.left) / box.width) * length);
  };

  const onBarsKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      seekTo(elapsed + STEP_SECONDS);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seekTo(elapsed - STEP_SECONDS);
    }
  };

  const nextSpeed = () => {
    setSpeed((current) => SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length] ?? 1);
  };

  return (
    <div className="surface-card flex w-full max-w-[400px] items-center gap-2.5 rounded-lg p-2">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setOwnDuration(event.currentTarget.duration);
        }}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t('voiceMessage.pause') : t('voiceMessage.play')}
        title={playing ? t('voiceMessage.pause') : t('voiceMessage.play')}
        className="btn-primary h-8 w-8 flex-shrink-0 p-0"
      >
        <Icon name={playing ? 'pause' : 'play'} size={15} />
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('voiceMessage.position')}
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(elapsed)}
        aria-valuetext={formatDuration(Math.floor(elapsed))}
        onClick={onBarsClick}
        onKeyDown={onBarsKey}
        className="flex min-w-0 flex-1 cursor-pointer rounded-sm"
      >
        <VoiceBars bars={bars} progress={progress} />
      </div>
      <span className="tabular flex-shrink-0 font-mono text-label text-txt-tertiary">
        {formatDuration(Math.floor(playing || elapsed > 0 ? elapsed : length))}
      </span>
      <button
        type="button"
        onClick={nextSpeed}
        aria-label={t('voiceMessage.speed', { speed: formatNumber(speed) })}
        title={t('voiceMessage.speed', { speed: formatNumber(speed) })}
        className="btn-quiet btn-sm flex-shrink-0 px-1.5 font-mono"
      >
        {t('voiceMessage.speedShort', { speed: formatNumber(speed) })}
      </button>
    </div>
  );
}
