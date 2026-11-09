import type { MessageCard } from './cards.js';
import type { BlueskyPost } from './bluesky.js';
import type { SpaceLook } from './looks.js';
import type { ProfileThemeStyle } from './profileFields.js';
import type { CommandOptionValue, CommandReply } from './bots.js';
import type { ErrorCode, ErrorDetails } from './errors.js';
import type { CustomEmoji } from './customEmoji.js';
import type { GrantedUserBadgeId, MemberBadgeId, SpaceBadgeId, UserBadgeId } from './badges.js';
import type { UserNotice } from './legal.js';
import type { ReviewQueueCountPayload, SpaceCategory, SpaceReviewUpdatedPayload, UserSuspension } from './platform.js';
import type { PollInfo } from './polls.js';
import type { SpaceEvent } from './events.js';
import type { SavedItem } from './saved.js';
import type { ThreadInfo, ThreadSummary } from './threads.js';
import type { ForumTag } from './forums.js';
import type { AvatarFrame, NameEffect, NameFont, Nameplate, ProfileEffect } from './decorations.js';
import type { CustomDecorationRef, WornCustomDecorations } from './customDecorations.js';
import type { SpaceTag, WornSpaceTag } from './spaceTags.js';
import type { SignupChallengeSolution } from './signupChallenge.js';
import type { WatchPosition, WatchPresence, WatchReaction, WatchSession } from './watch.js';

// ─── Constants ──────────────────────────────────────────────────────────────

export const MAX_MESSAGE_LENGTH = 4000;
/** How many messages one channel or conversation can have pinned. */
export const MAX_PINS_PER_CHANNEL = 50;
/** How many messages a moderator can delete in one go. */
export const MAX_BULK_DELETE_MESSAGES = 100;

// ─── User Types ─────────────────────────────────────────────────────────────

export const AVATAR_COLORS = ['mint', 'sky', 'lavender', 'coral', 'rose', 'teal', 'amber'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Whether a value is one of the avatar colours: a name from anywhere else is none of them. */
export function isAvatarColor(value: unknown): value is AvatarColor {
  return typeof value === 'string' && (AVATAR_COLORS as readonly string[]).includes(value);
}

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  banner: string | null;
  accentColor: string | null;
  /**
   * The second colour of the profile theme (`#rrggbb`), paired with `accentColor`:
   * the two make the gradient of the banner and the tint of the profile card.
   * Absent on instances that predate it; meaningless without `accentColor`.
   */
  accentColorSecondary?: string | null;
  /**
   * How strongly the profile theme colours the card (`soft`, `strong`, `full`); null or absent
   * reads as `soft`, the look a theme always had. Since 1.41.2; local to its instance.
   */
  profileThemeStyle?: ProfileThemeStyle | null;
  avatarColor: AvatarColor | null;
  bio: string | null;
  /** Pronouns shown beside the name on the profile card; absent or null without. */
  pronouns?: string | null;
  /** Links on the profile card (a site, a social profile), in the person's order. */
  profileLinks?: ProfileLink[];
  /**
   * Accounts elsewhere the person proved are theirs by signing in there, and
   * chose to show (docs/systems/linked-accounts.md). Absent from hosts that
   * predate them, and from a copy of a person another instance holds.
   */
  linkedAccounts?: ProfileLinkedAccount[];
  /** How the profile card is laid out; absent or null for `standard`. */
  profileLayout?: ProfileLayout | null;
  /**
   * Profile decorations (docs/systems/decorations.md): the frame round the
   * picture, the effect over the banner, the nameplate in lists, and the
   * name's font and effect. Null for none, sent as null so that an update
   * merged over an older row clears one; absent from hosts that predate them.
   * A client shows only the names it knows (`decorationsOf`).
   */
  avatarFrame?: AvatarFrame | null;
  profileEffect?: ProfileEffect | null;
  nameplate?: Nameplate | null;
  nameFont?: NameFont | null;
  nameEffect?: NameEffect | null;
  /**
   * The designs someone made that the profile wears (customDecorations.ts), by field, with what a
   * client needs to draw them; the field itself is then null. Null for none, sent as null so that an
   * update merged over an older row takes them off; absent from hosts that predate them and from a
   * copy of a person another instance holds.
   */
  customDecorations?: WornCustomDecorations | null;
  /**
   * The space tag the person wears beside their name (docs/systems/space-tags.md): a space of the
   * instance that sent the row, and its tag as it was when they put it on or the space last
   * changed it. Null for none, sent as null so that an update merged over an older copy takes it
   * off; absent from hosts that predate tags. A client shows only what passes `wornSpaceTagOf`.
   */
  spaceTag?: WornSpaceTag | null;
  /**
   * The person's badges on the instance that sent the row (badges.ts): staff
   * for an instance admin, and those its admins gave. Absent from hosts that
   * predate badges.
   */
  badges?: UserBadgeId[];
  status: UserStatus;
  customStatus: string | null;
  isAdmin: boolean;
  isDeleted?: boolean;
  profileUpdatedAt?: number;
  createdAt: number;
  homeInstance: string | null;
  homeUserId: string | null;
  /** Own view only: the other instances this account also has an account on, read by its own client. */
  replicatedInstances?: ReplicatedInstance[];
  /** Own account only: the version of the instance's terms this person agreed to. */
  termsVersion?: number | null;
  showActivity?: boolean;
  /** Only when it is not a person: the mark at a webhook's message comes from here, set by the server. */
  accountKind?: Exclude<AccountKind, 'person'>;
  /** Only on the person's own row. */
  dmPolicy?: DmPolicy;
  /** Only on the person's own row. */
  friendRequestPolicy?: FriendRequestPolicy;
  /** Self-view only: when the custom status clears by itself (epoch ms), or null when it stays until changed. */
  customStatusExpiresAt?: number | null;
  /** The account's address, the one waiting to replace it, and whether the first is confirmed. Own view only. */
  email?: string | null;
  emailVerified?: boolean;
  pendingEmail?: string | null;
  /** This account may not approach strangers or create spaces until its address is confirmed. Own view only. */
  emailVerificationRequired?: boolean;
  /** The language mail is written in; the client updates it when it differs. Own view only. */
  locale?: string | null;
  /** Signing in takes a second factor, and so do sensitive changes. Own view only. */
  twoFactorEnabled?: boolean;
  /** When this account last changed its username. Only ever sent to the account itself. */
  usernameChangedAt?: number | null;
  /** Self-view only: this federated account's home instance was reset/lost — it now operates as a sovereign local account (detach spec). */
  federationHomeOrphaned?: boolean;
  /**
   * Self-view only: the home instance a detached account was federated from
   * before it was detached, or null. A detached account is homed on the
   * instance that holds it (`homeInstance` and `homeUserId` are null), so this
   * is the only place its former home is still named; re-attach needs it.
   * Read it through {@link detachedHomeOf}.
   */
  detachedHomeInstance?: string | null;
}

export interface ReplicatedInstance {
  origin: string;   // Full URL with protocol, e.g. "https://orbit.ddns.net"
  username: string;
  domain?: string;  // Legacy field — kept for backward compat with existing data
}

export type FederationRegistryStatus = 'connected' | 'disconnected' | 'unreachable' | 'auth_expired';

export interface FederationRegistryEntry {
  origin: string;
  label: string;
  username: string;
  remoteUserId: string;
  status: FederationRegistryStatus;
  addedAt: number;
  lastConnectedAt: number | null;
  disconnectedAt: number | null;
  errorMessage: string | null;
}

export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';
/** A status a user can pick. 'offline' is never chosen: it means "no connection". */
export type ChosenUserStatus = Exclude<UserStatus, 'offline'>;

export const CHOSEN_USER_STATUSES: readonly ChosenUserStatus[] = ['online', 'idle', 'dnd'];

export function isChosenUserStatus(value: unknown): value is ChosenUserStatus {
  return typeof value === 'string' && (CHOSEN_USER_STATUSES as readonly string[]).includes(value);
}

/** Whether an account row carries the detached flag (integer on the server row, boolean on the client `User`). */
function isDetached(account: { federationHomeOrphaned?: number | boolean | null }): boolean {
  return account.federationHomeOrphaned === 1 || account.federationHomeOrphaned === true;
}

/**
 * Whether an account owns its chosen status, so its own row is where the choice
 * is stored and read (`users.chosen_status`). True for an account homed on the
 * instance that holds the row: a native account, and a detached one (its home
 * instance was reset, so it is homed here now); false for a replicated
 * account, whose choice lives on its home instance. The same authority rule
 * the server applies to profile edits and credential issuance.
 *
 * Since #310 a detached row carries no `homeInstance` (federation.md,
 * "Detached accounts are homed here"), so `!homeInstance` alone decides for
 * rows from this version. The detached flag still counts on its own for a row
 * served by an instance that predates that rewrite, where a detached account
 * kept its former home in `homeInstance`.
 *
 * Accepts the server row (integer flag) and the client `User` (boolean flag).
 * activity-presence.md, "DB Persistence".
 */
export function ownsChosenStatus(account: {
  homeInstance?: string | null;
  federationHomeOrphaned?: number | boolean | null;
}): boolean {
  return !account.homeInstance || isDetached(account);
}

/**
 * The home instance a detached account was federated from, or null when the
 * account is not detached. Rows from this version name it in
 * `detachedHomeInstance`; a row served by an instance that predates #310 kept
 * it in `homeInstance`, which is read as the fallback.
 */
export function detachedHomeOf(account: {
  homeInstance?: string | null;
  detachedHomeInstance?: string | null;
  federationHomeOrphaned?: number | boolean | null;
}): string | null {
  if (!isDetached(account)) return null;
  return account.detachedHomeInstance || account.homeInstance || null;
}

export interface UserWithPassword extends User {
  passwordHash: string;
}

// ─── Space (Community) Types ─────────────────────────────────────────────────

export type SpaceVisibility = 'public' | 'request' | 'private';

export interface Space {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  avatarColor: AvatarColor | null;
  ownerId: string;
  /**
   * The owner group's heading in the member list, null for the default
   * ("Owner"). Absent from instances up to 1.10.0, which do not keep it; the
   * client reads it through `ownerGroupTitle` and `hostKeepsOwnerTitle`.
   */
  ownerTitle: string | null;
  /**
   * Whether the member list shows the owner in a group of their own above the
   * roles (headed by `ownerTitle`). Off, the owner is listed under their own
   * top shown role like anyone else and marked as the owner by a crown, which
   * comes from `ownerId`, never from a role. Absent from hosts that predate
   * it, where the owner always had their own group (`ownerHasOwnGroup`).
   */
  ownerGroup?: boolean;
  /** The space's badges: verified (from the platform's verification) and those its admins gave. */
  badges?: SpaceBadgeId[];
  /**
   * The tag its members can wear beside their name (docs/systems/space-tags.md); null for none,
   * absent from hosts that predate tags.
   */
  tag?: SpaceTag | null;
  /**
   * The colours the space chose for itself (looks.ts; read with `spaceLookOf`); null for none,
   * absent from hosts that predate looks.
   */
  look?: SpaceLook | null;
  inviteCode: string | null;
  /** Its own invite address, `/join/<this>` (shared/src/vanityInvites.ts). */
  vanityCode?: string | null;
  visibility: SpaceVisibility;
  directoryListed: boolean;
  description: string | null;
  /**
   * The notification level a member of this space starts with until they
   * choose their own (Server settings, Overview); null keeps the built-in
   * `DEFAULT_NOTIFICATION_LEVEL`. Absent from hosts that predate it.
   */
  defaultNotificationLevel?: SpaceDefaultNotificationLevel | null;
  createdAt: number;
}

export interface InvitePreview {
  spaceId: string;
  spaceName: string;
  description: string | null;
  icon: string | null;
  avatarColor: AvatarColor | null;
  memberCount: number;
  instanceName: string;
  /**
   * The space's visibility when the preview was read. The invite page offers
   * a join request for `request` and a join otherwise. Absent from an
   * instance older than this field, where the page offers a join and switches
   * to a request when the join answers `join_request_required`.
   */
  visibility?: SpaceVisibility;
  /**
   * Whose space came over from Discord: its channels and roles from a template, or its emoji and
   * stickers (`spaces.discord_imported_at`). The invite page's welcome for a link marked
   * `?from=discord` claims nothing this does not confirm. Absent from older instances.
   */
  movedFromDiscord?: boolean;
}

export interface ExploreSpace {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  avatarColor: AvatarColor | null;
  description: string | null;
  visibility: SpaceVisibility;
  memberCount: number;
  createdAt: number;
  joined?: boolean;
  /** Verified and the badges an admin gave the space (badges.ts); absent from hosts that predate badges. */
  badges?: SpaceBadgeId[];
  /** The category its approved Discovery listing names (platform.ts); absent from older hosts. */
  category?: SpaceCategory | null;
}

/** Why the last directory ping did not go through. `reason` is set when `status` is 'fetch'. */
export interface DirectoryPingError {
  at: number;
  status: number | 'network' | 'timeout' | 'origin' | 'fetch';
  reason?: 'unreachable' | 'status' | 'invalid' | 'origin-mismatch';
}

/** One space as an instance serves it on GET /api/directory/spaces. */
export interface DirectoryDocumentSpace {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  banner: string | null;
  avatarColor: AvatarColor | null;
  visibility: 'public' | 'request';
  memberCount: number;
  createdAt: number;
}

/** The document an instance serves. `schema` is fixed at 1 for this release. */
export interface DirectoryDocument {
  schema: 1;
  origin: string;
  instance: { name: string; federatedRegistrationOpen: boolean; version: string | null };
  spaces: DirectoryDocumentSpace[];
}

/** One entry of the hub's feed: a document space plus the origin it came from. */
export interface DirectoryEntry extends DirectoryDocumentSpace {
  origin: string;
  instanceName: string;
  federatedRegistrationOpen: boolean;
}

export interface DirectoryFeed {
  schema: 1;
  spaces: DirectoryEntry[];
}

export interface JoinRequest {
  id: string;
  spaceId: string;
  userId: string;
  message: string | null;
  status: 'pending' | 'accepted' | 'declined';
  decidedBy: string | null;
  createdAt: number;
  decidedAt: number | null;
  user?: User;
}

