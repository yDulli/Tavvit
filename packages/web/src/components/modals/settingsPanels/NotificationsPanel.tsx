import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveChannelNotificationPolicy, isSpaceDefaultNotificationLevel } from '@backspace/shared';
import { useFormatters } from '../../../i18n/formatters';
import {
  notificationPermission,
  requestNotificationPermission,
  sendNotification,
  type NotificationPermissionState,
} from '../../../platform/notifications';
import { useNotificationPrefsStore } from '../../../stores/notificationPrefsStore';
import { selectNotificationSetting, useNotificationSettingsStore } from '../../../stores/notificationSettingsStore';
import { useSpaceStore, type TaggedSpace } from '../../../stores/spaceStore';
import { useVoiceStore } from '../../../stores/voiceStore';
import { NotificationSettingsModal } from '../../notifications/NotificationSettingsModal';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { SettingsPage, SettingsSection, SliderRow, ToggleRow } from './_shared/SettingsControls';
import { PushSection } from './PushSection';
import { KeywordsSection } from './KeywordsSection';

/** Whether this device may show notifications at all, and the one way to allow it. */
function DeviceSection() {
  const { t } = useTranslation(['settings', 'common']);
  const [permission, setPermission] = useState<NotificationPermissionState>(() => notificationPermission());
  const line = {
    app: t('settings:notifications.device.app'),
    granted: t('settings:notifications.device.granted'),
    default: t('settings:notifications.device.default'),
    denied: t('settings:notifications.device.denied'),
    unsupported: t('settings:notifications.device.unsupported'),
  }[permission];

  const allow = async () => {
    await requestNotificationPermission();
    setPermission(notificationPermission());
  };

  return (
    <SettingsSection title={t('settings:notifications.device.title')}>
      <p className="text-ui leading-relaxed text-txt-secondary">{line}</p>
      {permission === 'default' && (
        <button type="button" onClick={() => { void allow(); }} className="btn-primary">
          {t('settings:notifications.device.turnOn')}
        </button>
      )}
      {(permission === 'granted' || permission === 'app') && (
        <button
          type="button"
          onClick={() => sendNotification(t('common:appName'), t('settings:notifications.device.testBody'))}
          className="btn-outline"
        >
          {t('settings:notifications.device.test')}
        </button>
      )}
    </SettingsSection>
  );
}

function SpaceRow({ space, onOpen }: { space: TaggedSpace; onOpen: () => void }) {
  const { t } = useTranslation(['settings', 'spaces']);
  const origin = space._instanceOrigin ?? '';
  const own = useNotificationSettingsStore((s) => selectNotificationSetting(s, origin, { spaceId: space.id, channelId: null }));
  // A timed mute that ends while the page is open shows at once.
  useNotificationSettingsStore((s) => s.clock);
  const spaceDefault = isSpaceDefaultNotificationLevel(space.defaultNotificationLevel) ? space.defaultNotificationLevel : null;
  const { level, muted } = resolveChannelNotificationPolicy(own, undefined, Date.now(), spaceDefault);
  const summary = muted ? t('settings:notifications.spaces.muted') : t(`spaces:notifications.level.${level}`);
  return (
    <button type="button" onClick={onOpen} className="list-row w-full rounded-none px-4 py-2.5 text-left">
      <Avatar src={space.icon} name={space.name} size={28} userId={space.id} avatarColor={space.avatarColor} palette="space" />
      <span className="min-w-0 flex-1 truncate text-ui font-medium text-txt-primary">{space.name}</span>
      <span className="flex-shrink-0 text-meta text-txt-tertiary">{summary}</span>
      <Icon name="chevron-right" size={15} className="flex-shrink-0 text-txt-tertiary" />
    </button>
  );
}

/**
 * Everything about being alerted, in one place: whether this device may show
 * notifications, what they say, the sounds, and each space's level. The first
 * three are this device's; a space's level is the account's, set on the instance
 * that hosts the space (docs/systems/sounds.md, "Notification settings").
 */
export function NotificationsPanel() {
  const { t } = useTranslation(['settings']);
  const f = useFormatters();
  const prefs = useNotificationPrefsStore();
  const soundEffectVolume = useVoiceStore((s) => s.soundEffectVolume);
  const setSoundEffectVolume = useVoiceStore((s) => s.setSoundEffectVolume);
  const messageSoundAllChannels = useVoiceStore((s) => s.messageSoundAllChannels);
  const setMessageSoundAllChannels = useVoiceStore((s) => s.setMessageSoundAllChannels);
  const spaces = useSpaceStore((s) => s.spaces);
  const [open, setOpen] = useState<TaggedSpace | null>(null);

  return (
    <SettingsPage title={t('settings:nav.tabs.notifications')}>
      <DeviceSection />
      <PushSection />
      <KeywordsSection />

      <SettingsSection title={t('settings:notifications.content.title')}>
        <ToggleRow
          label={t('settings:notifications.content.showText.label')}
          description={t('settings:notifications.content.showText.description')}
          enabled={prefs.showMessageText}
          onChange={(value) => prefs.setPref('showMessageText', value)}
        />
        <ToggleRow
          label={t('settings:notifications.content.directMessages.label')}
          description={t('settings:notifications.content.directMessages.description')}
          enabled={prefs.directMessages}
          onChange={(value) => prefs.setPref('directMessages', value)}
        />
        {window.backspace && (
          <ToggleRow
            label={t('settings:notifications.content.appBadge.label')}
            enabled={prefs.appBadge}
            onChange={(value) => prefs.setPref('appBadge', value)}
          />
        )}
      </SettingsSection>

      <SettingsSection title={t('settings:notifications.sounds.title')}>
        <SliderRow
          id="sound-effect-volume"
          label={t('settings:voice.volume.soundEffects.label')}
          value={soundEffectVolume}
          min={0}
          max={200}
          valueLabel={f.formatPercent(soundEffectVolume)}
          onChange={setSoundEffectVolume}
        />
        <ToggleRow
          label={t('settings:notifications.sounds.messageSound.label')}
          description={t('settings:notifications.sounds.messageSound.description')}
          enabled={prefs.messageSound}
          onChange={(value) => prefs.setPref('messageSound', value)}
        />
        <ToggleRow
          label={t('settings:voice.volume.messageSound.label')}
          description={t('settings:voice.volume.messageSound.description')}
          enabled={messageSoundAllChannels}
          disabled={!prefs.messageSound}
          onChange={setMessageSoundAllChannels}
        />
        <ToggleRow
          label={t('settings:notifications.sounds.callSound.label')}
          description={t('settings:notifications.sounds.callSound.description')}
          enabled={prefs.callSound}
          onChange={(value) => prefs.setPref('callSound', value)}
        />
      </SettingsSection>

      <SettingsSection title={t('settings:notifications.spaces.title')} description={t('settings:notifications.spaces.description')} flush>
        {spaces.length === 0 ? (
          <p className="px-4 py-3 text-ui text-txt-tertiary">{t('settings:notifications.spaces.empty')}</p>
        ) : (
          <div className="divide-y divide-border-hard">
            {spaces.map((space) => (
              <SpaceRow key={`${space._instanceOrigin ?? ''}/${space.id}`} space={space} onOpen={() => setOpen(space)} />
            ))}
          </div>
        )}
      </SettingsSection>

      {open && (
        <NotificationSettingsModal
          target={{ kind: 'space', origin: open._instanceOrigin ?? '', spaceId: open.id, spaceName: open.name }}
          onClose={() => setOpen(null)}
        />
      )}
    </SettingsPage>
  );
}
