import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { BotPublicInfo } from '@backspace/shared/src/bots';
import { api } from '../../api/client';
import { describeError } from '../../i18n/errors';
import { PermissionBits, permissionsToString, stringToPermissions } from '../../utils/permissions';
import { PERMISSION_GROUPS } from '../../utils/permissionGroups';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { usePermissionNames } from '../ui/OverrideEntry';

/**
 * Bringing a bot into a space: which space, and what it would be allowed. The server says which
 * spaces this person may manage on this instance, and decides all of it again when they add it:
 * a bot gets only rights the person holds themselves, never ADMINISTRATOR.
 */
export function BotInvitePage() {
  const { t } = useTranslation(['spaces', 'common']);
  const { botId } = useParams<{ botId: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const fieldId = useId();
  const names = usePermissionNames();
  const [bot, setBot] = useState<BotPublicInfo | null>(null);
  const [spaceId, setSpaceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const asked = useMemo(() => {
    const value = search.get('permissions');
    return value && /^\d{1,20}$/.test(value) ? stringToPermissions(value) & ~PermissionBits.ADMINISTRATOR : 0n;
  }, [search]);
  const askedNames = PERMISSION_GROUPS.flatMap((group) => group.perms).filter((perm) => (asked & perm.bit) !== 0n).map((perm) => names[perm.key]);

  useEffect(() => {
    if (!botId) return undefined;
    let cancelled = false;
    api.bots.publicInfo(botId).then((info) => {
      if (!cancelled) setBot(info);
    }).catch((err: unknown) => {
      if (!cancelled) setError(describeError(err));
    });
    return () => {
      cancelled = true;
    };
  }, [botId]);

  const add = async () => {
    if (!botId || !spaceId || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.bots.addToSpace(botId, spaceId, permissionsToString(asked));
      navigate(`/channels/${spaceId}`);
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-start justify-center overflow-y-auto bg-surface-base px-4 py-10">
      <div className="surface-card flex w-full max-w-md flex-col gap-5 p-6">
        <h1 className="page-title">{t('spaces:botInvite.title')}</h1>

        {bot && (
          <div className="flex items-center gap-3">
            <Avatar src={bot.avatar} name={bot.name} size={48} userId={bot.id} avatarColor={bot.avatarColor} />
            <div className="min-w-0">
              <p className="truncate text-lead text-txt-primary">{bot.name}</p>
              <p className="truncate text-meta text-txt-tertiary">{t('spaces:botInvite.runBy', { name: bot.ownerName })}</p>
              {bot.description && <p className="mt-1 text-ui text-txt-secondary">{bot.description}</p>}
            </div>
          </div>
        )}

        {bot && (
          <>
            <p className="text-ui text-txt-secondary">{t('spaces:botInvite.warning')}</p>

            <div>
              <label htmlFor={`${fieldId}-space`} className="field-label">{t('spaces:botInvite.spaceLabel')}</label>
              <select id={`${fieldId}-space`} value={spaceId} onChange={(change) => setSpaceId(change.target.value)} className="input-standard w-full">
                <option value="">{t('spaces:botInvite.spacePick')}</option>
                {bot.spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
              </select>
              {bot.spaces.length === 0 && <p className="mt-1.5 text-meta text-txt-tertiary">{t('spaces:botInvite.noSpaces')}</p>}
            </div>

            <div>
              <p className="field-label">{t('spaces:botInvite.permissionsLabel')}</p>
              {askedNames.length === 0 ? (
                <p className="text-ui text-txt-secondary">{t('spaces:botInvite.noPermissions')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {askedNames.map((name) => (
                    <li key={name} className="flex items-center gap-2 text-ui text-txt-secondary">
                      <Icon name="check" size={14} className="flex-shrink-0 text-txt-tertiary" />
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Link to="/channels/@me" className="btn-quiet">{t('common:actions.cancel')}</Link>
          {bot && (
            <button type="button" onClick={() => void add()} disabled={!spaceId || busy} aria-busy={busy} className="btn-primary">
              {t('spaces:botInvite.add')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
