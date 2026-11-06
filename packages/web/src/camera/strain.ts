import { create } from 'zustand';

/**
 * Whether laying the background costs this device more time than a frame has.
 * The processor reports how long each frame took (`onFrameProcessed`); when
 * the frames keep taking longer than the camera's 30 frames a second allow,
 * the picture stutters, and the picker says so and suggests a lighter choice.
 *
 * A running average over about a second of frames decides, with a gap between
 * the two thresholds so the note does not flicker on and off at the border.
 */

/** A frame at 30 frames a second has 33 ms; past this, frames are being dropped. */
export const STRAINED_ABOVE_MS = 30;
/** Back under this, the device keeps up again. */
export const EASED_BELOW_MS = 22;
/** Frames measured before anything is said: the first ones include warming up. */
export const FRAMES_BEFORE_JUDGING = 45;
/** Weight of the newest frame in the running average (about the last 30 frames). */
const SMOOTHING = 1 / 30;

interface StrainState {
  strained: boolean;
}

export const useCameraStrain = create<StrainState>(() => ({ strained: false }));

/** Fed one processor's frame times; a new processor starts a new meter. */
export interface StrainMeter {
  onFrame(processingTimeMs: number): void;
  /** The processor stopped: nothing is strained any more. */
  stop(): void;
}

export function createStrainMeter(): StrainMeter {
  let frames = 0;
  let average = 0;
  let stopped = false;
  return {
    onFrame(processingTimeMs) {
      if (stopped || !Number.isFinite(processingTimeMs) || processingTimeMs < 0) return;
      frames += 1;
      average = frames === 1 ? processingTimeMs : average + (processingTimeMs - average) * SMOOTHING;
      if (frames < FRAMES_BEFORE_JUDGING) return;
      const { strained } = useCameraStrain.getState();
      if (!strained && average > STRAINED_ABOVE_MS) useCameraStrain.setState({ strained: true });
      else if (strained && average < EASED_BELOW_MS) useCameraStrain.setState({ strained: false });
    },
    stop() {
      stopped = true;
      if (useCameraStrain.getState().strained) useCameraStrain.setState({ strained: false });
    },
  };
}