export interface SpaceWithChannelsAndMembers extends Space {
  channels: Channel[];
  categories: ChannelCategory[];
  members: MemberWithUser[];
  roles: Role[];
  myPermissions?: string; // Computed per-user BigInt decimal string (space-level)
}

// ─── Member Types ───────────────────────────────────────────────────────────

export interface Member {
  spaceId: string;
  userId: string;
  nickname: string | null;
  /**
   * The member's own picture, banner and about text for this space (a space
   * profile), each null to show the account's. Set by the member only
   * (`PATCH /api/spaces/:id/members/@me/profile`); absent from hosts that
   * predate space profiles.
   */
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  joinedAt: number;
  /**
   * While in the future (epoch ms, the hosting server's clock) the member is
   * timed out: they cannot post, react or join voice in the space. Null or a
   * past time when they are not; absent from hosts that predate timeouts.
   */
  timedOutUntil?: number | null;
}

export interface MemberWithUser extends Member {
  user: User;
  roles: Role[];
  /**
   * Staff badges the member's roles give them in this space, worked out by
   * the hosting server from the roles' bits, which members cannot see.
   * Owning the space is not among them: that comes from `Space.ownerId`.
   */
  badges?: MemberBadgeId[];
}

// ─── Role Types ─────────────────────────────────────────────────────────────

export interface Role {
  id: string;
  spaceId: string;
  name: string;
  color: string;
  position: number;
  permissions?: string; // BigInt decimal string (bitwise)
  isEveryone?: boolean; // UI hint: true when role.id === space.id
  /** What the role is for, shown in the role list and on the profile card; null without one. */
  description?: string | null;
  /** A second colour (`#rrggbb`): names and role chips are drawn in a gradient from `color` to it. */
  colorSecondary?: string | null;
  /** An emoji drawn beside the role's name on the profile card and in the member list; null without one. */
  icon?: string | null;
  /**
   * Members whose top shown role this is are listed under it in the member
   * list. A role that is not shown still colours and ranks its members.
   * Absent from hosts that predate it, which group by every role.
   */
  hoist?: boolean;
  /** Anyone in the space may @mention the role, without MENTION_EVERYONE. */
  mentionable?: boolean;
  createdAt: number;
}

// ─── Profile cards ──────────────────────────────────────────────────────────

/** One link on a profile card. `label` defaults to the link's host. */
export interface ProfileLink {
  url: string;
  label?: string | null;
}

// ─── Linked accounts ────────────────────────────────────────────────────────

/**
 * The services a person can link an account of (docs/systems/linked-accounts.md).
 * Linking means signing in at the service, so only one's own account can be
 * linked. Which ones an instance offers: `InstanceInfoResponse.linkedAccounts`.
 */
export const LINKED_ACCOUNT_PROVIDERS = ['twitch'] as const;
export type LinkedAccountProvider = (typeof LINKED_ACCOUNT_PROVIDERS)[number];

export function isLinkedAccountProvider(value: unknown): value is LinkedAccountProvider {
  return typeof value === 'string' && (LINKED_ACCOUNT_PROVIDERS as readonly string[]).includes(value);
}

/** What a profile shows of an account its owner linked (`User.linkedAccounts`). */
export interface ProfileLinkedAccount {
  provider: LinkedAccountProvider;
  /** The account's handle at the service (Twitch: its login, in lower case). */
  login: string;
  /** How the service writes the account's name. */
  name: string;
}

/** One's own linked account, as the settings show it. */
export interface LinkedAccountView extends ProfileLinkedAccount {
  /** The profile shows it, with a link to it. */
  showOnProfile: boolean;
  /** While the person streams there, they are shown as live (activity-presence.md, "Live on Twitch"). */
  showLive: boolean;
  linkedAt: number;
}

export interface LinkedAccountsResponse {
  /** The services this instance can link; empty when its operator set none up. */
  available: LinkedAccountProvider[];
  accounts: LinkedAccountView[];
}

/** Where to send the person to sign in at the service. */
export interface LinkedAccountStartResponse {
  url: string;
}

/** What the service handed back on the page it returned to (`/linked-accounts/<provider>`). */
export interface LinkedAccountCompleteRequest {
  code: string;
  state: string;
}

export interface LinkedAccountUpdateRequest {
  showOnProfile?: boolean;
  showLive?: boolean;
}

/**
 * The profile card's layouts: `standard` (the banner across the top, the
 * picture over its edge), `centered` (the picture and name centred under the
 * banner) and `compact` (no banner area; picture and name side by side).
 */
export const PROFILE_LAYOUTS = ['standard', 'centered', 'compact'] as const;
export type ProfileLayout = (typeof PROFILE_LAYOUTS)[number];

export function isProfileLayout(value: unknown): value is ProfileLayout {
  return typeof value === 'string' && (PROFILE_LAYOUTS as readonly string[]).includes(value);
}

export const PROFILE_LIMITS = {
  MAX_PRONOUNS_LENGTH: 40,
  MAX_LINKS: 5,
  MAX_LINK_URL_LENGTH: 200,
  MAX_LINK_LABEL_LENGTH: 32,
  /** A space profile's about text, as long as the account's. */
  MAX_BIO_LENGTH: 190,
} as const;

/**
 * Body of `PATCH /api/spaces/:id/members/@me/profile`: the member's space
 * profile. An absent field is left as it is; null shows the account's again.
 */
export interface UpdateSpaceProfileRequest {
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
}

/** The limits of a role's display fields (`Role.description`, `Role.icon`). */
export const ROLE_LIMITS = {
  MAX_NAME_LENGTH: 100,
  MAX_DESCRIPTION_LENGTH: 200,
  /** An emoji, a flag or a short sequence of them. */
  MAX_ICON_LENGTH: 16,
} as const;

/**
 * Body of `POST /api/spaces/:id/roles` and `PATCH /api/spaces/:id/roles/:roleId`.
 * An absent field is left as it is (on create: its default); null clears the
 * optional display fields.
 */
export interface RoleWriteRequest {
  name?: string;
  color?: string;
  colorSecondary?: string | null;
  description?: string | null;
  icon?: string | null;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string;
}

// ─── Folder Types ───────────────────────────────────────────────────────────

export interface SpaceFolder {
  id: string;
  userId: string;
  name: string | null;
  color: string | null;
  position: number;
  spaceIds: string[];
}

// ─── Space Layout Types ────────────────────────────────────────────────────

export type SpaceLayoutItem =
  | { t: 's'; id: string }
  | { t: 'f'; id: string };

// ─── Channel Types ──────────────────────────────────────────────────────────

/**
 * `announcement` is a text channel only those with the right may write in, and other spaces can
 * follow. `forum` holds no messages of its own: each post is a thread (docs/systems/forums.md).
 */
export type ChannelType = 'text' | 'voice' | 'thread' | 'announcement' | 'forum';

export interface ChannelCategory {
  id: string;
  spaceId: string;
  name: string;
  position: number;
  isPrivate?: boolean;
  createdAt: number;
}

export interface CategoryOverride {
  categoryId: string;
  targetType: 'role' | 'member';
  targetId: string;
  allow: string;
  deny: string;
}

export interface Channel {
  id: string;
  spaceId: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  position: number;
  categoryId: string | null;
  isPrivate?: boolean;
  /**
   * Slow mode: how many seconds a member must wait between two messages in
   * this channel (one of `SLOWMODE_SECONDS`); 0 when off. Members who may
   * manage messages or the channel are exempt. Absent from hosts that
   * predate it.
   */
  slowmodeSeconds?: number;
  createdAt: number;
  lastMessageId?: string | null;
  myPermissions?: string; // Computed per-user BigInt decimal string
  /** A thread's channel (threads.ts). Threads are never in a listing of a space's channels. */
  parentChannelId?: string | null;
  /** Its own icon in place of its type's (`glyph:<id>` or an emoji, channelIcons.ts). Absent from hosts that predate it. */
  icon?: string | null;
  /**
   * A voice channel someone shows in a stream with an overlay link (docs/systems/voice-overlay.md),
   * so everyone who joins knows they may be seen. Always sent for a voice channel, absent for others
   * and from hosts that predate overlays.
   */
  streamOverlay?: boolean;
}

export interface ReadState {
  channelId: string;
  lastReadMessageId: string;
}

// ─── Notification Settings ─────────────────────────────────────────────────
// Per-space and per-channel alert preferences, stored on the instance that
// hosts the space (docs/systems/sounds.md, "Notification settings").

/**
 * Which messages of a space channel alert the user (sound and desktop
 * notification). DMs are not governed by it.
 *
 * - `all`: every message from someone else.
 * - `mentions`: only messages that mention the user.
 * - `nothing`: no message, mentions included.
 */
export const NOTIFICATION_LEVELS = ['all', 'mentions', 'nothing'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

/** The level of a space with no stored choice, and of every channel that inherits it. */
export const DEFAULT_NOTIFICATION_LEVEL: NotificationLevel = 'mentions';

export function isNotificationLevel(value: unknown): value is NotificationLevel {
  return typeof value === 'string' && (NOTIFICATION_LEVELS as readonly string[]).includes(value);
}

/**
 * The levels a space can set as its members' starting point
 * (`Space.defaultNotificationLevel`). "nothing" is left out on purpose: going
 * silent is each member's own choice, never the space's.
 */
export const SPACE_DEFAULT_NOTIFICATION_LEVELS = ['all', 'mentions'] as const;
export type SpaceDefaultNotificationLevel = (typeof SPACE_DEFAULT_NOTIFICATION_LEVELS)[number];

export function isSpaceDefaultNotificationLevel(value: unknown): value is SpaceDefaultNotificationLevel {
  return typeof value === 'string' && (SPACE_DEFAULT_NOTIFICATION_LEVELS as readonly string[]).includes(value);
}

/**
 * How long a mute lasts. The server turns a duration into `mutedUntil` with
 * its own clock, so every session of the user sees the same end time.
 */
export const NOTIFICATION_MUTE_DURATIONS = ['1h', '8h', '24h', 'indefinite'] as const;
export type NotificationMuteDuration = (typeof NOTIFICATION_MUTE_DURATIONS)[number];

/** Length of each timed mute in ms; `indefinite` has none. */
export const NOTIFICATION_MUTE_DURATION_MS: Record<Exclude<NotificationMuteDuration, 'indefinite'>, number> = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export function isNotificationMuteDuration(value: unknown): value is NotificationMuteDuration {
  return typeof value === 'string' && (NOTIFICATION_MUTE_DURATIONS as readonly string[]).includes(value);
}

/**
 * One stored notification setting of the signed-in user, for a whole space
 * (`channelId` null) or for one channel of it. Ids are the hosting
 * instance's.
 *
 * `level` null means "not chosen": a channel then inherits its space's level,
 * and a space uses `DEFAULT_NOTIFICATION_LEVEL`. `muted` with `mutedUntil`
 * null is a mute until the user lifts it; with a time, the mute ends then
 * (epoch ms, the server's clock). A mute that has ended reads as not muted.
 *
 * `updatedAt` is the server's write time. A setting with no choice left
 * (`level` null, not muted and no mass-mention suppression) is not stored,
 * and is sent as such so other
 * sessions drop theirs.
 */
export interface NotificationSetting {
  /** Space-wide suppression of mass mentions; omitted means false. Direct mentions are unaffected. */
  suppressEveryone?: boolean;
  suppressRoles?: boolean;
  spaceId: string;
  channelId: string | null;
  level: NotificationLevel | null;
  muted: boolean;
  mutedUntil: number | null;
  updatedAt: number;
}

/**
 * Body of `PATCH /api/spaces/:spaceId/notification-settings` and
 * `PATCH /api/channels/:channelId/notification-settings`. An absent field is
 * left as it is. `level: null` clears the choice (inherit / default);
 * `mute: null` lifts the mute.
 */
export interface UpdateNotificationSettingRequest {
  /** Only accepted for space settings, not channel overrides. */
  suppressEveryone?: boolean;
  suppressRoles?: boolean;
  level?: NotificationLevel | null;
  mute?: NotificationMuteDuration | null;
}

export interface NotificationSettingsResponse {
  settings: NotificationSetting[];
}

/** Whether a stored mute is in force at `now`. */
export function isMuteActive(setting: Pick<NotificationSetting, 'muted' | 'mutedUntil'> | null | undefined, now: number): boolean {
  if (!setting || !setting.muted) return false;
  return setting.mutedUntil === null || setting.mutedUntil > now;
}

/**
 * Where a channel's effective level came from: the member's choice for the
 * channel, their choice for the space, the space's default (set by its
 * moderators), or the built-in default.
 */
export type NotificationLevelSource = 'channel' | 'space' | 'spaceDefault' | 'default';

/**
 * What applies to one space channel: its level after inheritance, and
 * whether it is muted (its own mute or its space's). `mutedUntil` is the
 * end of the mute in force (null while indefinite or not muted); with both
 * the channel and the space muted it is the later of the two ends.
 */
export interface ChannelNotificationPolicy {
  suppressEveryone: boolean;
  suppressRoles: boolean;
  level: NotificationLevel;
  levelSource: NotificationLevelSource;
  muted: boolean;
  mutedUntil: number | null;
  /** The channel's own mute is in force (as opposed to only the space's). */
  channelMuted: boolean;
  /** The space's mute is in force. */
  spaceMuted: boolean;
}

/**
 * The inheritance rule, in one place: a channel's own level wins, else the
 * member's level for its space, else the space's default
 * (`Space.defaultNotificationLevel`), else `DEFAULT_NOTIFICATION_LEVEL`. A
 * channel is muted while its own mute or its space's is in force.
 */
export function resolveChannelNotificationPolicy(
  spaceSetting: NotificationSetting | null | undefined,
  channelSetting: NotificationSetting | null | undefined,
  now: number,
  spaceDefault?: SpaceDefaultNotificationLevel | null,
): ChannelNotificationPolicy {
  let level: NotificationLevel = DEFAULT_NOTIFICATION_LEVEL;
  let levelSource: NotificationLevelSource = 'default';
  if (channelSetting?.level) {
    level = channelSetting.level;
    levelSource = 'channel';
  } else if (spaceSetting?.level) {
    level = spaceSetting.level;
    levelSource = 'space';
  } else if (spaceDefault && isSpaceDefaultNotificationLevel(spaceDefault)) {
    level = spaceDefault;
    levelSource = 'spaceDefault';
  }
  const channelMuted = isMuteActive(channelSetting, now);
  const spaceMuted = isMuteActive(spaceSetting, now);
  const ends: Array<number | null> = [];
  if (channelMuted && channelSetting) ends.push(channelSetting.mutedUntil);
  if (spaceMuted && spaceSetting) ends.push(spaceSetting.mutedUntil);
  let mutedUntil: number | null = null;
  if (ends.length > 0 && !ends.includes(null)) {
    mutedUntil = Math.max(...ends.filter((end): end is number => end !== null));
  }
  return {
    level, levelSource, muted: channelMuted || spaceMuted, mutedUntil, channelMuted, spaceMuted,
    suppressEveryone: spaceSetting?.suppressEveryone === true,
    suppressRoles: spaceSetting?.suppressRoles === true,
  };
}

// ─── Space Moderation ───────────────────────────────────────────────────────
// Server settings → Moderation and Audit log, slow mode per channel and member
// timeouts. Stored and enforced by the instance that hosts the space; a
// federated member's client talks to that instance directly, so none of it is
// relayed (docs/systems/spaces.md, "Moderation").

/**
 * A space's automatic message rules. They apply to messages posted or edited
 * in its text channels; the owner, administrators and members who may manage
 * messages or the space are exempt.
 */
export interface SpaceModerationSettings {
  /**
   * Words and phrases a message may not contain, compared without regard to
   * case and only as whole words; a leading or trailing `*` also matches the
   * entry inside a longer word (`*bad*`).
   */
  blockedWords: string[];
  /** Refuse messages that contain a web link. */
  blockLinks: boolean;
  /** Refuse messages that contain an invite link to a space. */
  blockInvites: boolean;
  /** The most user and role mentions one message may carry; 0 sets no limit. */
  maxMentions: number;
  /** How old an account must be, in minutes, before it may post; 0 sets no minimum. */
  minAccountAgeMinutes: number;
  /** How long someone must have been a member, in minutes, before they may post; 0 sets no minimum. */
  minMemberAgeMinutes: number;
  /** When the rules were last changed (epoch ms); null while they are the defaults. */
  updatedAt: number | null;
}

/** Body of `PATCH /api/spaces/:spaceId/moderation`; an absent field is left as it is. */
export type UpdateSpaceModerationRequest = Partial<Omit<SpaceModerationSettings, 'updatedAt'>>;

export const MODERATION_LIMITS = {
  MAX_BLOCKED_WORDS: 100,
  MAX_BLOCKED_WORD_LENGTH: 48,
  /** `maxMentions` is 0 (off) up to this. */
  MAX_MENTIONS_CAP: 50,
  /** `minAccountAgeMinutes` and `minMemberAgeMinutes` are 0 (off) up to this (30 days). */
  MAX_AGE_MINUTES: 43_200,
  /** A timeout or audit reason. */
  MAX_REASON_LENGTH: 512,
  /** The shortest and longest timeout, in seconds (one minute to 28 days). */
  MIN_TIMEOUT_SECONDS: 60,
  MAX_TIMEOUT_SECONDS: 2_419_200,
} as const;

/** The slow mode intervals a channel can have, in seconds; 0 is off. */
export const SLOWMODE_SECONDS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600] as const;
export type SlowmodeSeconds = (typeof SLOWMODE_SECONDS)[number];

