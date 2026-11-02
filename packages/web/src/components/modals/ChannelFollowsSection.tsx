import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChannelFollowInfo } from '@backspace/shared/src/channelFollows';
import { describeError } from '../../i18n/errors';
import { getApiForOrigin, getChannelOrigin } from '../../stores/spaceStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Icon } from '../ui/Icon';

/**
 * Who follows this channel and what it follows, under its webhooks: the two let something write
 * or carry its words elsewhere, and the same right manages them. Either side can end one.
 */
export function ChannelFollowsSection({ channelId, isAnnouncement }: { channelId: string; isAnnouncement: boolean }) {
  const { t } = useTranslation(['spaces', 'common']);
  const origin = getChannelOrigin(channelId);
  const [followers, setFollowers] = useState<ChannelFollowInfo[]>([]);
  const [following, setFollowing] = useState<ChannelFollowInfo[]>([]);
  const [ending, setEnding] = useState<ChannelFollowInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    getApiForOrigin(origin).channelFollows.list(channelId)
      .then((response) => {
        if (stale) return;
        setFollowers(response.followers);
        setFollowing(response.following);
      })
      .catch((err: unknown) => {
        if (!stale) setError(describeError(err));
      });
    return () => {
      stale = true;
    };
  }, [origin, channelId]);

  const end = async () => {
    if (!ending) return;
    const { id } = ending;
    setEnding(null);
    setError('');
    try {
      await getApiForOrigin(origin).channelFollows.remove(id);
      setFollowers((current) => current.filter((item) => item.id !== id));
      setFollowing((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(describeError(err));
    }
  };

  const row = (follow: ChannelFollowInfo, space: string, channel: string) => (
    <li key={follow.id} className="flex items-center gap-2 rounded-md border border-border-soft px-3 py-2">
      <Icon name="megaphone" size={14} className="flex-shrink-0 text-txt-tertiary" />
      <span className="min-w-0 flex-1 truncate text-ui text-txt-primary">{t('spaces:channel.settings.follows.place', { space, channel })}</span>
      <button
        type="button"
        onClick={() => setEnding(follow)}
        className="icon-btn"
        title={t('spaces:channel.settings.follows.remove')}
        aria-label={t('spaces:channel.settings.follows.remove')}
      >
        <Icon name="trash" size={14} />
      </button>
    </li>
  );

  if (!isAnnouncement && following.length === 0 && !error) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border-hard pt-4">
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      {isAnnouncement && (
        <section className="flex flex-col gap-1.5">
          <h3 className="label-mono">{t('spaces:channel.settings.follows.followersTitle')}</h3>
          {followers.length === 0
            ? <p className="text-ui text-txt-tertiary">{t('spaces:channel.settings.follows.followersEmpty')}</p>
            : <ul className="flex flex-col gap-1">{followers.map((follow) => row(follow, follow.targetSpaceName, follow.targetChannelName))}</ul>}
        </section>
      )}
      {following.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="label-mono">{t('spaces:channel.settings.follows.followingTitle')}</h3>
          <ul className="flex flex-col gap-1">{following.map((follow) => row(follow, follow.sourceSpaceName, follow.sourceChannelName))}</ul>
        </section>
      )}
      <ConfirmDialog
        isOpen={ending !== null}
        onClose={() => setEnding(null)}
        onConfirm={() => void end()}
        title={t('spaces:channel.settings.follows.removeTitle')}
        description={t('spaces:channel.settings.follows.removeBody')}
        confirmLabel={t('spaces:channel.settings.follows.remove')}
        variant="danger"
      />
    </div>
  );
}
