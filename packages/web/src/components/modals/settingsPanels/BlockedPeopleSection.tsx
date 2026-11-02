import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlockedUser } from '@backspace/shared';
import { Avatar } from '../../ui/Avatar';
import { useBlockStore } from '../../../stores/blockStore';
import { useUIStore } from '../../../stores/uiStore';
import { useFormatters } from '../../../i18n/formatters';
import { describeError } from '../../../i18n/errors';
import { parseFederatedUsername } from '../../../utils/identity';
import { SettingsSection } from './_shared/SettingsControls';

/**
 * Everyone the signed-in user has blocked, each with the way to undo it. The
 * list is the home instance's; it is read again whenever the home socket
 * connects, and this section offers the retry when that read failed.
 */
export function BlockedPeopleSection() {
  const { t } = useTranslation(['settings', 'social', 'common']);
  const f = useFormatters();
  const blocks = useBlockStore((s) => s.blocks);
  const status = useBlockStore((s) => s.status);
  const load = useBlockStore((s) => s.load);
  const unblock = useBlockStore((s) => s.unblock);
  const addToast = useUIStore((s) => s.addToast);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleUnblock = async (entry: BlockedUser) => {
    const name = entry.user.displayName ?? parseFederatedUsername(entry.user.username).baseName;
    setPendingId(entry.user.id);
    try {
      await unblock(entry.user.id);
      addToast(t('social:block.unblocked', { name }), 'success');
    } catch (err) {
      addToast(t('social:block.unblockFailed', { name, reason: describeError(err) }), 'warning');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <SettingsSection title={t('settings:privacy.blocked.sectionTitle')} description={t('settings:privacy.blocked.description')}>
      {status === 'failed' && blocks.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-ui" role="alert">
          <span className="text-txt-danger">{t('settings:privacy.blocked.loadFailed')}</span>
          <button type="button" onClick={() => { void load(); }} className="btn-outline btn-sm">
            {t('settings:privacy.blocked.retry')}
          </button>
        </div>
      ) : status !== 'ready' && blocks.length === 0 ? (
        <div className="text-ui text-txt-tertiary">{t('settings:privacy.blocked.loading')}</div>
      ) : blocks.length === 0 ? (
        <div className="text-ui text-txt-tertiary">{t('settings:privacy.blocked.empty')}</div>
      ) : (
        <ul className="-my-2 divide-y divide-border-hard">
          {blocks.map((entry) => {
            const name = entry.user.displayName ?? parseFederatedUsername(entry.user.username).baseName;
            return (
              <li key={entry.user.id} className="flex items-center gap-3 py-2">
                <Avatar
                  src={entry.user.avatar}
                  name={name}
                  size={32}
                  userId={entry.user.homeUserId ?? entry.user.id}
                  user={entry.user}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ui font-medium text-txt-primary">{name}</div>
                  <div className="truncate text-meta text-txt-tertiary">
                    {t('settings:privacy.blocked.since', { date: f.formatMediumDate(entry.blockedAt) })}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pendingId === entry.user.id}
                  aria-busy={pendingId === entry.user.id}
                  onClick={() => { void handleUnblock(entry); }}
                  className="btn-outline btn-sm"
                >
                  {t('settings:privacy.blocked.unblock')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
}
