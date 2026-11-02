import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VOICE_MESSAGE_LIMITS } from '@backspace/shared/src/voiceMessages';
import { useFormatters } from '../../i18n/formatters';
import { VoiceRecorder, type VoiceRecording } from '../../utils/voiceRecorder';
import { Icon } from '../ui/Icon';
import { VoiceBars, VoiceMessagePlayer } from './VoiceMessagePlayer';

const SHORTEST_SECONDS = 0.5;
/** How much of the recording the bar shows while it runs, a tenth of a second each. */
const LIVE_BARS = 48;
const QUIET_BAR = 4;

interface VoiceRecorderBarProps {
  /**
   * Someone is holding the button (a phone): letting go ends the recording. Without it, the
   * recording runs until the stop button is pressed.
   */
  held: boolean;
  onSend: (recording: VoiceRecording) => void;
  onClose: () => void;
  /** The microphone cannot be used: says why, and closes. */
  onUnavailable: (reason: 'denied' | 'unsupported') => void;
}

/** In place of the composer's input: recording, then a preview to send or throw away. */
export function VoiceRecorderBar({ held, onSend, onClose, onUnavailable }: VoiceRecorderBarProps) {
  const { t } = useTranslation('chat');
  const { formatDuration } = useFormatters();
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const stoppingRef = useRef(false);
  const [recording, setRecording] = useState<VoiceRecording | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<readonly number[]>(() => new Array<number>(LIVE_BARS).fill(QUIET_BAR));

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || stoppingRef.current) return;
    stoppingRef.current = true;
    if (recorder.elapsedSeconds() < SHORTEST_SECONDS) {
      recorder.cancel();
      onClose();
      return;
    }
    const finished = await recorder.stop().catch(() => null);
    if (!finished) {
      onClose();
      return;
    }
    setRecording(finished);
    setPreviewUrl(URL.createObjectURL(finished.blob));
  }, [onClose]);

  useEffect(() => {
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;
    let unmounted = false;
    recorder.start().catch((err: unknown) => {
      if (unmounted) return;
      onUnavailable(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'unsupported');
    });
    const ticker = setInterval(() => {
      const elapsed = recorder.elapsedSeconds();
      setSeconds(elapsed);
      setLevels((current) => [...current.slice(1), Math.max(QUIET_BAR, recorder.level() * 100)]);
      if (elapsed >= VOICE_MESSAGE_LIMITS.MAX_SECONDS) void stop();
    }, 100);
    return () => {
      unmounted = true;
      clearInterval(ticker);
      recorder.cancel();
    };
    // Once, for the life of the bar: a new recording is a new bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Letting go of the held button ends it, wherever the finger went by then.
  useEffect(() => {
    if (!held) return undefined;
    const release = () => void stop();
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [held, stop]);

  if (recording && previewUrl) {
    return (
      <div className="flex min-h-11 flex-wrap items-center gap-2 px-2 py-1.5" role="group" aria-label={t('voiceMessage.preview')}>
        <button
          type="button"
          onClick={onClose}
          className="icon-btn h-10 w-10 flex-shrink-0 desktop:h-8 desktop:w-8"
          aria-label={t('voiceMessage.discard')}
          title={t('voiceMessage.discard')}
        >
          <Icon name="trash" size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <VoiceMessagePlayer url={previewUrl} bars={recording.bars} duration={recording.durationSeconds} />
        </div>
        <button
          type="button"
          onClick={() => onSend(recording)}
          className="btn-primary h-10 w-10 flex-shrink-0 p-0 desktop:h-8 desktop:w-8"
          aria-label={t('voiceMessage.send')}
          title={t('voiceMessage.send')}
        >
          <Icon name="send" size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-11 items-center gap-2 px-2 py-1.5" role="status" aria-label={t('voiceMessage.recording')}>
      <button
        type="button"
        onClick={onClose}
        className="icon-btn h-10 w-10 flex-shrink-0 desktop:h-8 desktop:w-8"
        aria-label={t('voiceMessage.discard')}
        title={t('voiceMessage.discard')}
      >
        <Icon name="trash" size={16} />
      </button>
      <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-full bg-accent-rose motion-safe:animate-pulse" />
      <span className="tabular flex-shrink-0 font-mono text-meta text-txt-secondary">{formatDuration(Math.floor(seconds))}</span>
      <div className="min-w-0 flex-1">
        <VoiceBars bars={levels} progress={1} />
      </div>
      {held ? (
        <span className="flex-shrink-0 text-meta text-txt-tertiary">{t('voiceMessage.release')}</span>
      ) : (
        <button type="button" onClick={() => void stop()} className="btn-primary btn-sm flex-shrink-0">
          {t('voiceMessage.stop')}
        </button>
      )}
    </div>
  );
}
