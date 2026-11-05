import { parseRoleGlyph } from '@backspace/shared/src/roleGlyphs';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AUDIT_LOG_ACTIONS,
  AUDIT_LOG_PAGE_SIZE,
  AVATAR_COLORS,
  isAuditLogAction,
  type AuditLogAction,
  type AvatarColor,
  type AuditLogChange,
  type AuditLogEntry,
  type AuditLogValue,
  type Channel,
  type MemberWithUser,
  type User,
} from '@backspace/shared';
import { useSpaceStore, getApiForOrigin } from '../../../stores/spaceStore';
import { describeError } from '../../../i18n/errors';
import { useFormatters } from '../../../i18n/formatters';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { usePermissionNames, type PermissionKey } from '../../ui/OverrideEntry';
import { PERMISSION_GROUPS } from '../../../utils/permissionGroups';
import { normalizeUserAssets } from '../../../utils/assetUrls';
import { spaceMemberName, userDisplayName } from '../../../utils/identity';
import { useAvatarColorNames, useVisibilityOptions } from './spaceOptions';

// ─── Wording ────────────────────────────────────────────────────────────────

/**
 * The values a sentence is built from: who acted, and on what. A type alias,
 * not an interface: i18next's options type has a string index signature,
 * which an object type alias satisfies and an interface does not.
 */
type SentenceValues = {
  actor: string;
  target: string;
};

/** The name of every action, for the filter. Typed by action, so a new one cannot go without. */
function useActionLabels(): Record<AuditLogAction, string> {
  const { t } = useTranslation(['spaces']);
  return useMemo(() => ({
    space_update: t('spaces:settings.audit.actions.spaceUpdate'),
    moderation_update: t('spaces:settings.audit.actions.moderationUpdate'),
    invite_regenerate: t('spaces:settings.audit.actions.inviteRegenerate'),
    invite_create: t('spaces:settings.audit.actions.inviteCreate'),
    invite_revoke: t('spaces:settings.audit.actions.inviteRevoke'),
    messages_bulk_delete: t('spaces:settings.audit.actions.messagesBulkDelete'),
    channel_create: t('spaces:settings.audit.actions.channelCreate'),
    channel_update: t('spaces:settings.audit.actions.channelUpdate'),
    channel_delete: t('spaces:settings.audit.actions.channelDelete'),
    category_create: t('spaces:settings.audit.actions.categoryCreate'),
    category_update: t('spaces:settings.audit.actions.categoryUpdate'),
    category_delete: t('spaces:settings.audit.actions.categoryDelete'),
    override_update: t('spaces:settings.audit.actions.overrideUpdate'),
    override_delete: t('spaces:settings.audit.actions.overrideDelete'),
    role_create: t('spaces:settings.audit.actions.roleCreate'),
    role_update: t('spaces:settings.audit.actions.roleUpdate'),
    role_delete: t('spaces:settings.audit.actions.roleDelete'),
    role_reorder: t('spaces:settings.audit.actions.roleReorder'),
    member_roles_update: t('spaces:settings.audit.actions.memberRolesUpdate'),
    member_kick: t('spaces:settings.audit.actions.memberKick'),
    member_ban: t('spaces:settings.audit.actions.memberBan'),
    member_unban: t('spaces:settings.audit.actions.memberUnban'),
    member_timeout: t('spaces:settings.audit.actions.memberTimeout'),
    member_timeout_remove: t('spaces:settings.audit.actions.memberTimeoutRemove'),
    message_delete: t('spaces:settings.audit.actions.messageDelete'),
    channel_messages_delete: t('spaces:settings.audit.actions.channelMessagesDelete'),
    thread_create: t('spaces:settings.audit.actions.threadCreate'),
    thread_update: t('spaces:settings.audit.actions.threadUpdate'),
    thread_delete: t('spaces:settings.audit.actions.threadDelete'),
    event_create: t('spaces:settings.audit.actions.eventCreate'),
    event_update: t('spaces:settings.audit.actions.eventUpdate'),
    event_delete: t('spaces:settings.audit.actions.eventDelete'),
    welcome_update: t('spaces:settings.audit.actions.welcomeUpdate'),
    webhook_create: t('spaces:settings.audit.actions.webhookCreate'),
    webhook_update: t('spaces:settings.audit.actions.webhookUpdate'),
    webhook_delete: t('spaces:settings.audit.actions.webhookDelete'),
    forum_tags_update: t('spaces:settings.audit.actions.forumTagsUpdate'),
    channel_follow_create: t('spaces:settings.audit.actions.channelFollowCreate'),
    channel_follow_delete: t('spaces:settings.audit.actions.channelFollowDelete'),
    vanity_update: t('spaces:settings.audit.actions.vanityUpdate'),
    sound_create: t('spaces:settings.audit.actions.soundCreate'),
    sound_update: t('spaces:settings.audit.actions.soundUpdate'),
    sound_delete: t('spaces:settings.audit.actions.soundDelete'),
    emoji_create: t('spaces:settings.audit.actions.emojiCreate'),
    emoji_update: t('spaces:settings.audit.actions.emojiUpdate'),
    emoji_delete: t('spaces:settings.audit.actions.emojiDelete'),
    sticker_create: t('spaces:settings.audit.actions.stickerCreate'),
    sticker_update: t('spaces:settings.audit.actions.stickerUpdate'),
    sticker_delete: t('spaces:settings.audit.actions.stickerDelete'),
    discord_expressions_import: t('spaces:settings.audit.actions.discordExpressionsImport'),
    bot_add: t('spaces:settings.audit.actions.botAdd'),
    message_pin: t('spaces:settings.audit.actions.messagePin'),
    message_unpin: t('spaces:settings.audit.actions.messageUnpin'),
    join_request_approve: t('spaces:settings.audit.actions.joinRequestApprove'),
    join_request_decline: t('spaces:settings.audit.actions.joinRequestDecline'),
    ownership_transfer: t('spaces:settings.audit.actions.ownershipTransfer'),
    template_import: t('spaces:settings.audit.actions.templateImport'),
  }), [t]);
}

