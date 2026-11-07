import './styles/globals.css';
import { showsLanding } from './landing/entry';
import { showsPublicPage } from './publicPages/entry';
import { showsOverlay } from './overlay/entry';

/**
 * The page's only script. It decides what this page load is and fetches just
 * that: the public product page for a visitor, a public page such as the status for
 * anyone, a stream's voice overlay for OBS, the app for everyone else. Nothing here may import the app, or a visitor
 * downloads all of it for a page of text.
 */

/** A chunk could not be fetched (no network, or a build replaced mid-load). */
function showLoadFailure(error: unknown): void {
  console.error('[boot] Could not load the page:', error);
  const root = document.getElementById('root');
  if (!root) return;
  const message = document.createElement('p');
  message.className = 'empty-state-body';
  message.textContent = 'Tavvit could not load. Check your connection and try again.'; // i18n-check: allow-literal (shown when no catalog could load)
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn-primary mt-3';
  retry.textContent = 'Reload'; // i18n-check: allow-literal (shown when no catalog could load)
  retry.addEventListener('click', () => window.location.reload());
  const frame = document.createElement('div');
  frame.className = 'empty-state h-full';
  frame.append(message, retry);
  root.replaceChildren(frame);
}

function startApp(): Promise<unknown> {
  // The app waits for the emoji names before its first render, and they are chunks
  // of their own. Asked for together with the app they arrive with it, not a
  // round trip later; a failure here is the app's to handle when it asks itself.
  void import('@emoji-mart/data').catch(() => {});
  void import('./utils/discordEmojiAliases').catch(() => {});
  return import('./appBoot');
}

function startPage(): Promise<unknown> {
  if (showsLanding()) return import('./landing/boot');
  if (showsPublicPage()) return import('./publicPages/boot');
  if (showsOverlay()) return import('./overlay/boot');
  return startApp();
}

startPage().catch(showLoadFailure);
