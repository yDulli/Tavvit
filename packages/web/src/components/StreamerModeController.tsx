import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { maskNotifications } from '../platform/notifications';
import { getElectronAPI } from '../platform/platform';
import { useUIStore } from '../stores/uiStore';
import { writePushMask } from '../streamer/pushMask';
import { useStreamerModeStore } from '../streamer/streamerModeStore';

/**
 * Streamer mode beyond the page's own text (docs/systems/streamer-mode.md):
 * what notifications and pushes say while it is on, word when the desktop app
 * turned it on or off, and asking the desktop app to watch for streaming
 * programs for as long as the mode may turn on by itself. Renders nothing.
 */
export function StreamerModeController(): null {
  const { t, i18n } = useTranslation('common');
  const on = useStreamerModeStore((state) => state.on);
  const automatic = useStreamerModeStore((state) => state.automatic);

  // Notifications here and pushes to this device say only that there is one.
  // Unmounting (signing out) leaves the words in place: the mode is still on.
  useEffect(() => {
    const text = on ? { title: t('appName'), body: t('streamerMode.notification') } : null;
    maskNotifications(text);
    writePushMask(text).catch((error: unknown) => {
      console.warn('[streamerMode] the service worker could not be told:', error);
    });
  }, [on, t, i18n.language]);

  // A change the desktop app made is said; one made by hand is seen where it was made.
  useEffect(
    () =>
      useStreamerModeStore.subscribe((state, previous) => {
        if (state.on === previous.on) return;
        if (state.on && state.bySoftware) useUIStore.getState().addToast(t('streamerMode.onBySoftware'), 'info', 5000);
        else if (!state.on && previous.bySoftware) useUIStore.getState().addToast(t('streamerMode.offBySoftware'), 'info', 5000);
      }),
    [t],
  );

  // The desktop app watches for OBS, Streamlabs and XSplit only while asked.
  useEffect(() => {
    const desktop = getElectronAPI();
    if (!desktop?.watchStreamingPrograms || !desktop.onStreamingPrograms) return;
    const { reportStreamingPrograms, forgetStreamingPrograms } = useStreamerModeStore.getState();
    if (!automatic) {
      desktop.watchStreamingPrograms(false).catch(() => {});
      forgetStreamingPrograms();
      return;
    }
    const stopListening = desktop.onStreamingPrograms(reportStreamingPrograms);
    desktop.watchStreamingPrograms(true).then(
      (running) => {
        if (running !== null) reportStreamingPrograms(running);
      },
      () => {},
    );
    return () => {
      stopListening();
    };
  }, [automatic]);

  return null;
}
