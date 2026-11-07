import { voiceOverlaySecretOf } from '@backspace/shared/src/voiceOverlay';

/**
 * Whether this page load is a voice overlay (docs/systems/voice-overlay.md): the page an OBS
 * browser source opens at `/overlay/voice/<secret>`. Decided before anything else loads, like the
 * product page, so a stream's browser source fetches only the overlay and never the app.
 */
export function showsOverlay(): boolean {
  return voiceOverlaySecretOf(window.location.pathname) !== null;
}
