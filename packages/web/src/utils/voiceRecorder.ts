import { VOICE_MESSAGE_LIMITS } from '@backspace/shared/src/voiceMessages';

export interface VoiceRecording {
  blob: Blob;
  fileName: string;
  durationSeconds: number;
  bars: number[];
}

/**
 * What a browser can record, in the order to prefer. The extension is what tells the server
 * it is audio: `.webm` would read as a video. An iPhone only offers `audio/mp4`.
 */
const FORMATS = [
  { mimeType: 'audio/webm;codecs=opus', extension: '.weba' },
  { mimeType: 'audio/webm', extension: '.weba' },
  { mimeType: 'audio/mp4', extension: '.m4a' },
  { mimeType: 'audio/ogg;codecs=opus', extension: '.ogg' },
] as const;

const SAMPLE_MS = 100;
const SHORTEST_BAR = 4;

function supportedFormat(): (typeof FORMATS)[number] | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return FORMATS.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? null;
}

export function voiceRecordingSupported(): boolean {
  return supportedFormat() !== null && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** The loudness over time as a fixed number of bars, scaled so the loudest is full height. */
export function barsFromLevels(levels: readonly number[], count: number = VOICE_MESSAGE_LIMITS.MAX_BARS): number[] {
  if (levels.length === 0) return [SHORTEST_BAR];
  const bars = Math.min(count, levels.length);
  const averages: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor((bar * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * levels.length) / bars));
    let sum = 0;
    for (let at = from; at < to; at += 1) sum += levels[at] ?? 0;
    averages.push(sum / (to - from));
  }
  const loudest = Math.max(...averages);
  return averages.map((value) => {
    const scaled = loudest > 0 ? Math.round((value / loudest) * VOICE_MESSAGE_LIMITS.MAX_BAR) : 0;
    return Math.max(SHORTEST_BAR, scaled);
  });
}

/** One recording from the microphone. Nothing leaves the device until the person sends it. */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sampler: ReturnType<typeof setInterval> | null = null;
  private readonly chunks: Blob[] = [];
  private readonly levels: number[] = [];
  private startedAt = 0;
  private extension: string = FORMATS[0].extension;

  /** Rejects when the browser cannot record or the person refused the microphone. */
  async start(): Promise<void> {
    const format = supportedFormat();
    if (!format) throw new Error('recording_unsupported');
    this.extension = format.extension;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.recorder = new MediaRecorder(this.stream, { mimeType: format.mimeType });
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });

    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.context.createMediaStreamSource(this.stream).connect(this.analyser);
    this.sampler = setInterval(() => this.levels.push(this.level()), SAMPLE_MS);

    this.startedAt = Date.now();
    this.recorder.start(250);
  }

  /** How loud it is now, from 0 to 1. */
  level(): number {
    if (!this.analyser) return 0;
    const samples = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const centred = (sample - 128) / 128;
      sum += centred * centred;
    }
    return Math.min(1, Math.sqrt(sum / samples.length) * 2.5);
  }

  elapsedSeconds(): number {
    return this.startedAt === 0 ? 0 : (Date.now() - this.startedAt) / 1000;
  }

  /** Ends it and hands over the result. */
  stop(): Promise<VoiceRecording> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === 'inactive') {
        reject(new Error('not_recording'));
        return;
      }
      const durationSeconds = this.elapsedSeconds();
      recorder.addEventListener('stop', () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType.split(';')[0] });
        const bars = barsFromLevels(this.levels);
        this.release();
        resolve({ blob, fileName: `voice-message${this.extension}`, durationSeconds, bars });
      }, { once: true });
      recorder.stop();
    });
  }

  /** Ends it and forgets it. Safe to call at any point. */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
  }

  private release(): void {
    if (this.sampler) clearInterval(this.sampler);
    this.sampler = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.analyser = null;
    this.recorder = null;
  }
}
