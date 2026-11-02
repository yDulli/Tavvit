import { PermissionBits } from '@backspace/shared/src/permissions.js';

/**
 * Who sees a category (docs/systems/permissions.md, "Categories"): every member sees one hidden from
 * nobody. One hidden from @everyone is shown only to those who see a channel in it, and to those who
 * may manage channels, who arrange it: its name says what it holds ("Staff", "Ban appeals"), so the
 * rest are not told it.
 */
export function categoryShownTo(isPrivate: boolean, holdsVisibleChannel: boolean, spacePerms: bigint): boolean {
  if (!isPrivate || holdsVisibleChannel) return true;
  return (spacePerms & (PermissionBits.MANAGE_CHANNELS | PermissionBits.ADMINISTRATOR)) !== 0n;
}

/** The categories of a space a viewer is sent, given the channels they see there and their permissions in it. */
export function shownCategories<T extends { id: string; isPrivate?: boolean }>(
  categories: readonly T[],
  visibleChannels: ReadonlyArray<{ categoryId?: string | null }>,
  spacePerms: bigint,
): T[] {
  const holding = new Set(visibleChannels.map((channel) => channel.categoryId).filter((id): id is string => typeof id === 'string'));
  return categories.filter((category) => categoryShownTo(category.isPrivate === true, holding.has(category.id), spacePerms));
}