export function isSlowmodeSeconds(value: unknown): value is SlowmodeSeconds {
  return typeof value === 'number' && (SLOWMODE_SECONDS as readonly number[]).includes(value);
}

/** The timeout lengths the interface offers, in seconds (1 min, 5 min, 10 min, 1 h, 1 day, 1 week). */
export const TIMEOUT_DURATIONS_SECONDS = [60, 300, 600, 3600, 86_400, 604_800] as const;

/**
 * Body of `PUT /api/spaces/:spaceId/members/:userId/timeout`. Any whole
 * number of seconds from `MIN_TIMEOUT_SECONDS` to `MAX_TIMEOUT_SECONDS` is
 * accepted; the server turns it into `timedOutUntil` with its own clock.
 */
export interface TimeoutMemberRequest {
  durationSeconds: number;
  reason?: string | null;
}

/** Answer of the timeout endpoints: the member as it now is. */
export interface MemberResponse {
  member: MemberWithUser;
}

/** Everything the audit log records, one entry per change. */
export const AUDIT_LOG_ACTIONS = [
  'space_update',
  'moderation_update',
  'invite_regenerate',
  'invite_create',
  'invite_revoke',
  'messages_bulk_delete',
  'channel_create',
  'channel_update',
  'channel_delete',
  'category_create',
  'category_update',
  'category_delete',
  'override_update',
  'override_delete',
  'role_create',
  'role_update',
  'role_delete',
  'role_reorder',
  'member_roles_update',
  'member_kick',
  'member_ban',
  'member_unban',
  'member_timeout',
  'member_timeout_remove',
  'message_delete',
  'channel_messages_delete',
  'thread_create',
  'thread_update',
  'thread_delete',
  'event_create',
  'event_update',
  'event_delete',
  'welcome_update',
  'webhook_create',
  'webhook_update',
  'webhook_delete',
  'forum_tags_update',
  'channel_follow_create',
  'channel_follow_delete',
  'vanity_update',
  'sound_create',
  'sound_update',
  'sound_delete',
  'emoji_create',
  'emoji_update',
  'emoji_delete',
  'sticker_create',
  'sticker_update',
  'sticker_delete',
  'discord_expressions_import',
  'bot_add',
  'message_pin',
  'message_unpin',
  'join_request_approve',
  'join_request_decline',
  'ownership_transfer',
  'template_import',
] as const;
export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number];

export function isAuditLogAction(value: unknown): value is AuditLogAction {
  return typeof value === 'string' && (AUDIT_LOG_ACTIONS as readonly string[]).includes(value);
}

export type AuditLogTargetType = 'space' | 'channel' | 'category' | 'role' | 'member' | 'message' | 'invite' | 'join_request';

export type AuditLogValue = string | number | boolean | null;

/**
 * One field an entry changed. `key` is the field's machine name (`name`,
 * `topic`, `slowmodeSeconds`, `permissions`, `allow`, `deny`, `color`,
 * `visibility`, `role_added`, `role_removed`, `durationSeconds`, ...);
 * permission values are decimal strings. A field that was added has no
 * `from`, one that was removed no `to`.
 */
export interface AuditLogChange {
  key: string;
  from?: AuditLogValue;
  to?: AuditLogValue;
}

export interface AuditLogEntry {
  id: string;
  spaceId: string;
  /** Who made the change: a user id of the hosting instance. */
  actorId: string;
  action: AuditLogAction;
  targetType: AuditLogTargetType | null;
  targetId: string | null;
  /** The target's name when the entry was written (a channel, a role, a member), so a deleted target still reads. */
  targetLabel: string | null;
  changes: AuditLogChange[] | null;
  reason: string | null;
  createdAt: number;
}

/** How many entries one page of the audit log holds by default, and at most. */
export const AUDIT_LOG_PAGE_SIZE = 50;
export const AUDIT_LOG_MAX_PAGE_SIZE = 100;

/**
 * Answer of `GET /api/spaces/:spaceId/audit-log?before&limit&action&actorId`:
 * newest first, with the users the entries name (actors and members who were
 * targets) so the page can show them. `nextBefore` is the cursor for the next
 * older page, null at the end.
 */
export interface AuditLogResponse {
  entries: AuditLogEntry[];
  users: User[];
  nextBefore: string | null;
}

// ─── Message Types ──────────────────────────────────────────────────────────

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  replyToId: string | null;
  content: string | null;
  type?: 'user' | 'system';
  editedAt: number | null;
  createdAt: number;
  /**
   * Space channel messages only, set by the instance hosting the space
   * (`massMentionFields` in `mentions.ts`): the content has `@everyone` or
   * `@here`, and the role ids it mentions. That instance stores a new mass
   * mention only from an author holding MENTION_EVERYONE, so a client alerts
   * on mass mentions from these fields alone. Absent from instances before
   * MENTION_EVERYONE, whose mass mentions therefore never alert.
   */
  mentionEveryone?: boolean;
  mentionRoleIds?: string[];
  /** When the message was pinned to its channel, and by whom; null when it is not. */
  pinnedAt?: number | null;
  pinnedBy?: string | null;
  /** What a bot or a webhook showed besides text (cards.ts). When it wrote no text, the content is their summary. */
  cards?: MessageCard[];
  /** A copy of a message forwarded here (routes/forward.ts). It names neither the original nor its author. */
  forwarded?: boolean;
}

/** Where to forward a message: exactly one of them. */
export interface ForwardMessageRequest {
  channelId?: string;
  dmChannelId?: string;
}

/** What pinning or unpinning a message answers with (`message_pin_changed` carries the same). */
export interface MessagePinState {
  pinnedAt: number | null;
  pinnedBy: string | null;
}

export interface MessageWithUser extends Message {
  user: User;
  attachments: Attachment[];
  embeds: Embed[];
  reactions: Reaction[];
  replyTo?: MessageWithUser | null;
  /** The poll this message asks; the content is its question (polls.ts). */
  poll?: PollInfo;
  /** The thread that grew from this message (threads.ts). */
  thread?: ThreadSummary;
}

// ─── Reaction Types ────────────────────────────────────────────────────────

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: number;
  user?: User;
}

// ─── Attachment Types ───────────────────────────────────────────────────────

export interface Attachment {
  id: string;
  messageId: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  thumbnailFilename?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  /**
   * Web-playability for video attachments. `false` = the codec can't be
   * decoded in a browser <video> (e.g. HEVC .mov) so the client renders a
   * download fallback; `true`/`null` = attempt inline playback (null is the
   * optimistic unknown case, also covered by the client's onError fallback).
   */
  playable?: boolean | null;
  /** The sender marked it: a picture or video stays covered until a reader asks. */
  spoiler?: boolean;
  /** A voice message: bar heights to draw its waveform (shared/src/voiceMessages.ts). */
  voiceWaveform?: number[] | null;
  federationStatus?: string | null;
  federationMeta?: string | null;
  createdAt: number;
}

// ─── Embed Types ──────────────────────────────────────────────────────────

/** `post`: a post on a social network the server could read (Bluesky), drawn from `Embed.post`. */
export type EmbedType = 'generic' | 'video' | 'image' | 'audio' | 'rich' | 'post';
export type EmbedProvider = 'youtube' | 'vimeo' | 'spotify' | 'bluesky';

export interface Embed {
  id: string;
  messageId: string | null;
  dmMessageId: string | null;
  url: string;
  embedType: EmbedType;
  provider: EmbedProvider | null;
  title: string | null;
  description: string | null;
  image: string | null;
  embedUrl: string | null;
  width: number | null;
  height: number | null;
  color: string | null;
  createdAt: number;
  /**
   * For a `post` embed: the post as its card shows it (bluesky.ts; read with `blueskyPostOf`). The
   * plain fields above hold its author, text and first picture for a client that draws no posts.
   */
  post?: BlueskyPost | null;
}

// ─── Active Call Types ───────────────────────────────────────────────────────

export interface ActiveCallInfo {
  dmChannelId: string | null;
  federatedCallId?: string;
  callerId: string;
  participants: string[];
  startedAt: number;
  state: 'ringing' | 'active';
  // Federation fields (present only for federated calls on remote instances)
  federatedCallHost?: string;
  livekitUrl?: string;
  livekitToken?: string;  // this user's LiveKit token (server filters per-user at payload assembly)
}

// ─── DM Types ───────────────────────────────────────────────────────────────

export interface DmLastMessagePreview {
  id: string;
  dmChannelId: string;
  userId: string;
  content: string | null;
  createdAt: number;
  /**
   * 'system' for membership/lifecycle JSON payloads (member_added, member_removed,
   * owner_changed, space_invite). 'user' (or omitted) for normal user-authored
   * messages. The sidebar renderer relies on this to avoid showing raw JSON.
   */
  type?: 'user' | 'system';
  attachments?: Array<{ type: string; filename: string }>;
}

/**
 * A DM conversation as a current server puts it on the wire. Every field is
 * required, nullable where the row can be null, so a server payload that
 * forgets one does not compile; the server builds it only through
 * `utils/dmChannelWire.ts` (ADR 0002).
 */
export interface DmChannel {
  id: string;
  /** The conversation key: `null` only for a group no other instance holds. */
  federatedId: string | null;
  ownerId: string | null;
  ownerHomeUserId: string | null;
  ownerHomeInstance: string | null;
  createdAt: number;
  members: User[];
  lastMessage: DmLastMessagePreview | DmMessageWithUser | null;
  name: string | null;
  icon: string | null;
  metadataUpdatedAt: number;
}

export interface DmMessage {
  id: string;
  dmChannelId: string;
  userId: string;
  content: string | null;
  type?: 'user' | 'system';
  createdAt: number;
  // Compatibility fields
  channelId?: string;
  replyToId?: string | null;
  editedAt?: number | null;
  // Federation relay identity
  sourceMessageId?: string | null;
  sourceInstance?: string | null;
  pinnedAt?: number | null;
  pinnedBy?: string | null;
  forwarded?: boolean;
}

export interface DmMessageWithUser extends DmMessage {
  user: User;
  attachments: Attachment[];
  embeds: Embed[];
  reactions: Reaction[];
  replyTo?: DmMessageWithUser | null;
}

// ─── Activity Types ────────────────────────────────────────────────────────

export type ActivityType = 'custom' | 'playing' | 'listening' | 'watching' | 'streaming';

export interface ActivityTimestamps {
  start?: number;
  end?: number;
}

export interface ActivityAssets {
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
}

/**
 * Where an activity came from when the person's home instance worked it out
 * rather than their device reporting it (docs/systems/activity-presence.md,
 * "Live on Twitch"): `twitch`, the person's Twitch channel being live.
 */
