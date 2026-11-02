import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { wsSendAll } from '../hooks/useWebSocket';
import { useAuthStore } from '../stores/authStore';
import { useNotificationPrefsStore } from '../stores/notificationPrefsStore';
import { windowInFocus } from '../utils/windowFocus';
import { syncPushSubscription } from '../utils/pushSubscription';

/**
 * Headless, in AppLayout. It tells the server whether this window is in front (a person
 * looking at the app gets no push), keeps the device's push registration current, and goes
 * where a tapped notification says.
 */
export function PushController() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    const report = () => wsSendAll({ type: 'client_focus', focused: windowInFocus() });
    document.addEventListener('visibilitychange', report);
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);
    window.addEventListener('pagehide', report);
    return () => {
      document.removeEventListener('visibilitychange', report);
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
      window.removeEventListener('pagehide', report);
    };
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    const sync = () => {
      syncPushSubscription(userId).catch((err: unknown) => console.warn('[push] Could not update this device', err));
    };
    sync();
    return useNotificationPrefsStore.subscribe((state, previous) => {
      if (state.showMessageText !== previous.showMessageText || state.directMessages !== previous.directMessages) sync();
    });
  }, [userId]);

  useEffect(() => {
    const container = navigator.serviceWorker;
    if (!container) return undefined;
    const onMessage = (event: MessageEvent<{ type?: string; path?: unknown }>) => {
      if (event.data?.type !== 'tavvit-open' || typeof event.data.path !== 'string') return;
      if (event.data.path.startsWith('/') && !event.data.path.startsWith('//')) navigate(event.data.path);
    };
    container.addEventListener('message', onMessage);
    return () => container.removeEventListener('message', onMessage);
  }, [navigate]);

  return null;
}
