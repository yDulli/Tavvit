import type { AccountKind } from '@backspace/shared';
import { sqliteTable, text, integer, primaryKey, foreignKey, real, unique, index, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').unique().notNull(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar'),
  /** Live presence: the chosen status while connected, 'offline' with no connection. */
  status: text('status').default('offline'),
  /**
   * The status the user picked ('online' | 'idle' | 'dnd'). Survives disconnects
   * and restarts; published as `status` when a connection authenticates.
   * Meaningful only on rows that own their choice (native or detached,
   * `ownsChosenStatus` in @backspace/shared): a replicated row's copy is never
   * read or written.
   */
  chosenStatus: text('chosen_status').notNull().default('online'),
  customStatus: text('custom_status'),
  /**
   * When the custom status clears by itself (epoch ms), or null to keep it until
   * the user changes it. Set from a duration chosen when the status is saved;
   * the sweeper in utils/customStatusExpiry.ts clears it and tells observers.
   */
  customStatusExpiresAt: integer('custom_status_expires_at'),
  isAdmin: integer('is_admin').default(0),
  homeInstance: text('home_instance'),
  homeUserId: text('home_user_id'),
  replicatedInstances: text('replicated_instances').default('[]'),
  banner: text('banner'),
  accentColor: text('accent_color'),
  /** The profile theme's second colour (`#rrggbb`); see User.accentColorSecondary. */
  accentColorSecondary: text('accent_color_secondary'),
  avatarColor: text('avatar_color'),
  bio: text('bio'),
  /** Pronouns shown on the profile card; null without (User.pronouns). */
  pronouns: text('pronouns'),
  /** JSON array of ProfileLink ({ url, label }), at most PROFILE_LIMITS.MAX_LINKS; null without. */
  profileLinks: text('profile_links'),
  /** The profile card's layout (ProfileLayout); null for the standard one. */
  profileLayout: text('profile_layout'),
  /**
   * JSON array of the badges an instance admin gave the person
   * (GrantedUserBadgeId, docs/systems/badges.md); null without. Staff is not
   * stored: it comes from is_admin.
   */
  badges: text('badges'),
  /**
   * An instance admin's suspension of the account (docs/systems/admin.md,
   * "Suspensions"). Suspended while `suspended_at` is set and `suspended_until`
   * is null (until lifted) or in the future: no sign-in, no API, no socket.
   * Lifting clears all three; the platform audit log keeps the history.
   */
  suspendedAt: integer('suspended_at'),
  /** Its own limit on files, set by an admin; 0 means none. Null: the instance's applies. */
  storageLimitBytes: integer('storage_limit_bytes'),
  suspendedUntil: integer('suspended_until'),
  suspensionReason: text('suspension_reason'),
  /** The version of the instance's terms this person agreed to, and when (docs/systems/legal.md). */
  termsVersion: integer('terms_version'),
  termsAcceptedAt: integer('terms_accepted_at'),
  isDeleted: integer('is_deleted').default(0),
  profileUpdatedAt: integer('profile_updated_at'),
  passwordChangedAt: integer('password_changed_at'),
  /** When this account last changed its username (docs/systems/auth.md, "Changing a username"). */
  usernameChangedAt: integer('username_changed_at'),
  /**
   * The account's address (docs/systems/email.md). Lower case. Verified when
   * `email_verified_at` is set; only then does it open anything. Local accounts only:
   * a replicated row has none, and it is never relayed.
   */
  email: text('email'),
  emailVerifiedAt: integer('email_verified_at'),
  /** A new address waiting for its link; the old one stays in force until then. */
  pendingEmail: text('pending_email'),
  /** The language mail to this account is written in (SupportedLanguage); null until the client said. */
  locale: text('locale'),
  /** Since when signing in takes a second factor. The secret itself is in `two_factor_secrets`. */
  twoFactorEnabledAt: integer('two_factor_enabled_at'),
  showActivity: integer('show_activity').notNull().default(1),
  /** Who may start a conversation with this person (DmPolicy, utils/contactPolicy.ts). */
  /** `person` signs in. A `webhook` (or later `bot`) account is left out of everything that lists people. */
  accountKind: text('account_kind').$type<AccountKind>().notNull().default('person'),
  dmPolicy: text('dm_policy').notNull().default('friends_and_spaces'),
  /** Who may send this person a friend request (FriendRequestPolicy). */
  friendRequestPolicy: text('friend_request_policy').notNull().default('anyone'),
  federationRegistryUpdatedAt: integer('federation_registry_updated_at').default(0),
  federationHealPending: integer('federation_heal_pending').default(0),
  federationHomeOrphaned: integer('federation_home_orphaned').default(0),
  /**
   * The identity a detached account (`federation_home_orphaned = 1`) had before
   * it was detached: its former home instance and its id there. Detaching
   * moves `home_instance`/`home_user_id` here and clears them, so the row is
   * homed on this instance and presents itself to peers as one of its users
   * (federation.md, "Detached accounts are homed here"). Read only to resolve
   * a reference to the former identity back to this row (`resolveRelayActor`),
   * for re-attach, and for the reset-cleanup admin listing. Kept on a
   * tombstone; cleared by re-attach.
   */
  detachedHomeInstance: text('detached_home_instance'),
  detachedHomeUserId: text('detached_home_user_id'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  /**
   * Every federated identity lookup starts with `home_user_id = ?`
   * (`resolveRelayActor`, `resolveLocalUser`, the relay mention lists).
   * Single column on purpose: a home user id matches about one row, and most
   * pair lookups compare `home_instance` normalized or in code, where a
   * composite's second column cannot be used.
   */
  homeUserIdx: index('idx_users_home_user_id').on(table.homeUserId),
  /** `resolveRelayActor` matches a former (detached) identity in the same query as `home_user_id`. */
  detachedHomeUserIdx: index('idx_users_detached_home_user_id').on(table.detachedHomeUserId),
  /** Unique among verified addresses only, so typing someone's address neither claims it nor reveals it. */
  verifiedEmailIdx: uniqueIndex('idx_users_verified_email').on(table.email).where(sql`email_verified_at IS NOT NULL`),
}));

export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  banner: text('banner'),
  avatarColor: text('avatar_color'),
  ownerId: text('owner_id').notNull().references(() => users.id),
  ownerTitle: text('owner_title'),
  /**
   * 1: the member list shows the owner in a group of their own (Space.ownerGroup).
   * Migration 0040 set it for every space that had named that group, so those
   * keep the list they chose; 0 lists the owner under their own roles.
   */
  ownerGroup: integer('owner_group').notNull().default(0),
  inviteCode: text('invite_code').unique(),
  /** Its own invite address, which also has a row in `space_invites` (shared/src/vanityInvites.ts). */
  vanityCode: text('vanity_code').unique(),
  visibility: text('visibility').default('private'),
  directoryListed: integer('directory_listed').notNull().default(0),
  description: text('description'),
  /**
   * JSON array of the badges an instance admin gave the space
   * (GrantedSpaceBadgeId); null without. Verified is not stored here: it comes
   * from `verification_status`.
   */
  badges: text('badges'),
  /**
   * The platform's verification of the space (docs/systems/admin.md,
   * "Verification"): null when never requested, else 'pending',
   * 'needs_info', 'verified', 'rejected' or 'revoked'. The one status field;
   * the request is in space_verification_requests, every decision in
   * space_review_events.
   */
  verificationStatus: text('verification_status'),
  /**
   * The platform's approval of the space's Discovery listing (docs/systems/
   * admin.md, "Discovery approval"): null when never submitted, else
   * 'pending', 'changes_requested', 'approved', 'rejected' or 'withdrawn'.
   * Only 'approved' lists the space; nothing an owner sets does.
   */
  discoveryStatus: text('discovery_status'),
  /**
   * The notification level a member starts with until they choose their own
   * ('all' | 'mentions'); NULL keeps the built-in default. Read by the
   * clients only (`resolveChannelNotificationPolicy`).
   */
  defaultNotificationLevel: text('default_notification_level'),
  /**
   * What the space says to someone new (shared/src/welcome.ts). With `rules_required_since` set,
   * a member who joined after that has to agree to `rules_text` before they can take part.
   * The channels are a JSON array of ids.
   */
  welcomeText: text('welcome_text'),
  rulesText: text('rules_text'),
  rulesRequiredSince: integer('rules_required_since'),
  welcomeChannelIds: text('welcome_channel_ids'),
  createdAt: integer('created_at').notNull(),
});

