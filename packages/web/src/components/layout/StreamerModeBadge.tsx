import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useStreamerMode } from '../../streamer/streamerModeStore';
import { Icon } from '../ui/Icon';

/**
 * Says that streamer mode is on, at the right of the top bar, for as long as
 * it is (docs/systems/streamer-mode.md). Violet: an active state of the app's
 * own. A click opens the mode's settings rather than turning it off, so a
 * stray click in the middle of a stream shows nothing it hides.
 */
export function StreamerModeBadge() {
  const { t } = useTranslation('common');
  const on = useStreamerMode();
  const openModal = useUIStore((state) => state.openModal);
  if (!on) return null;
  return (
    <button
      type="button"
      onClick={() => openModal('userSettings', { tab: 'privacy' })}
      aria-label={t('streamerMode.badgeLabel')}
      data-tooltip=""
      className="mr-1 flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md border border-accent-primary/30 bg-accent-primary/10 px-2 text-label font-medium text-accent-soft transition-colors duration-100 hover:bg-accent-primary/15 active:bg-accent-primary/20 compact:px-1.5"
    >
      <Icon name="eye-off" size={14} className="flex-shrink-0" />
      <span className="compact:hidden">{t('streamerMode.badge')}</span>
    </button>
  );
}
