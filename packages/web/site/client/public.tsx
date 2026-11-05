import { StrictMode, useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { publicPageAt } from '../../src/publicPages/entry';
import { applyStoredPublicLanguage, initPublicPagesI18nEnglish } from '../../src/publicPages/i18n';
import { PublicPage } from '../../src/publicPages/PublicPages';
import type { PublicPagePath } from '../../src/publicPages/entry';

/**
 * The script of a public page the build prerendered (site/pages/[page].astro): it takes the HTML
 * over in English, as the build wrote it, and then shows the visitor's own language.
 */
function TakenOver({ path }: { path: PublicPagePath }): React.JSX.Element {
  useEffect(() => {
    applyStoredPublicLanguage().catch((error: unknown) => {
      console.error('[pages] Could not show the chosen language:', error);
    });
  }, []);
  return <PublicPage path={path} />;
}

initPublicPagesI18nEnglish();

const root = document.getElementById('root');
const path = publicPageAt(window.location.pathname);
if (root && path) {
  hydrateRoot(root, <StrictMode><TakenOver path={path} /></StrictMode>);
}