export const spaceMembers = sqliteTable('space_members', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  nickname: text('nickname'),
  /** The member's own picture, banner and about text for this space; null falls back to the account's (Member.avatar). */
  avatar: text('avatar'),
  banner: text('banner'),
  bio: text('bio'),
  joinedAt: integer('joined_at').notNull(),
  /**
   * While in the future (epoch ms, this server's clock) the member is timed
   * out: no posting, reacting or joining voice in the space. NULL or a past
   * time when not. See utils/spaceModeration.ts.
   */
  timedOutUntil: integer('timed_out_until'),
  /** When they agreed to the space's rules; null when they have not. */
  rulesAcceptedAt: integer('rules_accepted_at'),
}, (table) => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId] }),
  userIdx: index('idx_space_members_user_id').on(table.userId),
}));

export const channelCategories = sqliteTable('channel_categories', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  spaceIdx: index('idx_channel_categories_space_id').on(table.spaceId),
}));

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  topic: text('topic'),
  position: integer('position').default(0),
  categoryId: text('category_id'),
  /** Slow mode: seconds a member waits between two messages here (one of SLOWMODE_SECONDS); 0 is off. */
  slowmodeSeconds: integer('slowmode_seconds').notNull().default(0),
  /** Its own icon in place of its type's: `glyph:<id>` or an emoji (shared/src/channelIcons.ts). */
  icon: text('icon'),
  /**
   * A thread (`type = 'thread'`, docs/systems/threads.md): the channel it is in, whose rights
   * it has, the message it grew from (null once that is gone) and who started it. A listing
   * of a space's channels leaves threads out.
   */
  parentChannelId: text('parent_channel_id').references((): AnySQLiteColumn => channels.id, { onDelete: 'cascade' }),
  threadStarterMessageId: text('thread_starter_message_id').references((): AnySQLiteColumn => messages.id, { onDelete: 'set null' }),
  threadCreatedBy: text('thread_created_by'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  spaceIdx: index('idx_channels_space_id').on(table.spaceId),
  parentIdx: index('idx_channels_parent').on(table.parentChannelId),
  starterIdx: uniqueIndex('idx_channels_thread_starter').on(table.threadStarterMessageId).where(sql`thread_starter_message_id IS NOT NULL`),
}));

/** Who follows a thread: their alerts and unread count come from it. Going from the space takes this too. */
export const threadMembers = sqliteTable('thread_members', {
  threadId: text('thread_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: integer('joined_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.threadId, table.userId] }),
  userIdx: index('idx_thread_members_user').on(table.userId),
}));

/**
 * The tags of a forum (docs/systems/forums.md): what a post can be sorted under. `color` is a
 * name of the accent family (`FORUM_TAG_COLORS`).
 */
export const forumTags = sqliteTable('forum_tags', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  channelIdx: index('idx_forum_tags_channel').on(table.channelId),
}));

/** Which tags a post carries. A post goes with its tags, and a tag from all its posts. */
export const forumPostTags = sqliteTable('forum_post_tags', {
  threadId: text('thread_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => forumTags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.threadId, table.tagId] }),
  tagIdx: index('idx_forum_post_tags_tag').on(table.tagId),
}));

/**
 * An announcement channel another space follows: what is posted there arrives as a copy in the
 * target, written by `account_id` (`users.account_kind = 'follow'`). Either channel going takes
 * this with it. When the person who set it up goes, it keeps working: it belongs to the channel.
 */
export const channelFollows = sqliteTable('channel_follows', {
  id: text('id').primaryKey(),
  sourceChannelId: text('source_channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  targetChannelId: text('target_channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdBy: text('created_by'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pairIdx: uniqueIndex('idx_channel_follows_pair').on(table.sourceChannelId, table.targetChannelId),
  targetIdx: index('idx_channel_follows_target').on(table.targetChannelId),
}));

/** Own invite addresses an administrator took away: nobody can take them again. */
/** Names given up a short while ago: out of reach until `until`, so nobody can pose as who had them. */
export const retiredUsernames = sqliteTable('retired_usernames', {
  username: text('username').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  until: integer('until').notNull(),
});

export const blockedVanityCodes = sqliteTable('blocked_vanity_codes', {
  code: text('code').primaryKey(),
  createdAt: integer('created_at').notNull(),
});

/**
 * When a member last posted in a slow mode channel: one row per channel and
 * member, written with each message accepted while the channel has slow mode
 * on, so the wait survives restarts and deleting the message. The channel's
 * rows are dropped when its slow mode is switched off. See
 * utils/spaceModeration.ts.
 */
export const channelSlowmodePosts = sqliteTable('channel_slowmode_posts', {
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postedAt: integer('posted_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.channelId, table.userId] }),
}));

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  replyToId: text('reply_to_id'),
  content: text('content'),
  type: text('type', { enum: ['user', 'system'] }).notNull().default('user'),
  editedAt: integer('edited_at'),
  /** When the message was pinned to its channel, and by whom; null when it is not (routes/pins.ts). */
  pinnedAt: integer('pinned_at'),
  pinnedBy: text('pinned_by'),
  /** A copy of a message forwarded here (routes/forward.ts). */
  forwarded: integer('forwarded', { mode: 'boolean' }).notNull().default(false),
  /** JSON: what a bot or a webhook showed besides text (shared/src/cards.ts). */
  cards: text('cards'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  replyToFk: foreignKey({
    columns: [table.replyToId],
    foreignColumns: [table.id],
  }).onDelete('set null'),
  channelIdx: index('idx_messages_channel_id').on(table.channelId),
  pinnedIdx: index('idx_messages_channel_pinned').on(table.channelId, table.pinnedAt).where(sql`pinned_at IS NOT NULL`),
  userIdx: index('idx_messages_user_id').on(table.userId),
  // Unread counts (ws/channelUnreadCounts.ts): the messages of a channel after
  // a read cursor, compared as numbers, with the author to leave out the
  // reader's own and the type to leave out system rows, so a count reads the
  // index alone. The expression is unqualified because SQLite refuses a
  // qualified column in an index expression, and the query must spell it
  // `CAST(... AS INTEGER)` in this case for the planner to match it.
  unreadIdx: index('idx_messages_channel_unread').on(table.channelId, sql`CAST(id AS INTEGER)`, table.userId, table.type),
}));

/**
 * A poll in a space channel (routes/polls.ts): a message whose content is the question.
 * Its answers and votes go with the message. The votes of a deleted account go with it.
 */
export const polls = sqliteTable('polls', {
  messageId: text('message_id').primaryKey().references(() => messages.id, { onDelete: 'cascade' }),
  multiple: integer('multiple', { mode: 'boolean' }).notNull().default(false),
  /** When it ends by itself; null when it runs until someone ends it. */
  endsAt: integer('ends_at'),
  endedAt: integer('ended_at'),
  createdAt: integer('created_at').notNull(),
});

export const pollOptions = sqliteTable('poll_options', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  label: text('label').notNull(),
}, (table) => ({
  messageIdx: index('idx_poll_options_message').on(table.messageId),
}));

export const pollVotes = sqliteTable('poll_votes', {
  optionId: text('option_id').notNull().references(() => pollOptions.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.optionId, table.userId] }),
  messageIdx: index('idx_poll_votes_message').on(table.messageId, table.userId),
  userIdx: index('idx_poll_votes_user').on(table.userId),
}));

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  dmMessageId: text('dm_message_id').references(() => dmMessages.id, { onDelete: 'cascade' }),
  uploaderId: text('uploader_id'),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimetype: text('mimetype').notNull(),
  size: integer('size').notNull(),
  thumbnailFilename: text('thumbnail_filename'),
  width: integer('width'),
  height: integer('height'),
  duration: real('duration'),
  // Tri-state web-playability for video attachments: 1 = decodable in a
  // browser <video>, 0 = known-undecodable (e.g. HEVC .mov), NULL = unknown
  // (codec unprobed / non-video). Drives the client's download fallback.
  playable: integer('playable', { mode: 'boolean' }),
  /** The sender marked it as a spoiler; set when the message is sent. */
  spoiler: integer('spoiler', { mode: 'boolean' }).notNull().default(false),
  /** A voice message's bar heights, `12,40,7` (shared/src/voiceMessages.ts). Null for any other file. */
  voiceWaveform: text('voice_waveform'),
  sourceUrl: text('source_url'),
  federationStatus: text('federation_status'),
  federationMeta: text('federation_meta'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  messageIdx: index('idx_attachments_message_id').on(table.messageId),
  uploaderIdx: index('idx_attachments_uploader').on(table.uploaderId),
  dmMessageIdx: index('idx_attachments_dm_message_id').on(table.dmMessageId),
}));

