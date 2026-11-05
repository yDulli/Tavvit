import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useInstanceStore } from '../stores/instanceStore';
import { useUIStore } from '../stores/uiStore';

/**
 * Whether a space can be opened right now, asked wherever a space is opened from a list (the top
 * bar's tabs, Home's cards): one on an instance whose connection is out cannot, and a toast says the
 * connection is coming back, instead of opening a space that has nothing to show. A space on the
 * page's own instance always can.
 */
export function useCanOpenSpace(): (space: { _instanceOrigin?: string }) => boolean {
  const { t } = useTranslation('spaces');
  return useCallback((space) => {
    const origin = space._instanceOrigin;
    if (!origin) return true;
    const instance = useInstanceStore.getState().instances.find((entry) => entry.origin === origin);
    if (!instance || (instance.status !== 'disconnected' && instance.status !== 'error')) return true;
    useUIStore.getState().addToast(
      t('sidebar.space.reconnecting', { instance: instance.label || t('sidebar.space.remoteInstance') }),
      'warning',
      4000,
    );
    return false;
  }, [t]);
}
