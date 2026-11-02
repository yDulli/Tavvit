import { useSpaceStore } from '../stores/spaceStore';
import { useThreadStore } from '../stores/threadStore';
import { useUIStore } from '../stores/uiStore';

/** Shows a thread: the panel beside the channel on a window, a screen of its own on a phone. */
export function openThreadView(threadId: string, parentChannelId: string, jumpToMessageId: string | null = null): void {
  const ui = useUIStore.getState();
  if (ui.isMobile) {
    ui.pushMobileScreen('thread', { threadId, parentChannelId, ...(jumpToMessageId ? { messageId: jumpToMessageId } : {}) });
    return;
  }
  useThreadStore.getState().openThread({ threadId, parentChannelId, jumpToMessageId });
}

/** The way to a message: through its channel when it is in a thread, which has no address of its own. */
export function messagePath(spaceId: string, channelId: string, messageId: string): string {
  const parent = useSpaceStore.getState().spaceChannelIndex.get(channelId)?.parentChannelId;
  return parent
    ? `/channels/${spaceId}/${parent}?thread=${channelId}&message=${messageId}`
    : `/channels/${spaceId}/${channelId}?message=${messageId}`;
}