export const embeds = sqliteTable('embeds', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  dmMessageId: text('dm_message_id').references(() => dmMessages.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  embedType: text('embed_type').notNull(),
  provider: text('provider'),
  title: text('title'),
  description: text('description'),
  image: text('image'),
  embedUrl: text('embed_url'),
  width: integer('width'),
  height: integer('height'),
  color: text('color'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  messageIdx: index('idx_embeds_message_id').on(table.messageId),
  dmMessageIdx: index('idx_embeds_dm_message_id').on(table.dmMessageId),
}));

export const dmChannels = sqliteTable('dm_channels', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id'),
  federatedId: text('federated_id'),
  ownerHomeUserId: text('owner_home_user_id'),
  ownerHomeInstance: text('owner_home_instance'),
  deletedAt: integer('deleted_at'),
  createdAt: integer('created_at').notNull(),
  name: text('name'),
  icon: text('icon'),
  metadataUpdatedAt: integer('metadata_updated_at').default(0).notNull(),
}, (table) => ({
  federatedIdx: uniqueIndex('idx_dm_federated')
    .on(table.federatedId)
    .where(sql`federated_id IS NOT NULL`),
}));

export const dmMembers = sqliteTable('dm_members', {
  dmChannelId: text('dm_channel_id').notNull().references(() => dmChannels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  closed: integer('closed').default(0),
  // When `closed` last took its current value, for last-writer-wins against a
  // relayed dm_close / dm_reopen: the member's own action or the membership's
  // start (local clock), or the relayed event's timestamp. Written only through
  // utils/dmMemberClosed.ts.
  closedChangedAt: integer('closed_changed_at').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.dmChannelId, table.userId] }),
  userIdx: index('idx_dm_members_user_id').on(table.userId),
}));

export const dmMessages = sqliteTable('dm_messages', {
  id: text('id').primaryKey(),
  dmChannelId: text('dm_channel_id').notNull().references(() => dmChannels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id),
  replyToId: text('reply_to_id'),
  content: text('content'),
  type: text('type').notNull().default('user'),
  editedAt: integer('edited_at'),
  sourceInstance: text('source_instance'),
  sourceMessageId: text('source_message_id'),
  encryptionVersion: integer('encryption_version').default(0),
  /** As on `messages`. `pin_changed_at` is the last change either way: a relayed older state does not replace a newer one. */
  pinnedAt: integer('pinned_at'),
  pinnedBy: text('pinned_by'),
  pinChangedAt: integer('pin_changed_at'),
  /** A copy of a message forwarded here (routes/forward.ts). */
  forwarded: integer('forwarded', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  replyToFk: foreignKey({
    columns: [table.replyToId],
    foreignColumns: [table.id],
  }).onDelete('set null'),
  channelIdx: index('idx_dm_messages_dm_channel_id').on(table.dmChannelId),
  pinnedIdx: index('idx_dm_messages_channel_pinned').on(table.dmChannelId, table.pinnedAt).where(sql`pinned_at IS NOT NULL`),
  userIdx: index('idx_dm_messages_user_id').on(table.userId),
  // Unread counts, as idx_messages_channel_unread above.
  unreadIdx: index('idx_dm_messages_channel_unread').on(table.dmChannelId, sql`CAST(id AS INTEGER)`, table.userId),
  sourceUniqueIdx: uniqueIndex('idx_dm_messages_source_unique')
    .on(table.sourceInstance, table.sourceMessageId)
    .where(sql`source_instance IS NOT NULL`),
}));

export const friends = sqliteTable('friends', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  friendId: text('friend_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.friendId] }),
  userIdx: index('idx_friends_user_id').on(table.userId),
  friendIdx: index('idx_friends_friend_id').on(table.friendId),
}));

/**
 * Who has blocked whom. A block is one-directional (the blocker chose it) but its
 * effects on direct contact are mutual while it exists: neither person can start
 * a conversation, send a friend request or message the other. The blocked person
 * is never told. See utils/blocks.ts.
 */
export const userBlocks = sqliteTable('user_blocks', {
  blockerId: text('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  blockedId: text('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.blockerId, table.blockedId] }),
  blockedIdx: index('idx_user_blocks_blocked_id').on(table.blockedId),
}));

/**
 * The instance's custom emoji (shared/src/customEmoji.ts). The picture is the
 * file `emoji/<id>.webp` under the upload directory, which the attachment
 * janitor never reads; deleting the row deletes the file.
 */
export const customEmojis = sqliteTable('custom_emojis', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  animated: integer('animated').notNull().default(0),
  size: integer('size').notNull(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  createdByIdx: index('idx_custom_emojis_created_by').on(table.createdBy),
}));

export const friendRequests = sqliteTable('friend_requests', {
  id: text('id').primaryKey(),
  fromId: text('from_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toId: text('to_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').default('pending'), // 'pending', 'accepted', 'declined'
  createdAt: integer('created_at').notNull(),
  relayMessageId: text('relay_message_id'),  // entityId of the originating relay event; null for local-only requests. Used by the rollback hook in federationRollback.ts to find rows for deletion when a federated friend_request_create is permanently rejected.
}, (table) => ({
  toIdx: index('idx_friend_requests_to_id').on(table.toId),
  fromIdx: index('idx_friend_requests_from_id').on(table.fromId),
  relayMessageIdx: index('idx_friend_requests_relay_message_id').on(table.relayMessageId),
}));

export const reactions = sqliteTable('reactions', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  messageIdx: index('idx_reactions_message_id').on(table.messageId),
  // One reaction per user, emoji and message. A repeat insert is refused.
  messageUserEmojiIdx: uniqueIndex('idx_reactions_message_user_emoji').on(table.messageId, table.userId, table.emoji),
}));

export const dmReactions = sqliteTable('dm_reactions', {
  id: text('id').primaryKey(),
  dmMessageId: text('dm_message_id').notNull().references(() => dmMessages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  dmMessageIdx: index('idx_dm_reactions_dm_message_id').on(table.dmMessageId),
  // One reaction per user, emoji and message. A repeat insert is refused.
  dmMessageUserEmojiIdx: uniqueIndex('idx_dm_reactions_message_user_emoji').on(table.dmMessageId, table.userId, table.emoji),
}));

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** The role made for a bot when it came into the space; it gets the same one back after a kick. */
  botId: text('bot_id'),
  color: text('color').default('#b9bbbe'),
  position: integer('position').default(0),
  permissions: text('permissions'), // JSON string of permission keys
  /** What the role is for; null without one (Role.description). */
  description: text('description'),
  /** The gradient's second colour, `#rrggbb`; null for a plain colour. */
  colorSecondary: text('color_secondary'),
  /** An emoji drawn beside the name; null without one. */
  icon: text('icon'),
  /** Members are listed under the role in the member list (Role.hoist). 1 for every role that predates the flag, which is how they were listed. */
  hoist: integer('hoist').notNull().default(1),
  /** Anyone may @mention the role without MENTION_EVERYONE. */
  mentionable: integer('mentionable').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  spaceIdx: index('idx_roles_space_id').on(table.spaceId),
}));

export const memberRoles = sqliteTable('member_roles', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId, table.roleId] }),
  userSpaceIdx: index('idx_member_roles_user_id_space_id').on(table.userId, table.spaceId),
}));

export const channelOverrides = sqliteTable('channel_overrides', {
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(), // 'role' | 'member'
  targetId: text('target_id').notNull(), // role ID or user ID
  allow: text('allow').notNull().default('0'), // BigInt decimal string
  deny: text('deny').notNull().default('0'), // BigInt decimal string
}, (table) => ({
  pk: primaryKey({ columns: [table.channelId, table.targetType, table.targetId] }),
  channelIdx: index('idx_channel_overrides_channel_id').on(table.channelId),
}));

export const categoryOverrides = sqliteTable('category_overrides', {
  categoryId: text('category_id').notNull().references(() => channelCategories.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  allow: text('allow').notNull().default('0'),
  deny: text('deny').notNull().default('0'),
}, (table) => ({
  pk: primaryKey({ columns: [table.categoryId, table.targetType, table.targetId] }),
  categoryIdx: index('idx_category_overrides_category_id').on(table.categoryId),
}));

export const readStates = sqliteTable('read_states', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  lastReadMessageId: text('last_read_message_id').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.channelId] }),
  userIdx: index('idx_read_states_user_id').on(table.userId),
}));

