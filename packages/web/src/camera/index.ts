import type { ActiveBackground } from './backgrounds';
import { loadOwnImage } from './ownImage';
import { SCENE_PICTURES } from './scenes';

export type { CameraBackgroundProcessor, BackgroundPreview } from './processor';

type ProcessorModule = typeof import('./processor');

let loading: Promise<ProcessorModule> | null = null;

/**
 * The processor's code (LiveKit's track processors and MediaPipe's
 * JavaScript, about 50 KB compressed) in a chunk of its own, loaded the first
 * time a background is used. A failed load is tried again next time.
 */
export function loadBackgroundProcessor(): Promise<ProcessorModule> {
  if (!loading) {
    loading = import('./processor');
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** A background ready for the processor: the one chosen, or the one standing in for it. */
export interface ResolvedBackground {
  background: ActiveBackground;
  /** The scene's or the person's picture; null for a blur. */
  image: string | null;
  /**
   * True when the chosen background could not be used as it is: the person's
   * own picture is no longer on this device. The room is then blurred
   * strongly instead, never shown.
   */
  substituted: boolean;
}

const STAND_IN: ActiveBackground = { kind: 'blur', strength: 'strong' };

export async function resolveBackground(background: ActiveBackground): Promise<ResolvedBackground> {
  switch (background.kind) {
    case 'blur':
      return { background, image: null, substituted: false };
    case 'scene':
      return { background, image: SCENE_PICTURES[background.scene].image, substituted: false };
    case 'own': {
      const image = await loadOwnImage();
      return image ? { background, image, substituted: false } : { background: STAND_IN, image: null, substituted: true };
    }
  }
}
