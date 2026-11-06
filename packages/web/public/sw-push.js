/*
 * Imported into the generated service worker (vite.config.ts, `workbox.importScripts`).
 * It shows a push message while the app is closed, and brings the app to it on a tap.
 * docs/systems/push.md. A browser takes a push that shows nothing as a reason to stop
 * delivering them, so whatever arrives shows something.
 */
(function registerPush(scope) {
  /*
   * While streamer mode is on, the page leaves the words a push may say in IndexedDB
   * (src/streamer/pushMask.ts), and they stand in for the message's: a stream captures
   * the whole screen, notifications included. Anything unreadable counts as not set.
   */
  function readStreamerMask() {
    return new Promise((resolve) => {
      let request;
      try {
        request = scope.indexedDB.open('tavvit-device', 1);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('flags')) request.result.createObjectStore('flags');
      };
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const read = db.transaction('flags', 'readonly').objectStore('flags').get('streamerMode');
          read.onsuccess = () => {
            db.close();
            const mask = read.result;
            resolve(mask && typeof mask.title === 'string' && typeof mask.body === 'string' ? mask : null);
          };
          read.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
    });
  }

  scope.addEventListener('push', (event) => {
    let message = {};
    try {
      message = event.data ? event.data.json() : {};
    } catch (error) {
      console.warn('[sw-push] Could not read a push message', error);
    }
    event.waitUntil(readStreamerMask().then((mask) => scope.registration.showNotification(mask ? mask.title : (message.title || 'Tavvit'), {
      body: mask ? mask.body : (typeof message.body === 'string' ? message.body : ''),
      tag: typeof message.tag === 'string' ? message.tag : undefined,
      icon: '/icons/icon-192.png',
      data: { url: typeof message.url === 'string' ? message.url : '/' },
    })));
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
