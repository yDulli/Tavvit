import React from 'react';
import ReactDOM from 'react-dom/client';
import { initLandingI18n } from './i18n';
import { LandingPage } from './LandingPage';
import './landing.css';

// The app is a fixed frame that scrolls inside its panels; this page is a document
// that scrolls as a whole. The stylesheet changes that for this attribute alone.
document.documentElement.dataset.page = 'landing';

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