/** The sentence of every action ("Mira timed out Jonas"). */
function useActionSentences(): Record<AuditLogAction, (values: SentenceValues) => string> {
  const { t } = useTranslation(['spaces']);
  return useMemo(() => ({
    space_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.spaceUpdate', v),
    moderation_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.moderationUpdate', v),
    invite_regenerate: (v: SentenceValues) => t('spaces:settings.audit.sentences.inviteRegenerate', v),
    invite_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.inviteCreate', v),
    invite_revoke: (v: SentenceValues) => t('spaces:settings.audit.sentences.inviteRevoke', v),
    messages_bulk_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.messagesBulkDelete', v),
    channel_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.channelCreate', v),
    channel_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.channelUpdate', v),
    channel_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.channelDelete', v),
    category_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.categoryCreate', v),
    category_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.categoryUpdate', v),
    category_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.categoryDelete', v),
    override_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.overrideUpdate', v),
    override_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.overrideDelete', v),
    role_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.roleCreate', v),
    role_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.roleUpdate', v),
    role_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.roleDelete', v),
    role_reorder: (v: SentenceValues) => t('spaces:settings.audit.sentences.roleReorder', v),
    member_roles_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.memberRolesUpdate', v),
    member_kick: (v: SentenceValues) => t('spaces:settings.audit.sentences.memberKick', v),
    member_ban: (v: SentenceValues) => t('spaces:settings.audit.sentences.memberBan', v),
    member_unban: (v: SentenceValues) => t('spaces:settings.audit.sentences.memberUnban', v),
    member_timeout: (v: SentenceValues) => t('spaces:settings.audit.sentences.memberTimeout', v),
    member_timeout_remove: (v: SentenceValues) => t('spaces:settings.audit.sentences.memberTimeoutRemove', v),
    message_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.messageDelete', v),
    channel_messages_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.channelMessagesDelete', v),
    thread_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.threadCreate', v),
    thread_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.threadUpdate', v),
    thread_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.threadDelete', v),
    event_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.eventCreate', v),
    event_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.eventUpdate', v),
    event_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.eventDelete', v),
    welcome_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.welcomeUpdate', v),
    webhook_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.webhookCreate', v),
    webhook_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.webhookUpdate', v),
    webhook_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.webhookDelete', v),
    forum_tags_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.forumTagsUpdate', v),
    channel_follow_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.channelFollowCreate', v),
    channel_follow_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.channelFollowDelete', v),
    vanity_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.vanityUpdate', v),
    sound_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.soundCreate', v),
    sound_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.soundUpdate', v),
    sound_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.soundDelete', v),
    emoji_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.emojiCreate', v),
    emoji_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.emojiUpdate', v),
    emoji_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.emojiDelete', v),
    sticker_create: (v: SentenceValues) => t('spaces:settings.audit.sentences.stickerCreate', v),
    sticker_update: (v: SentenceValues) => t('spaces:settings.audit.sentences.stickerUpdate', v),
    sticker_delete: (v: SentenceValues) => t('spaces:settings.audit.sentences.stickerDelete', v),
    discord_expressions_import: (v: SentenceValues) => t('spaces:settings.audit.sentences.discordExpressionsImport', v),
    bot_add: (v: SentenceValues) => t('spaces:settings.audit.sentences.botAdd', v),
    message_pin: (v: SentenceValues) => t('spaces:settings.audit.sentences.messagePin', v),
    message_unpin: (v: SentenceValues) => t('spaces:settings.audit.sentences.messageUnpin', v),
    join_request_approve: (v: SentenceValues) => t('spaces:settings.audit.sentences.joinRequestApprove', v),
    join_request_decline: (v: SentenceValues) => t('spaces:settings.audit.sentences.joinRequestDecline', v),
    ownership_transfer: (v: SentenceValues) => t('spaces:settings.audit.sentences.ownershipTransfer', v),
    template_import: (v: SentenceValues) => t('spaces:settings.audit.sentences.templateImport', v),
  }), [t]);
}

