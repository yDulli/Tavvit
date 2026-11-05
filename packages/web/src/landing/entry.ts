import { isElectron } from '../platform/platform';

/**
 * Who sees the public product page, decided before any other code loads, so a
 * visitor is not sent the whole app and a member is not shown an advert. It has
 * to stay free of the app's modules: the stores in particular are most of what a
 * visitor is being spared.
 *
 * The product page is for someone who came to the address in a browser and is
 * not signed in. The desktop app and an installed web app start in the app: both
 * are already past the question of what Tavvit is, and the desktop shell waits
 * for a signal only the app sends.
 */

/** Where the session token lives; `stores/authStore.ts` reads and writes the same key. */
export const SESSION_TOKEN_KEY = 'backspace_token';

/** Every way a browser shows a web app that was installed, as opposed to a tab. */
export const INSTALLED_DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'] as const;

export function hasStoredSession(): boolean {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY) !== null;
  } catch {
    // Storage can be disabled by browser privacy settings: then nobody is signed in here.
    return false;
  }
}

function isInstalledWebApp(): boolean {
  const matchesMode = INSTALLED_DISPLAY_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
  // iOS Safari reports an app on the home screen only through this flag.
  return matchesMode || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * What the page offers by device: the Windows download in the opening and Apple's Command key on the
 * switcher, or the general choice. The page's HTML holds both and the stylesheet shows one by
 * `data-lp-os` on `<html>`; `public/landing-gate.js` sets it on the prerendered page, before the first
 * paint, with the same rules (landing/gate.test.ts).
 */
export type LandingPlatform = 'windows' | 'apple' | 'other';

export function landingPlatform(userAgent: string): LandingPlatform {
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Mac|iPhone|iPad/.test(userAgent)) return 'apple';
  return 'other';
}

/** True when this page load is a visitor at the front door. */
export function showsLanding(): boolean {
  if (window.location.pathname !== '/') return false;
  if (isElectron()) return false;
  if (isInstalledWebApp()) return false;
  return !hasStoredSession();
}
