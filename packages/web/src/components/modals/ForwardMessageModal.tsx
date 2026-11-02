import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSwitcherItems } from '../../hooks/useSwitcherItems';
import { describeError } from '../../i18n/errors';
import { getApiForOrigin, useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { hasPermissionBit, PermissionBits } from '../../utils/permissions';
import { rankSwitcherItems, type SwitcherItem } from '../../utils/quickSwitcher';
import { ChannelIcon } from '../ui/ChannelIcon';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

const RESULT_LIMIT = 30;

/** What the modal is opened with. */
export interface ForwardMessageTarget {
  messageId: string;
  /** Whether the message is in a conversation, not a channel. */
  isDm: boolean;
  /** The instance holding it: a message can only be forwarded to a place on the same one. */
  origin: string;
}

function ForwardMessageForm({ target, onDone }: { target: ForwardMessageTarget; onDone: () => void }) {
  const { t } = useTranslation(['chat', 'common']);
  const { items } = useSwitcherItems();
  const channelOriginMap = useSpaceStore((s) => s.channelOriginMap);
  const channelPermissions = useSpaceStore((s) => s.channelPermissions);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const places = useMemo(() => items.filter((item) => {
    if (item.kind === 'dm') return (channelOriginMap.get(item.id.slice('dm:'.length)) ?? '') === target.origin;
    if (item.kind !== 'channel') return false;
    // A forum takes posts, not messages.
    if (useSpaceStore.getState().spaceChannelIndex.get(item.id.slice('channel:'.length))?.type === 'forum') return false;
    const channelId = item.id.slice('channel:'.length);
    return (channelOriginMap.get(channelId) ?? '') === target.origin
      && hasPermissionBit(channelPermissions.get(channelId), PermissionBits.SEND_MESSAGES);
  }), [items, channelOriginMap, channelPermissions, target.origin]);

  const shown = useMemo(() => rankSwitcherItems(places, query, RESULT_LIMIT), [places, query]);

  const forward = async (place: SwitcherItem) => {
    setBusyId(place.id);
    setError('');
    const destination = place.kind === 'dm'
      ? { dmChannelId: place.id.slice('dm:'.length) }
      : { channelId: place.id.slice('channel:'.length) };
    const client = getApiForOrigin(target.origin);
    try {
      await (target.isDm
        ? client.dm.forwardMessage(target.messageId, destination)
        : client.messages.forward(target.messageId, destination));
      useUIStore.getState().addToast(t('chat:forward.done', { place: place.label }), 'success');
      onDone();
    } catch (err) {
      setError(describeError(err));
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('chat:forward.search')}
        aria-label={t('chat:forward.search')}
        autoFocus
        className="input-search w-full"
      />
      {error && <p role="alert" className="text-meta text-txt-danger">{error}</p>}
      <ul className="max-h-[320px] overflow-y-auto scrollbar-thin">
        {shown.length === 0 && <li className="px-2 py-6 text-center text-ui text-txt-tertiary">{t('chat:forward.noPlaces')}</li>}
        {shown.map((place) => (
          <li key={place.id}>
            <button
              type="button"
              onClick={() => void forward(place)}
              disabled={busyId !== null}
              aria-busy={busyId === place.id}
              className="list-row w-full items-center gap-2.5 text-left"
            >
              {place.channel ? (
                <ChannelIcon type={place.channel.type} icon={place.channel.icon} size={16} className="flex-shrink-0 text-txt-tertiary" />
              ) : (
                <Icon name={place.kind === 'dm' ? 'user' : 'hash'} size={16} className="flex-shrink-0 text-txt-tertiary" />
              )}
              <span className="min-w-0 flex-1 truncate text-ui text-txt-primary">{place.label}</span>
              {place.detail && <span className="min-w-0 flex-shrink truncate text-meta text-txt-tertiary">{place.detail}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-meta text-txt-tertiary">{t('chat:forward.hint')}</p>
    </div>
  );
}

/** Forwarding a message: a list of the places this person may write, on the same instance. */
export function ForwardMessageModal() {
  const { t } = useTranslation('chat');
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData);
  const closeModal = useUIStore((s) => s.closeModal);
  const target = modalData.target as ForwardMessageTarget | undefined;
  const isOpen = activeModal === 'forwardMessage' && target !== undefined;

  return (
    <Modal isOpen={isOpen} onClose={closeModal} title={t('forward.title')} maxWidth="max-w-md">
      {isOpen && target && <ForwardMessageForm key={target.messageId} target={target} onDone={closeModal} />}
    </Modal>
  );
}
