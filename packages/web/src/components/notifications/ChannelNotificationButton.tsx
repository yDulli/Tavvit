import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChannelNotificationPolicy } from '../../hooks/useNotificationSettings';
import { BellOffIcon } from './ChannelMutedIndicator';
import { Icon } from '../ui/Icon';
import { ChannelNotificationPopover } from './ChannelNotificationPopover';

/**
 * The channel header's bell. Opens the channel's notification popover, and
 * shows a crossed-out bell while the channel is muted (its own mute or its
 * space's).
 */
export function ChannelNotificationButton({ channelId, channelName }: { channelId: string; channelName: string }) {
  const { t } = useTranslation(['spaces']);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const policy = useChannelNotificationPolicy(channelId);
  const muted = policy?.muted === true;
  const close = useCallback(() => setOpen(false), []);

  // A popover left open belongs to the channel it was opened on.
  useEffect(() => {
    setOpen(false);
  }, [channelId]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-active={open}
        className="icon-btn icon-btn-lg"
        title={muted ? `${t('spaces:main.notificationSettings')} (${t('spaces:notifications.mutedIndicator')})` : t('spaces:main.notificationSettings')}
      >
        {muted ? <BellOffIcon size={18} /> : <Icon name="bell" size={18} />}
      </button>
      <ChannelNotificationPopover
        open={open}
        onClose={close}
        anchorRef={buttonRef}
        channelId={channelId}
        channelName={channelName}
      />
    </>
  );
}
