import type { ChannelType } from '@backspace/shared';
import type { IconName } from '../components/ui/Icon';

/** What stands in front of a channel's name. */
export function channelIconName(type: ChannelType | undefined): IconName {
  switch (type) {
    case 'voice': return 'volume';
    case 'announcement': return 'megaphone';
    case 'forum': return 'forum';
    default: return 'hash';
  }
}

/** Whether a channel takes webhooks: those where messages are written directly, except a voice channel's chat. */
export function channelTakesWebhooks(type: ChannelType | undefined): boolean {
  return type === 'text' || type === 'announcement';
}

/** Whether a thread can grow from a message of this channel; the server holds the same rule (routes/threads.ts). */
export function channelTakesThreads(type: ChannelType | undefined): boolean {
  return type === 'text' || type === 'announcement';
}