/**
 * The names of the fields an entry can change, by the machine name the hosting
 * instance records (docs/systems/spaces.md, "Audit log"). A key not listed,
 * from a newer instance, shows as itself.
 */
function useFieldLabels(): Readonly<Record<string, string>> {
  const { t } = useTranslation(['spaces']);
  return useMemo(() => ({
    name: t('spaces:settings.audit.fields.name'),
    type: t('spaces:settings.audit.fields.type'),
    topic: t('spaces:settings.audit.fields.topic'),
    tags: t('spaces:settings.audit.fields.tags'),
    vanityCode: t('spaces:settings.audit.fields.vanityCode'),
    category: t('spaces:settings.audit.fields.category'),
    channel: t('spaces:settings.audit.fields.channel'),
    slowmodeSeconds: t('spaces:settings.audit.fields.slowmodeSeconds'),
    target: t('spaces:settings.audit.fields.target'),
    permissions: t('spaces:settings.audit.fields.permissions'),
    allow: t('spaces:settings.audit.fields.allow'),
    deny: t('spaces:settings.audit.fields.deny'),
    color: t('spaces:settings.audit.fields.color'),
    colorSecondary: t('spaces:settings.audit.fields.colorSecondary'),
    hoist: t('spaces:settings.audit.fields.hoist'),
    mentionable: t('spaces:settings.audit.fields.mentionable'),
    position: t('spaces:settings.audit.fields.position'),
    role_added: t('spaces:settings.audit.fields.roleAdded'),
    role_removed: t('spaces:settings.audit.fields.roleRemoved'),
    durationSeconds: t('spaces:settings.audit.fields.durationSeconds'),
    owner: t('spaces:settings.audit.fields.owner'),
    inviteCode: t('spaces:settings.audit.fields.inviteCode'),
    messages: t('spaces:settings.audit.fields.messages'),
    icon: t('spaces:settings.audit.fields.icon'),
    banner: t('spaces:settings.audit.fields.banner'),
    avatarColor: t('spaces:settings.audit.fields.avatarColor'),
    visibility: t('spaces:settings.audit.fields.visibility'),
    description: t('spaces:settings.audit.fields.description'),
    directoryListed: t('spaces:settings.audit.fields.directoryListed'),
    ownerTitle: t('spaces:settings.audit.fields.ownerTitle'),
    ownerGroup: t('spaces:settings.audit.fields.ownerGroup'),
    // A Discord template import records the template and how much it made.
    template: t('spaces:settings.audit.fields.template'),
    roles: t('spaces:settings.audit.fields.roles'),
    categories: t('spaces:settings.audit.fields.categories'),
    channels: t('spaces:settings.audit.fields.channels'),
    // Importing a Discord server's emoji and stickers records how many came over.
    emoji: t('spaces:settings.audit.fields.emoji'),
    stickers: t('spaces:settings.audit.fields.stickers'),
    defaultNotificationLevel: t('spaces:settings.audit.fields.defaultNotificationLevel'),
    blocked_word_added: t('spaces:settings.audit.fields.blockedWordAdded'),
    blocked_word_removed: t('spaces:settings.audit.fields.blockedWordRemoved'),
    blockLinks: t('spaces:settings.audit.fields.blockLinks'),
    blockInvites: t('spaces:settings.audit.fields.blockInvites'),
    maxMentions: t('spaces:settings.audit.fields.maxMentions'),
    minAccountAgeMinutes: t('spaces:settings.audit.fields.minAccountAgeMinutes'),
    minMemberAgeMinutes: t('spaces:settings.audit.fields.minMemberAgeMinutes'),
  }), [t]);
}

