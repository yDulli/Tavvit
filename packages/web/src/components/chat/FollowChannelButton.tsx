import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FollowTargetSpace } from '@backspace/shared/src/channelFollows';
import { describeError } from '../../i18n/errors';
import { getApiForOrigin, getChannelOrigin } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

function FollowDialog({ channelId, channelName, onClose }: { channelId: string; channelName: string; onClose: () => void }) {
  const { t } = useTranslation(['chat', 'common']);
  const fieldId = useId();
  const origin = getChannelOrigin(channelId);
  const [spaces, setSpaces] = useState<FollowTargetSpace[] | null>(null);
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    getApiForOrigin(origin).channelFollows.targets(channelId)
      .then((response) => {
        if (stale) return;
        setSpaces(response.spaces);
        setTargetId(response.spaces[0]?.channels[0]?.id ?? '');
      })
      .catch((err: unknown) => {
        if (!stale) setError(describeError(err));
      });
    return () => {
      stale = true;
    };
  }, [origin, channelId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!targetId || busy) return;
    setBusy(true);
    setError('');
    try {
      const made = await getApiForOrigin(origin).channelFollows.create(channelId, targetId);
      useUIStore.getState().addToast(t('chat:follow.done', { channel: made.targetChannelName, space: made.targetSpaceName }), 'info');
      onClose();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('chat:follow.title', { channel: channelName })} mobileStyle="sheet">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-ui leading-relaxed text-txt-secondary">{t('chat:follow.intro')}</p>
        {error && <div role="alert" className="rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">{error}</div>}
        {spaces === null && !error && (
          <div role="status" aria-label={t('chat:forum.loading')} className="flex h-16 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-txt-tertiary border-r-transparent" />
          </div>
        )}
        {spaces !== null && spaces.length === 0 && <p className="text-ui text-txt-tertiary">{t('chat:follow.none')}</p>}
        {spaces !== null && spaces.length > 0 && (
          <div>
            <label htmlFor={`${fieldId}-target`} className="field-label">{t('chat:follow.targetLabel')}</label>
            <select id={`${fieldId}-target`} value={targetId} onChange={(change) => setTargetId(change.target.value)} className="input-standard w-full">
              {spaces.map((space) => (
                <optgroup key={space.id} label={space.name}>
                  {space.channels.map((channel) => <option key={channel.id} value={channel.id}>{`#${channel.name}`}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-end">
          <div className="action-bar">
            <button type="button" onClick={onClose} className="btn-quiet">{t('common:actions.cancel')}</button>
            <button type="submit" disabled={!targetId || busy} aria-busy={busy} className="btn-primary">{t('chat:follow.submit')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** In the header of an announcement channel: have its posts arrive in a channel of another space. */
export function FollowChannelButton({ channelId, channelName, compact = false, className }: {
  channelId: string;
  channelName: string;
  /** Just the icon, for a phone's header. */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <button data-tooltip="" type="button" onClick={() => setOpen(true)} className={className} aria-label={t('follow.button')}>
          <Icon name="megaphone" size={20} />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn-outline btn-sm">
          <Icon name="megaphone" size={14} />
          {t('follow.button')}
        </button>
      )}
      {open && <FollowDialog channelId={channelId} channelName={channelName} onClose={() => setOpen(false)} />}
    </>
  );
}
