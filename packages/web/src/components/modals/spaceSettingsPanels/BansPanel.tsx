import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../../i18n/formatters';
import { describeError } from '../../../i18n/errors';
import { Avatar } from '../../ui/Avatar';
import { useSpaceStore, getApiForOrigin } from '../../../stores/spaceStore';

interface Ban {
  spaceId: string;
  userId: string;
  reason: string | null;
  bannedBy: string;
  createdAt: number;
  user: { id: string; username: string; displayName?: string | null; avatar?: string | null } | null;
  moderator: { id: string; username: string; displayName?: string | null } | null;
}

interface BansPanelProps {
  spaceId: string;
}

export function BansPanel({ spaceId }: BansPanelProps) {
  const { t } = useTranslation(['spaces', 'common']);
  const spaces = useSpaceStore((s) => s.spaces);
  const f = useFormatters();
  const space = spaces.find((s) => s.id === spaceId);
  const spaceApi = getApiForOrigin(space?._instanceOrigin ?? '');

  const [bans, setBans] = useState<Ban[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadBans = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await spaceApi.spaces.getBans(spaceId);
      setBans(data);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsLoading(false);
    }
  }, [spaceId, spaceApi]);

  useEffect(() => {
    loadBans();
  }, [loadBans]);

  const handleUnban = async (userId: string) => {
    try {
      await spaceApi.spaces.unban(spaceId, userId);
      setBans((prev) => prev.filter((b) => b.userId !== userId));
    } catch (err) {
      setError(describeError(err));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-txt-tertiary text-ui">{t('spaces:bans.loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="page-title">{t('spaces:bans.title')}</h2>
        <p className="mt-1 text-meta leading-snug text-txt-tertiary">{t('spaces:bans.description')}</p>
      </div>
      {error && (
        <div className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>
      )}

      {bans.length === 0 ? (
        <div className="surface-card rounded-lg">
          <div className="empty-state">
            <p className="empty-state-body">{t('spaces:bans.empty')}</p>
          </div>
        </div>
      ) : (
        <div>
          <div className="label-mono mb-1.5">
            {t('spaces:bans.listHeading', { total: f.formatNumber(bans.length) })}
          </div>
          <div className="surface-card overflow-hidden rounded-lg">
            <div className="divide-y divide-border-hard">
              {bans.map((ban) => {
                const displayName = ban.user?.displayName ?? ban.user?.username ?? ban.userId;
                const moderatorName = ban.moderator?.displayName ?? ban.moderator?.username ?? ban.bannedBy;
                const bannedDate = f.formatNumericDate(ban.createdAt);

                return (
                  <div key={ban.userId} className="flex min-h-[52px] items-center justify-between gap-3 px-3 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        src={ban.user?.avatar ?? null}
                        name={displayName}
                        size={32}
                        userId={ban.userId}
                      />
                      <div className="min-w-0">
                        <div className="text-ui font-medium text-txt-primary truncate">{displayName}</div>
                        <div className="mt-0.5 text-meta text-txt-tertiary truncate">
                          {ban.reason
                            ? t('spaces:bans.bannedByWithReason', { moderator: moderatorName, date: bannedDate, reason: ban.reason })
                            : t('spaces:bans.bannedBy', { moderator: moderatorName, date: bannedDate })}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnban(ban.userId)}
                      className="btn-outline btn-sm"
                    >
                      {t('spaces:bans.unban')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
