import { useSpaceStore } from '../stores/spaceStore';
import { hasPermissionBit, PermissionBits } from './permissions';

/**
 * Whether this person may pin in a space channel, to offer the buttons. The server decides
 * (routes/pins.ts). A conversation has no permissions: any member may.
 */
export function useCanPinInChannel(channelId: string | null | undefined): boolean {
  const permissions = useSpaceStore((state) => (channelId ? state.channelPermissions.get(channelId) : undefined));
  return hasPermissionBit(permissions, PermissionBits.PIN_MESSAGES)
    || hasPermissionBit(permissions, PermissionBits.MANAGE_MESSAGES);
}
