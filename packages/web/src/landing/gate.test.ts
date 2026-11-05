import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INSTALLED_DISPLAY_MODES, SESSION_TOKEN_KEY, landingPlatform } from './entry';

/**
 * `public/landing-gate.js` is the prerendered product page's first script: a plain file, because it
 * runs in the <head> before anything is drawn. It must decide as `showsLanding` does and name the
 * device as `landingPlatform` does, so it is run here against stand-ins for the browser.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../public/landing-gate.js'), 'utf8');

interface Situation {
  token?: string;
  desktop?: boolean;
  displayMode?: string;
  iosStandalone?: boolean;
  userAgent?: string;
  storageThrows?: boolean;
  search?: string;
  hash?: string;
}

function runGate(situation: Situation): { replacedWith: string | null; platform: string | null } {
  let replacedWith: string | null = null;
  const attributes = new Map<string, string>();
  const fakeWindow: Record<string, unknown> = {
    matchMedia: (query: string) => ({ matches: situation.displayMode !== undefined && query === `(display-mode: ${situation.displayMode})` }),
    localStorage: {
      getItem: (key: string) => {
        if (situation.storageThrows) throw new Error('SecurityError');
        return key === SESSION_TOKEN_KEY ? situation.token ?? null : null;
      },
    },
    location: {
      search: situation.search ?? '',
      hash: situation.hash ?? '',
      replace: (url: string) => { replacedWith = url; },
    },
  };
  if (situation.desktop) fakeWindow.backspace = { platform: 'win32' };
  const fakeDocument = { documentElement: { setAttribute: (name: string, value: string) => { attributes.set(name, value); } } };
  const fakeNavigator = { userAgent: situation.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64)', standalone: situation.iosStandalone };
  // The script's free names are the parameters here, so it runs against the stand-ins alone.
  new Function('window', 'document', 'navigator', source)(fakeWindow, fakeDocument, fakeNavigator);
  return { replacedWith, platform: attributes.get('data-lp-os') ?? null };
}

describe('landing-gate.js', () => {
  it('leaves a visitor on the page', () => {
    expect(runGate({}).replacedWith).toBeNull();
  });

  it('sends someone signed in to the app, keeping what the address carried', () => {
    expect(runGate({ token: 'a.b.c' }).replacedWith).toBe('/channels/@me');
    expect(runGate({ token: 'a.b.c', search: '?x=1', hash: '#y' }).replacedWith).toBe('/channels/@me?x=1#y');
  });

  it('sends the desktop app and every kind of installed web app to the app', () => {
    expect(runGate({ desktop: true }).replacedWith).toBe('/channels/@me');
    for (const mode of INSTALLED_DISPLAY_MODES) expect(runGate({ displayMode: mode }).replacedWith, mode).toBe('/channels/@me');
    expect(runGate({ iosStandalone: true }).replacedWith).toBe('/channels/@me');
    expect(runGate({ displayMode: 'browser' }).replacedWith).toBeNull();
  });

  it('takes storage it may not read as nobody signed in, as entry.ts does', () => {
    expect(runGate({ storageThrows: true }).replacedWith).toBeNull();
  });

  it('names the device as landingPlatform does', () => {
    for (const agent of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)',
      'Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0',
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/131.0 Mobile',
    ]) {
      expect(runGate({ userAgent: agent }).platform, agent).toBe(landingPlatform(agent));
    }
  });

  it('reads the same key the app signs in with', () => {
    expect(source).toContain(`'${SESSION_TOKEN_KEY}'`);
  });
});
