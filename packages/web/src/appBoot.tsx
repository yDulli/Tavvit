import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { startPendingMessageOrchestrator } from './stores/pendingMessageRehydrate';
import i18n, { initI18n } from './i18n';
import { initializeInterfaceScale } from './platform/interfaceScale';
import { startPointerLight } from './utils/pointerLight';
import { waitForEmojiShortcodeNames } from './utils/emojiShortcodes';
// Profile decorations and their typefaces belong to the app alone, never to the product page's bundle (docs/systems/decorations.md).
import './styles/decorations.css';
import './styles/nameFonts.css';

/**
 * The app's start: what `main.tsx` loads for everyone but a visitor at the front
 * door (see landing/entry.ts).
 */
const stopInterfaceScale = initializeInterfaceScale();
if (import.meta.hot) import.meta.hot.dispose(stopInterfaceScale);
const stopPointerLight = startPointerLight();
if (import.meta.hot) import.meta.hot.dispose(stopPointerLight);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null; showStack: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, showStack: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo.componentStack);
    // Renderer is alive enough to show the fallback UI — disarm the boot timer.
    // Without this, the timer fires 20s after a caught render error and
    // overrides the in-app error UI with native recovery, which is wrong.
    // Gated on VITE_FORCE_BOOT_STALL so the smoke harness can suppress both
    // ping paths simultaneously when testing the renderer-stalled recovery path.
    if (import.meta.env.VITE_FORCE_BOOT_STALL) return;
    if (typeof window.backspace?.rendererReady === 'function') {
      window.backspace.rendererReady();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: 'calc(100*var(--app-vh))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
          color: '#f2f2f2',
          flexDirection: 'column',
          gap: '16px',
          padding: '24px',
        }}>
          <h1 style={{ fontSize: '20px', fontWeight: 600, letterSpacing: '-0.01em' }}>{i18n.t('common:crash.title')}</h1>
          <p style={{ color: '#a8a8a8', maxWidth: '480px', textAlign: 'center' }}>{this.state.error?.message}</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                padding: '8px 18px',
                backgroundColor: '#f2f2f2',
                color: '#000000',
                border: 'none',
                borderRadius: '999px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {i18n.t('common:actions.tryAgain')}
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 18px',
                backgroundColor: 'transparent',
                color: '#a8a8a8',
                border: '1px solid #292929',
                borderRadius: '999px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {i18n.t('common:crash.reload')}
            </button>
          </div>
          {this.state.error?.stack && (
            <details
              open={this.state.showStack}
              onToggle={(e) => this.setState({ showStack: (e.target as HTMLDetailsElement).open })}
              style={{ maxWidth: '600px', width: '100%', marginTop: '8px' }}
            >
              <summary style={{ color: '#a8a8a8', cursor: 'pointer', fontSize: '13px' }}>
                {i18n.t('common:crash.details')}
              </summary>
              <pre style={{
                marginTop: '8px',
                padding: '12px',
                backgroundColor: '#141519',
                border: '1px solid #2c2d34',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#acafba',
                overflow: 'auto',
                maxHeight: '200px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

startPendingMessageOrchestrator();

function render(): void {
  ReactDOM.createRoot(root!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

// The selected language's catalogs are loaded before the first paint, so
// nothing flashes English first. English itself is bundled, so if loading a
// language fails the app still renders, in English, rather than not at all.
// The emoji shortcode names (emoji-mart's data set and Discord's table, each a
// chunk of its own, which main.tsx requests together with this one) load
// alongside, so text renders converted from the first paint. The wait is capped: a chunk that stalls
// must not leave a blank page. Past the cap the app renders with shortcodes as
// written and converts them when the names land; the wait never rejects.
const i18nReady = initI18n()
  .catch((err) => { console.error('[i18n] Failed to initialise, rendering in English:', err); });
const EMOJI_NAMES_MAX_WAIT_MS = 1000;
Promise.all([i18nReady, waitForEmojiShortcodeNames(EMOJI_NAMES_MAX_WAIT_MS)]).finally(render);
