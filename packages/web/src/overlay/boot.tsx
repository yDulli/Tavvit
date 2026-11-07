import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceOverlayPage } from './VoiceOverlayPage';

/**
 * Starts the voice overlay page (docs/systems/voice-overlay.md): transparent all the way down, so
 * OBS lays only the people over the stream, and nothing of the app.
 */
document.documentElement.classList.add('voice-overlay-page');
document.title = 'Tavvit overlay'; // i18n-check: allow-literal (a browser source's title nobody reads)

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <VoiceOverlayPage />
    </StrictMode>,
  );
}