export const ACTIVITY_SOURCES = ['twitch'] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export function isActivitySource(value: unknown): value is ActivitySource {
  return typeof value === 'string' && (ACTIVITY_SOURCES as readonly string[]).includes(value);
}

export interface Activity {
  type: ActivityType;
  name: string;
  details?: string;
  state?: string;
  timestamps?: ActivityTimestamps;
  assets?: ActivityAssets;
  url?: string;
  /**
   * Set only by the person's home instance, for an activity it derived
   * (`ACTIVITY_SOURCES`). A client never sends one: a server drops it from
   * an `activity_update` and takes it only from another instance.
   */
  source?: ActivitySource;
}

// ─── WebSocket Event Types ──────────────────────────────────────────────────

export type DmCallUndeliverableReason =
  | 'peer_rejected'
  | 'peer_awaiting_approval'
  | 'peer_transient_failure'
  | 'livekit_unavailable'
  | 'no_recipient'
  // The peer accepts no name this instance could give the call's caller (a
  // federated account here whose home is a third instance), so its members
  // cannot be rung through this instance (federation.md, "Who a call relay
  // names").
  | 'identity_not_accepted';

/**
 * A person's federated identity on the wire: their home user id and the
 * instance that homes them. Compared by home user id and instance host,
 * never by a local row id.
 */
export interface FederatedIdentity {
  homeUserId: string;
  homeInstance: string;
}

export type DmCallPhase = 'start' | 'accept' | 'reject' | 'end' | 'host_unreachable';

export interface DmCallUndeliverableFailure {
  reason: DmCallUndeliverableReason;
  peerOrigin?: string;
  peerLabel?: string;
  affectedUserIds?: string[];
}

// Client → Server Events
export type ClientEvent =
  | { type: 'client_focus'; focused: boolean }
  | { type: 'thread_watch'; threadId: string | null }
  | { type: 'auth'; token: string; client?: ClientKind }
  | { type: 'message_create'; channelId: string; content: string; replyToId?: string }
  | { type: 'message_edit'; messageId: string; content: string }
  | { type: 'message_delete'; messageId: string }
  | { type: 'channel_poke'; channelId: string; targetUserId: string }
  | { type: 'typing_start'; channelId: string }
  | { type: 'presence_update'; status: ChosenUserStatus }
  | { type: 'voice_join'; channelId: string }
  | { type: 'voice_leave' }
  | { type: 'dm_message_create'; dmChannelId: string; content?: string; attachments?: string[]; replyToId?: string }
  | { type: 'dm_typing_start'; dmChannelId: string }
  | { type: 'dm_message_edit'; messageId: string; content: string }
  | { type: 'dm_message_delete'; messageId: string }
  | { type: 'reaction_add'; messageId: string; emoji: string }
  | { type: 'reaction_remove'; messageId: string; emoji: string }
  | { type: 'channel_ack'; channelId: string; messageId: string }
  | { type: 'mark_unread'; channelId: string; messageId: string }
  | { type: 'dm_call_start'; dmChannelId: string }
  | { type: 'dm_call_accept'; dmChannelId: string | null; federatedCallId?: string | null }
  | { type: 'dm_call_reject'; dmChannelId: string | null; federatedCallId?: string | null }
  | { type: 'dm_call_end'; dmChannelId: string | null; federatedCallId?: string | null }
  | { type: 'voice_status'; isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }
  | { type: 'voice_space_mute'; userId: string; muted: boolean }
  | { type: 'voice_space_deafen'; userId: string; deafened: boolean }
  | { type: 'voice_move'; userId: string; targetChannelId: string }
  | { type: 'voice_disconnect'; userId: string }
  | { type: 'activity_update'; activities: Activity[] }
  | { type: 'ping' };

/**
 * Who a presence snapshot is about, beyond the delivering instance's local row
 * id: the row's `homeUserId` and `homeInstance`, both null for a user native to
 * the delivering instance. The client keys activities by the federated identity
 * this names (see activityStore), so every instance's view of one person lands
 * on one key. Absent on servers that predate the fields.
 */
export interface PresenceIdentity {
  homeUserId: string | null;
  homeInstance: string | null;
}

// Server → Client Events
export type ServerEvent =
  /** Several events in one frame, for a client that said at `auth` that it reads them (`batch: true`). */
  | { type: 'batch'; events: ServerEvent[] }
  | { type: 'channel_poke'; message: MessageWithUser }
  | { type: 'ready'; user: User; spaces: SpaceWithChannelsAndMembers[]; dmChannels: DmChannel[]; followedThreads?: ThreadInfo[]; folders?: SpaceFolder[]; spaceLayout?: SpaceLayoutItem[] | null; layoutUpdatedAt?: number; voiceStates?: Record<string, string[]>; voiceChannelElapsedSeconds?: Record<string, number>; voiceUserStates?: Record<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }>; supportsPoke?: boolean; unreadCounts?: Record<string, number>; readStates?: ReadState[]; activeCalls?: ActiveCallInfo[]; spaceVoiceStates?: Record<string, { spaceMuted: boolean; spaceDeafened: boolean }>; userActivities?: Record<string, Activity[]>; userActivityIdentities?: Record<string, PresenceIdentity>; rejectedPeerOrigins?: string[]; awaitingApprovalPeerOrigins?: string[]; activePeerOrigins?: string[]; pendingApprovalCount?: number; reportQueueCount?: number | null; reviewQueueCount?: ReviewQueueCountPayload | null; watching?: Record<string, WatchPresence> }
  | { type: 'channel_unread_count'; counts: Record<string, number> }
  | { type: 'message_created'; message: MessageWithUser }
  | { type: 'message_updated'; message: MessageWithUser }
  | { type: 'message_deleted'; messageId: string; channelId: string }
  | ({ type: 'message_pin_changed'; channelId: string; messageId: string } & MessagePinState)
  | { type: 'poll_updated'; channelId: string; messageId: string; poll: PollInfo }
  | {
    type: 'command_invoked';
    name: string;
    args: string;
    /** What the person filled in, for a command that asks for options. */
    options: Record<string, CommandOptionValue>;
    /** Answer it with `POST /api/interactions/:id/reply` within 15 minutes. */
    interactionId: string;
    channelId: string;
    spaceId: string;
    user: User;
  }
  | ({ type: 'command_reply' } & CommandReply)
  | { type: 'soundboard_play'; channelId: string; spaceId: string; soundId: string; userId: string }
  /** A voice channel's session as it is now, to those in the call; null once it ended (docs/systems/watch-together.md). */
  | { type: 'watch_state'; channelId: string; session: WatchSession | null; serverNow: number }
  /** What the channel list shows of it, to everyone who can see the channel; null once it ended. */
  | { type: 'watch_presence'; spaceId: string; channelId: string; presence: WatchPresence | null }
  | { type: 'watch_position'; channelId: string; position: WatchPosition; serverNow: number }
  | { type: 'watch_reaction'; channelId: string; reaction: WatchReaction }
  | { type: 'space_sounds_changed'; spaceId: string }
  | { type: 'space_emojis_changed'; spaceId: string }
  | { type: 'space_stickers_changed'; spaceId: string }
  | { type: 'saved_changed'; messageId: string; saved: boolean }
  | { type: 'saved_reminder'; item: SavedItem; preview: string }
  | { type: 'space_welcome_changed'; spaceId: string }
  | { type: 'event_updated'; event: SpaceEvent }
  | { type: 'event_deleted'; eventId: string; spaceId: string }
  | { type: 'event_reminder'; eventId: string; spaceId: string; title: string; startsAt: number }
  | { type: 'thread_updated'; parentChannelId: string; starterMessageId: string | null; thread: ThreadSummary }
  | { type: 'thread_deleted'; threadId: string; parentChannelId: string; starterMessageId: string | null }
  | { type: 'forum_tags_updated'; channelId: string; tags: ForumTag[] }
  | { type: 'thread_followed'; thread: ThreadInfo }
  | { type: 'thread_unfollowed'; threadId: string }
  /** Many messages of one channel at once: a ban that took someone's recent messages with it. */
  | { type: 'messages_deleted'; messageIds: string[]; channelId: string }
  | { type: 'typing'; channelId: string; userId: string; username: string }
  | ({ type: 'presence_update'; userId: string; status: string; activities?: Activity[] } & Partial<PresenceIdentity>)
  | { type: 'voice_state_update'; channelId: string; userId: string; action: 'join' | 'leave'; channelElapsedSeconds?: number }
  | { type: 'member_joined'; spaceId: string; member: MemberWithUser }
  | { type: 'member_updated'; spaceId: string; member: MemberWithUser }
  | { type: 'member_left'; spaceId: string; userId: string }
  | { type: 'dm_message_created'; message: DmMessageWithUser }
  | { type: 'dm_message_updated'; message: DmMessageWithUser }
  /**
   * `lastMessage`: the conversation's preview once the message is gone, the one before it or null
   * for none (since 1.41.1), so a list showing the deleted message as the last one stops showing it.
   * Absent from older hosts.
   */
  | { type: 'dm_message_deleted'; messageId: string; dmChannelId: string; lastMessage?: DmLastMessagePreview | null }
  | { type: 'dm_typing'; dmChannelId: string; userId: string; username: string }
  | { type: 'dm_typing_stop'; dmChannelId: string; userId: string }
  | { type: 'emoji_upserted'; emoji: CustomEmoji }
  | { type: 'emoji_removed'; emojiId: string }
  | { type: 'reaction_added'; messageId: string; reaction: Reaction }
  | { type: 'reaction_removed'; messageId: string; userId: string; emoji: string }
  | { type: 'channel_ack'; channelId: string; messageId: string }
  | { type: 'friend_request_received'; request: FriendRequest }
  | { type: 'friend_request_accepted'; friend: Friend; requestId: string }
  | { type: 'dm_call_incoming'; dmChannelId: string | null; federatedCallId?: string; callerId: string; callerName: string; livekitUrl?: string; livekitToken?: string; callOrigin?: string }
  // `answeredBy` names the member whose answer this is, by federated
  // identity, so only that person's other sessions stop ringing. Absent from
  // servers up to 1.9.0.
  | { type: 'dm_call_accepted'; dmChannelId: string | null; federatedCallId?: string; answeredBy?: FederatedIdentity }
  // `dmChannelId` is null and `federatedCallId` set when the instance holds a
  // federated call with no local copy of the DM (Path B, voice.md).
  | { type: 'dm_call_rejected'; dmChannelId: string | null; federatedCallId?: string }
  | { type: 'dm_call_ended'; dmChannelId: string | null; federatedCallId?: string }
  | { type: 'dm_call_undeliverable'; dmChannelId: string | null; federatedCallId: string; terminal: boolean; phase: DmCallPhase; failures: DmCallUndeliverableFailure[] }
  | { type: 'voice_status_update'; userId: string; channelId: string; isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }
  | { type: 'space_voice_state'; spaceId: string; voiceStates: Record<string, string[]>; voiceChannelElapsedSeconds: Record<string, number>; voiceUserStates: Record<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }>; spaceVoiceStates: Record<string, { spaceMuted: boolean; spaceDeafened: boolean; permissionMuted: boolean }>; watching?: Record<string, WatchPresence> }
  | { type: 'dm_channel_created'; dmChannel: DmChannel }
  | { type: 'dm_channel_closed'; dmChannelId: string }
  | { type: 'dm_channel_updated'; dmChannelId: string; name: string | null; icon: string | null }
  | { type: 'dm_member_added'; dmChannelId: string; user: User }
  | { type: 'dm_member_removed'; dmChannelId: string; userId: string }
  | { type: 'friend_removed'; userId: string }
  | { type: 'blocks_updated'; blockedUserIds: string[] }
  | { type: 'friend_request_cancelled'; requestId: string; userId: string }
  | { type: 'friend_request_declined'; requestId: string; userId: string }
  | { type: 'friend_request_sent'; request: FriendRequest }
  | { type: 'friend_request_relay_failed'; requestId: string; reason: 'user_not_found' | 'peer_rejected'; message: string; targetHandle: string }
  | { type: 'channel_created'; channel: Channel; spaceId: string }
  | { type: 'channel_updated'; channel: Channel; spaceId: string }
  | { type: 'channel_deleted'; channelId: string; spaceId: string }
  | { type: 'space_updated'; space: Space }
  | { type: 'join_request_received'; request: JoinRequest }
  | { type: 'join_request_accepted'; request: JoinRequest; space: SpaceWithChannelsAndMembers }
  | { type: 'join_request_declined'; request: JoinRequest }
  | { type: 'voice_space_muted'; userId: string; channelId: string; spaceId: string; muted: boolean }
  | { type: 'voice_space_deafened'; userId: string; channelId: string; spaceId: string; deafened: boolean }
  | { type: 'voice_permission_muted'; userId: string; spaceId: string; muted: boolean }
  | { type: 'voice_moved'; userId: string; oldChannelId: string; newChannelId: string }
  | { type: 'voice_disconnected'; userId: string; channelId: string; reason?: 'displaced' | 'session_closed' | 'rejected' }
  | { type: 'user_updated'; user: User }
  /** Only to the person: their linked accounts changed, on this device or another (linked-accounts.md). */
  | { type: 'linked_accounts_update'; accounts: LinkedAccountView[] }
  | { type: 'member_banned'; spaceId: string; reason: string | null }
  /** To every member: the space is gone, deleted by its owner or an instance administrator (utils/spaceDeletion.ts). */
  | { type: 'space_deleted'; spaceId: string }
  | { type: 'category_created'; category: ChannelCategory; spaceId: string }
  | { type: 'category_updated'; category: ChannelCategory; spaceId: string }
  | { type: 'category_deleted'; categoryId: string; spaceId: string }
  | { type: 'channel_layout_updated'; spaceId: string; channels: Channel[]; categories: ChannelCategory[] }
  | { type: 'space_layout_updated'; layout: SpaceLayoutItem[]; folders: SpaceFolder[]; updatedAt?: number }
  // One of the user's notification settings on this instance changed (from
  // any of their sessions here). A setting with level null and not muted was
  // cleared. See docs/systems/websocket.md.
  | { type: 'notification_settings_updated'; setting: NotificationSetting }
  | { type: 'mark_unread'; channelId: string; messageId: string }
  | { type: 'embeds_resolved'; messageId: string; channelId: string; embeds: Embed[] }
  | { type: 'dm_embeds_resolved'; messageId: string; dmChannelId: string; embeds: Embed[] }
  | { type: 'federation_file_rejected'; messageId: string; dmChannelId: string; attachmentId: string; affectedUsers: Array<{ userId: string; username: string; limit: number }> }
  | { type: 'federation_peer_rejected'; peerOrigin: string; peerLabel?: string; reason: string; reasonCode?: FederationPeerStatusReason; affectedContexts: Array<{ contextType: 'dm' | 'friend'; contextId: string; contextLabel: string }> }
  | { type: 'federation_peer_active'; peerOrigin: string }
  | { type: 'federation_peers_changed' }
  | { type: 'federation_peer_reset_detected'; origin: string }
  | { type: 'federation_approval_request_received'; origin: string; instanceName?: string }
  | { type: 'peering_subscription_changed' }
  | { type: 'peering_notification_received'; kind: PeeringNotificationKind }
  | {
      type: 'dm_owner_updated';
      dmChannelId: string;
      newOwnerId: string;
      // Federation routing fields. Required for the client to keep
      // `dmChannel.ownerHomeInstance` in sync after a transfer — otherwise
      // owner-only API calls (`updateMetadata`, `kickMember`, `transferOwnership`)
      // continue to route through the previous owner's home instance via
      // `getOwnerInstanceForDm` until the user reconnects and receives a fresh
      // `ready` payload. Always populated on new emissions; tolerated as
      // optional for receivers connected to an older sender.
      newOwnerHomeUserId?: string | null;
      newOwnerHomeInstance?: string | null;
    }
  | { type: 'pong' }
  // `code` is set where the refusal has a stable ErrorCode (e.g. a voice
  // moderation action refused by the role hierarchy); older senders omit it.
  // `details` fills the code's placeholders (`content_too_long` carries
  // `max`), as in an HTTP error body. `dmChannelId` names the call of a refused `dm_call_start` or
  // `dm_call_accept`; a client calling or in that call drops it (voice.md,
  // "DM Call State Machine").
  | { type: 'error'; message: string; code?: ErrorCode; details?: ErrorDetails; dmChannelId?: string }
  // The space's roles or a member's roles changed: what the receiver may see
  // or do there, and how its roles and members look, may be different now.
  // The client refetches that space's detail (docs/systems/websocket.md).
  | { type: 'space_access_changed'; spaceId: string }
  // Platform administration (platform.ts): to a space's owner when one of its
  // reviews moved, to the instance's admins when the open requests changed.
  | ({ type: 'space_review_updated' } & SpaceReviewUpdatedPayload)
  | ({ type: 'review_queue_count' } & ReviewQueueCountPayload)
  /** To the instance's admins: how many reports wait for a decision. */
  | { type: 'report_queue_count'; open: number }
  /** To everyone: the operator's details or a legal document changed, read them again. */
  | { type: 'legal_updated' }
  /** To one person: what the operator decided about them. */
  | { type: 'user_notice'; notice: UserNotice }
  | { type: 'announcements_changed' };

