import { createElement, StrictMode, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { SitePublicPath } from '@backspace/shared/src/site.js';
import { initLandingI18nEnglish } from '../src/landing/i18n';
import { LandingPage } from '../src/landing/LandingPage';
import { initPublicPagesI18nEnglish } from '../src/publicPages/i18n';
import { PublicPage } from '../src/publicPages/PublicPages';

/**
 * The website's pages as HTML, rendered while the web package is built (site/pages/*.astro).
 *
 * Each is the same React tree the page's script renders when it takes the HTML over
 * (site/client/*.tsx), in English and with nothing the server has said yet, so the two agree to the
 * last character: what differs by visitor (their language, the instance's facts, their device) is
 * filled in afterwards, or, for the device, already in the HTML and chosen by the stylesheet.
 *
 * Each page gets an i18next instance of its own: the build renders the pages one after another in
 * one process, and they have different catalogs.
 */
function render(element: ReactElement, setUp: (instance: ReturnType<typeof createInstance>) => void): string {
  const i18n = createInstance();
  setUp(i18n);
  return renderToString(createElement(StrictMode, null, createElement(I18nextProvider, { i18n }, element)));
}

export function renderLanding(): string {
  return render(createElement(LandingPage, { prerendered: true }), initLandingI18nEnglish);
}

export function renderPublicPage(path: SitePublicPath): string {
  return render(createElement(PublicPage, { path }), initPublicPagesI18nEnglish);
}
