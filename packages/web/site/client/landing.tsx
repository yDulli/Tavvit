import { StrictMode, useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { applyStoredLandingLanguage, initLandingI18nEnglish } from '../../src/landing/i18n';
import { LandingPage } from '../../src/landing/LandingPage';

/**
 * The product page's script on the prerendered page (site/pages/index.astro): it takes over the
 * HTML the build wrote instead of drawing the page again. The first render is the build's own
 * (English, nothing from the server yet), and only then does the visitor's language follow.
 *
 * `landing-gate.js` has already sent whoever belongs in the app there before this loads.
 */
function TakenOver(): React.JSX.Element {
  useEffect(() => {
    applyStoredLandingLanguage().catch((error: unknown) => {
      // The page stays in English rather than breaking.
      console.error('[landing] Could not show the chosen language:', error);
    });
  }, []);
  return <LandingPage prerendered />;
}

initLandingI18nEnglish();

const root = document.getElementById('root');
if (root) {
  hydrateRoot(root, <StrictMode><TakenOver /></StrictMode>);
}
