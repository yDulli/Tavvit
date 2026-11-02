import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../../i18n/errors';
import { useMessageSelection } from '../../stores/messageSelectionStore';
import { getApiForOrigin, getChannelOrigin } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';

/** While messages are being picked in this channel: how many, and what can happen to them. */
export function MessageSelectionBar({ channelId }: { channelId: string }) {
  const { t } = useTranslation(['chat', 'common']);
  const active = useMessageSelection((s) => s.channelId === channelId);
  const count = useMessageSelection((s) => s.ids.size);
  const cancel = useMessageSelection((s) => s.cancel);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [active, cancel]);

  // Going elsewhere ends it.
  useEffect(() => () => {
    if (useMessageSelection.getState().channelId === channelId) useMessageSelection.getState().cancel();
  }, [channelId]);

  if (!active) return null;

  const remove = async () => {
    setBusy(true);
    try {
      const messageIds = [...useMessageSelection.getState().ids];
      await getApiForOrigin(getChannelOrigin(channelId)).channels.deleteMessages(channelId, messageIds);
      cancel();
    } catch (err) {
      useUIStore.getState().addToast(describeError(err), 'warning');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="glass-bubble absolute inset-x-3 top-2 z-20 flex items-center justify-between gap-3 rounded-lg px-3 py-2">
      <span className="tabular text-ui text-txt-primary">{t('chat:selection.count', { count })}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={cancel} className="btn-quiet btn-sm">{t('common:actions.cancel')}</button>
        <button type="button" onClick={() => setConfirming(true)} disabled={count === 0 || busy} className="btn-danger btn-sm">
          {t('chat:selection.delete')}
        </button>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={remove}
        title={t('chat:selection.confirmTitle', { count })}
        description={t('chat:selection.confirmBody')}
        confirmLabel={t('chat:selection.delete')}
        variant="danger"
        loading={busy}
      />
    </div>
  );
}