/**
 * A user's notification setting for a space (`channel_id` NULL) or for one
 * channel of it. Lives on the instance that hosts the space and is keyed by
 * the user's row here (for a federated member, their account on this
 * instance). `level` NULL is "not chosen": the channel inherits the space,
 * the space uses the default. `muted` with `muted_until` NULL lasts until
 * lifted. A row with no choice left is deleted, not kept.
 * See docs/systems/sounds.md ("Notification settings").
 */
export const notificationSettings = sqliteTable('notification_settings', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  level: text('level'),
  muted: integer('muted').notNull().default(0),
  mutedUntil: integer('muted_until'),
  suppressEveryone: integer('suppress_everyone').notNull().default(0),
  suppressRoles: integer('suppress_roles').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({
  // One space-wide row and one row per channel, per user. Two partial
  // indexes because a NULL channel_id never collides in a plain unique index.
  spaceRowIdx: uniqueIndex('idx_notification_settings_space_row')
    .on(table.userId, table.spaceId)
    .where(sql`${table.channelId} IS NULL`),
  channelRowIdx: uniqueIndex('idx_notification_settings_channel_row')
    .on(table.userId, table.channelId)
    .where(sql`${table.channelId} IS NOT NULL`),
}));

export const spaceFolders = sqliteTable('space_folders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  color: text('color'),
  position: integer('position').default(0),
  createdAt: integer('created_at').notNull(),
});

export const spaceFolderMembers = sqliteTable('space_folder_members', {
  folderId: text('folder_id').notNull().references(() => spaceFolders.id, { onDelete: 'cascade' }),
  spaceId: text('space_id').notNull(), // No FK — federated space IDs don't exist locally
  position: integer('position').default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.folderId, table.spaceId] }),
}));

export const userSpaceLayout = sqliteTable('user_space_layout', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  layout: text('layout').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
});

export const instanceSettings = sqliteTable('instance_settings', {
  id: integer('id').primaryKey().default(1),
  // The column default stays 'Backspace' deliberately: changing a SQLite column
  // default makes drizzle-kit emit a full table rebuild, and the only INSERT
  // into this table is `ensureDefaults`, which writes DEFAULT_INSTANCE_NAME
  // explicitly. Read paths fall back to DEFAULT_INSTANCE_NAME for NULL.
  instanceName: text('instance_name').default('Backspace'),
  workerId: integer('worker_id'),
  instanceId: text('instance_id'),
  discoveryEnabled: integer('discovery_enabled').notNull().default(1),
  maxBitrateKbps: integer('max_bitrate_kbps').notNull().default(20000),
  minBitrateKbps: integer('min_bitrate_kbps').notNull().default(500),
  bitrateStepKbps: integer('bitrate_step_kbps').notNull().default(500),
  allowedResolutions: text('allowed_resolutions').notNull().default('540,720,1080'),
  allowedFramerates: text('allowed_framerates').notNull().default('30,45,60'),
  maxResolution: integer('max_resolution').notNull().default(1080),
  maxFramerate: integer('max_framerate').notNull().default(60),
  registrationOpen: integer('registration_open'),  // null = use env var default, 0/1 = explicit
  federatedRegistrationOpen: integer('federated_registration_open').notNull().default(1),
  gifApiKey: text('gif_api_key'),
  bitrateMatrixOverrides: text('bitrate_matrix_overrides'),
  allowCustomBitrate: integer('allow_custom_bitrate').notNull().default(1),
  maxUploadSizeBytes: integer('max_upload_size_bytes'),
  federationRelayEnabled: integer('federation_relay_enabled').notNull().default(1),
  federationRelayTtlDays: integer('federation_relay_ttl_days').notNull().default(30),
  defaultAutoRotateIntervalDays: integer('default_auto_rotate_interval_days').notNull().default(90),
  autoAcceptPeering: integer('auto_accept_peering').notNull().default(1),
  /** The admin allows spaces on this instance to be listed in the directory. */
  directoryEnabled: integer('directory_enabled').notNull().default(0),
  /** A directory ping is owed. Survives restarts and the toggle being off. */
  directoryDirty: integer('directory_dirty').notNull().default(0),
  /** ms timestamp of the last successful directory ping. */
  directoryLastPingAt: integer('directory_last_ping_at'),
  /** JSON DirectoryPingError of the last failed ping, null after a success. */
  directoryLastError: text('directory_last_error'),
  /** People on this instance see spaces from other instances in Explore. */
  directoryBrowseEnabled: integer('directory_browse_enabled').notNull().default(1),
  /** What an account may keep in files; 0 means no limit (utils/accountLimits.ts). */
  storagePerAccountBytes: integer('storage_per_account_bytes').notNull().default(5368709120),
  /** How many spaces an account may own; 0 means no limit. */
  spacesPerAccount: integer('spaces_per_account').notNull().default(25),
  /** Who may add to the instance's emoji library: 'admins' or 'everyone'. */
  emojiPolicy: text('emoji_policy').notNull().default('admins'),
  /**
   * Since when a new local account needs a verified address before it may do anything in a space
   * but read, create spaces or approach strangers (docs/systems/email.md, "The gate"). Null: off.
   * Older accounts are not concerned.
   */
  emailRequiredSince: integer('email_required_since'),
  /**
   * Whether an address at a throwaway mail domain (email/throwawayDomains.txt) is refused at
   * sign-up and when an address is set (docs/systems/email.md, "Throwaway addresses"). 1: refused.
   * Addresses already on accounts stay as they are.
   */
  blockThrowawayEmail: integer('block_throwaway_email').notNull().default(1),
  /**
   * What a browser solves before an account is created (SignupChallengeLevel). A row made
   * from here on is `normal` (ensureDefaults); the migration set the one that existed.
   */
  signupChallenge: text('signup_challenge').notNull().default('off'),
  /** When this server started lately, as JSON, to tell a restart loop from an update (utils/operatorAlerts.ts). */
  recentStarts: text('recent_starts'),
  /** Whether people here may run bots. Off until the operator turns it on. */
  botsEnabled: integer('bots_enabled').notNull().default(0),
  /** Instance accent colour as `#rrggbb`; null = the built-in default (DEFAULT_ACCENT_COLOR). Validated on write. */
  accentColor: text('accent_color'),
  /** JSON LegalOperator: who runs the instance (docs/systems/legal.md). Null until an admin fills it in. */
  legalOperator: text('legal_operator'),
  /** First-boot timestamp (ms); backfilled by ensureDefaults, so non-null after boot. */
  installedAt: integer('installed_at'),
  /**
   * When this instance began recording applied relay events in
   * `federation_applied_events` (ms): the upgrade that ran migration 0022.
   * Null on an instance that recorded them from its first boot. A friend
   * event applied before it cannot be recognized, so the pull never reads a
   * peer's friend events from before it (utils/federationSync.ts).
   */
  ledgerStartedAt: integer('ledger_started_at'),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * One signed-in device: a token names its row (`sid`), and a token whose row is gone
 * is refused at once. docs/systems/auth.md, "Sessions". The address is cut short and the
 * label is a browser and a system, enough to recognise a device and nothing more.
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  /** Written at most every few minutes (`touchSession`). */
  lastActiveAt: integer('last_active_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  clientLabel: text('client_label'),
  addressHint: text('address_hint'),
}, (table) => ({
  userIdx: index('idx_sessions_user').on(table.userId),
  expiresIdx: index('idx_sessions_expires').on(table.expiresAt),
}));

/**
 * A copy of what this instance holds about an account, asked for by that person
 * (utils/dataExport.ts). The file is `<id>.zip` in `config.exportDir`.
 */
export const dataExports = sqliteTable('data_exports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'pending', 'ready' or 'failed'. */
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  /** When the file and this row go. */
  expiresAt: integer('expires_at').notNull(),
  sizeBytes: integer('size_bytes'),
}, (table) => ({
  userIdx: index('idx_data_exports_user').on(table.userId),
}));

/**
 * The links into a space. `spaces.invite_code` names the standing one, the link the
 * Invite dialog hands out; a space can have others with an end date or a limit. A
 * link that was revoked, ran out or expired has no row (or none that counts), so it
 * leads nowhere: docs/systems/spaces.md, "Invite links".
 */
