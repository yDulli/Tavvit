import { hasPermissionBit, PermissionBits } from '../../../utils/permissions';

/**
 * The tabs of a space's settings and who may open each: the one place both the settings window and
 * the phone's settings button read, so a member who may manage only the emoji still finds the way
 * in. The server checks every request on its own; this only decides what is offered.
 */

export type SpaceSettingsTab =
  | 'you' | 'overview' | 'welcome' | 'tag' | 'emoji' | 'sounds' | 'discord' | 'access' | 'invites' | 'discovery' | 'verification' | 'moderation'
  | 'members' | 'roles' | 'bans' | 'audit';

export type SpaceSettingsGroup = 'general' | 'management';

/** The navigation's sections and their tabs, in order. A tab the viewer may not open is left out. */
export const SPACE_SETTINGS_NAV: readonly { group: SpaceSettingsGroup; tabs: readonly SpaceSettingsTab[] }[] = [
  { group: 'general', tabs: ['you', 'overview', 'welcome', 'tag', 'emoji', 'sounds', 'discord', 'access', 'invites', 'discovery', 'verification', 'moderation'] },
  { group: 'management', tabs: ['members', 'roles', 'bans', 'audit'] },
];

const SPACE_SETTINGS_TABS: readonly SpaceSettingsTab[] = SPACE_SETTINGS_NAV.flatMap((section) => section.tabs);

export function isSpaceSettingsTab(value: unknown): value is SpaceSettingsTab {
  return typeof value === 'string' && (SPACE_SETTINGS_TABS as readonly string[]).includes(value);
}

/**
 * Which tabs a viewer with these permissions may open: the permission each panel's routes check on
 * the instance that hosts the space. `isOwner` decides only Verification, which the owner alone asks for.
 */
export function allowedSpaceSettingsTabs(permissions: bigint | string | undefined | null, isOwner: boolean): Record<SpaceSettingsTab, boolean> {
  const has = (bit: bigint) => hasPermissionBit(permissions, bit);
  const manageSpace = has(PermissionBits.MANAGE_SPACE);
  const manageEmojis = has(PermissionBits.MANAGE_EMOJIS);
  const manageRoles = has(PermissionBits.MANAGE_ROLES);
  return {
    you: true,
    overview: manageSpace,
    access: manageSpace,
    invites: manageSpace,
    discovery: manageSpace,
    verification: isOwner,
    moderation: manageSpace,
    welcome: manageSpace,
    tag: manageSpace,
    emoji: manageEmojis,
    sounds: has(PermissionBits.MANAGE_SOUNDS),
    // Moving from Discord: the template needs roles and channels, the emoji and stickers their own right.
    discord: (manageRoles && has(PermissionBits.MANAGE_CHANNELS)) || manageEmojis,
    // The list is for those who can act on it; everyone else has the member list beside the chat.
    members: manageRoles || has(PermissionBits.KICK_MEMBERS) || has(PermissionBits.BAN_MEMBERS),
    roles: manageRoles,
    bans: has(PermissionBits.BAN_MEMBERS),
    audit: has(PermissionBits.VIEW_AUDIT_LOG),
  };
}

/** Whether the viewer may open any tab beyond their own settings in the space. */
export function mayManageSpaceSettings(permissions: bigint | string | undefined | null, isOwner: boolean): boolean {
  const allowed = allowedSpaceSettingsTabs(permissions, isOwner);
  return (Object.keys(allowed) as SpaceSettingsTab[]).some((tab) => tab !== 'you' && allowed[tab]);
}
