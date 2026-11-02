import React from 'react';
import ReactDOM from 'react-dom/client';
import { publicPageAt } from './entry';
import { initPublicPagesI18n } from './i18n';
import { PublicPage } from './PublicPages';

// A document that scrolls as a whole, like the product page.
document.documentElement.dataset.page = 'landing';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
const path = publicPageAt(window.location.pathname) ?? '/help';

// Whatever goes wrong with the language, the page still renders rather than stays blank.
void initPublicPagesI18n()
  .catch((error: unknown) => { console.error('[pages] Could not set up the language:', error); })
  .finally(() => {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <PublicPage path={path} />
      </React.StrictMode>,
    );
  });