export const spaceInvites = sqliteTable('space_invites', {
  code: text('code').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  /** When it stops working; null for never. */
  expiresAt: integer('expires_at'),
  /** How many people it may let in; null for no limit. */
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
}, (table) => ({
  spaceIdx: index('space_invites_space_idx').on(table.spaceId),
}));

export const bans = sqliteTable('bans', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  bannedBy: text('banned_by').references(() => users.id),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId] }),
  spaceIdx: index('idx_bans_space_id').on(table.spaceId),
}));

export const joinRequests = sqliteTable('join_requests', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  message: text('message'),
  status: text('status').notNull().default('pending'),
  decidedBy: text('decided_by').references(() => users.id),
  createdAt: integer('created_at').notNull(),
  decidedAt: integer('decided_at'),
}, (table) => ({
  spaceStatusIdx: index('idx_join_requests_space_id_status').on(table.spaceId, table.status),
}));

export const voiceRestrictions = sqliteTable('voice_restrictions', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  restrictionType: text('restriction_type').notNull(), // 'mute' | 'deafen'
  moderatorId: text('moderator_id').references(() => users.id),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId, table.restrictionType] }),
  spaceIdx: index('idx_voice_restrictions_space_id').on(table.spaceId),
}));

/**
 * The timeout of a member who left or was kicked while timed out, kept until
 * it ends so that leaving and joining again does not lift it: a join restores
 * it onto the new `space_members` row and drops this one. A ban needs none
 * (the banned cannot join). Written and read only by utils/spaceModeration.ts.
 */
export const spaceDepartedTimeouts = sqliteTable('space_departed_timeouts', {
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  timedOutUntil: integer('timed_out_until').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.spaceId, table.userId] }),
}));

/**
 * A space's automatic message rules (SpaceModerationSettings). A space
 * without a row has the defaults: nothing blocked, no limits. Written only by
 * `PATCH /api/spaces/:id/moderation`, read by utils/spaceModeration.ts.
 */