// ─── API Request/Response Types ─────────────────────────────────────────────

export interface RegisterRequest {
  /** The answer to `GET /api/auth/challenge` (signupChallenge.ts). */
  challenge?: SignupChallengeSolution;
  username: string;
  password: string;
  displayName?: string;
  avatarColor?: string;
  homeInstance?: string;
  homeUserId?: string;
  /** With `homeInstance`: what their home gave them for this instance (`POST /api/auth/attach-proof`), which it will vouch for. */
  attachProof?: string;
  inviteToken?: string;
  /** The version of the terms the person agreed to; required once the instance has published terms. */
  acceptedTermsVersion?: number;
  /** The person confirmed the instance's minimum age; required together with the terms. */
  ageConfirmed?: boolean;
  /** Where to confirm the account and reset its password. Ignored while the instance sends no mail. */
  email?: string;
  /** The language mail to this account is written in. */
  locale?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  /** A random id this browser keeps, to tell a new device from a known one. */
  deviceId?: string;
}

/** The sign-in's second step, with the ticket `POST /auth/login` answered `mfa_required` with. */
export interface LoginSecondFactorRequest {
  ticket: string;
  /** From an authenticator app, or a recovery code. */
  code: string;
}

export interface TwoFactorSetupResponse {
  /** Base32, for typing into an app. Shown once. */
  secret: string;
  otpauthUrl: string;
}

export type SecurityEventKind =
  | 'login'
  | 'login_new_device'
  | 'login_failed'
  | 'mfa_failed'
  | 'password_changed'
  | 'username_changed'
  | 'password_reset'
  | 'email_added'
  | 'email_changed'
  | 'email_removed'
  | 'two_factor_on'
  | 'two_factor_off'
  | 'two_factor_reset'
  | 'recovery_regenerated'
  | 'recovery_used'
  | 'session_revoked'
  | 'sessions_ended'
  | 'sessions_ended_by_admin';

export interface SecurityEventInfo {
  id: string;
  kind: SecurityEventKind;
  clientLabel: string | null;
  addressHint: string | null;
  /** Failures from one place within a few minutes are one entry. */
  count: number;
  createdAt: number;
}