// ─── Values ─────────────────────────────────────────────────────────────────

/** Fields whose values are permission sets, as decimal bit strings. */
const PERMISSION_FIELDS: ReadonlySet<string> = new Set(['permissions', 'allow', 'deny']);

/** Every permission bit in the role editors' order, for naming a set of them. */
const PERMISSION_ORDER = PERMISSION_GROUPS.flatMap((group) => group.perms);

/** A permission set from a change value, or null when the value is not one. */
function permissionBits(value: AuditLogValue | undefined): bigint | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return null;
}

/** The keys of the bits set in `bits`, in display order. */
function permissionKeysOf(bits: bigint): PermissionKey[] {
  return PERMISSION_ORDER.filter((perm) => (bits & perm.bit) !== 0n).map((perm) => perm.key);
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

function isAvatarColor(value: string): value is AvatarColor {
  return (AVATAR_COLORS as readonly string[]).includes(value);
}

/** How one side of a change reads, by the field it belongs to. */
function useValueFormatter(): (key: string, value: AuditLogValue) => React.ReactNode {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatInterval, formatNumber } = useFormatters();
  const visibilityOptions = useVisibilityOptions();
  const colorNames = useAvatarColorNames();
  const permissionNames = usePermissionNames();

  return (key, value) => {
    if (value === null) {
      return key === 'defaultNotificationLevel'
        ? t('spaces:settings.overview.notifications.builtIn')
        : t('common:states.none');
    }
    if (typeof value === 'boolean') return value ? t('common:states.on') : t('common:states.off');
    if (PERMISSION_FIELDS.has(key)) {
      const bits = permissionBits(value);
      if (bits !== null) {
        const keys = permissionKeysOf(bits);
        return keys.length > 0
          ? keys.map((permission) => permissionNames[permission] ?? permission).join(', ')
          : t('common:states.none');
      }
    }
    if (typeof value === 'number') {
      switch (key) {
        case 'slowmodeSeconds':
        case 'durationSeconds':
          return value === 0 ? t('common:states.off') : formatInterval(value);
        case 'minAccountAgeMinutes':
        case 'minMemberAgeMinutes':
          return value === 0 ? t('common:states.off') : formatInterval(value * 60);
        case 'maxMentions':
          return value === 0 ? t('common:states.off') : formatNumber(value);
        default:
          return formatNumber(value);
      }
    }
    if (key === 'icon' && typeof value === 'string') {
      const glyph = parseRoleGlyph(value);
      if (glyph) return t(`spaces:roleIcons.names.${glyph}`);
    }
    if (key === 'defaultNotificationLevel') {
      if (value === 'all') return t('spaces:notifications.level.all');
      if (value === 'mentions') return t('spaces:notifications.level.mentions');
    }
    if (key === 'type') {
      if (value === 'text') return t('spaces:channel.create.types.text.name');
      if (value === 'voice') return t('spaces:channel.create.types.voice.name');
    }
    // A message's channel is recorded by name; messages are only in text channels.
    if (key === 'channel') return `#${value}`;
    if (key === 'visibility') {
      const option = visibilityOptions.find((candidate) => candidate.value === value);
      if (option) return option.label;
    }
    if (key === 'avatarColor' && isAvatarColor(value)) return colorNames[value];
    if ((key === 'color' || key === 'colorSecondary' || key === 'avatarColor') && HEX_COLOR.test(value)) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm border border-border-soft" style={{ background: value }} />
          <span className="font-mono">{value}</span>
        </span>
      );
    }
    return value;
  };
}