export const spaceModerationSettings = sqliteTable('space_moderation_settings', {
  spaceId: text('space_id').primaryKey().references(() => spaces.id, { onDelete: 'cascade' }),
  /** JSON array of strings, stored as `normalizeModerationSettings` returns them. */
  blockedWords: text('blocked_words').notNull().default('[]'),
  blockLinks: integer('block_links').notNull().default(0),
  blockInvites: integer('block_invites').notNull().default(0),
  maxMentions: integer('max_mentions').notNull().default(0),
  minAccountAgeMinutes: integer('min_account_age_minutes').notNull().default(0),
  minMemberAgeMinutes: integer('min_member_age_minutes').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * The space's audit log: one row per moderation or settings change, newest
 * read first. `id` is a snowflake, so ids sort by time and page the log.
 * `actor_id` has no foreign key on purpose: an entry outlives its actor.
 * Written only through utils/auditLog.ts, which also drops entries older than
 * 180 days.
 */
export const spaceAuditLog = sqliteTable('space_audit_log', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  targetLabel: text('target_label'),
  /** JSON AuditLogChange[], or NULL when the entry records no field. */
  changes: text('changes'),
  reason: text('reason'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  // Paging newest first within one space compares ids as numbers, written
  // `CAST(... AS INTEGER)` exactly as here so the planner uses the index (see
  // idx_messages_channel_unread for why the column is unqualified).
  spacePageIdx: index('idx_space_audit_log_space_page').on(table.spaceId, sql`CAST(id AS INTEGER)`),
  // The retention sweep deletes a space's entries older than a cut-off.
  spaceCreatedIdx: index('idx_space_audit_log_space_created').on(table.spaceId, table.createdAt),
}));

export const federationPeers = sqliteTable('federation_peers', {
  id: text('id').primaryKey(),
  origin: text('origin').notNull().unique(),
  instanceName: text('instance_name'),
  hmacSecret: text('hmac_secret').notNull(),
  status: text('status').notNull().default('active'),
  // Who caused this row to exist. Only 'admin' is proof that a local admin
  // deliberately authorized peering with this origin, which is what the
  // inbound /peer/accept gate consults when autoAcceptPeering = 0:
  //   'admin'  — POST /peer/initiate, or an approval/denial decision in
  //              routes/federation/handlers/approvals.ts.
  //   'auto'   — created by local traffic without an admin decision: the
  //              outbox placeholder, or ensurePeered() auto-peering.
  //   'remote' — created by an inbound /peer/accept from the remote itself.
  // Rows that predate this column read as 'auto' (fail closed): a stale
  // pending row cannot stand in for an admin decision.
  initiatedBy: text('initiated_by', { enum: ['admin', 'auto', 'remote'] }).notNull().default('auto'),
  lastSeenAt: integer('last_seen_at'),
  lastFailureAt: integer('last_failure_at'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  consecutiveAuthFailures: integer('consecutive_auth_failures').notNull().default(0),
  lastProbeAt: integer('last_probe_at'),
  probeAttempts: integer('probe_attempts').notNull().default(0),
  lastSyncedAt: integer('last_synced_at').default(0),
  remoteMaxUploadSize: integer('remote_max_upload_size'),
  nonceSupported: integer('nonce_supported').notNull().default(0),
  pendingHmacSecret: text('pending_hmac_secret'),
  secretRotationAt: integer('secret_rotation_at'),
  secretRotatedAt: integer('secret_rotated_at'),
  autoRotateIntervalDays: integer('auto_rotate_interval_days').notNull().default(90),
  createdAt: integer('created_at').notNull(),
  approvalToken: text('approval_token'),
  peerInstanceId: text('peer_instance_id'),
  observedPeerInstanceId: text('observed_peer_instance_id'),
  // Why the row is in its status, for the statuses that carry a reason
  // (needs_attention, rejected); NULL for every other status. Written only by
  // utils/federationPeerState.ts. See docs/systems/federation.md, "Peer state".
  statusReason: text('status_reason'),
});

// Pull-sync position per peer and context ('dm' | 'friend' | 'profile'): the
// peer's mutation-log row last consumed, in the PEER's clock (`mutated_at`)
// with its row id as the tiebreak. `peerEpoch` is the peer's instance id the
// cursor was taken against; a different epoch restarts the cursor at 0.
// See utils/federationSync.ts.
export const federationSyncCursors = sqliteTable('federation_sync_cursors', {
  peerId: text('peer_id').notNull().references(() => federationPeers.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(),
  cursorTs: integer('cursor_ts').notNull().default(0),
  cursorId: text('cursor_id'),
  peerEpoch: text('peer_epoch'),
  lastPulledAt: integer('last_pulled_at'),
}, (table) => ({
  pk: primaryKey({ columns: [table.peerId, table.contextType] }),
}));

// Pulled events a receiver refused for a reason that can pass later, kept
// with the whole event and replayed locally in the peer's order within each
// subject (`subjectKey`, the unit utils/federationSync.ts orders pulled events
// in). A subject with a row here holds its later pulled events behind it.
// One row per distinct event: `eventHash` is the sha256 of the event's
// canonical JSON, so a re-read of a kept event adds nothing and two events
// that share a type, message and millisecond (two reactions, two rejected
// attachments) are both kept.
export const federationSyncRetry = sqliteTable('federation_sync_retry', {
  id: text('id').primaryKey(),
  peerId: text('peer_id').notNull().references(() => federationPeers.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(),
  subjectKey: text('subject_key').notNull(),
  eventType: text('event_type').notNull(),
  messageId: text('message_id').notNull(),
  eventTs: integer('event_ts').notNull(),
  eventHash: text('event_hash').notNull(),
  eventJson: text('event_json').notNull(),
  lastReason: text('last_reason').notNull(),
  attempts: integer('attempts').notNull().default(1),
  firstFailedAt: integer('first_failed_at').notNull(),
  nextRetryAt: integer('next_retry_at').notNull(),
}, (table) => ({
  eventIdx: uniqueIndex('idx_sync_retry_event').on(table.peerId, table.eventHash),
  subjectIdx: index('idx_sync_retry_subject').on(table.peerId, table.subjectKey),
  orderIdx: index('idx_sync_retry_order').on(table.peerId, table.eventTs),
}));

// Relay events this instance has applied (or a tombstone standing for one),
// for events whose processors cannot tell a second delivery from state alone:
// friend events, and the delete of a message not held here, which answers a
// later create of it as a duplicate. Keyed by the normalized origin the event
// is attributed to. Swept by the janitor after 100 days, longer than the
// 90-day mutation log the pull reads.
export const federationAppliedEvents = sqliteTable('federation_applied_events', {
  sourceOrigin: text('source_origin').notNull(),
  eventKey: text('event_key').notNull(),
  appliedAt: integer('applied_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.sourceOrigin, table.eventKey] }),
  appliedAtIdx: index('idx_applied_events_applied_at').on(table.appliedAt),
}));

// The last applied change per federated subject: a group member (the group's
// federatedId + the member's identity) or a friend pair (both identities).
// Relayed member and friend events apply last-writer-wins against it, on the
// live relay and the pull alike; local changes record it too. `changedAt` is
// the change's own timestamp (the relayed event's, or local time for a change
// made here); `recordedAt` is the local time of the write, for the sweep.
// Written only through utils/federationSubjectClock.ts.
export const federationSubjectClocks = sqliteTable('federation_subject_clocks', {
  subjectKey: text('subject_key').primaryKey(),
  changedAt: integer('changed_at').notNull(),
  recordedAt: integer('recorded_at').notNull(),
}, (table) => ({
  recordedAtIdx: index('idx_subject_clocks_recorded_at').on(table.recordedAt),
}));

// Records a detected federated-peer reset (same origin, new instance epoch).
// One row per origin; upserted when a live epoch change is observed, resolved
// once stale replicated identities are healed.
export const federationResetEvents = sqliteTable('federation_reset_events', {
  origin: text('origin').primaryKey(),
  deadEpoch: text('dead_epoch').notNull(),
  newEpoch: text('new_epoch'),
  detectedAt: integer('detected_at').notNull(),
  resolvedAt: integer('resolved_at'),
  stubCount: integer('stub_count').notNull().default(0),
  orphanedAccountCount: integer('orphaned_account_count').notNull().default(0),
  acknowledgedAt: integer('acknowledged_at'),
});

// One-time proof tokens for detached-account re-attach (re-attach spec §3.1).
// Minted by POST /api/auth/attach-proof for a logged-in native user, verified
// once by a peer via POST /api/federation/verify-attach-proof. Expired/used
// rows are deleted opportunistically on each mint.
export const federationAttachProofs = sqliteTable('federation_attach_proofs', {
  token: text('token').primaryKey(),
  homeUserId: text('home_user_id').notNull(),
  targetDomain: text('target_domain').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
});

// SQL-level CHECK constraint enforces (direction='inbound' → hmac_secret NOT NULL).
// See packages/server/drizzle/0003_brave_inhumans.sql. drizzle-kit cannot represent
// CHECK constraints in its snapshot, so any future migration that recreates this
// table MUST re-add the CHECK clause by hand. The snapshot WILL silently drop it
// otherwise.
export const peerApprovalRequests = sqliteTable('peer_approval_requests', {
  id: text('id').primaryKey(),
  origin: text('origin').notNull(),
  direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull().default('inbound'),
  instanceName: text('instance_name'),
  hmacSecret: text('hmac_secret'),
  requestedAt: integer('requested_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  approvalToken: text('approval_token'),
}, (table) => ({
  uniqOriginDirection: unique().on(table.origin, table.direction),
}));

export const peerApprovalSubscribers = sqliteTable('peer_approval_subscribers', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => peerApprovalRequests.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  triggerReason: text('trigger_reason').notNull(),
  triggerTarget: text('trigger_target').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  uniqSubscription: unique().on(table.requestId, table.userId, table.triggerReason, table.triggerTarget),
  userIdx: index('idx_peer_approval_subscribers_user_id').on(table.userId),
}));

export const peerApprovalNotifications = sqliteTable('peer_approval_notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['approved', 'denied', 'expired'] }).notNull(),
  peerOrigin: text('peer_origin').notNull(),
  triggerReason: text('trigger_reason').notNull(),
  triggerTarget: text('trigger_target').notNull(),
  createdAt: integer('created_at').notNull(),
  readAt: integer('read_at'),
}, (table) => ({
  userIdx: index('idx_peer_approval_notifications_user_id').on(table.userId),
}));

export const federationOutbox = sqliteTable('federation_outbox', {
  id: text('id').primaryKey(),
  peerId: text('peer_id').notNull().references(() => federationPeers.id, { onDelete: 'cascade' }),
  contextId: text('context_id').notNull(),
  /** The id the peer knows the event by (the relay event's `messageId`). */
  entityId: text('entity_id').notNull(),
  /**
   * The queue the row belongs to: the events of one entity, sent one at a
   * time in order and folded only by the rules in federationOutboxQueue.ts.
   * Derived there from the event (`outboxQueueKey`). Null only on rows queued
   * before the column existed, until the boot backfill fills it.
   */
  queueKey: text('queue_key'),
  contextType: text('context_type').notNull().default('dm'),
  eventType: text('event_type').notNull(),
  payload: text('payload').notNull(),
  encryptionVersion: integer('encryption_version').default(0),
  attempts: integer('attempts').default(0),
  nextRetryAt: integer('next_retry_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  /**
   * When some path first possibly handed this event to the peer: the worker
   * putting it on the wire, or the peer pulling `/sync`. Null: the peer
   * cannot have it. Never cleared.
   */
  offeredAt: integer('offered_at'),
}, (table) => ({
  queueIdx: index('idx_outbox_queue').on(table.peerId, table.queueKey, table.createdAt),
  retryIdx: index('idx_outbox_retry').on(table.nextRetryAt),
}));

export const federationFileQueue = sqliteTable('federation_file_queue', {
  id: text('id').primaryKey(),
  peerOrigin: text('peer_origin').notNull(),
  dmMessageId: text('dm_message_id').notNull(),
  sourceUrl: text('source_url').notNull(),
  targetFilename: text('target_filename'),
  originalName: text('original_name').notNull(),
  mimetype: text('mimetype').notNull(),
  size: integer('size').notNull(),
  status: text('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  attempts: integer('attempts').default(0),
  nextRetryAt: integer('next_retry_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const federationMutationLog = sqliteTable('federation_mutation_log', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull(),
  contextId: text('context_id').notNull(),
  contextType: text('context_type').notNull().default('dm'),
  mutationType: text('mutation_type').notNull(),
  mutatedAt: integer('mutated_at').notNull(),
  payload: text('payload'),
}, (table) => ({
  timeIdx: index('idx_mutation_log_time').on(table.mutatedAt),
}));

export const userFederationRegistry = sqliteTable('user_federation_registry', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  origin: text('origin').notNull(),
  label: text('label').notNull().default(''),
  username: text('username').notNull().default(''),
  remoteUserId: text('remote_user_id').notNull().default(''),
  status: text('status').notNull().default('connected'),
  addedAt: integer('added_at').notNull(),
  lastConnectedAt: integer('last_connected_at'),
  disconnectedAt: integer('disconnected_at'),
  errorMessage: text('error_message'),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.origin] }),
}));

// Per-remote credential this user's client presents when registering or logging
// in as itself on ANOTHER instance. Home-instance-only state: the row is written
// and read exclusively by the account's own home instance, is never federated,
// and never leaves the home server except to the account's authenticated client.
//
// Why it exists: the client used to reuse the account's home password verbatim
// for every remote it connected to, handing a reusable home credential to every
// remote operator. Each remote now gets its own high-entropy secret with no
// relationship to the home password or to any other remote's secret.
//
// `provisionedAt` is the migration marker: NULL means the remote account may
// still be carrying a credential this instance did not issue (a pre-existing
// connection), so the client rotates it the next time it holds a live session
// there. Set once the remote account is known to use `secret`.
export const userFederationCredentials = sqliteTable('user_federation_credentials', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  origin: text('origin').notNull(),
  secret: text('secret').notNull(),
  createdAt: integer('created_at').notNull(),
  provisionedAt: integer('provisioned_at'),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.origin] }),
}));

export const inviteLinks = sqliteTable('invite_links', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  name: text('name').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at').notNull(),
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at'),
  revokedAt: integer('revoked_at'),
}, (table) => ({
  createdAtIdx: index('idx_invite_links_created_at').on(table.createdAt),
}));

