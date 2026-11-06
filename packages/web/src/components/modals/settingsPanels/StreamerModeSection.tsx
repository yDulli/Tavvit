import { useTranslation } from 'react-i18next';
import { getElectronAPI } from '../../../platform/platform';
import { useKeybindStore } from '../../../stores/keybindStore';
import { useUIStore } from '../../../stores/uiStore';
import { useStreamerModeStore } from '../../../streamer/streamerModeStore';
import { Icon } from '../../ui/Icon';
import { SettingsSection, ToggleRow } from './_shared/SettingsControls';

/** What streamer mode hides, in the order the settings name it (docs/systems/streamer-mode.md). */
const HIDES = ['email', 'invites', 'instances', 'twoFactor', 'sessions', 'tokens', 'notes', 'notifications'] as const;

/**
 * Streamer mode's switches: on and off, and, in the desktop app, on by itself
 * while OBS, Streamlabs or XSplit runs. Says what it hides and which shortcut
 * turns it on and off. All of it is this device's.
 */
export function StreamerModeSection() {
  const { t } = useTranslation('settings');
  const on = useStreamerModeStore((state) => state.on);
  const automatic = useStreamerModeStore((state) => state.automatic);
  const setOn = useStreamerModeStore((state) => state.setOn);
  const setAutomatic = useStreamerModeStore((state) => state.setAutomatic);
  const openModal = useUIStore((state) => state.openModal);
  const shortcut = useKeybindStore((state) => state.keybinds.find((keybind) => keybind.actionId === 'toggleStreamerMode')?.displayLabel ?? null);
  const watchesPrograms = typeof getElectronAPI()?.watchStreamingPrograms === 'function';

  return (
    <SettingsSection title={t('privacy.streamer.title')} description={t('privacy.streamer.description')}>
      <ToggleRow label={t('privacy.streamer.on')} enabled={on} onChange={setOn} />
      {watchesPrograms ? (
        <ToggleRow
          label={t('privacy.streamer.automatic')}
          description={t('privacy.streamer.automaticDescription')}
          enabled={automatic}
          onChange={setAutomatic}
        />
      ) : (
        <p className="text-meta leading-snug text-txt-tertiary">{t('privacy.streamer.automaticDesktopOnly')}</p>
      )}
      <div>
        <div className="text-ui font-medium text-txt-primary">{t('privacy.streamer.hidesTitle')}</div>
        <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 desktop:grid-cols-2">
          {HIDES.map((key) => (
            <li key={key} className="flex items-start gap-2 text-meta leading-snug text-txt-secondary">
              <Icon name="eye-off" size={13} className="mt-0.5 flex-shrink-0 text-txt-tertiary" />
              <span>{t(`privacy.streamer.hides.${key}`)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-meta leading-snug text-txt-tertiary">
        {shortcut ? t('privacy.streamer.shortcut', { keys: shortcut }) : t('privacy.streamer.noShortcut')}{' '}
        <button type="button" onClick={() => openModal('userSettings', { tab: 'keybinds' })} className="text-accent-soft hover:underline">
          {t('privacy.streamer.setShortcut')}
        </button>
      </p>
    </SettingsSection>
  );
}
