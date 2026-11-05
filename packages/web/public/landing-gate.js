/*
 * The first thing the prerendered product page runs (site/pages/index.astro), in its <head>, before
 * anything is drawn. It is a plain script that needs nothing else, because it has to be quick and
 * the page's own script comes later.
 *
 * It decides what main.tsx decides for `/` (landing/entry.ts, `showsLanding`): the desktop app, an
 * installed web app and someone who is signed in go to the app, where `/` has always led; a visitor
 * stays. It also tells the stylesheet which device this is (`landingPlatform`), so the page shows
 * the one of its two choices that fits without changing after it is drawn.
 * landing/gate.test.ts holds this file to the rules in landing/entry.ts.
 */
/* global document, navigator, window -- a browser's, as for any page script */
(function () {
  var root = document.documentElement;
  var agent = navigator.userAgent || '';
  root.setAttribute('data-lp-os', /Windows/i.test(agent) ? 'windows' : /Mac|iPhone|iPad/.test(agent) ? 'apple' : 'other');

  var installed = false;
  try {
    installed = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some(function (mode) {
      return window.matchMedia('(display-mode: ' + mode + ')').matches;
    }) || navigator.standalone === true;
  } catch {
    installed = false;
  }

  var signedIn = false;
  try {
    signedIn = window.localStorage.getItem('backspace_token') !== null;
  } catch {
    // Storage can be disabled by browser privacy settings: then nobody is signed in here.
    signedIn = false;
  }

  if (typeof window.backspace !== 'undefined' || installed || signedIn) {
    window.location.replace('/channels/@me' + window.location.search + window.location.hash);
  }
})();
