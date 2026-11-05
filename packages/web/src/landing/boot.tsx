import React from 'react';
import ReactDOM from 'react-dom/client';
import { landingPlatform } from './entry';
import { initLandingI18n } from './i18n';
import { LandingPage } from './LandingPage';
import './landing.css';

// The app is a fixed frame that scrolls inside its panels; this page is a document
// that scrolls as a whole. The stylesheet changes that for this attribute alone.
document.documentElement.dataset.page = 'landing';
// Which of the page's two choices by device shows (the Windows download, the Command key).
document.documentElement.dataset.lpOs = landingPlatform(navigator.userAgent);

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// Whatever goes wrong with the language, the page still renders rather than stays blank.
void initLandingI18n()
  .catch((error: unknown) => { console.error('[landing] Could not set up the language:', error); })
  .finally(() => {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <LandingPage />
      </React.StrictMode>,
    );
  });
