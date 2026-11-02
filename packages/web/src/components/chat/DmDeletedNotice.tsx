import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';

/**
 * Read-only composer replacement shown in a 1-on-1 DM whose partner's account
 * was deleted. Occupies the same bottom slot as the MessageInput glass bubble.
 */
export function DmDeletedNotice() {
  const { t } = useTranslation(['dm', 'common']);
  return (
    <div className="px-2 pb-1.5 pt-1 desktop:px-5 desktop:pb-4">
      <div className="glass-bubble flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-1.5 text-ui text-txt-tertiary select-none">
        <Icon name="info" size={15} className="flex-shrink-0" />
        <span>{t('dm:deletedNotice.accountDeleted')}</span>
      </div>
    </div>
  );
}