/** One changed field: its name, then what it was and what it became. */
function ChangeLine({ change, label, formatValue }: {
  change: AuditLogChange;
  label: string;
  formatValue: (key: string, value: AuditLogValue) => React.ReactNode;
}) {
  const permissionNames = usePermissionNames();
  const hasFrom = change.from !== undefined;
  const hasTo = change.to !== undefined;

  // A permission set that changed reads as what was granted and what was taken away.
  const before = hasFrom && PERMISSION_FIELDS.has(change.key) ? permissionBits(change.from) : null;
  const after = hasTo && PERMISSION_FIELDS.has(change.key) ? permissionBits(change.to) : null;
  if (before !== null && after !== null) {
    const added = permissionKeysOf(after & ~before);
    const removed = permissionKeysOf(before & ~after);
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        <dt className="text-txt-tertiary">{label}</dt>
        <dd className="min-w-0 flex flex-wrap gap-x-2 gap-y-0.5">
          {added.map((key) => (
            <span key={`+${key}`} className="text-txt-positive">+ {permissionNames[key] ?? key}</span>
          ))}
          {removed.map((key) => (
            <span key={`-${key}`} className="text-txt-danger">− {permissionNames[key] ?? key}</span>
          ))}
          {added.length === 0 && removed.length === 0 && <span className="text-txt-secondary">{formatValue(change.key, change.to ?? null)}</span>}
        </dd>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
      <dt className="text-txt-tertiary">{label}</dt>
      <dd className="min-w-0 break-words text-txt-secondary">
        {hasFrom && hasTo ? (
          <>
            <span>{formatValue(change.key, change.from ?? null)}</span>
            <span aria-hidden="true" className="px-1.5 text-txt-tertiary">→</span>
            <span className="text-txt-primary">{formatValue(change.key, change.to ?? null)}</span>
          </>
        ) : hasTo ? (
          <span className="text-txt-primary">{formatValue(change.key, change.to ?? null)}</span>
        ) : (
          // A value that was removed: what it used to be, struck through.
          <span className="line-through">{formatValue(change.key, change.from ?? null)}</span>
        )}
      </dd>
    </div>
  );
}

// ─── Sentences ──────────────────────────────────────────────────────────────

/**
 * Stand-ins for the actor's and the target's names while a sentence is
 * translated. The translated text places them; each is then replaced by its
 * own emphasised element. Private-use code points, so no catalog text can
 * contain them.
 */
const ACTOR_SLOT = '\uE000';
const TARGET_SLOT = '\uE001';
const SLOT_SPLIT = /(\uE000|\uE001)/;

function renderSentence(sentence: string, actor: string, target: string): React.ReactNode[] {
  return sentence.split(SLOT_SPLIT).map((part, index) => {
    if (part === ACTOR_SLOT) return <span key={index} className="font-medium text-txt-primary">{actor}</span>;
    if (part === TARGET_SLOT) return <span key={index} className="font-medium text-txt-primary">{target}</span>;
    return part ? <span key={index}>{part}</span> : null;
  });
}

// ─── Entries ────────────────────────────────────────────────────────────────

interface EntryContext {
  users: ReadonlyMap<string, User>;
  members: ReadonlyMap<string, MemberWithUser>;
  channels: ReadonlyMap<string, Channel>;
}