export const inviteRedemptions = sqliteTable('invite_redemptions', {
  id: text('id').primaryKey(),
  inviteId: text('invite_id').notNull().references(() => inviteLinks.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  registrantUsername: text('registrant_username').notNull(),
  redeemedAt: integer('redeemed_at').notNull(),
}, (table) => ({
  inviteIdx: index('idx_invite_redemptions_invite_id').on(table.inviteId),
  userIdx: index('idx_invite_redemptions_user_id').on(table.userId),
}));

// Assets outlive personal collections so removing a favorite cannot break message history.
export const stickerAssets = sqliteTable('sticker_assets', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
});

export const personalStickers = sqliteTable('personal_stickers', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stickerId: text('sticker_id').notNull().references(() => stickerAssets.id),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.userId, table.stickerId] }) }));

/**
 * A space's verification request (docs/systems/admin.md, "Verification"): one
 * per space, replaced when the owner sends it again. The status is
 * spaces.verification_status; the decisions are in space_review_events.
 */
export const spaceVerificationRequests = sqliteTable('space_verification_requests', {
  spaceId: text('space_id').primaryKey().references(() => spaces.id, { onDelete: 'cascade' }),
  /** The space's name and description when the request was sent. */
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  website: text('website'),
  /** JSON array of public profile addresses (http/https). */
  profiles: text('profiles').notNull().default('[]'),
  reason: text('reason').notNull(),
  /** How the requester shows they run the community: a public post, a page, a contact the reviewer can check. */
  proof: text('proof').notNull(),
  requestedBy: text('requested_by').notNull(),
  requestedAt: integer('requested_at').notNull(),
  decidedBy: text('decided_by'),
  decidedAt: integer('decided_at'),
  decisionNote: text('decision_note'),
});

/**
 * A space's Discovery request (docs/systems/admin.md, "Discovery approval"):
 * one per space. `approved_snapshot` holds the listing as the admin approved
 * it; a change to it sends the space back to review.
 */
export const spaceDiscoveryRequests = sqliteTable('space_discovery_requests', {
  spaceId: text('space_id').primaryKey().references(() => spaces.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  requestedBy: text('requested_by').notNull(),
  requestedAt: integer('requested_at').notNull(),
  decidedBy: text('decided_by'),
  decidedAt: integer('decided_at'),
  decisionNote: text('decision_note'),
  /** JSON { name, description, icon, banner, category } as approved; null until approved. */
  approvedSnapshot: text('approved_snapshot'),
});

/**
 * The history of both reviews: every request, decision and automatic change
 * of a space's verification or Discovery status, with who did it and why.
 */
export const spaceReviewEvents = sqliteTable('space_review_events', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  /** 'verification' | 'discovery' */
  process: text('process').notNull(),
  /** What happened: 'submit', 'approve', 'reject', 'request_changes', 'revoke', 'withdraw', 'changed', 'migrated'. */
  action: text('action').notNull(),
  /** The status the event left; null when it left none (a withdrawn verification request). */
  status: text('status'),
  actorId: text('actor_id').notNull(),
  note: text('note'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  spaceProcessIdx: index('idx_space_review_events_space').on(table.spaceId, table.process, table.createdAt),
}));

/**
 * What the instance's administrators did (docs/systems/admin.md, "Platform
 * audit log"): suspensions, review decisions, badges, Discovery withdrawals.
 * `id` is a snowflake, so ids sort by time and page the log. No foreign keys:
 * an entry outlives its actor and its target.
 */
/** One published version of the terms or the privacy policy (docs/systems/legal.md). Never edited, so an acceptance always names what was agreed to. */
export const legalDocuments = sqliteTable('legal_documents', {
  id: text('id').primaryKey(),
  /** 'terms' | 'privacy' */
  kind: text('kind').notNull(),
  version: integer('version').notNull(),
  /** JSON object: language code to Markdown text. */
  texts: text('texts').notNull(),
  publishedAt: integer('published_at').notNull(),
  effectiveAt: integer('effective_at').notNull(),
  changes: text('changes'),
  publishedBy: text('published_by').notNull(),
}, (table) => ({
  versionIdx: uniqueIndex('idx_legal_documents_version').on(table.kind, table.version),
}));

/** A report of illegal content or of a breach of the terms (DSA Art. 16). Decided ones go after a year. */
export const contentReports = sqliteTable('content_reports', {
  id: text('id').primaryKey(),
  /** 'open' | 'closed' */
  status: text('status').notNull(),
  category: text('category').notNull(),
  explanation: text('explanation').notNull(),
  /** 'message' | 'dm_message' | 'user' | 'space' | 'link' */
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  targetUrl: text('target_url'),
  /** JSON ReportSnapshot: what was reported, as it was then. */
  snapshot: text('snapshot'),
  reporterUserId: text('reporter_user_id'),
  reporterName: text('reporter_name'),
  reporterEmail: text('reporter_email'),
  createdAt: integer('created_at').notNull(),
  decision: text('decision'),
  ground: text('ground'),
  decisionNote: text('decision_note'),
  decidedBy: text('decided_by'),
  decidedAt: integer('decided_at'),
}, (table) => ({
  statusIdx: index('idx_content_reports_status').on(table.status, table.createdAt),
}));

/** What the operator decided, told to the person it concerns (DSA Art. 16(5), 17). Read ones go after a year. */
export const userNotices = sqliteTable('user_notices', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  ground: text('ground'),
  note: text('note'),
  subject: text('subject'),
  until: integer('until'),
  decision: text('decision'),
  createdAt: integer('created_at').notNull(),
  readAt: integer('read_at'),
}, (table) => ({
  userIdx: index('idx_user_notices_user').on(table.userId),
}));

/** A link in a mail: only its hash is here. One per account and purpose. docs/systems/email.md. */
export const emailTokens = sqliteTable('email_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'verify' | 'reset' */
  purpose: text('purpose').notNull(),
  /** The address the link went to. A verify link confirms exactly this one. */
  address: text('address').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => ({
  userIdx: index('idx_email_tokens_user').on(table.userId, table.purpose),
  expiresIdx: index('idx_email_tokens_expires').on(table.expiresAt),
}));

/**
 * Mail waiting to go, and a short memory of what went. The body is never stored: it is
 * rendered when it is sent. The address, the nonce and the parameters go once a row is done.
 */
export const emailOutbox = sqliteTable('email_outbox', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  /** 'critical' | 'verify' | 'notice': who still goes when the day's budget runs low. */
  priority: text('priority').notNull(),
  userId: text('user_id'),
  toAddress: text('to_address'),
  /** The address's hash, for the limits per address. Stays after the address went. */
  toHash: text('to_hash').notNull(),
  locale: text('locale').notNull(),
  /** JSON: what the text names. Never a secret. */
  params: text('params').notNull().default('{}'),
  /** What the mail's link is derived from, with a key that is not in the database. */
  linkNonce: text('link_nonce'),
  /** 'queued' | 'sent' | 'failed' | 'expired' */
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  providerId: text('provider_id'),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
  sentAt: integer('sent_at'),
}, (table) => ({
  dueIdx: index('idx_email_outbox_due').on(table.status, table.nextAttemptAt),
  addressIdx: index('idx_email_outbox_address').on(table.toHash, table.createdAt),
  userIdx: index('idx_email_outbox_user').on(table.userId),
}));

/** How much went, per UTC day. No personal data. */
export const emailUsageDaily = sqliteTable('email_usage_daily', {
  day: text('day').primaryKey(),
  accepted: integer('accepted').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  bounced: integer('bounced').notNull().default(0),
  complained: integer('complained').notNull().default(0),
  /** What the provider itself counted, when it says: it also counts tests from its dashboard. */
  providerDay: integer('provider_day'),
  providerMonth: integer('provider_month'),
});

/** Addresses mail must not go to any more, by hash: they bounced hard or complained. */
export const emailSuppressions = sqliteTable('email_suppressions', {
  addressHash: text('address_hash').primaryKey(),
  /** 'bounce' | 'complaint' */
  reason: text('reason').notNull(),
  createdAt: integer('created_at').notNull(),
});

/**
 * An account's TOTP secret, encrypted with a key that is not in the database and bound to
 * the account (security/twoFactor.ts). `confirmed_at` null: being set up, not in force.
 */
export const twoFactorSecrets = sqliteTable('two_factor_secrets', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  secretEnc: text('secret_enc').notNull(),
  confirmedAt: integer('confirmed_at'),
  /** The newest accepted time step: a code cannot be used twice. */
  lastUsedStep: integer('last_used_step'),
  /** Wrong codes in a row, and until when the next has to wait. Per account, so a new ticket does not help. */
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: integer('locked_until'),
  createdAt: integer('created_at').notNull(),
});

