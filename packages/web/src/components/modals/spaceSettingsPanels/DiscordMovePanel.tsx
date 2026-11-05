import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiForOrigin, useSpaceStore } from '../../../stores/spaceStore';
import { useUIStore } from '../../../stores/uiStore';
import { hasPermissionBit, PermissionBits } from '../../../utils/permissions';
import { Icon } from '../../ui/Icon';
import { SettingsPage, SettingsSection } from '../settingsPanels/_shared/SettingsControls';
import { DiscordAnnouncement } from './DiscordAnnouncement';
import { DiscordExpressionImport } from './DiscordExpressionImport';

/**
 * Moving a Discord server here, in one place (spaces.md, "Importing a Discord template" and
 * "Importing emoji and stickers from Discord"): its channels and
 * roles from a template, its emoji and stickers with the owner's own bot, and the text that tells its
 * people where the community went. Each part shows for whoever holds what its routes check.
 */
export function DiscordMovePanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const openModal = useUIStore((state) => state.openModal);
  const permissions = useSpaceStore((state) => state.spacePermissions.get(spaceId));
  const space = useSpaceStore((state) => state.spaces.find((entry) => entry.id === spaceId));
  const origin = space?._instanceOrigin ?? '';
  const canImportTemplate = hasPermissionBit(permissions, PermissionBits.MANAGE_ROLES) && hasPermissionBit(permissions, PermissionBits.MANAGE_CHANNELS);
  const canImportExpressions = hasPermissionBit(permissions, PermissionBits.MANAGE_EMOJIS);
  const canLink = Boolean(space?.vanityCode) || hasPermissionBit(permissions, PermissionBits.CREATE_INVITE);
  const [hasEmoji, setHasEmoji] = useState(false);

  // Whether the announcement may say the emoji are here already.
  const readEmoji = useCallback(() => {
    getApiForOrigin(origin).spaceExpressions.emojis(spaceId)
      .then(({ emojis }) => setHasEmoji(emojis.length > 0))
      .catch(() => setHasEmoji(false));
  }, [origin, spaceId]);

  useEffect(() => {
    readEmoji();
  }, [readEmoji]);

  return (
    <SettingsPage title={t('spaces:settings.nav.tabs.discord')} intro={t('spaces:import.move.intro')}>
      {canImportTemplate && (
        <SettingsSection title={t('spaces:import.move.structureTitle')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 basis-60 text-meta leading-snug text-txt-tertiary">{t('spaces:import.entry.hint')}</p>
            <button type="button" className="btn-outline btn-sm" onClick={() => openModal('discordImport', { spaceId })}>
              <Icon name="download" size={14} />
              {t('spaces:import.entry.action')}
            </button>
          </div>
        </SettingsSection>
      )}

      {canImportExpressions && (
        <SettingsSection title={t('spaces:import.expressions.entryTitle')}>
          <DiscordExpressionImport spaceId={spaceId} origin={origin} onFinished={readEmoji} />
        </SettingsSection>
      )}

      {canLink && (
        <SettingsSection title={t('spaces:import.announce.title')}>
          <DiscordAnnouncement spaceId={spaceId} origin={origin} withEmoji={hasEmoji} />
        </SettingsSection>
      )}

      <p className="text-meta leading-snug text-txt-tertiary">{t('spaces:import.move.history')}</p>
    </SettingsPage>
  );
}