function AuditLogRow({ entry, context }: { entry: AuditLogEntry; context: EntryContext }) {
  const { t } = useTranslation(['spaces', 'common']);
  const { formatRelativeTime, formatDateTime } = useFormatters();
  const sentences = useActionSentences();
  const fieldLabels = useFieldLabels();
  const formatValue = useValueFormatter();
  const [expanded, setExpanded] = useState(false);
  const changesId = useId();

  const member = context.members.get(entry.actorId);
  const actorUser = member?.user ?? context.users.get(entry.actorId);
  const actorName = actorUser ? spaceMemberName(member, actorUser) : t('common:states.unknown');

  // The target's name as the entry recorded it; a channel reads as #name
  // unless it is known to be a voice channel.
  const label = entry.targetLabel?.trim();
  const channel = entry.targetId ? context.channels.get(entry.targetId) : undefined;
  const isTextChannelTarget = (entry.targetType === 'channel' || channel !== undefined) && channel?.type !== 'voice';
  const targetName = !label
    ? t('spaces:settings.audit.unknownTarget')
    : isTextChannelTarget ? `#${label}` : label;

  // An action a newer instance records that this client does not know yet
  // reads as who did it and its name, rather than breaking the log.
  const sentence = isAuditLogAction(entry.action)
    ? sentences[entry.action]({ actor: ACTOR_SLOT, target: TARGET_SLOT })
    : t('spaces:settings.audit.sentences.unknown', { actor: ACTOR_SLOT, action: String(entry.action) });
  const changes = entry.changes ?? [];

  return (
    <li className="flex gap-3 px-3 py-2.5">
      <Avatar
        src={actorUser?.avatar ?? null}
        name={actorName}
        size={28}
        user={actorUser}
        userId={actorUser ? undefined : entry.actorId}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 break-words text-ui text-txt-secondary">
            {renderSentence(sentence, actorName, targetName)}
          </p>
          <time
            dateTime={new Date(entry.createdAt).toISOString()}
            title={formatDateTime(entry.createdAt)}
            className="flex-shrink-0 font-mono tabular-nums text-meta text-txt-tertiary"
          >
            {formatRelativeTime(entry.createdAt)}
          </time>
        </div>
        {entry.reason && (
          <p className="mt-0.5 break-words text-meta text-txt-tertiary">
            {t('spaces:settings.audit.reason', { reason: entry.reason })}
          </p>
        )}
        {changes.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              aria-controls={changesId}
              className="mt-1 inline-flex items-center gap-1 rounded text-meta text-txt-tertiary transition-colors duration-100 hover:text-txt-primary"
            >
              <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />
              {expanded
                ? t('spaces:settings.audit.hideChanges')
                : t('spaces:settings.audit.showChanges', { count: changes.length })}
            </button>
            {expanded && (
              <dl id={changesId} className="mt-1.5 space-y-1 rounded-md border border-border-hard px-2.5 py-2 text-meta">
                {changes.map((change, index) => (
                  <ChangeLine
                    key={`${change.key}-${index}`}
                    change={change}
                    label={fieldLabels[change.key] ?? change.key}
                    formatValue={formatValue}
                  />
                ))}
              </dl>
            )}
          </>
        )}
      </div>
    </li>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

/** Users from an answer, with their pictures pointed at the instance that sent them. */
function usersFrom(list: readonly User[], origin: string): Map<string, User> {
  const users = new Map<string, User>();
  for (const user of list) users.set(user.id, normalizeUserAssets({ ...user }, origin));
  return users;
}

/**
 * Server settings → Audit log: who changed what in the space, newest first,
 * read from the instance that hosts it a page at a time. Filters by action
 * and by the person who acted; ids are the hosting instance's own. The modal
 * keys the panel by space, so the users and filters of one space's log never
 * carry over to another's.
 */
export function AuditLogPanel({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation(['spaces', 'common']);
  const actionLabels = useActionLabels();
  const origin = useSpaceStore((s) => s.spaces.find((space) => space.id === spaceId)?._instanceOrigin ?? '');
  const isOpenSpace = useSpaceStore((s) => s.currentSpaceId === spaceId);
  const roster = useSpaceStore((s) => s.members);
  const openChannels = useSpaceStore((s) => s.channels);

  const [action, setAction] = useState<AuditLogAction | ''>('');
  const [actorId, setActorId] = useState('');
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [users, setUsers] = useState<ReadonlyMap<string, User>>(new Map());
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const actionFilterId = useId();
  const actorFilterId = useId();

  /**
   * The first-page load the panel is waiting for. A new filter, a refresh or
   * a different space starts another, and an answer for an older one, or an
   * older page requested under it, changes nothing.
   */
  const runId = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const id = ++runId.current;
    setLoading(true);
    setError('');
    setMoreError('');
    setLoadingMore(false);
    try {
      const page = await getApiForOrigin(origin).moderation.auditLog(spaceId, {
        limit: AUDIT_LOG_PAGE_SIZE,
        ...(action ? { action } : {}),
        ...(actorId ? { actorId } : {}),
      });
      if (runId.current !== id) return;
      setEntries(page.entries);
      setUsers((known) => new Map([...known, ...usersFrom(page.users, origin)]));
      setNextBefore(page.nextBefore);
    } catch (err) {
      if (runId.current !== id) return;
      setEntries([]);
      setNextBefore(null);
      setError(describeError(err));
    } finally {
      if (runId.current === id) setLoading(false);
    }
  }, [origin, spaceId, action, actorId]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadOlder = async () => {
    if (!nextBefore || loadingMore) return;
    const id = runId.current;
    setLoadingMore(true);
    setMoreError('');
    try {
      const page = await getApiForOrigin(origin).moderation.auditLog(spaceId, {
        before: nextBefore,
        limit: AUDIT_LOG_PAGE_SIZE,
        ...(action ? { action } : {}),
        ...(actorId ? { actorId } : {}),
      });
      if (runId.current !== id) return;
      setEntries((shown) => {
        const seen = new Set(shown.map((entry) => entry.id));
        return [...shown, ...page.entries.filter((entry) => !seen.has(entry.id))];
      });
      setUsers((known) => new Map([...known, ...usersFrom(page.users, origin)]));
      setNextBefore(page.nextBefore);
    } catch (err) {
      if (runId.current !== id) return;
      setMoreError(describeError(err));
    } finally {
      if (runId.current === id) setLoadingMore(false);
    }
  };

  // The roster and channels in the store belong to the open space only.
  const members = useMemo(() => {
    const byId = new Map<string, MemberWithUser>();
    if (isOpenSpace) for (const member of roster) if (member.spaceId === spaceId) byId.set(member.userId, member);
    return byId;
  }, [isOpenSpace, roster, spaceId]);
  const channels = useMemo(() => {
    const byId = new Map<string, Channel>();
    if (isOpenSpace) for (const channel of openChannels) if (channel.spaceId === spaceId) byId.set(channel.id, channel);
    return byId;
  }, [isOpenSpace, openChannels, spaceId]);

  // Who the actor filter offers: the space's members and everyone the log named.
  const actorChoices = useMemo(() => {
    const names = new Map<string, string>();
    for (const member of members.values()) names.set(member.userId, spaceMemberName(member, member.user));
    for (const user of users.values()) if (!names.has(user.id)) names.set(user.id, userDisplayName(user));
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [members, users]);

  const context: EntryContext = { users, members, channels };
  const filtered = action !== '' || actorId !== '';

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="page-title">{t('spaces:settings.audit.title')}</h2>
          <p className="mt-1 text-meta leading-snug text-txt-tertiary">{t('spaces:settings.audit.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadFirstPage()}
          disabled={loading}
          className="icon-btn flex-shrink-0"
          aria-label={t('common:actions.refresh')}
        >
          <Icon name="refresh" size={16} />
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[180px] flex-1">
          <label htmlFor={actionFilterId} className="field-label">{t('spaces:settings.audit.filters.action')}</label>
          <select
            id={actionFilterId}
            value={action}
            onChange={(e) => {
              const value = e.target.value;
              setAction(isAuditLogAction(value) ? value : '');
            }}
            className="input-standard h-8 w-full py-0"
          >
            <option value="">{t('spaces:settings.audit.filters.allActions')}</option>
            {AUDIT_LOG_ACTIONS.map((candidate) => (
              <option key={candidate} value={candidate}>{actionLabels[candidate]}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label htmlFor={actorFilterId} className="field-label">{t('spaces:settings.audit.filters.actor')}</label>
          <select
            id={actorFilterId}
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            className="input-standard h-8 w-full py-0"
          >
            <option value="">{t('spaces:settings.audit.filters.anyone')}</option>
            {actorChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>{choice.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-accent-rose/30 bg-accent-rose/10 px-3 py-2 text-ui text-txt-danger">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadFirstPage()}
            disabled={loading}
            className="font-medium underline underline-offset-2 hover:no-underline transition-all disabled:no-underline disabled:opacity-60 disabled:cursor-default"
          >
            {t('common:actions.retry')}
          </button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-8" role="status">
          <div className="text-txt-tertiary text-ui">{t('common:states.loading')}</div>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Icon name="shield" size={18} />
          </div>
          <p className="empty-state-title">
            {filtered ? t('spaces:settings.audit.emptyFiltered.title') : t('spaces:settings.audit.empty.title')}
          </p>
          <p className="empty-state-body">
            {filtered ? t('spaces:settings.audit.emptyFiltered.body') : t('spaces:settings.audit.empty.body')}
          </p>
        </div>
      ) : (
        <>
          <ol className="surface-card divide-y divide-border-hard rounded-lg">
            {entries.map((entry) => (
              <AuditLogRow key={entry.id} entry={entry} context={context} />
            ))}
          </ol>
          {moreError && (
            <p className="text-meta text-txt-danger text-center">{moreError}</p>
          )}
          {nextBefore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingMore}
                aria-busy={loadingMore}
                className="btn-outline btn-sm"
              >
                {loadingMore ? t('common:states.loading') : t('spaces:settings.audit.loadOlder')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