export interface SecurityOverview {
  twoFactor: {
    /** This server holds the key that 2FA needs. */
    available: boolean;
    enabled: boolean;
    enabledAt: number | null;
    recoveryCodesLeft: number;
  };
  passwordChangedAt: number | null;
  sessionCount: number;
  events: SecurityEventInfo[];
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface CreateSpaceRequest {
  name: string;
  icon?: string;
  banner?: string;
  avatarColor?: string;
  visibility?: SpaceVisibility;
  description?: string;
}

export interface CreateChannelRequest {
  name: string;
  type: ChannelType;
  topic?: string;
  categoryId?: string;
}

export interface UpdateChannelRequest {
  /** Between `text` and `announcement` only; anything else is `400 channel_type_change_invalid`. */
  type?: ChannelType;
  name?: string;
  /** `null` or a value that trims to nothing clears the topic. */
  topic?: string | null;
  position?: number;
  categoryId?: string | null;
  /** `glyph:<id>` or an emoji; `null` or an empty string goes back to the type's icon. */
  icon?: string | null;
  /** Slow mode interval, one of `SLOWMODE_SECONDS` (0 switches it off); anything else is `400 slowmode_invalid`. */
  slowmodeSeconds?: number;
}

export interface UpdateSpaceRequest {
  ownerTitle?: string | null;
  /** List the owner in a group of their own above the roles (`Space.ownerGroup`). Owner only. */
  ownerGroup?: boolean;
  name?: string;
  icon?: string;
  banner?: string;
  avatarColor?: string;
  visibility?: SpaceVisibility;
  directoryListed?: boolean;
  description?: string;
  /** The members' starting notification level; null restores the built-in default. Anything else is `400 notification_level_invalid`. */
  defaultNotificationLevel?: SpaceDefaultNotificationLevel | null;
  /** The space's tag (spaceTags.ts), or null to take it away; anything else is `400 space_tag_invalid`. */
  tag?: SpaceTag | null;
  /** The space's colours (looks.ts), or null for none; anything `spaceLookOf` refuses is `400 space_look_invalid`. */
  look?: SpaceLook | null;
}

/** What a click on a worn tag shows: the space as Explore would, and its tag (GET /api/spaces/:id/tag). */
export interface SpaceTagCardResponse {
  space: ExploreSpace;
  tag: SpaceTag;
}

/** One entry of the list of people the signed-in user has blocked. */
export interface BlockedUser {
  user: User;
  /** When the block was made (epoch ms). */
  blockedAt: number;
}

/** Who may start a conversation with someone. Conversations they already have stay open. */
/** What an account is. Only a person signs in; the others exist because a message needs an author. */
/** `follow` writes the copies of a followed announcement channel's posts (docs/systems/forums.md). */
export type AccountKind = 'person' | 'webhook' | 'bot' | 'follow';

export const DM_POLICIES = ['nobody', 'friends', 'friends_and_spaces', 'anyone'] as const;
export type DmPolicy = (typeof DM_POLICIES)[number];
export const DEFAULT_DM_POLICY: DmPolicy = 'friends_and_spaces';

/** Who may send someone a friend request, and find them by name to do it. */
export const FRIEND_REQUEST_POLICIES = ['nobody', 'shared_spaces', 'anyone'] as const;
export type FriendRequestPolicy = (typeof FRIEND_REQUEST_POLICIES)[number];
export const DEFAULT_FRIEND_REQUEST_POLICY: FriendRequestPolicy = 'anyone';

/** Who may add to the instance's emoji library. */
export type InstanceEmojiPolicy = 'admins' | 'everyone';

/** The longest reason a moderator can give for removing someone. */
export const MODERATION_REASON_MAX_LENGTH = 512;

/** How far back a ban can take the person's messages with it, in seconds. */
export const BAN_DELETE_MESSAGE_SECONDS = [0, 3600, 86_400, 604_800] as const;

/** The ends an invite link can have, in seconds from now. */
export const INVITE_EXPIRY_SECONDS = [1800, 3600, 21_600, 86_400, 604_800, 2_592_000] as const;
/** The limits an invite link can have, in people let in. */
export const INVITE_MAX_USES = [1, 5, 10, 25, 50, 100] as const;

/** One link into a space, as those who manage the space see it. */
export interface SpaceInviteLink {
  code: string;
  /** The link the Invite dialog hands out. */
  standing: boolean;
  /** Who made it; null when that account is gone. */
  createdBy: { id: string; name: string } | null;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
}

export interface CreateSpaceInviteRequest {
  /** One of `INVITE_EXPIRY_SECONDS`, or null for never. */
  expiresInSeconds: number | null;
  /** One of `INVITE_MAX_USES`, or null for no limit. */
  maxUses: number | null;
}

/** One device signed in to this account. */
export interface SessionInfo {
  id: string;
  /** The device asking. */
  current: boolean;
  /** A browser and a system ("Chrome · Windows"); null when the request did not say. */
  clientLabel: string | null;
  /** The address cut short ("203.0.113.0"), to tell places apart. */
  addressHint: string | null;
  createdAt: number;
  lastActiveAt: number;
}

export interface SessionsResponse {
  sessions: SessionInfo[];
}

/** Where a person's copy of their data stands. */
export interface DataExportStatus {
  status: 'none' | 'pending' | 'ready' | 'failed';
  createdAt: number | null;
  /** When the file is removed; null while there is none. */
  expiresAt: number | null;
  sizeBytes: number | null;
}

export interface UpdateUserRequest {
  dmPolicy?: DmPolicy;
  friendRequestPolicy?: FriendRequestPolicy;
  /** Null or an empty string clears them. */
  pronouns?: string | null;
  /** The whole list, replacing the stored one; an empty list or null clears it. */
  profileLinks?: ProfileLink[] | null;
  profileLayout?: ProfileLayout | null;
  /**
   * Profile decorations (decorations.ts); null clears one. A value that is not
   * one of the designs is refused, and the classic font is stored as none. A
   * design someone made is sent as its reference (`custom:<id>`), and must be
   * of the field's kind and shared, or the caller's own.
   */
  avatarFrame?: AvatarFrame | CustomDecorationRef | null;
  profileEffect?: ProfileEffect | CustomDecorationRef | null;
  nameplate?: Nameplate | CustomDecorationRef | null;
  nameFont?: NameFont | null;
  nameEffect?: NameEffect | CustomDecorationRef | null;
  /**
   * The id of a space of this instance whose tag to wear, or null to wear none. The space must
   * have a tag and the person must be its member; anything else is `400 space_tag_unavailable`.
   */
  spaceTag?: string | null;
  displayName?: string;
  avatar?: string;
  banner?: string;
  accentColor?: string;
  /** The profile theme's second colour; an empty string clears it. */
  accentColorSecondary?: string;
  /** How strongly the theme colours the card; null goes back to `soft`. */
  profileThemeStyle?: ProfileThemeStyle | null;
  avatarColor?: string;
  bio?: string;
  customStatus?: string;
  /**
   * How long the custom status lasts, in minutes (1 to 10080), counted from the
   * save; null keeps it until it is changed. Meaningless without a status.
   */
  customStatusExpiresInMinutes?: number | null;
  status?: ChosenUserStatus;
  replicatedInstances?: ReplicatedInstance[];
  profileUpdatedAt?: number;
  showActivity?: boolean;
}

export interface UpdateMemberRequest {
  roleIds?: string[];
  /** Space-local name; null explicitly restores the account display name. */
  nickname?: string | null;
}

export interface CreateMessageRequest {
  content: string;
  attachments?: string[];
  /** Those of `attachments` to show as spoilers. */
  spoilerAttachments?: string[];
  replyToId?: string;
  /** Bots only (cards.ts). */
  cards?: unknown;
}

export interface UpdateMessageRequest {
  content: string;
  /** Bots only: the cards it shows from now on, or null for none. */
  cards?: unknown;
}

export interface JoinSpaceRequest {
  inviteCode: string;
}

export interface LiveKitTokenRequest {
  channelId: string;
}

export interface LiveKitTokenResponse {
  token: string;
  url: string;
}

export interface CreateDmRequest {
  userId?: string;
  homeUserId?: string;
  homeInstance?: string;
}

export interface AddDmMemberRequest {
  userId?: string;
  homeUserId?: string;
  homeInstance?: string;
}

/**
 * Body of POST /api/dm/:id/transfer.
 *
 * Accepts either a local user id (`newOwnerId`) or a federated identity
 * (`homeUserId` + `homeInstance`). Federated identification mirrors
 * `AddDmMemberRequest` and is required when the caller only knows the
 * target's home identity — typical for federated members surfaced through
 * the client's `userViews` cache, where `id` is the home id and not the
 * owner instance's local replicated id. When both are supplied, the
 * federated args take precedence (strictly more specific).
 */
export interface TransferOwnershipRequest {
  newOwnerId?: string;
  homeUserId?: string;
  homeInstance?: string;
}

export interface GroupDmUserIdentity {
  id: string;
  homeUserId?: string | null;
  homeInstance?: string | null;
}

export interface CreateGroupDmRequest {
  users: GroupDmUserIdentity[];
  fromDmChannelId?: string;
}

export interface CreateDmMessageRequest {
  content?: string;
  attachments?: string[];
  /** Those of `attachments` to show as spoilers. */
  spoilerAttachments?: string[];
  replyToId?: string;
}

// ─── Space Invite via DM ────────────────────────────────────────────────────

export interface SpaceInviteRequest {
  /** Caller-supplied target friend identity. Either local userId, or remote (homeUserId+homeInstance). */
  target: { userId: string } | { homeUserId: string; homeInstance: string };
  /** Space identifier on the space's home instance. */
  spaceId: string;
  /** Space's home instance origin. Empty string for the caller's home. */
  spaceInstanceOrigin: string;
  /** Per-space invite code (already issued; client passes whatever it has loaded). */
  inviteCode: string;
}

export interface SpaceInviteResponse {
  dmChannelId: string;
  messageId: string;
  message: DmMessageWithUser;
}

/** JSON content shape for type='system' space_invite messages. */
export interface SpaceInviteSystemPayload {
  event: 'space_invite';
  spaceId: string;
  spaceInstanceOrigin: string;
  inviteCode: string;
  snapshot: {
    spaceName: string;
    icon: string | null;
    avatarColor: AvatarColor | null;
    memberCount: number;
    description: string | null;
    instanceName: string;
  };
}

export interface PaginatedQuery {
  before?: string;
  after?: string;
  limit?: number;
}

/**
 * Set by the message history endpoints on a response that honoured `after`.
 * A server that predates forward paging ignores `after` and answers with the
 * newest page, without this header. Contract: docs/systems/api.md, "Message
 * history paging".
 */
export const MESSAGE_PAGING_HEADER = 'X-Backspace-Paging';
export const MESSAGE_PAGING_AFTER = 'after';

export interface ApiError {
  error: string;
  statusCode: number;
}

// ─── Social Types ────────────────────────────────────────────────────────────

export interface Friend {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  banner: string | null;
  accentColor: string | null;
  avatarColor: AvatarColor | null;
  bio: string | null;
  status: UserStatus;
  customStatus: string | null;
  createdAt: number;
  addedAt: number;
  homeUserId: string | null;
  homeInstance: string | null;
}

/**
 * `GET /api/social/search`: a person found by their username (docs/systems/
 * social.md, "Finding people"). Only what an add-friend row shows and a
 * request or a DM needs to address them; nothing about their status, their
 * profile text or their other accounts.
 */
export interface UserSearchResult {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  avatarColor: AvatarColor | null;
  homeInstance: string | null;
  homeUserId: string | null;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined';

export interface FriendRequest {
  id: string;
  fromId: string;
  toId: string;
  status: FriendRequestStatus;
  createdAt: number;
  user?: User; // The other user (if it's an incoming request, the sender; if outgoing, the recipient)
}

/**
 * Body of `POST /api/social/requests`. The target is named one of two ways:
 *
 * - By federated identity (`homeUserId` + `homeInstance`), when the client
 *   already holds the user. Takes precedence over `username`; both fields are
 *   required together. `homeInstance` is a bare domain or a full origin.
 * - By `username`, for a handle the user typed (`name` or `name@domain`).
 *
 * Clients that send an identity also send `username`: a server that predates
 * the identity fields ignores them and reads `username`.
 */
export interface SendFriendRequest {
  username?: string;
  homeUserId?: string;
  homeInstance?: string;
}

export interface UpdateFriendRequest {
  status: 'accepted' | 'declined';
}

// ─── GIF Types ──────────────────────────────────────────────────────────────

export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  width: number;
  height: number;
}

// ─── Instance Settings Types ────────────────────────────────────────────────

/** Where this account's address stands. Mail itself is never reported as delivered, only as handed over. */
export interface AccountEmailStatus {
  address: string | null;
  verified: boolean;
  pendingAddress: string | null;
  /** Mail to the address that is waiting for a link bounced or was complained about, so nothing more goes there. */
  undeliverable: boolean;
  /** How the last mail with a link fared: 'failed' and 'expired' never reached the provider. */
  lastSend: 'queued' | 'sent' | 'failed' | 'expired' | null;
}

export interface ChangeEmailRequest {
  address: string;
  password: string;
  locale?: string;
  /** Required while the account has 2FA on. */
  twoFactorCode?: string;
}

/** What the admin area shows about mail. Holds no address and no credential. */
export interface AdminEmailStatus {
  transport: 'none' | 'smtp' | 'resend';
  from: string;
  /** 'held': a daily or monthly limit is reached. 'blocked': the provider refuses the key or the domain. */
  state: 'off' | 'ok' | 'held' | 'blocked';
  heldUntil: number | null;
  lastError: string | null;
  queued: number;
  today: { accepted: number; failed: number; bounced: number; complained: number; limit: number };
  month: { accepted: number; limit: number };
  /** Share of the last 30 days' mail, 0 to 1; a provider may pause an account above about 4 % and 0.08 %. */
  bounceRate: number;
  complaintRate: number;
  webhookConfigured: boolean;
}

export interface InstanceAdminSettings {
  /** A new account needs a verified address (docs/systems/email.md, "The gate"). */
  emailRequired?: boolean;
  /** Addresses at throwaway mail domains are refused (docs/systems/email.md, "Throwaway addresses"). Missing on older servers. */
  blockThrowawayEmail?: boolean;
  instanceName: string;
  emojiPolicy: InstanceEmojiPolicy;
  registrationOpen: boolean;
  federatedRegistrationOpen: boolean;
  discoveryEnabled: boolean;
  gifApiKey?: string;
  gifEnabled?: boolean;
  maxUploadSizeMb: number;
  /** What an account may keep in files, in GB; 0 means no limit (utils/accountLimits.ts on the server). */
  storagePerAccountGb: number;
  /** How many spaces an account may own; 0 means no limit. */
  spacesPerAccount: number;
  federationRelayEnabled: boolean;
  federationRelayTtlDays: number;
  defaultAutoRotateIntervalDays: number;
  autoAcceptPeering: boolean;
  directoryEnabled: boolean;
  /**
   * The other directory axis: whether people on this instance see spaces from
   * other instances in Explore. Independent of `directoryEnabled`, which is
   * what this instance sends out. `DIRECTORY_ENDPOINT` sits above it: with no
   * endpoint there is nothing to browse whatever this says.
   */
  directoryBrowseEnabled: boolean;
  /** Read-only on the wire; the server ignores them on PATCH. */
  directoryLastPingAt: number | null;
  directoryLastError: DirectoryPingError | null;
  /**
   * Spaces here that have opted in to the directory and are not private,
   * counted whatever `directoryEnabled` says. Read-only, ignored on PATCH.
   * The instance switch lists nothing by itself; this is how the admin sees
   * whether any space has taken it up.
   */
  directoryListedSpaceCount: number;
  /**
   * The instance accent colour as `#rrggbb`, or null for the built-in violet.
   * Validated on write (`accentColorProblem`): it must stay readable under white
   * button text and visible on the dark panels. Also on `InstanceInfoResponse`.
   */
  accentColor: string | null;
}

export interface InstanceStreamingLimits {
  maxBitrateKbps: number;
  minBitrateKbps: number;
  bitrateStepKbps: number;
  allowedResolutions: (number | 'native')[];
  allowedFramerates: number[];
  maxResolution: number;
  maxFramerate: number;
  discoveryEnabled: boolean;
  /** The admin allows spaces here to be listed in the directory. Read-only on this route; PATCH /settings/instance sets it. */
  directoryEnabled: boolean;
  /**
   * This instance has a `DIRECTORY_ENDPOINT` to reach. Read-only and derived
   * from configuration, never stored, never accepted on a PATCH.
   *
   * It rides on this document because this is the one settings document any
   * signed-in user may read, on their own instance or on a peer: a space's
   * own instance answers for itself, which `GET /instance/info` on the home
   * instance cannot do for a space that lives somewhere else. Without it the
   * per-space listing switch was enabled on an instance with no endpoint,
   * writing a flag whose listing document no hub ever fetches.
   */
  directoryConfigured: boolean;
  bitrateMatrixOverrides: Record<string, number> | null;
  allowCustomBitrate: boolean;
}

// ─── Federation Types ──────────────────────────────────────────────────────

/** One message that mentions the signed-in user, for the inbox (GET /api/users/@me/mentions). */
export interface MentionItem {
  spaceId: string;
  channelId: string;
  message: MessageWithUser;
  /** How the message reaches the reader: by name, through a role they hold, @everyone / @here, or a word they watch. */
  via: 'user' | 'role' | 'everyone' | 'keyword';
  /**
   * The names of the people the text mentions, by the id in its `<@id>` tokens, as
   * that space shows them. The inbox reads messages of spaces whose member lists
   * the client has not loaded. Absent from a peer on an older version.
   */
  mentionedNames?: Record<string, string>;
}

/**
 * GET /api/users/@me/mentions: newest first. `nextBefore` is the `before` for
 * the next page, or null when the archive is exhausted. It is not always the
 * last item's id: a page can end on messages that were scanned and matched
 * nothing, and the next page starts after those.
 */
export interface MentionsResponse {
  mentions: MentionItem[];
  nextBefore: string | null;
}

/** One installer of the current desktop release, as the server can actually serve it. */
export interface DesktopReleaseFile {
  /** Only Windows installers are built today (docs/systems/desktop.md, "Releases"). */
  platform: 'windows';
  arch: 'x64' | 'arm64';
  /** The installer's file name, e.g. `Tavvit-1.11.0-win-x64.exe`. */
  fileName: string;
  /** Same-origin path the browser downloads from: `/downloads/desktop/<fileName>`. */
  url: string;
  /** Bytes on disk. */
  size: number;
  /** Base64 SHA-512 from latest.yml, the value electron-updater verifies against. */
  sha512: string;
}

/** GET /api/desktop/release — the published desktop build, or none. */
export interface DesktopReleaseResponse {
  release: {
    version: string;
    /** ISO 8601, from latest.yml's `releaseDate`; null when the file carries none. */
    releasedAt: string | null;
    files: DesktopReleaseFile[];
  } | null;
}

export interface InstanceInfoResponse {
  name: string;
  version: string;
  registrationOpen: boolean;
  /** This instance sends mail: addresses, confirming them and "forgot password" exist. Missing on older servers. */
  email?: boolean;
  /** A new account has to give an address and confirm it before it may do anything in a space but read, approach strangers or create spaces. */
  emailRequired?: boolean;
  /** This server holds what 2FA needs. Missing on older servers. */
  twoFactor?: boolean;
  /** Someone set up a translator for messages on this server (docs/systems/translation.md). Missing on older servers. */
  translation?: boolean;
  /**
   * The services whose accounts people can link on this server
   * (docs/systems/linked-accounts.md); a linked Twitch account shows when its
   * owner is live. Empty when the operator set none up; missing on older servers.
   */
  linkedAccounts?: LinkedAccountProvider[];
  emojiPolicy: InstanceEmojiPolicy;
  federatedRegistrationOpen: boolean;
  // Persistent per-instance epoch (incarnation UUID). Minted by ensureDefaults on
  // first boot and stable across restarts; changes only on a wipe/re-provision.
  // Peers use it to detect that a remote has been re-provisioned (self-healing).
  instanceId: string;
  // AGPL-3.0 § 13 network-use source offer: URL to the Corresponding Source of
  // the version this instance is running (operator-configurable via
  // BACKSPACE_SOURCE_URL so forks point at their own source).
  sourceCodeUrl: string;
  // Short git SHA/tag of the running build; null in dev builds with no commit injected.
  commit: string | null;
  // Three independent directory facts (directory.md section 9). They are
  // reported separately because folding any two of them into one boolean
  // leaves a client unable to tell which of them is false, and every surface
  // that says something about the directory needs a different one.
  //
  // directoryConfigured: the operator gave this instance a DIRECTORY_ENDPOINT.
  // Nothing about the directory works without it: no pinger, no proxy, no
  // Outer Space. Every surface that promises the directory will do something
  // gates on this.
  // directoryAvailable: people here browse the directory, which is
  // directoryConfigured and the admin's browse setting together. The Explore
  // page gates Outer Space on it.
  // directoryEnabled: the admin allows spaces here to be listed; the space
  // settings panel reads it.
  directoryConfigured: boolean;
  directoryAvailable: boolean;
  directoryEnabled: boolean;

  // ── Tavvit additions ──────────────────────────────────────────────────────
  // Optional on the wire: a client also reads this document from other
  // instances it connects to (older Backspace servers), and those never send
  // these fields. Each field below says what ABSENT means.

