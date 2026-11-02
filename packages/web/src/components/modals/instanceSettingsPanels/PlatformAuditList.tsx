import { useTranslation } from 'react-i18next';
import { isPeerTrustChange, isPlatformAuditAction, type PlatformAuditAction, type PlatformAuditEntry } from '@backspace/shared/src/platform';
import { isGrantedSpaceBadge, isGrantedUserBadge } from '@backspace/shared/src/badges';
import { useFormatters } from '../../../i18n/formatters';
import { useBadgeText } from '../../../badges/badgeText';

type ActionKey = `admin:platform.audit.actions.${PlatformAuditAction}`;

function actionKey(action: PlatformAuditAction): ActionKey {
  return `admin:platform.audit.actions.${action}`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Entries of the platform audit log (docs/systems/admin.md, "Platform audit
 * log"), newest first: what was done, by whom, to what, why, and what it set.
 * An action from a newer instance this client does not know reads neutrally.
 */
export function PlatformAuditList({ entries, compact = false }: { entries: readonly PlatformAuditEntry[]; compact?: boolean }) {
  const { t } = useTranslation(['admin', 'common']);
  const f = useFormatters();
  const badgeText = useBadgeText();

  if (entries.length === 0) {
    return <p className="text-meta text-txt-tertiary">{t('admin:platform.audit.empty')}</p>;
  }

  const badgeNames = (ids: string[]): string => f.formatList(ids.map((id) => (
    isGrantedUserBadge(id) || isGrantedSpaceBadge(id) ? badgeText[id].name : id
  )));

  /** What the entry set, in a sentence, where there is something to say. */
  const detailsText = (entry: PlatformAuditEntry): string | null => {
    const details = entry.details ?? {};
    switch (entry.action) {
      case 'user_suspend': {
        const until = details.until;
        return typeof until === 'number'
          ? t('admin:platform.audit.details.until', { date: f.formatDateTime(until) })
          : t('admin:platform.audit.details.untilLifted');
      }
      case 'user_role':
        return details.isAdmin === true ? t('admin:platform.audit.details.madeAdmin') : t('admin:platform.audit.details.removedAdmin');
      case 'user_badges':
      case 'space_badges': {
        const added = stringList(details.added);
        const removed = stringList(details.removed);
        const parts: string[] = [];
        if (added.length > 0) parts.push(t('admin:platform.audit.details.badgesAdded', { badges: badgeNames(added) }));
        if (removed.length > 0) parts.push(t('admin:platform.audit.details.badgesRemoved', { badges: badgeNames(removed) }));
        return parts.length > 0 ? parts.join(' · ') : null;
      }
      case 'user_storage_limit': {
        const limit = details.limitBytes;
        if (typeof limit !== 'number') return t('admin:platform.audit.details.storageInstance');
        return limit === 0
          ? t('admin:platform.audit.details.storageNone')
          : t('admin:platform.audit.details.storageOwn', { limit: f.formatBytes(limit) });
      }
      case 'settings_update': {
        const fields = stringList(details.fields);
        return fields.length > 0 ? t('admin:platform.audit.details.fields', { fields: f.formatList(fields) }) : null;
      }
      case 'space_vanity_revoke':
        return typeof details.code === 'string' ? `/join/${details.code}` : null;
      case 'peer_trust':
        return isPeerTrustChange(details.change) ? t(`admin:platform.audit.details.peer.${details.change}`) : null;
      case 'storage_cleanup':
        return typeof details.deletedFiles === 'number' && typeof details.freedBytes === 'number'
          ? t('admin:platform.audit.details.cleanup', { count: details.deletedFiles, size: f.formatBytes(details.freedBytes) })
          : null;
      case 'signup_challenge_update':
      case 'signup_rule_add':
      case 'signup_rule_remove':
        return entry.targetId;
      case 'backup_create':
        return typeof details.name === 'string' ? details.name : null;
      case 'user_sessions_end':
        return typeof details.sessions === 'number' ? t('admin:platform.audit.details.sessions', { n: f.formatNumber(details.sessions) }) : null;
      case 'accounts_export':
      case 'audit_export':
        return typeof details.rows === 'number' ? t('admin:platform.audit.details.rows', { n: f.formatNumber(details.rows) }) : null;
      default:
        return null;
    }
  };

  return (
    <ol className="surface-card divide-y divide-border-hard rounded-lg">
      {entries.map((entry) => {
        const known = isPlatformAuditAction(entry.action);
        const actor = entry.actor ? (entry.actor.displayName || `@${entry.actor.username}`) : t('common:review.unknownActor');
        const target = entry.targetLabel ?? entry.targetId;
        const extra = known ? detailsText(entry) : null;
        return (
          <li key={entry.id} className="px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-meta">
              <span className="font-medium text-txt-primary">
                {known ? t(actionKey(entry.action as PlatformAuditAction)) : t('admin:platform.audit.actions.unknown')}
              </span>
              {!compact && entry.targetType !== 'instance' && (
                <span className="min-w-0 truncate text-txt-secondary">{target}</span>
              )}
              <span className="min-w-0 truncate text-txt-tertiary">{t('admin:platform.audit.by', { name: actor })}</span>
              <span className="ml-auto font-mono text-label text-txt-tertiary">{f.formatDateTime(entry.createdAt)}</span>
            </div>
            {extra && <p className="mt-0.5 text-meta text-txt-secondary">{extra}</p>}
            {entry.reason && <p className="mt-1 whitespace-pre-wrap break-words text-meta text-txt-secondary">{entry.reason}</p>}
          </li>
        );
      })}
    </ol>
  );
}
