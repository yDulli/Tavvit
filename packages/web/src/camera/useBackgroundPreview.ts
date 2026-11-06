import { useEffect, useRef, useState } from 'react';
import { useVoiceStore } from '../stores/voiceStore';
import { backgroundKey, isActiveBackground } from './backgrounds';
import { loadBackgroundProcessor, resolveBackground, type BackgroundPreview } from './index';
import { useOwnImage } from './ownImage';
import { cameraBackgroundsSupported } from './support';

export type BackgroundPreviewStatus = 'off' | 'preparing' | 'ready' | 'failed';

export interface BackgroundPreviewState {
  /** The picture with its background, once there is one. */
  output: MediaStreamTrack | null;
  status: BackgroundPreviewStatus;
}

const OFF: BackgroundPreviewState = { output: null, status: 'off' };

/**
 * The settings' camera preview with the chosen background. While `camera`
 * (the preview's own camera track, never a call's) runs and a background is
 * chosen, a processor makes the picture to show; changing the background
 * changes it in place. Nothing is sent anywhere.
 */
export function useBackgroundPreview(camera: MediaStreamTrack | null): BackgroundPreviewState {
  const background = useVoiceStore((s) => s.cameraBackground);
  const ownImage = useOwnImage((s) => s.url);
  const active = camera !== null && isActiveBackground(background) && cameraBackgroundsSupported();
  const [state, setState] = useState<BackgroundPreviewState>(OFF);
  const previewRef = useRef<BackgroundPreview | null>(null);

  // Start a processor for this camera when a background is wanted; stop it
  // with the camera, or when the room is to be seen as it is again.
  useEffect(() => {
    if (!active || !camera) {
      setState(OFF);
      return;
    }
    let cancelled = false;
    setState({ output: null, status: 'preparing' });
    void (async () => {
      const chosen = useVoiceStore.getState().cameraBackground;
      if (!isActiveBackground(chosen)) return;
      const processors = await loadBackgroundProcessor();
      const { background: shown, image } = await resolveBackground(chosen);
      if (cancelled) return;
      const preview = await processors.startBackgroundPreview(camera, shown, image);
      if (cancelled) {
        await preview.stop();
        return;
      }
      previewRef.current = preview;
      setState({ output: preview.output, status: 'ready' });
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.error('[camera] background preview failed:', error);
      setState({ output: null, status: 'failed' });
    });
    return () => {
      cancelled = true;
      const preview = previewRef.current;
      previewRef.current = null;
      void preview?.stop();
    };
  }, [active, camera]);

  // Another background, or a new own picture: change the running one in place.
  const key = backgroundKey(background);
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || state.status !== 'ready') return;
    const chosen = useVoiceStore.getState().cameraBackground;
    if (!isActiveBackground(chosen)) return;
    void resolveBackground(chosen)
      .then(({ background: shown, image }) => preview.processor.show(shown, image))
      .catch((error: unknown) => console.error('[camera] background change failed:', error));
  }, [key, ownImage, state.status]);

  return state;
}