  // The operator enabled server-to-server federation (FEDERATION_ENABLED).
  // Absent means the server predates the switch, i.e. federation is available.
  federationEnabled?: boolean;
  // No local account exists yet and registration is closed, so nobody can
  // sign in or register: the first administrator has to be created from the
  // server with the `tavvit-admin` CLI. The login page shows how. Absent: false.
  setupRequired?: boolean;
  // The operator named where the source of THIS (modified) build is published
  // (TAVVIT_SOURCE_URL). While false, `sourceCodeUrl` is only the upstream
  // fallback and the AGPL § 13 offer is incomplete. Absent: true (an unmodified
  // upstream server's own URL is its source).
  sourceCodeConfigured?: boolean;
  // The instance accent colour as `#rrggbb`, or null for the built-in violet.
  // Absent: null.
  accentColor?: string | null;
}

export interface VerifyPasswordRequest {
  password: string;
}

export interface VerifyPasswordResponse {
  valid: boolean;
}

export interface ChangePasswordRequest {
  currentPassword?: string;  // Required on home, optional for federated users
  newPassword: string;
  /** Required while the account has 2FA on. */
  twoFactorCode?: string;
}

export interface ChangeUsernameRequest {
  username: string;
  password: string;
  /** Required while the account has 2FA on. */
  twoFactorCode?: string;
}

export interface ChangePasswordResponse {
  token: string;
}

export interface DeleteAccountRequest {
  password: string;
  username: string;  // Must match — confirmation safeguard
  /** Required while the account has 2FA on. */
  twoFactorCode?: string;
}

// ─── Per-Remote Federation Credentials ───────────────────────────────────
// The credential the client uses to register/log in as this user on ANOTHER
// instance. Issued and stored by the user's HOME instance only, so it stays
// identical across devices and browsing sessions. Never the home password.
// It signs in to the account there, so it is given out only with the home
// password (and the second factor while 2FA is on): a session alone learns
// whether the remote account already uses it, nothing more.

export interface FederationCredentialRequest {
  origin: string;            // Remote instance origin, e.g. 'https://orbit.example'
  markProvisioned?: boolean; // Record that the remote account now uses this secret
  /** The home password: without it the answer has no `secret`. */
  password?: string;
  /** Required with `password` while the account has 2FA on. */
  twoFactorCode?: string;
}

export interface FederationCredentialResponse {
  origin: string;
  /** Only when the request carried the password. */
  secret?: string;
  provisioned: boolean;      // True once the remote account is known to use `secret`
}

// ─── Federation Identity Delete Types ────────────────────────────────────

export interface FederationIdentityDeleteRequest {
  origins: string[];
  mode: 'leave' | 'soft' | 'full';
}

export interface FederationIdentityDeleteResult {
  success: boolean;
  error?: string;
  ownedSpaces?: { id: string; name: string }[];
}

export interface FederationIdentityDeleteResponse {
  results: Record<string, FederationIdentityDeleteResult>;
}

export interface FederationIdentityDeleteS2SRequest {
  homeUserId: string;
  homeInstance: string;
  mode: 'soft' | 'full';
}

// ─── Storage Management Types ─────────────────────────────────────────────

export interface StorageBreakdown {
  type: string;   // 'image' | 'video' | 'audio' | 'document' | 'other'
  count: number;
  size: number;
}

export interface StorageStats {
  totalFiles: number;
  totalSize: number;
  referencedFiles: number;
  referencedSize: number;
  orphanedFiles: number;
  orphanedSize: number;
  unlinkedAttachments: number;
  unlinkedSize: number;
  danglingAttachments: number;
  danglingSize: number;
  /** Count of `.tus/` entries (payloads + sidecars) with mtime older than 1h. */
  staleTusSessions: number;
  /** Total size in bytes of those stale `.tus/` entries. */
  staleTusSize: number;
  breakdown: StorageBreakdown[];
}

export interface OrphanedFile {
  filename: string;
  size: number;
  modifiedAt: number;
}

export interface CleanupResult {
  dryRun: boolean;
  deletedFiles: number;
  freedBytes: number;
  deletedAttachmentRecords: number;
  errors: string[];
}

// ─── Admin User Management Types ──────────────────────────────────────────

export interface AdminUser {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  avatarColor: string | null;
  status: string;
  isAdmin: boolean;
  isDeleted: boolean;
  homeInstance: string | null;
  /**
   * A copy of someone whose home, `homeInstance`, still answers for their profile: what it shows
   * is what that instance sends, so removing parts of it is that instance's to do
   * (docs/systems/admin.md, "Removing content"). False for an account of this instance and for a
   * copy whose home is gone.
   */
  profileKeptByHome: boolean;
  createdAt: number;
  /** The suspension standing now (platform.ts); null when there is none. */
  suspension: UserSuspension | null;
  /** The badges an admin gave the account. */
  grantedBadges: GrantedUserBadgeId[];
}

export interface AdminUserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminResetPasswordResponse {
  temporaryPassword: string;
}

// ─── Federation Relay Types ──────────────────────────────────────────────────

export interface FederationRelayParticipant {
  homeUserId: string;
  homeInstance: string;
  profile?: FederationRelayProfileSnapshot;
}

export interface FederationRelayEvent {
  eventType: 'create' | 'update' | 'delete' | 'reaction_add' | 'reaction_remove'
    | 'member_add' | 'member_remove' | 'ownership_transfer' | 'group_metadata_update'
    | 'friend_request_create' | 'friend_request_update' | 'friend_request_cancel'
    | 'friend_add' | 'friend_remove' | 'file_rejected'
    | 'dm_call_start' | 'dm_call_accept' | 'dm_call_reject' | 'dm_call_end'
    | 'dm_typing_start' | 'dm_typing_stop'
    | 'profile_update' | 'presence_update'
    | 'read_state_update'
    | 'dm_close' | 'dm_reopen'
    | 'pin_set';
  contextType?: 'dm' | 'friend' | 'profile';
  dmChannelId?: string;
  messageId: string;
  federatedId?: string;
  encryptionVersion: 0;
  timestamp: number;
  participants?: FederationRelayParticipant[];
  message?: {
    userId: string;
    homeUserId: string;
    homeInstance: string;
    type?: 'user' | 'system';
    content: string | null;
    /** The sender's local id of the replied-to message. Meaningless to a receiver, which never adopts it; see `replyTo`. */
    replyToId: string | null;
    /**
     * The replied-to message in coordinates every instance shares. Optional:
     * absent from older senders and on messages that are not replies. The
     * receiver resolves it inside the conversation the message lands in and
     * stores no reply target when it does not resolve there.
     */
    replyTo?: FederationMessageRef | null;
    /**
     * The users the content's `<@id>` tokens name, each as the sender's id
     * with the federated identity it stands for. Optional: absent from older
     * senders, from system messages and from content that mentions nobody.
     * The receiver rewrites each token to its own row for that identity; see
     * `FederationMentionRef`.
     */
    mentions?: FederationMentionRef[];
    editedAt: number | null;
    createdAt: number;
    /** A copy of a message forwarded here. Optional: absent from older senders. */
    forwarded?: boolean;
    attachments?: FederationRelayAttachment[];
  };
  reactions?: FederationRelayReaction[];
  reaction?: FederationRelayReaction;
  /** `pin_set`: whether a conversation's message is pinned now, and who changed it. */
  pin?: FederationRelayPin;
  /**
   * `update` / `delete`: the message being changed and who is changing it.
   * Optional: older senders omit it and are matched by `messageId` alone. See
   * `FederationMessageTarget` for how a receiver applies it.
   */
  target?: FederationMessageTarget;
  membership?: FederationMembershipPayload;
  ownership?: FederationOwnershipPayload;
  group?: FederationGroupPayload;
  friendship?: FederationFriendshipPayload;
  // file_rejected event fields
  attachmentId?: string;
  sourceFilename?: string;
  rejectionReason?: string;
  rejectionLimit?: number;
  affectedUserIds?: string[];
  /**
   * `file_rejected`: the same users as `affectedUserIds`, each with the
   * instance that homes them, so the receiver matches the whole identity.
   * Optional: absent from older senders, whose bare ids are matched only when
   * exactly one local user carries that home user id.
   */
  affectedUsers?: Array<{ homeUserId: string; homeInstance: string }>;
  call?: FederationCallPayload;
  typing?: {
    homeUserId: string;
    homeInstance: string;
    username: string;
  };
  metadata?: FederationGroupMetadataPayload;
  profileUpdate?: FederationProfileUpdatePayload;
  presenceUpdate?: FederationPresenceUpdatePayload;
  readState?: {
    user: { homeUserId: string; homeInstance: string };
    messageRef: { sourceInstance: string; sourceMessageId: string };
  };
  dmCloseReopen?: {
    homeUserId: string;
    homeInstance: string;
  };
}

export interface FederationCallPayload {
  livekitUrl?: string;
  tokens?: Record<string, string>;  // homeUserId → LiveKit token
  /**
   * The same tokens with each holder's federated identity. Optional: older
   * senders omit it, and every key of `tokens` is then a user homed on the
   * receiving instance. A receiver gives a token only to the local user its
   * identity resolves to; a home user id alone is unique only where issued.
   */
  memberTokens?: Array<{ homeUserId: string; homeInstance: string; token: string }>;
  caller?: { homeUserId: string; homeInstance: string; displayName: string };
  acceptor?: { homeUserId: string; homeInstance: string };
  rejector?: { homeUserId: string; homeInstance: string };
  endedBy?: { homeUserId: string; homeInstance: string };
  participants?: FederationRelayParticipant[];  // All DM members for Path B identity matching
  /**
   * Group call rules, per member (voice.md, "Group calls across instances").
   * On `dm_call_start` the host says it applies them: a member's end or
   * decline removes only that member, and the host relays `dm_call_end` to
   * every peer once the call is over. On `dm_call_accept` from an instance
   * holding the call's entry: it relays this member's leave, also when they
   * just go away, so the host seats them. On `dm_call_end` /
   * `dm_call_reject` from that instance: only this member left or declined,
   * and the sender keeps the call for its other members. Senders up to 1.8.0
   * omit it; their acceptors are not seated, and their ends and declines end
   * the call for all of the sender's members.
   */
  perMember?: boolean;
  /**
   * On `dm_call_accept`: the member who answered. `acceptor` names a user the
   * receiving peer accepts from the sender, which is the caller when the
   * member who answered is homed on a third instance; this names the member
   * themselves. It authorizes nothing: it only tells the receiver whose other
   * sessions stop ringing. Senders up to 1.9.0 omit it, and `acceptor` is
   * then the best answer there is.
   */
  answeredBy?: FederatedIdentity;
}

export interface FederationMembershipPayload {
  user: FederationRelayParticipant;
  addedBy?: FederationRelayParticipant;
  removedBy?: FederationRelayParticipant;
  reason?: 'kick' | 'leave';
}

export interface FederationOwnershipPayload {
  newOwner: FederationRelayParticipant;
  previousOwner: FederationRelayParticipant;
}

export interface FederationGroupPayload {
  owner: FederationRelayParticipant;
  members: FederationRelayParticipant[];
  // Group metadata snapshot — used by bootstrap path on a fresh peer.
  // Mirrors current owner-instance values at the moment of the member_add event.
  name: string | null;
  icon: string | null;            // absolute URL
  metadataUpdatedAt: number;
}

export interface FederationGroupMetadataPayload {
  name: string | null;     // explicit null = cleared
  icon: string | null;     // absolute URL on the wire; null = cleared
  metadataUpdatedAt: number;
  actor: FederationRelayParticipant; // == owner by authority invariant; used for system-message rendering
}

export interface FederationRelayProfileSnapshot {
  username?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  avatarColor?: string | null;
  banner?: string | null;
  bio?: string | null;
  // Current presence at the moment the snapshot was built. Optional for
  // backwards compatibility with peers that pre-date the field. Receivers use
  // this to seed the stub's status at creation time, so a freshly-friended
  // remote user shows their actual current state instead of defaulting to
  // 'offline' until the next presence_update arrives. presence_update is
  // ephemeral and fires only on transitions, so without this field an
  // already-online remote stays stuck at 'offline' on the receiver until they
  // next change status.
  status?: 'online' | 'idle' | 'dnd' | 'offline' | null;
  /**
   * The user is tombstoned on the instance that built this snapshot.
   * Receivers must not create a new stub for this identity; internal
   * '!deleted:<id>' usernames are never shipped (dead-incarnation spec §3.3).
   */
  deleted?: boolean | null;
}

export interface FederationProfileUpdatePayload {
  homeUserId: string;
  homeInstance: string;
  profileUpdatedAt: number;
  // Home user's canonical username (without @domain suffix). Receivers apply
  // `displayName ?? username` so stubs whose home user has no displayName show
  // the real handle instead of getting clobbered to null. Username itself is
  // immutable on the home instance — receivers do NOT rewrite the stub's
  // username column on profile_update.
  username: string;
  displayName: string | null;
  avatar: string | null;
  banner: string | null;
  accentColor: string | null;
  avatarColor: string | null;
  bio: string | null;
}

/**
 * Presence projection from a home instance to peers. Carries the user's current
 * online status and (optionally) rich activities. Outbox-only on the wire — never
 * written to federation_mutation_log; presence is ephemeral and stale replays on
 * peer activation are wrong (the activation hook re-emits a fresh snapshot).
 */
export interface FederationPresenceUpdatePayload {
  homeUserId: string;
  homeInstance: string;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  activities?: Activity[];
  ts: number; // emitter clock; receiver may use for last-write-wins
}

export interface FederationFriendshipPayload {
  from: FederationRelayParticipant;
  to: FederationRelayParticipant;
  fromProfile?: FederationRelayProfileSnapshot;
  toProfile?: FederationRelayProfileSnapshot;
  status?: 'pending' | 'accepted' | 'declined';
  createdAt: number;
}

/**
 * A DM message named across instances. Every instance holds its own copy of a
 * federated message under its own local id, so a reference that crosses
 * instances uses the id the message has on the instance it was created on,
 * together with that instance's origin (as its `getOurOrigin()` reports it).
 */
export interface FederationMessageRef {
  messageId: string;
  messageHomeInstance: string;
}

/**
 * One user a relayed message's content mentions.
 *
 * A `<@id>` token carries an id issued by the instance the content was written
 * on, which names nobody on another instance. `id` is that id as it appears in
 * the relayed content; `homeUserId` + `homeInstance` is the federated identity
 * of the user it names there. A receiver resolves the identity to its own row
 * and rewrites `<@id>` to that row's id before storing the content, and keeps
 * the token as written when it holds no row for the identity.
 */
export interface FederationMentionRef {
  id: string;
  homeUserId: string;
  homeInstance: string;
}

/**
 * The message an `update` or `delete` relay changes.
 *
 * `messageId` on the event is the sender's local id, which only identifies the
 * message when the sender created it. A receiver given a target instead
 * resolves `message` inside its copy of the conversation `federatedId`, and
 * applies the change only when `actor` is that message's author, compared as
 * federated identities, and `actor` passes the relay attribution check. The
 * rule is written out in docs/systems/dm-system.md, "Relayed edits and
 * deletes".
 */
export interface FederationMessageTarget {
  message: FederationMessageRef;
  /** The conversation's `federatedId` (1-on-1 and group alike). */
  federatedId: string;
  /** The user editing or deleting, as a federated identity. */
  actor: { homeUserId: string; homeInstance: string };
}

export interface FederationRelayReaction {
  messageId?: string;
  messageHomeInstance?: string;
  userId: string;
  homeUserId: string;
  homeInstance: string;
  emoji: string;
  createdAt: number;
}

export interface FederationRelayPin {
  messageId: string;
  messageHomeInstance?: string;
  userId: string;
  homeUserId: string;
  homeInstance: string;
  pinned: boolean;
  /** When it changed, on the sender's clock. An older state does not replace a newer one. */
  at: number;
}

export interface FederationRelayAttachment {
  id: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  // Web-playability computed by the origin instance (see Attachment.playable).
  // Propagated so the receiving instance need not re-probe the codec.
  playable?: boolean | null;
  spoiler?: boolean;
  voiceWaveform?: number[];
  thumbnailFilename?: string;
  sourceUrl: string;
}

export interface FederationRelayRequest {
  version: 1;
  sourceInstance: string;
  // Sender's persistent epoch (incarnation UUID). Optional for wire compatibility
  // with peers that predate epoch self-healing; when present, the receiver can
  // detect that the source instance has been re-provisioned.
  sourceInstanceId?: string;
  /**
   * Relay behaviours the sender implements beyond plain v1. Optional for wire
   * compatibility: a receiver treats a missing or malformed list as empty and
   * answers with v1 behaviour only. See `FederationRelayCapability`.
   */
  capabilities?: FederationRelayCapability[];
  events: FederationRelayEvent[];
}

/**
 * A relay behaviour a sender opts into by listing it in
 * `FederationRelayRequest.capabilities`. Each one gates something the receiver
 * would otherwise not send, so an older sender is never handed an answer it was
 * not built to handle.
 *
 * - `attribution_unproven`: the sender retries an event rejected with the
 *   reason `attribution_unproven` on its normal backoff, until the outbox TTL.
 *   A receiver may then use that reason for a homeward claim whose proof it
 *   does not hold yet; for any other sender it answers the same case with the
 *   terminal `attribution_mismatch`.
 */
export type FederationRelayCapability = 'attribution_unproven';

export interface FederationEpochResponse {
  instanceId: string;
}

export interface FederationRelayResponse {
  accepted: string[];
  rejected: Array<{ messageId: string; reason: string }>;
  /**
   * Third classification (additive, v1.x): events that were processed cleanly
   * but had no reachable recipient. Distinct from `rejected` (data/protocol
   * refusal). Currently used only for `dm_call_start` — other event types
   * keep accepted/rejected semantics unchanged. Omitted when empty for
   * wire-size hygiene and byte-identical responses in the typical case.
   */
  undeliverable?: Array<{ messageId: string; reason: string }>;
  maxUploadSize: number;
}

export interface FederationSyncRequest {
  sinceTimestamp: number;
  /**
   * Keyset tiebreak: with it, the server returns the log rows after the row
   * `(sinceTimestamp, afterId)` in `(mutated_at, id)` order, so rows sharing a
   * millisecond across a page boundary are all served. Older servers ignore it
   * and return rows with `mutated_at > sinceTimestamp`.
   */
  afterId?: string;
  dmChannelId?: string;
  federatedId?: string;
  contextType?: 'dm' | 'friend' | 'profile';
  limit: number;
}

export interface FederationSyncResponse {
  events: FederationRelayEvent[];
  hasMore: boolean;
  checkpoint: number;
  /**
   * The id of the last log row the page covered (before any filtering), to be
   * sent back as `afterId` with `sinceTimestamp: checkpoint`. Absent from older
   * servers, whose next page has to start at `checkpoint - 1`.
   */
  checkpointId?: string;
}

// Detached-account re-attach (re-attach spec §3.1–3.2).
// Minted on the home instance D for a logged-in native user.
export interface AttachProofResponse {
  token: string;
}

// Body of POST /api/users/@me/reattach on the peer R — the one-time proof token
// minted by the home instance, verified with D over signed S2S.
export interface ReattachRequest {
  token: string;
}

// Success response of POST /api/users/@me/reattach — the re-bound self-view.
export interface ReattachResponse {
  success: true;
  user: User;
}

export interface FederationUserLookupRequest {
  username: string;
}

export interface FederationUserLookupProfile {
  displayName: string | null;
  avatar: string | null;
  avatarColor: AvatarColor | null;
  banner: string | null;
  bio: string | null;
  // Carried so the requester can seed the stub's status at creation time.
  // Optional for backwards compat with peers that pre-date the field.
  status?: 'online' | 'idle' | 'dnd' | 'offline' | null;
  // `/users/by-home-id` only, from homes that send it: the profile's version
  // (the value `profile_update` carries; a never-edited profile is at its
  // account's creation time) and the accent colour, so the answer can be
  // applied like a `profile_update`. Absent from older homes.
  profileUpdatedAt?: number | null;
  accentColor?: string | null;
}

export type FederationUserLookupResponse =
  | { found: true; user: { homeUserId: string; username: string; profile: FederationUserLookupProfile } }
  | { found: false; code: 'user_not_found' };

export interface FederationPeer {
  id: string;
  origin: string;
  instanceName: string | null;
  status: 'pending' | 'active' | 'unreachable' | 'revoked' | 'rejected' | 'awaiting_approval' | 'needs_attention';
  lastSeenAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  consecutiveAuthFailures: number;
  lastSyncedAt: number;
  autoRotateIntervalDays: number;
  secretRotatedAt: number | null;
  rotationInProgress: boolean;
  createdAt: number;
  statusReason: FederationPeerStatusReason | null;
}

// ─── Reset-cleanup admin surface (instance-epoch self-healing §6.4) ──────────

/**
 * A real (non-stub) account whose home instance was reset — quarantined via
 * `federation_home_orphaned = 1`. Surfaced to the admin "Reset cleanup" UI with
 * enough context (owned spaces, membership/message counts) to decide Keep or
 * Remove.
 */
export interface FederationOrphanedAccount {
  id: string;
  username: string; // preserved original handle (detach spec); legacy rows may carry '!orphaned:{uid}@domain'
  displayName: string | null;
  avatarColor: string | null;
  ownedSpaces: { id: string; name: string }[];
  spaceMemberCount: number; // # of spaces they're a member of
  messageCount: number; // # of space messages they authored
}

/**
 * A durable row from the `federation_reset_events` journal, augmented with the
 * origin's current orphaned real accounts for admin disposition.
 */
export interface FederationResetEvent {
  origin: string;
  deadEpoch: string;
  newEpoch: string | null;
  detectedAt: number;
  resolvedAt: number | null;
  acknowledgedAt: number | null;
  stubCount: number;
  orphanedAccountCount: number;
  orphanedAccounts: FederationOrphanedAccount[];
}

export interface FederationResetEventsResponse {
  events: FederationResetEvent[];
}

// ─── Outbound peering gate ──────────────────────────────────────────────────

/**
 * Why a user-initiated federation action triggered the outbound peering gate.
 * Recorded on `peer_approval_subscribers.trigger_reason` so admins can see
 * the human-readable cause and the user can recover their original action
 * after approval. Persisted as a string column with this exact set of values.
 *
 * `instance_connect`: the user opened a session on the remote instance
 * (connect, explicit login, token resume, or app start), and the client asked
 * its home instance to peer so DMs written there can be relayed home.
 */
export type PeeringTriggerReason = 'friend_add' | 'space_join' | 'direct_message' | 'instance_connect';

/**
 * The trigger reasons a client may state in `POST /api/federation/peer/ensure`.
 * The server refuses any other value with `validation_failed`, and derives the
 * target itself for each one. `friend_add` is deliberately absent: friend-add
 * peers server-side with a target it has checked, so a client stating it
 * could only put a friend request the admin cannot verify into the queue.
 */
export const PEER_ENSURE_REASONS = ['instance_connect'] as const satisfies readonly PeeringTriggerReason[];
export type PeerEnsureReason = (typeof PEER_ENSURE_REASONS)[number];

/**
 * Body of `POST /api/federation/peer/ensure`. `reason` is optional for clients
 * that predate it; the server reads a missing reason as `instance_connect`,
 * the only thing those clients called the endpoint for.
 */
export interface PeerEnsureRequest {
  remoteOrigin: string;
  reason?: PeerEnsureReason;
}

/**
 * Caller intent passed into `ensurePeered()`. The gate (when
 * `autoAcceptPeering=0` and no peer row exists) branches on `kind`:
 *   - 'user_action': queue an outbound approval request and surface
 *     `admin_required` to the caller so the user sees a clear pending state.
 *   - 'system': skip queueing; surface `admin_required` so the calling
 *     subsystem (e.g. background relay) can fail loudly without spamming
 *     admin queues with rows nobody asked for.
 *
 * `target` is the human-readable target identifier the user acted on
 * (e.g. `username@instance.example` for friend_add, the space invite code
 * for space_join, the federated DM channel id for direct_message, the remote
 * origin for instance_connect).
 */
export type EnsurePeeredCallerIntent =
  | { kind: 'user_action'; userId: string; reason: PeeringTriggerReason; target: string }
  | { kind: 'system' };

/**
 * Terminal-state notification kinds delivered to subscribers when the
 * outbound queue resolves. 'expired' is delivered by the storage janitor
 * before it deletes an unresolved outbound queue row past `expiresAt`.
 */
export type PeeringNotificationKind = 'approved' | 'denied' | 'expired';

/**
 * Per-user pending row joined from `peer_approval_subscribers` to its parent
 * `peer_approval_requests`. Returned from
 * `GET /api/federation/peering-subscriptions`. Used to render the user's own
 * "waiting on admin" surface so they remember which actions are blocked.
 */
export interface PeeringSubscription {
  id: string;
  requestId: string;
  peerOrigin: string;
  peerInstanceName: string | null;
  triggerReason: PeeringTriggerReason;
  triggerTarget: string;
  createdAt: number;
}

/**
 * Terminal-state notification row returned from
 * `GET /api/federation/peering-notifications`. Persists until the user
 * explicitly reads (sets `readAt`) or the janitor cleans up read rows
 * older than the retention window.
 */
export interface PeeringNotification {
  id: string;
  kind: PeeringNotificationKind;
  peerOrigin: string;
  triggerReason: PeeringTriggerReason;
  triggerTarget: string;
  createdAt: number;
  readAt: number | null;
}

/**
 * Subscriber summary embedded in the admin-facing approval request response
 * for outbound rows. Lets the admin see which users are waiting on each
 * outbound request without a separate fetch.
 */
export interface ApprovalRequestSubscriberSummary {
  userId: string;
  username: string;
  triggerReason: PeeringTriggerReason;
  triggerTarget: string;
}

/**
 * Admin-facing approval request row returned from
 * `GET /api/federation/approval-requests`. Inbound rows are remote
 * instances asking to peer with us; outbound rows are local users asking
 * us to peer with a remote instance. Outbound rows include `subscribers`
 * so the admin can see who is waiting.
 */
export interface ApprovalRequest {
  id: string;
  direction: 'inbound' | 'outbound';
  origin: string;
  instanceName: string | null;
  requestedAt: number;
  expiresAt: number;
  /**
   * Subscriber summaries — present (and possibly empty array) only when
   * `direction === 'outbound'`. ABSENT (`undefined`) when `direction === 'inbound'`.
   * Inbound rows have no per-action context; the field is omitted from the server
   * response, not set to `[]`.
   */
  subscribers?: ApprovalRequestSubscriberSummary[];
}

// ─── Invite Links ──────────────────────────────────────────────────────────

/** Derived status of an invite link. Active = usable; expired/exhausted/revoked = archived. */
export type InviteStatus = 'active' | 'expired' | 'exhausted' | 'revoked';

export interface InviteLinkSummary {
  id: string;
  token: string;
  name: string;
  status: InviteStatus;
  maxUses: number | null;
  usedCount: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdBy: string;
  /** Joined from users.username at read time. `'Deleted User'` when the creator's account is tombstoned. `null` only if the FK is somehow unresolvable (defensive). */
  createdByUsername: string | null;
  createdAt: number;
  /** Epoch ms of the most recent redemption; `null` when the invite has zero redemptions. */
  lastRedeemedAt: number | null;
  /** Server-constructed full URL, e.g. `https://host.example/register?invite=<token>`. Clients must NOT assemble this themselves. */
  url: string;
}

export interface InviteRedemption {
  id: string;
  userId: string | null;
  registrantUsername: string;
  currentUsername: string | null;
  isDeleted: boolean;
  redeemedAt: number;
}

export interface CreateInviteRequest {
  name: string;
  maxUses: number | null;
  expiresAt: number | null;
}

export interface UpdateInviteRequest {
  name?: string;
  maxUses?: number | null;
  expiresAt?: number | null;
}

export interface ReinstateInviteRequest {
  maxUses?: number | null;
  expiresAt?: number | null;
}

export interface ReinstateInviteResponse {
  invite: InviteLinkSummary;
  tokenRotated: boolean;
}

export interface CheckInviteValidResponse {
  valid: true;
  name: string;
}

export interface CheckInviteInvalidResponse {
  valid: false;
  reason: 'expired' | 'exhausted' | 'invalid';
}

export type CheckInviteResponse = CheckInviteValidResponse | CheckInviteInvalidResponse;

export type ClientKind = 'web' | 'desktop' | 'mobile';

export type { DmSystemEvent } from './dmSystemEvents.js';
export type { ChannelSystemEvent } from './channelSystemEvents.js';

// ─── Federation peer state (docs/systems/federation.md, "Peer state") ────────

/** Every value `federation_peers.status` takes. */
export type FederationPeerStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'active'
  | 'unreachable'
  | 'needs_attention'
  | 'rejected'
  | 'revoked';

/** Why a peer is in `needs_attention`. */
export type FederationNeedsAttentionReason = 'auth_failures' | 'peer_reset_detected' | 'repeer_incomplete';

/**
 * Why a peer is `rejected`. `denied_by_local_admin` is our own refusal; every
 * other value is the remote refusing us, or holding an older peering with us
 * that its admin has to reset (`stale_peering_on_remote`).
 */
export type FederationRejectedReason =
  | 'denied_by_local_admin'
  | 'denied_by_remote'
  | 'revoked_by_remote'
  | 'expired_on_remote'
  | 'stale_peering_on_remote';

/** `federation_peers.status_reason`: set for `needs_attention` and `rejected`, null otherwise. */
export type FederationPeerStatusReason = FederationNeedsAttentionReason | FederationRejectedReason;