/** Recovery codes, as keyed hashes only. Used ones stay until new ones are made, so they count as used. */
export const twoFactorRecoveryCodes = sqliteTable('two_factor_recovery_codes', {
  codeHash: text('code_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  usedAt: integer('used_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  userIdx: index('idx_two_factor_recovery_user').on(table.userId),
}));

/** The sign-in's first step passed, the second due. Not a token: nothing but the second step reads this. */
export const mfaTickets = sqliteTable('mfa_tickets', {
  ticketHash: text('ticket_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceId: text('device_id'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => ({
  userIdx: index('idx_mfa_tickets_user').on(table.userId),
  expiresIdx: index('idx_mfa_tickets_expires').on(table.expiresAt),
}));

/** What happened to an account's security, for its owner to read. 90 days, 200 per account. */
export const securityEvents = sqliteTable('security_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** SecurityEventKind */
  kind: text('kind').notNull(),
  clientLabel: text('client_label'),
  /** The address cut short, as on a session. */
  addressHint: text('address_hint'),
  /** Repeated failures from one place are one row. */
  count: integer('count').notNull().default(1),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  userIdx: index('idx_security_events_user').on(table.userId, table.createdAt),
  createdIdx: index('idx_security_events_created').on(table.createdAt),
}));

/** Devices an account signed in from, by a hash of a random id the browser keeps. To tell a new one. */
export const knownDevices = sqliteTable('known_devices', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceHash: text('device_hash').notNull(),
  firstSeenAt: integer('first_seen_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.deviceHash] }),
  seenIdx: index('idx_known_devices_seen').on(table.lastSeenAt),
}));

/** What the operator says to everyone signed in, on a banner, while it runs. */
export const announcements = sqliteTable('announcements', {
  id: text('id').primaryKey(),
  /** 'info' | 'warning' */
  tone: text('tone').notNull(),
  body: text('body').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  endsAt: integer('ends_at'),
  endedAt: integer('ended_at'),
  /** Also on the public status page, for anyone, signed in or not. */
  onStatusPage: integer('on_status_page').notNull().default(0),
}, (table) => ({
  liveIdx: index('idx_announcements_live').on(table.endedAt, table.endsAt),
}));

/** What the operator has to hear about (utils/operatorAlerts.ts). A row stays after it clears, to keep the day's mail counted. */
export const operatorAlerts = sqliteTable('operator_alerts', {
  /** 'disk_high' | 'backup_failed' | 'backup_old' | 'offsite_failed' | 'restart_loop' */
  cause: text('cause').primaryKey(),
  active: integer('active').notNull().default(1),
  detail: text('detail'),
  since: integer('since').notNull(),
  lastMailedAt: integer('last_mailed_at'),
});

/** What the admins keep for each other about an account. Goes with the account, and is in its data export. */
export const adminNotes = sqliteTable('admin_notes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  userIdx: index('idx_admin_notes_user').on(table.userId),
}));

/** Who may not sign up: an address at this domain, or this name. It touches no account that exists. */
export const signupRules = sqliteTable('signup_rules', {
  /** 'email_domain' | 'username' */
  kind: text('kind').notNull(),
  /** In lower case. */
  value: text('value').notNull(),
  note: text('note'),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.kind, table.value] }),
}));

/** The public spaces a new account of this instance starts in. */
export const starterSpaces = sqliteTable('starter_spaces', {
  spaceId: text('space_id').primaryKey().references(() => spaces.id, { onDelete: 'cascade' }),
  addedBy: text('added_by').notNull(),
  addedAt: integer('added_at').notNull(),
});

export const platformAuditLog = sqliteTable('platform_audit_log', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  /** 'user' | 'space' | 'instance' (settings, invites, storage) */
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  targetLabel: text('target_label'),
  reason: text('reason'),
  /** JSON object with what the action set (a status, an end time, a badge). */
  details: text('details'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pageIdx: index('idx_platform_audit_log_page').on(sql`CAST(id AS INTEGER)`),
  targetIdx: index('idx_platform_audit_log_target').on(table.targetType, table.targetId),
}));

/** This instance's own signing key for push (one row), made when first needed. Apart from the settings, so no settings route can hand it out. */
export const pushKeys = sqliteTable('push_keys', {
  id: integer('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: integer('created_at').notNull(),
});

/**
 * A browser that wants pushes for an account (docs/systems/push.md). Bound to the session it
 * was made in, so ending the session ends them. `show_text`, `direct_messages` and `locale`
 * are that device's own choices, which the server has to follow while the app is closed.
 */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  showText: integer('show_text', { mode: 'boolean' }).notNull().default(true),
  directMessages: integer('direct_messages', { mode: 'boolean' }).notNull().default(true),
  locale: text('locale'),
  failures: integer('failures').notNull().default(0),
  lastSuccessAt: integer('last_success_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  userIdx: index('idx_push_subscriptions_user').on(table.userId),
}));

/** An event in a space (routes/events.ts). `reminder_sent_at` keeps a reminder to once; moving the event clears it. */
export const spaceEvents = sqliteTable('space_events', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  location: text('location'),
  channelId: text('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  startsAt: integer('starts_at').notNull(),
  endsAt: integer('ends_at'),
  createdBy: text('created_by'),
  reminderSentAt: integer('reminder_sent_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  spaceIdx: index('idx_space_events_space').on(table.spaceId, table.startsAt),
  dueIdx: index('idx_space_events_due').on(table.startsAt).where(sql`reminder_sent_at IS NULL`),
}));

export const spaceEventRsvps = sqliteTable('space_event_rsvps', {
  eventId: text('event_id').notNull().references(() => spaceEvents.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.eventId, table.userId] }),
  userIdx: index('idx_space_event_rsvps_user').on(table.userId),
}));

/**
 * An address that posts into one channel (routes/webhooks.ts). Only the hash of its token is
 * kept. `user_id` is the account its messages are written under; `created_by` is cleared
 * when that person's account goes, and the webhook keeps working: it belongs to the channel.
 */
export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdBy: text('created_by'),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
}, (table) => ({
  channelIdx: index('idx_webhooks_channel').on(table.channelId),
  spaceIdx: index('idx_webhooks_space').on(table.spaceId),
}));

/** A person's own list of messages, with a reminder if they want one (routes/saved.ts). */
export const savedMessages = sqliteTable('saved_messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  dmMessageId: text('dm_message_id').references(() => dmMessages.id, { onDelete: 'cascade' }),
  remindAt: integer('remind_at'),
  reminderSentAt: integer('reminder_sent_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  messageIdx: uniqueIndex('idx_saved_user_message').on(table.userId, table.messageId),
  dmMessageIdx: uniqueIndex('idx_saved_user_dm_message').on(table.userId, table.dmMessageId),
  dueIdx: index('idx_saved_due').on(table.remindAt).where(sql`remind_at IS NOT NULL AND reminder_sent_at IS NULL`),
}));

/** The words that alert a person (shared/src/notificationRules.ts). */
export const notificationKeywords = sqliteTable('notification_keywords', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  word: text('word').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.word] }),
}));

/** A short clip of a space's soundboard (routes/soundboard.ts). The file is in `uploads/sounds`. */
export const spaceSounds = sqliteTable('space_sounds', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mimetype: text('mimetype').notNull(),
  size: integer('size').notNull(),
  duration: real('duration').notNull(),
  createdBy: text('created_by'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  spaceIdx: index('idx_space_sounds_space').on(table.spaceId),
}));

/**
 * A bot: an account (`users.account_kind = 'bot'`, same id) a person runs from a program
 * (routes/bots.ts). Only the hash of its token is kept. When the owner's account goes, their
 * bots go with it (`tombstoneUser`).
 */
export const bots = sqliteTable('bots', {
  id: text('id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  description: text('description'),
  tokenHash: text('token_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
}, (table) => ({
  ownerIdx: index('idx_bots_owner').on(table.ownerId),
}));

/** What a bot answers to in a channel's composer. */
export const botCommands = sqliteTable('bot_commands', {
  botId: text('bot_id').notNull().references(() => bots.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** JSON: what it asks for (shared/src/bots.ts, BotCommandOption). Null when it asks for nothing. */
  options: text('options'),
}, (table) => ({
  pk: primaryKey({ columns: [table.botId, table.name] }),
}));
