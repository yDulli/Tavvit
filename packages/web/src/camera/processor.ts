import {
  BackgroundProcessorWrapper,
  BackgroundTransformer,
  type SwitchBackgroundProcessorOptions,
  type TrackTransformerDestroyOptions,
} from '@livekit/track-processors';
import { Track, type ProcessorOptions } from 'livekit-client';
import { VISION_WASM_BASE } from 'virtual:vision-assets';
import { BLUR_RADIUS, backgroundKey, type ActiveBackground } from './backgrounds';
import { CameraBackgroundFailed } from './errors';
import modelUrl from './selfie_segmenter.tflite?url';
import { createStrainMeter, type StrainMeter } from './strain';

/**
 * The part of the camera backgrounds that does the work, loaded only when a
 * background is in use (`loadBackgroundProcessor` in `index.ts`): LiveKit's
 * processor, which finds the person with MediaPipe's selfie segmenter and
 * blurs or replaces everything else, on this device.
 *
 * The model is a file of the app's own (`selfie_segmenter.tflite`, Apache-2.0,
 * see NOTICE), and the WebAssembly comes from the app's own server
 * (`VISION_WASM_BASE`): nothing loads from anywhere else.
 */

/**
 * LiveKit's transformer passes the camera's very first frame on untouched,
 * so the picture is not blank while the first segmentation runs. That frame
 * would show the room the person chose to hide, to everyone in the call. This
 * one never does: nothing leaves until a frame has its background.
 */
class SealedBackgroundTransformer extends BackgroundTransformer {
  override async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>): Promise<void> {
    this.isFirstFrame = false;
    await super.transform(frame, controller);
  }
}

/** Where the segmenter runs: the graphics card, or the processor when the card will not. */
export type Delegate = 'GPU' | 'CPU';

/** What the processor does: one of LiveKit's modes, never `disabled` (the room as it is needs no processor). */
type BackgroundMode = Exclude<SwitchBackgroundProcessorOptions, { mode: 'disabled' }>;

function modeOf(background: ActiveBackground, image: string | null): BackgroundMode {
  if (background.kind === 'blur') return { mode: 'background-blur', blurRadius: BLUR_RADIUS[background.strength] };
  if (image === null) throw new Error(`the ${background.kind} background has no picture`);
  return { mode: 'virtual-background', imagePath: image };
}

let made = 0;

/** One camera's background: a processor for a LiveKit track or for the settings' preview. */
export class CameraBackgroundProcessor extends BackgroundProcessorWrapper {
  readonly delegate: Delegate;
  private readonly meter: StrainMeter;
  private shown: string;
  private changes: Promise<void> = Promise.resolve();

  constructor(background: ActiveBackground, image: string | null, delegate: Delegate) {
    const meter = createStrainMeter();
    const mode = modeOf(background, image);
    made += 1;
    super(
      new SealedBackgroundTransformer({
        ...(mode.mode === 'background-blur' ? { blurRadius: mode.blurRadius } : { imagePath: mode.imagePath }),
        segmenterOptions: { delegate },
        assetPaths: { tasksVisionFileSet: VISION_WASM_BASE, modelAssetPath: modelUrl },
        onFrameProcessed: (stats) => meter.onFrame(stats.processingTimeMs),
      }),
      // Each its own name: the fallback for browsers without track processors
      // finds its canvas by it, and two processors must not share one.
      `tavvit-camera-background-${made}`,
    );
    this.delegate = delegate;
    this.meter = meter;
    this.shown = `${backgroundKey(background)}|${image ?? ''}`;
  }

  /**
   * Changes the background without starting over; does nothing when it is the
   * one shown. One change at a time, in the order asked: a scene's picture
   * loads while the next click comes in, and the last click must win.
   */
  show(background: ActiveBackground, image: string | null): Promise<void> {
    const change = async () => {
      const key = `${backgroundKey(background)}|${image ?? ''}`;
      if (key === this.shown) return;
      await this.switchTo(modeOf(background, image));
      this.shown = key;
    };
    const next = this.changes.then(change, change);
    this.changes = next.catch(() => {});
    return next;
  }

