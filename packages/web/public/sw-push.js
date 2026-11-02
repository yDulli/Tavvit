/*
 * Imported into the generated service worker (vite.config.ts, `workbox.importScripts`).
 * It shows a push message while the app is closed, and brings the app to it on a tap.
 * docs/systems/push.md. A browser takes a push that shows nothing as a reason to stop
 * delivering them, so whatever arrives shows something.
 */
(function registerPush(scope) {
  scope.addEventListener('push', (event) => {
    let message = {};
    try {
      message = event.data ? event.data.json() : {};
    } catch (error) {
      console.warn('[sw-push] Could not read a push message', error);
    }
    event.waitUntil(scope.registration.showNotification(message.title || 'Tavvit', {
      body: typeof message.body === 'string' ? message.body : '',
      tag: typeof message.tag === 'string' ? message.tag : undefined,
      icon: '/icons/icon-192.png',
      data: { url: typeof message.url === 'string' ? message.url : '/' },
    }));
  });

  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = event.notification.data && event.notification.data.url;
    // Only ever a place in this app.
    const path = typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') ? target : '/';
    event.waitUntil(scope.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          client.postMessage({ type: 'tavvit-open', path });
          // A browser may refuse the focus; the window has already been told where to go.
          return client.focus().catch(() => undefined);
        }
      }
      return scope.clients.openWindow(path);
    }));
  });
})(self);
