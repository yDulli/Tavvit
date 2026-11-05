import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PermissionBits } from './permissions';
import type { PermissionKey } from '../components/ui/OverrideEntry';

/**
 * One toggleable permission of a role: the bit itself plus the key its display
 * name is looked up under (via `usePermissionNames()`).
 */
export interface PermDef {
  bit: bigint;
  key: PermissionKey;
}

export type PermissionGroupId = 'space' | 'roles' | 'members' | 'moderation' | 'channels' | 'invites' | 'messages' | 'voice' | 'advanced';

/**
 * Permission display groups for the role editors. Shared by RolesPanel (space
 * settings) and MemberRolesModal (per-member role editing) so both surfaces
 * show the same permissions, grouped the same way, in the same order, from
 * the everyday to the powerful. Every bit here is enforced by the instance.
 *
 * These are space-wide permissions. The channel and category override editors
 * list their own bits (`TEXT_CHANNEL_PERMISSIONS` and the rest in their
 * modals), so a bit that only means something for the whole space, such as
 * timing members out or reading the audit log, appears here and nowhere else.
 */
export const PERMISSION_GROUPS: { id: PermissionGroupId; perms: PermDef[] }[] = [
  {
    id: 'channels',
    perms: [
      { bit: PermissionBits.VIEW_CHANNEL, key: 'VIEW_CHANNEL' },
      { bit: PermissionBits.MANAGE_CHANNELS, key: 'MANAGE_CHANNELS' },
    ],
  },
  {
    id: 'messages',
    perms: [
      { bit: PermissionBits.SEND_MESSAGES, key: 'SEND_MESSAGES' },
      { bit: PermissionBits.ATTACH_FILES, key: 'ATTACH_FILES' },
      { bit: PermissionBits.READ_MESSAGE_HISTORY, key: 'READ_MESSAGE_HISTORY' },
      { bit: PermissionBits.ADD_REACTIONS, key: 'ADD_REACTIONS' },
      { bit: PermissionBits.MENTION_EVERYONE, key: 'MENTION_EVERYONE' },
      { bit: PermissionBits.PIN_MESSAGES, key: 'PIN_MESSAGES' },
      { bit: PermissionBits.CREATE_THREADS, key: 'CREATE_THREADS' },
      { bit: PermissionBits.MANAGE_WEBHOOKS, key: 'MANAGE_WEBHOOKS' },
    ],
  },
  {
    id: 'voice',
    perms: [
      { bit: PermissionBits.CONNECT, key: 'CONNECT' },
      { bit: PermissionBits.SPEAK, key: 'SPEAK' },
      { bit: PermissionBits.STREAM, key: 'STREAM' },
      { bit: PermissionBits.USE_SOUNDBOARD, key: 'USE_SOUNDBOARD' },
      { bit: PermissionBits.MUTE_MEMBERS, key: 'MUTE_MEMBERS' },
      { bit: PermissionBits.DEAFEN_MEMBERS, key: 'DEAFEN_MEMBERS' },
      { bit: PermissionBits.MOVE_MEMBERS, key: 'MOVE_MEMBERS' },
      { bit: PermissionBits.DISCONNECT_MEMBERS, key: 'DISCONNECT_MEMBERS' },
    ],
  },
  {
    id: 'invites',
    perms: [
      { bit: PermissionBits.CREATE_INVITE, key: 'CREATE_INVITE' },
    ],
  },
  {
    id: 'moderation',
    perms: [
      { bit: PermissionBits.MANAGE_MESSAGES, key: 'MANAGE_MESSAGES' },
      { bit: PermissionBits.MODERATE_MEMBERS, key: 'MODERATE_MEMBERS' },
    ],
  },
  {
    id: 'members',
    perms: [
      { bit: PermissionBits.KICK_MEMBERS, key: 'KICK_MEMBERS' },
      { bit: PermissionBits.BAN_MEMBERS, key: 'BAN_MEMBERS' },
    ],
  },
  {
    id: 'roles',
    perms: [
      { bit: PermissionBits.MANAGE_ROLES, key: 'MANAGE_ROLES' },
    ],
  },
  {
    id: 'space',
    perms: [
      { bit: PermissionBits.MANAGE_SPACE, key: 'MANAGE_SPACE' },
      { bit: PermissionBits.VIEW_AUDIT_LOG, key: 'VIEW_AUDIT_LOG' },
      { bit: PermissionBits.MANAGE_EVENTS, key: 'MANAGE_EVENTS' },
      { bit: PermissionBits.MANAGE_SOUNDS, key: 'MANAGE_SOUNDS' },
      { bit: PermissionBits.MANAGE_EMOJIS, key: 'MANAGE_EMOJIS' },
    ],
  },
  {
    id: 'advanced',
    perms: [
      { bit: PermissionBits.ADMINISTRATOR, key: 'ADMINISTRATOR' },
    ],
  },
];

/** The heading of each permission group, the same in every role editor. */
export function usePermissionGroupTitles(): Record<PermissionGroupId, string> {
  const { t } = useTranslation(['spaces']);
  return useMemo(() => ({
    space: t('spaces:roles.groups.space'),
    roles: t('spaces:roles.groups.roles'),
    members: t('spaces:roles.groups.members'),
    moderation: t('spaces:roles.groups.moderation'),
    channels: t('spaces:roles.groups.channels'),
    invites: t('spaces:roles.groups.invites'),
    messages: t('spaces:roles.groups.messages'),
    voice: t('spaces:roles.groups.voice'),
    advanced: t('spaces:roles.groups.advanced'),
  }), [t]);
}

/**
 * A line under a permission's name in the role editors, for the bits whose
 * name alone does not say what they allow. Keyed like `usePermissionNames()`;
 * a bit without an entry shows its name only.
 */
export function usePermissionDescriptions(): Partial<Record<PermissionKey, string>> {
  const { t } = useTranslation(['spaces']);
  return useMemo(() => ({
    MODERATE_MEMBERS: t('spaces:permissions.descriptions.moderateMembers'),
    VIEW_AUDIT_LOG: t('spaces:permissions.descriptions.viewAuditLog'),
    MANAGE_EMOJIS: t('spaces:permissions.descriptions.manageEmojis'),
  }), [t]);
}