  override async init(options: ProcessorOptions<Track.Kind>): Promise<void> {
    try {
      await super.init(options);
    } catch (error) {
      this.abandon();
      throw error;
    }
  }

  override async destroy(options?: TrackTransformerDestroyOptions): Promise<void> {
    // A restart (the camera coming back on) keeps measuring.
    if (!options?.willProcessorRestart) this.meter.stop();
    await super.destroy(options);
  }

  /**
   * After an `init` that failed half way: `destroy` only takes down a
   * processor that ran, so what the failed start made is let go here.
   */
  private abandon(): void {
    this.meter.stop();
    this.processedTrack?.stop();
    const generator: unknown = this.trackGenerator;
    if (generator instanceof MediaStreamTrack) generator.stop();
    this.displayCanvas?.remove();
  }
}

export function isCameraBackgroundProcessor(value: unknown): value is CameraBackgroundProcessor {
  return value instanceof CameraBackgroundProcessor;
}

/**
 * Makes a processor and lets `start` put it to work (`track.setProcessor`, or
 * `init` for a preview). If that fails on the graphics card, it tries once
 * more without it; if that fails too, it throws `CameraBackgroundFailed` and
 * nothing is left running.
 */
export async function startBackgroundProcessor(
  background: ActiveBackground,
  image: string | null,
  start: (processor: CameraBackgroundProcessor) => Promise<void>,
): Promise<CameraBackgroundProcessor> {
  let failure: unknown = null;
  for (const delegate of ['GPU', 'CPU'] as const) {
    const processor = new CameraBackgroundProcessor(background, image, delegate);
    try {
      await start(processor);
      return processor;
    } catch (error) {
      failure = error;
      await processor.destroy().catch(() => {});
    }
  }
  throw new CameraBackgroundFailed(failure);
}

/** A preview of the camera with its background, for the settings: no call, nothing sent. */
export interface BackgroundPreview {
  processor: CameraBackgroundProcessor;
  /** The picture with its background, to show in the preview. */
  output: MediaStreamTrack;
  stop(): Promise<void>;
}

export async function startBackgroundPreview(camera: MediaStreamTrack, background: ActiveBackground, image: string | null): Promise<BackgroundPreview> {
  // The processor reads the camera's size from a playing element, as it does
  // for a LiveKit track (whose element LiveKit makes the same way).
  const element = document.createElement('video');
  element.muted = true;
  element.playsInline = true;
  element.srcObject = new MediaStream([camera]);
  void element.play().catch(() => {});
  try {
    const processor = await startBackgroundProcessor(background, image, (candidate) =>
      candidate.init({ kind: Track.Kind.Video, track: camera, element }),
    );
    const output = processor.processedTrack;
    if (!output) {
      await processor.destroy();
      throw new CameraBackgroundFailed(new Error('the processor gave no picture'));
    }
    return {
      processor,
      output,
      async stop() {
        await processor.destroy();
        output.stop();
        element.srcObject = null;
      },
    };
  } catch (error) {
    element.srcObject = null;
    throw error;
  }
}

let prefetched = false;

/**
 * Fetches what the processor will need, so the first time the camera goes on
 * with a background it does not wait for 9 MB. The browser keeps the files
 * (the server marks them immutable); once per page is enough.
 */
export function prefetchBackgroundAssets(): void {
  if (prefetched) return;
  prefetched = true;
  for (const url of [`${VISION_WASM_BASE}/vision_wasm_internal.js`, `${VISION_WASM_BASE}/vision_wasm_internal.wasm`, modelUrl]) {
    void fetch(url, { credentials: 'same-origin' })
      .then((response) => response.arrayBuffer())
      .catch(() => {});
  }
}
