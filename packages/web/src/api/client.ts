import type { TranslateMessageResponse, TranslationTarget } from '@backspace/shared/src/translation';
import type { StorageUsage } from '@backspace/shared/src/accountLimits';
import type { AdminBotInfo, BotDetail, BotInfo, BotPublicInfo, BotsResponse, BotWithToken, ChannelCommand, CommandOptionValue } from '@backspace/shared/src/bots';
import type { SpaceSound, SpaceSoundRequest } from '@backspace/shared/src/soundboard';
import type { WatchAction, WatchReaction, WatchSession } from '@backspace/shared/src/watch';

/** A session as a watch route answers it: where it stands now, and the server's clock then. */
export interface WatchStateResponse {
  session: WatchSession | null;
  serverNow: number;
}
import type { SavedItem, SavedKind, SavedListResponse } from '@backspace/shared/src/saved';
import type { WebhookInfo, WebhookWithToken } from '@backspace/shared/src/webhooks';
import type { SpaceEvent, SpaceEventRequest } from '@backspace/shared/src/events';
import type { SpaceWelcome, SpaceWelcomeRequest } from '@backspace/shared/src/welcome';
import type { ThreadInfo, ThreadOpened } from '@backspace/shared/src/threads';
import type { CreateForumPostRequest, ForumPost, ForumPostsResponse, ForumTag, UpdateForumTagsRequest } from '@backspace/shared/src/forums';
import type { ChannelFollowInfo, ChannelFollowsResponse, FollowTargetSpace } from '@backspace/shared/src/channelFollows';
import type { PushKeyResponse, PushSubscribeRequest } from '@backspace/shared/src/push';
import type { SignupChallengeLevel, SignupChallengeResponse } from '@backspace/shared/src/signupChallenge';
import { solveSignupChallenge } from '../utils/signupChallenge';
import type { CreatePollRequest, PollInfo } from '@backspace/shared/src/polls';
import type { CreateSpaceInviteRequest, DataExportStatus, SessionsResponse, SecurityEventInfo, SessionInfo, SpaceInviteLink } from '@backspace/shared';
import type { SpaceTagCardResponse } from '@backspace/shared';
import type { CreateVoiceOverlayResponse, VoiceOverlayLinkResponse } from '@backspace/shared/src/voiceOverlay';
import type {
  LinkedAccountCompleteRequest,
  LinkedAccountProvider,
  LinkedAccountsResponse,
  LinkedAccountStartResponse,
  LinkedAccountUpdateRequest,
} from '@backspace/shared';
import type {
  AdminLegalDocument,
  AdminLegalResponse,
  AdminReport,
  AdminReportListResponse,
  CreateReportBody,
  CreateReportResponse,
  DecideReportBody,
  LegalDocumentKind,
  LegalDocumentResponse,
  LegalInfoResponse,
  LegalOperator,
  LegalTextLanguage,
  PublishLegalDocumentBody,
  UserNoticeListResponse,
} from '@backspace/shared/src/legal';
import type { PersonalSticker } from '@backspace/shared/src/stickers';
import type { CreateCustomDecorationRequest, CustomDecoration, CustomDecorationKind, CustomDecorationPage, CustomDecorationSort, UpdateCustomDecorationRequest } from '@backspace/shared/src/customDecorations';
import type { AdminSpaceExpressions, RemovalRequest, RemoveProfileContentRequest, RemoveSpaceContentRequest, RemoveSpaceExpressionRequest } from '@backspace/shared/src/adminRemoval';
import type { ReportGround } from '@backspace/shared/src/legal';
import type { ProfileImageRequest, ProfileImageResponse } from '@backspace/shared/src/profileImage';
import type { CustomEmoji } from '@backspace/shared/src/customEmoji';
import type { DiscordImportApplyRequest, DiscordImportPreview, DiscordImportPreviewRequest, DiscordImportResult } from '@backspace/shared/src/discordImport';
import type {
  DiscordExpressionApplyRequest,
  DiscordExpressionApplyResult,
  DiscordExpressionPreview,
  DiscordExpressionPreviewRequest,
} from '@backspace/shared/src/discordExpressionImport';
import type {
  AvailableExpressionsResponse,
  SpaceEmoji,
  SpaceEmojiRequest,
  SpaceSticker,
  SpaceStickerRequest,
  SpaceStickerUpdate,
} from '@backspace/shared/src/spaceExpressions';
import { isErrorCode, type ErrorCode, type ErrorDetails } from '@backspace/shared/src/errors';
import type {
  RoleWriteRequest,
  UpdateSpaceProfileRequest,
  BlockedUser,
  NotificationSetting,
  NotificationSettingsResponse,
  UpdateNotificationSettingRequest,
  AuthResponse,
  PeerEnsureRequest,
  RegisterRequest,
  LoginRequest,
  User,
  Space,
  SpaceWithChannelsAndMembers,
  Channel,
  ChannelCategory,
  ForwardMessageRequest,
  MessagePinState,
  MessageWithUser,
  MemberWithUser,
  DmChannel,
  DmMessageWithUser,
  CreateSpaceRequest,
  UpdateSpaceRequest,
  CreateChannelRequest,
  UpdateChannelRequest,
  CreateMessageRequest,
  UpdateMessageRequest,
  UpdateUserRequest,
  JoinSpaceRequest,
  UpdateMemberRequest,
  LiveKitTokenResponse,
  CreateDmRequest,
  AddDmMemberRequest,
  CreateGroupDmRequest,
  TransferOwnershipRequest,
  CreateDmMessageRequest,
  Friend,
  FriendRequest,
  SendFriendRequest,
  UserSearchResult,
  InstanceStreamingLimits,
  InstanceAdminSettings,
  InstanceInfoResponse,
  DesktopReleaseResponse,
  MentionsResponse,
  VerifyPasswordResponse,
  ChangePasswordRequest,
  ChangeUsernameRequest,
  ChangePasswordResponse,
  FederationCredentialRequest,
  FederationCredentialResponse,
  DeleteAccountRequest,
  StorageStats,
  OrphanedFile,
  CleanupResult,
  AdminUserListResponse,
  AdminUser,
  AdminResetPasswordResponse,
  ExploreSpace,
  JoinRequest,
  DirectoryFeed,
  Role,
  SpaceLayoutItem,
  SpaceFolder,
  InvitePreview,
  GifResult,
  FederationRegistryEntry,
  FederationIdentityDeleteRequest,
  FederationIdentityDeleteResponse,
  FederationPeer,
  FederationOrphanedAccount,
  FederationResetEvent,
  FederationResetEventsResponse,
  ApprovalRequest,
  PeeringSubscription,
  PeeringNotification,
  InviteLinkSummary,
  InviteRedemption,
  CreateInviteRequest,
  UpdateInviteRequest,
  ReinstateInviteRequest,
  ReinstateInviteResponse,
  CheckInviteResponse,
  SpaceInviteRequest,
  SpaceInviteResponse,
  AttachProofResponse,
  ReattachRequest,
  ReattachResponse,
  SpaceDefaultNotificationLevel,
  SlowmodeSeconds,
  SpaceModerationSettings,
  UpdateSpaceModerationRequest,
  TimeoutMemberRequest,
  MemberResponse,
  AuditLogAction,
  AuditLogResponse,
  AccountEmailStatus,
  AdminEmailStatus,
  ChangeEmailRequest,
  LoginSecondFactorRequest,
  SecurityOverview,
  TwoFactorSetupResponse,
} from '@backspace/shared';
import type {
  AdminSpaceDetail,
  AdminSpaceFilter,
  AdminSpaceListResponse,
  AdminSpaceSummary,
  AdminUserDetail,
  BadgeGrantBody,
  DiscoveryDecision,
  DiscoveryRequestBody,
  PlatformAuditAction,
  PlatformAuditResponse,
  PlatformAuditTargetType,
  PlatformOverview,
  ReviewDecisionBody,
  ReviewQueueResponse,
  SpaceReviewState,
  SuspendUserBody,
  UnsuspendUserBody,
  VerificationDecision,
  VerificationRequestBody,
} from '@backspace/shared/src/platform';
import type {
  AdminDashboard,
  AdminNotesResponse,
  AdminSearchResponse,
  AdminSystemInfo,
  Announcement,
  AnnouncementTone,
  AnnouncementsResponse,
  SignupRuleKind,
  SignupRulesResponse,
  StarterSpacesResponse,
} from '@backspace/shared/src/adminConsole';
import { MESSAGE_PAGING_AFTER, MESSAGE_PAGING_HEADER } from '@backspace/shared';

export type { FederationPeer, FederationOrphanedAccount, FederationResetEvent, FederationResetEventsResponse, ApprovalRequest, PeeringSubscription, PeeringNotification };

/**
 * Reply of the username availability check. `reason` is the server's
 * English text; `code` and `details` let the client say it in the user's
 * language.
 */
/**
 * The member an owner-only group DM request acts on, as the receiving
 * instance can find them: its own local id, or a home identity it resolves.
 */
export type DmMemberTarget =
  | { userId: string }
  | { homeUserId: string; homeInstance: string };

export interface CheckUsernameResponse {
  available: boolean;
  reason?: string;
  code?: ErrorCode;
  details?: ErrorDetails;
}

/**
 * A history request with an `after` cursor. `forward` is false when the
 * server ignored the cursor (it predates forward paging): `messages` is then
 * the newest page, not the page after the cursor.
 */
export interface HistoryPageAfter<T> {
  messages: T[];
  forward: boolean;
}

/**
 * A channel or category override write. `version` is the version of the row
 * the edit started from (`overrideVersion`, permissions.md "Concurrent
 * edits"); the server answers 409 `overrides_conflict` when the row has
 * changed since. A server from before the check ignores it.
 */
export interface OverrideWriteBody {
  targetType: string;
  targetId: string;
  allow: string;
  deny: string;
  version?: string;
}

/**
 * A role update. `permissionsVersion` is the version of the permissions the
 * edit started from (`rolePermissionsVersion`); with `permissions`, the server
 * answers 409 `role_permissions_conflict` when the role's permissions have
 * changed since.
 */
export interface RoleUpdateBody extends RoleWriteRequest {
  position?: number;
  above?: string;
  below?: string;
  permissions?: string;
  permissionsVersion?: string;
}

/**
 * A space update. `defaultNotificationLevel` is the level the space's members
 * start with until they choose their own; null gives the choice back to the
 * built-in default. A host that predates the field ignores it.
 */
export type SpaceUpdateBody = UpdateSpaceRequest & {
  defaultNotificationLevel?: SpaceDefaultNotificationLevel | null;
};

/**
 * A channel update. `slowmodeSeconds` is one of `SLOWMODE_SECONDS`: how long a
 * member waits between two messages, 0 to turn slow mode off.
 */
export type ChannelUpdateBody = UpdateChannelRequest & {
  slowmodeSeconds?: SlowmodeSeconds;
};

/** One page of a space's audit log: the entries before `before`, optionally of one action or one actor. */
export interface AuditLogQuery {
  /** The id of the oldest entry already shown (`AuditLogResponse.nextBefore`). */
  before?: string;
  /** 1 to `AUDIT_LOG_MAX_PAGE_SIZE`; the server's default page without it. */
  limit?: number;
  action?: AuditLogAction;
  /** A user id of the instance that hosts the space. */
  actorId?: string;
}

/** The `?version=` of an override delete, or nothing when there is no version to send. */
function versionQuery(version: string | undefined): string {
  return version === undefined ? '' : `?${new URLSearchParams({ version }).toString()}`;
}

/** The parts of an error body the client reads; see HttpError.fromBody for the vintages. */
function readErrorBody(body: unknown): { errorText?: string; code?: ErrorCode; details?: ErrorDetails } {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const errorText = typeof record.error === 'string' && record.error.length > 0 ? record.error : undefined;
  const code = isErrorCode(record.code) ? record.code : isErrorCode(record.error) ? record.error : undefined;
  const details = typeof record.details === 'object' && record.details !== null
    ? (record.details as ErrorDetails)
    : undefined;
  return { errorText, code, details };
}

/** The server did not answer in time. Its words are for the logs; `describeError` has the reader's. */
export class RequestTimeoutError extends Error {
  constructor() {
    super('Request timed out');
    this.name = 'RequestTimeoutError';
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly body?: unknown;
  /** Stable server error code, when the route sends one; see packages/shared/src/errors.ts. */
  readonly code?: ErrorCode;
  /** Interpolation values for the localized message, e.g. `{ max: 32 }`. */
  readonly details?: ErrorDetails;

  constructor(status: number, message: string, body?: unknown, code?: ErrorCode, details?: ErrorDetails) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.code = code;
    this.details = details;
  }

  /**
   * Build from a failed response body of any vintage.
   *
   * Current routes send `{ error, code, statusCode, details? }`. Routes not
   * yet converted, and peers on older versions, send `{ error }` alone, and
   * some of those put the code in `error` itself. Only codes the shared list
   * knows are accepted, so a peer cannot inject arbitrary catalog keys.
   */
  static fromBody(status: number, body: unknown): HttpError {
    const { errorText, code, details } = readErrorBody(body);
    return new HttpError(status, errorText ?? `HTTP ${status}`, body, code, details);
  }
}

/**
 * A 429 from any route. An HttpError with the body's own code when the
 * route sends one (`lookup_rate_limited`, say) and `rate_limited` otherwise,
 * so `describeError` says it in the user's language, plus the seconds to
 * wait for the surfaces that count down (the auth pages).
 */
export class RateLimitError extends HttpError {
  /** Seconds until the limiter admits the next request: the body's `retryAfter`, the Retry-After header, or 60. */
  readonly retryAfter: number;

  constructor(retryAfter: number, body?: unknown) {
    const { errorText, code, details } = readErrorBody(body);
    super(429, errorText ?? 'Rate limit exceeded', body, code ?? 'rate_limited', details);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class BackspaceApiClient {
  readonly auth: {
    register: (data: RegisterRequest) => Promise<AuthResponse>;
    login: (data: LoginRequest) => Promise<AuthResponse>;
    checkUsername: (username: string) => Promise<CheckUsernameResponse>;
    checkInvite: (token: string) => Promise<CheckInviteResponse>;
    attachProof: (targetDomain: string) => Promise<AttachProofResponse>;
    logout: () => Promise<{ success: boolean }>;
    sessions: () => Promise<SessionsResponse>;
    endSession: (id: string) => Promise<SessionsResponse>;
    endOtherSessions: () => Promise<SessionsResponse>;
    forgotPassword: (email: string, locale: string) => Promise<{ success: boolean }>;
    resetPassword: (token: string, password: string) => Promise<{ success: boolean }>;
    verifyEmail: (token: string) => Promise<{ success: boolean; address: string }>;
    loginSecondFactor: (data: LoginSecondFactorRequest) => Promise<AuthResponse>;
    security: () => Promise<SecurityOverview>;
    twoFactorSetup: (password: string) => Promise<TwoFactorSetupResponse>;
    twoFactorEnable: (code: string) => Promise<{ recoveryCodes: string[] }>;
    twoFactorDisable: (password: string, code: string) => Promise<{ success: boolean }>;
    twoFactorRecoveryCodes: (password: string, code: string) => Promise<{ recoveryCodes: string[] }>;
    endAllSessions: () => Promise<{ success: boolean }>;
  };

  readonly users: {
    me: () => Promise<User>;
    update: (data: UpdateUserRequest) => Promise<User>;
    get: (id: string) => Promise<User>;
    verifyPassword: (password: string) => Promise<VerifyPasswordResponse>;
    storage: () => Promise<StorageUsage>;
    dataExportStatus: () => Promise<DataExportStatus>;
    /** Linked accounts (docs/systems/linked-accounts.md): what this server can link, and what the person linked. */
    linkedAccounts: () => Promise<LinkedAccountsResponse>;
    /** Where to sign in at the service to link an account there. */
    startLinkedAccount: (provider: LinkedAccountProvider) => Promise<LinkedAccountStartResponse>;
    /** Complete a link with what the service handed back on the way back. */
    completeLinkedAccount: (provider: LinkedAccountProvider, data: LinkedAccountCompleteRequest) => Promise<LinkedAccountsResponse>;
    updateLinkedAccount: (provider: LinkedAccountProvider, data: LinkedAccountUpdateRequest) => Promise<LinkedAccountsResponse>;
    unlinkAccount: (provider: LinkedAccountProvider) => Promise<LinkedAccountsResponse>;
    requestDataExport: (password: string, twoFactorCode?: string) => Promise<DataExportStatus>;
    downloadDataExport: () => Promise<Blob>;
    email: () => Promise<AccountEmailStatus>;
    changeEmail: (data: ChangeEmailRequest) => Promise<AccountEmailStatus>;
    resendEmail: () => Promise<AccountEmailStatus>;
    cancelPendingEmail: () => Promise<AccountEmailStatus>;
    removeEmail: (password: string, twoFactorCode?: string) => Promise<AccountEmailStatus>;
    setLocale: (locale: string) => Promise<{ locale: string }>;
    changePassword: (data: ChangePasswordRequest) => Promise<ChangePasswordResponse>;
    changeUsername: (data: ChangeUsernameRequest) => Promise<{ user: User }>;
    federationCredential: (data: FederationCredentialRequest) => Promise<FederationCredentialResponse>;
    deleteAccount: (data: DeleteAccountRequest) => Promise<{ success: boolean }>;
    getMutuals: (id: string, homeUserId?: string) => Promise<{ mutualFriends: User[]; mutualSpaces: { id: string; name: string; icon: string | null; avatarColor: string | null }[] }>;
    getFederationRegistry: () => Promise<{ registry: FederationRegistryEntry[]; updatedAt: number }>;
    putFederationRegistry: (data: { registry: FederationRegistryEntry[]; updatedAt: number }) => Promise<{ ok: boolean; updatedAt: number }>;
    deleteFederationIdentity: (data: FederationIdentityDeleteRequest) => Promise<FederationIdentityDeleteResponse>;
    reattach: (data: ReattachRequest) => Promise<ReattachResponse>;
    /** The people the signed-in user has blocked on this instance. */
    listBlocks: () => Promise<{ blocks: BlockedUser[] }>;
    /** Block someone (idempotent). Ends a friendship and withdraws friend requests between the two. */
    block: (userId: string) => Promise<BlockedUser>;
    /** Lift a block (idempotent). */
    unblock: (userId: string) => Promise<{ success: boolean }>;
    /** Cut an animated GIF or WebP to an avatar or banner on the server; the answer names the stored file. */
    profileImage: (data: ProfileImageRequest) => Promise<ProfileImageResponse>;
  };

  readonly spaceLayout: {
    update: (data: { items: SpaceLayoutItem[]; folders: Record<string, { name: string | null; color: string | null; spaceIds: string[] }>; updatedAt?: number }) => Promise<{ items: SpaceLayoutItem[]; folders: SpaceFolder[]; updatedAt?: number }>;
  };

  /**
   * The signed-in user's notification settings on this instance. Called on
   * the client of the instance that hosts the space (origin routing).
   */
  readonly notificationSettings: {
    list: () => Promise<NotificationSettingsResponse>;
    updateSpace: (spaceId: string, data: UpdateNotificationSettingRequest) => Promise<NotificationSetting>;
    updateChannel: (channelId: string, data: UpdateNotificationSettingRequest) => Promise<NotificationSetting>;
  };

  readonly spaces: {
    list: () => Promise<Space[]>;
    get: (id: string) => Promise<SpaceWithChannelsAndMembers>;
    create: (data: CreateSpaceRequest) => Promise<Space>;
    update: (id: string, data: SpaceUpdateBody) => Promise<Space>;
    delete: (id: string) => Promise<{ success: boolean }>;
    invite: (id: string) => Promise<{ inviteCode: string }>;
    join: (id: string, data: JoinSpaceRequest) => Promise<Space>;
    joinByCode: (inviteCode: string) => Promise<Space>;
    members: (id: string) => Promise<MemberWithUser[]>;
    updateMember: (spaceId: string, userId: string, data: UpdateMemberRequest) => Promise<MemberWithUser>;
    removeMember: (spaceId: string, userId: string, reason?: string) => Promise<{ success: boolean }>;
    getBans: (spaceId: string) => Promise<{ spaceId: string; userId: string; reason: string | null; bannedBy: string; createdAt: number; user: any; moderator: any }[]>;
    ban: (spaceId: string, userId: string, reason?: string, deleteMessagesSeconds?: number) => Promise<{ success: boolean }>;
    listInvites: (spaceId: string) => Promise<{ invites: SpaceInviteLink[] }>;
    setVanity: (spaceId: string, code: string | null) => Promise<{ vanityCode: string | null }>;
    createInvite: (spaceId: string, data: CreateSpaceInviteRequest) => Promise<{ invites: SpaceInviteLink[] }>;
    revokeInvite: (spaceId: string, code: string) => Promise<{ invites: SpaceInviteLink[] }>;
    unban: (spaceId: string, userId: string) => Promise<{ success: boolean }>;
    transferOwnership: (spaceId: string, newOwnerId: string) => Promise<Space>;
    invitePreview: (code: string) => Promise<InvitePreview>;
    /** The signed-in member's own picture, banner and about text for this space; null shows the account's. */
    updateMyProfile: (spaceId: string, data: UpdateSpaceProfileRequest) => Promise<MemberWithUser>;
  };

  /**
   * Importing a Discord server template into a new space or one the user
   * manages (spaces.md, "Importing a Discord template"). Called on the
   * instance that will host the result.
   */
  readonly import: {
    discordPreview: (data: DiscordImportPreviewRequest) => Promise<DiscordImportPreview>;
    discordApply: (data: DiscordImportApplyRequest) => Promise<DiscordImportResult>;
    /**
     * A Discord server's emoji and stickers (spaces.md, "Importing emoji and stickers from
     * Discord"): one look-up with the bot token, then batches without it until `finished`.
     */
    discordExpressionsPreview: (data: DiscordExpressionPreviewRequest) => Promise<DiscordExpressionPreview>;
    discordExpressionsApply: (data: DiscordExpressionApplyRequest) => Promise<DiscordExpressionApplyResult>;
    discordExpressionsCancel: (importId: string) => Promise<{ success: boolean }>;
  };

  /** A space's own emoji and stickers (docs/systems/emoji.md). Called on the instance that hosts the space. */
  readonly spaceExpressions: {
    /** Everything this person may pick on this instance: the library and every space they are in. */
    available: () => Promise<AvailableExpressionsResponse>;
    emojis: (spaceId: string) => Promise<{ emojis: SpaceEmoji[]; max: number }>;
    addEmoji: (spaceId: string, body: SpaceEmojiRequest) => Promise<SpaceEmoji>;
    renameEmoji: (id: string, name: string) => Promise<SpaceEmoji>;
    removeEmoji: (id: string) => Promise<{ success: boolean }>;
    stickers: (spaceId: string) => Promise<{ stickers: SpaceSticker[]; max: number }>;
    addSticker: (spaceId: string, body: SpaceStickerRequest) => Promise<SpaceSticker>;
    updateSticker: (id: string, body: SpaceStickerUpdate) => Promise<SpaceSticker>;
    removeSticker: (id: string) => Promise<{ success: boolean }>;
  };

  /**
   * Moderation of a space: its automatic message rules, member timeouts and
   * its audit log. Stored and enforced by the instance that hosts the space,
   * so these are called on that instance's client (origin routing), never
   * relayed.
   */
  readonly moderation: {
    getSettings: (spaceId: string) => Promise<SpaceModerationSettings>;
    updateSettings: (spaceId: string, data: UpdateSpaceModerationRequest) => Promise<SpaceModerationSettings>;
    /** Time a member out; `userId` is their id on the hosting instance. Answers with the member as they now are. */
    timeoutMember: (spaceId: string, userId: string, data: TimeoutMemberRequest) => Promise<MemberResponse>;
    /** End a member's timeout early. */
    removeTimeout: (spaceId: string, userId: string) => Promise<MemberResponse>;
    /** One page of the audit log, newest first. */
    auditLog: (spaceId: string, query?: AuditLogQuery) => Promise<AuditLogResponse>;
  };

  readonly channels: {
    list: (spaceId: string) => Promise<Channel[]>;
    create: (spaceId: string, data: CreateChannelRequest) => Promise<Channel>;
    update: (id: string, data: ChannelUpdateBody) => Promise<Channel>;
    delete: (id: string) => Promise<{ success: boolean }>;
    messages: (id: string, before?: string, limit?: number) => Promise<MessageWithUser[]>;
    messagesAround: (id: string, messageId: string, limit?: number) => Promise<MessageWithUser[]>;
    messagesAfter: (id: string, after: string, limit?: number) => Promise<HistoryPageAfter<MessageWithUser>>;
    sendMessage: (channelId: string, data: CreateMessageRequest) => Promise<MessageWithUser>;
    pins: (channelId: string) => Promise<MessageWithUser[]>;
    deleteMessages: (channelId: string, messageIds: string[]) => Promise<{ deleted: number }>;
    createPoll: (channelId: string, poll: CreatePollRequest) => Promise<MessageWithUser>;
    getOverrides: (channelId: string) => Promise<{ channelId: string; targetType: string; targetId: string; allow: string; deny: string; version?: string }[]>;
    putOverride: (channelId: string, data: OverrideWriteBody) => Promise<{ success: boolean; version?: string }>;
    deleteOverride: (channelId: string, targetType: string, targetId: string, version?: string) => Promise<{ success: boolean }>;
    updateLayout: (spaceId: string, data: { channels: Array<{ id: string; position: number; categoryId: string | null }>; categories: Array<{ id: string; position: number }> }) => Promise<{ success: boolean }>;
  };

  readonly categories: {
    create: (spaceId: string, name: string) => Promise<ChannelCategory>;
    update: (id: string, data: { name?: string; position?: number }) => Promise<ChannelCategory>;
    delete: (id: string) => Promise<{ success: boolean }>;
    getOverrides: (categoryId: string) => Promise<{ categoryId: string; targetType: string; targetId: string; allow: string; deny: string; version?: string }[]>;
    putOverride: (categoryId: string, data: OverrideWriteBody) => Promise<{ success: boolean; version?: string }>;
    deleteOverride: (categoryId: string, targetType: string, targetId: string, version?: string) => Promise<{ success: boolean }>;
  };

  readonly bots: {
    list: () => Promise<BotsResponse>;
    create: (name: string) => Promise<BotWithToken>;
    detail: (id: string) => Promise<BotDetail>;
    update: (id: string, body: { name: string; description: string | null; avatar?: string | null }) => Promise<BotInfo>;
    rotate: (id: string) => Promise<BotWithToken>;
    remove: (id: string) => Promise<{ success: boolean }>;
    publicInfo: (id: string) => Promise<BotPublicInfo>;
    addToSpace: (id: string, spaceId: string, permissions: string) => Promise<{ success: boolean }>;
  };
  readonly commands: {
    list: (channelId: string) => Promise<{ commands: ChannelCommand[] }>;
    invoke: (channelId: string, botId: string, name: string, args: string, options?: Record<string, CommandOptionValue>) => Promise<{ success: boolean }>;
  };
  readonly sounds: {
    list: (spaceId: string) => Promise<{ sounds: SpaceSound[] }>;
    add: (spaceId: string, body: SpaceSoundRequest) => Promise<SpaceSound>;
    rename: (id: string, name: string) => Promise<SpaceSound>;
    remove: (id: string) => Promise<{ success: boolean }>;
    audio: (id: string) => Promise<Blob>;
    play: (channelId: string, soundId: string) => Promise<{ success: boolean }>;
  };
  /** Watching together in a voice channel's call (docs/systems/watch-together.md). */
  readonly watch: {
    get: (channelId: string) => Promise<WatchStateResponse>;
    add: (channelId: string, url: string) => Promise<WatchStateResponse>;
    change: (channelId: string, action: WatchAction) => Promise<WatchStateResponse>;
    end: (channelId: string) => Promise<WatchStateResponse>;
    react: (channelId: string, reaction: WatchReaction) => Promise<{ success: boolean }>;
  };
  readonly saved: {
    list: (before?: string) => Promise<SavedListResponse>;
    ids: () => Promise<{ messageIds: string[] }>;
    save: (kind: SavedKind, messageId: string, remindAt?: number | null) => Promise<SavedItem>;
    remove: (kind: SavedKind, messageId: string) => Promise<{ success: boolean }>;
  };
  readonly keywords: {
    get: () => Promise<{ keywords: string[] }>;
    set: (keywords: string[]) => Promise<{ keywords: string[] }>;
    matches: (before?: string) => Promise<MentionsResponse>;
  };
  readonly webhooks: {
    list: (channelId: string) => Promise<{ webhooks: WebhookInfo[] }>;
    create: (channelId: string, name: string) => Promise<WebhookWithToken>;
    rename: (id: string, name: string) => Promise<WebhookInfo>;
    rotate: (id: string) => Promise<WebhookWithToken>;
    remove: (id: string) => Promise<{ success: boolean }>;
  };
  readonly events: {
    list: (spaceId: string) => Promise<{ events: SpaceEvent[] }>;
    create: (spaceId: string, body: SpaceEventRequest) => Promise<SpaceEvent>;
    update: (id: string, body: SpaceEventRequest) => Promise<SpaceEvent>;
    remove: (id: string) => Promise<{ success: boolean }>;
    rsvp: (id: string) => Promise<SpaceEvent>;
    unrsvp: (id: string) => Promise<SpaceEvent>;
    attendees: (id: string) => Promise<{ attendees: User[] }>;
  };
  readonly welcome: {
    get: (spaceId: string) => Promise<SpaceWelcome>;
    update: (spaceId: string, body: SpaceWelcomeRequest) => Promise<SpaceWelcome>;
    accept: (spaceId: string) => Promise<SpaceWelcome>;
  };
  readonly forums: {
    posts: (channelId: string, query: { tag?: string; before?: string }) => Promise<ForumPostsResponse>;
    createPost: (channelId: string, body: CreateForumPostRequest) => Promise<ForumPost>;
    tags: (channelId: string) => Promise<{ tags: ForumTag[] }>;
    setTags: (channelId: string, tags: UpdateForumTagsRequest['tags']) => Promise<{ tags: ForumTag[] }>;
    setPostTags: (threadId: string, tagIds: string[]) => Promise<{ tagIds: string[] }>;
  };

  readonly channelFollows: {
    list: (channelId: string) => Promise<ChannelFollowsResponse>;
    targets: (channelId: string) => Promise<{ spaces: FollowTargetSpace[] }>;
    create: (channelId: string, targetChannelId: string) => Promise<ChannelFollowInfo>;
    remove: (id: string) => Promise<{ success: boolean }>;
  };

  readonly threads: {
    start: (messageId: string, name?: string) => Promise<ThreadInfo>;
    list: (channelId: string, archived: boolean) => Promise<{ threads: ThreadInfo[] }>;
    open: (id: string) => Promise<ThreadOpened>;
    follow: (id: string) => Promise<ThreadInfo>;
    unfollow: (id: string) => Promise<ThreadInfo>;
    rename: (id: string, name: string) => Promise<ThreadInfo>;
    remove: (id: string) => Promise<{ success: boolean }>;
  };

  readonly push: {
    key: () => Promise<PushKeyResponse>;
    subscribe: (data: PushSubscribeRequest) => Promise<{ success: boolean }>;
    unsubscribe: (endpoint: string) => Promise<{ success: boolean }>;
  };

  readonly messages: {
    update: (id: string, data: UpdateMessageRequest) => Promise<MessageWithUser>;
    delete: (id: string) => Promise<{ success: boolean }>;
    forward: (id: string, destination: ForwardMessageRequest) => Promise<MessageWithUser>;
    translate: (id: string, target: TranslationTarget) => Promise<TranslateMessageResponse>;
    votePoll: (id: string, optionIds: string[]) => Promise<PollInfo>;
    endPoll: (id: string) => Promise<PollInfo>;
    pollVoters: (id: string, optionId: string) => Promise<{ voters: User[] }>;
    pin: (id: string) => Promise<MessagePinState>;
    unpin: (id: string) => Promise<MessagePinState>;
  };

  readonly uploads: {
    url: (filename: string) => string;
  };

  readonly dm: {
    list: () => Promise<DmChannel[]>;
    create: (data: CreateDmRequest) => Promise<DmChannel>;
    createGroup: (data: CreateGroupDmRequest) => Promise<DmChannel>;
    close: (id: string) => Promise<{ success: boolean }>;
    messages: (id: string, before?: string, limit?: number) => Promise<DmMessageWithUser[]>;
    messagesAround: (id: string, messageId: string, limit?: number) => Promise<DmMessageWithUser[]>;
    messagesAfter: (id: string, after: string, limit?: number) => Promise<HistoryPageAfter<DmMessageWithUser>>;
    sendMessage: (id: string, data: CreateDmMessageRequest) => Promise<DmMessageWithUser>;
    updateMessage: (id: string, data: UpdateMessageRequest) => Promise<DmMessageWithUser>;
    deleteMessage: (id: string) => Promise<{ success: boolean }>;
    forwardMessage: (id: string, destination: ForwardMessageRequest) => Promise<DmMessageWithUser>;
    pins: (id: string) => Promise<DmMessageWithUser[]>;
    pinMessage: (id: string) => Promise<MessagePinState>;
    unpinMessage: (id: string) => Promise<MessagePinState>;
    addMember: (dmChannelId: string, data: AddDmMemberRequest) => Promise<DmChannel>;
    leave: (dmChannelId: string) => Promise<{ success: boolean }>;
    /**
     * Owner-only: rename a group DM and/or update its icon, on this client's
     * instance. `channelId` is that instance's copy. The owner's instance is
     * chosen, and the ids translated, by `utils/groupDmOwnerActions.ts`.
     */
    updateMetadata: (channelId: string, body: { name?: string | null; icon?: string | null }) => Promise<DmChannel>;
    /** Owner-only: remove `target` from a group DM, on this client's instance. See `updateMetadata`. */
    kickMember: (channelId: string, target: DmMemberTarget) => Promise<{ success: boolean }>;
    /** Owner-only: make `target` the owner of a group DM, on this client's instance. See `updateMetadata`. */
    transferOwnership: (channelId: string, target: DmMemberTarget) => Promise<DmChannel>;
    spaceInvite: (body: SpaceInviteRequest) => Promise<SpaceInviteResponse>;
  };

  readonly social: {
    friends: () => Promise<Friend[]>;
    requests: () => Promise<FriendRequest[]>;
    sendRequest: (body: SendFriendRequest) => Promise<{ success: boolean; requestId?: string }>;
    updateRequest: (id: string, status: 'accepted' | 'declined') => Promise<{ success: boolean }>;
    removeFriend: (id: string) => Promise<{ success: boolean }>;
    cancelRequest: (id: string) => Promise<{ success: boolean }>;
    /** People of this instance by username (social.md, "Finding people"): exact first, then by prefix. */
    search: (q: string) => Promise<UserSearchResult[]>;
  };

  /**
   * A space owner's side of the platform's reviews (admin.md, "Verification"
   * and "Discovery approval"): asking for verification or a listing, taking a
   * request back, reading where both stand. Called on the instance that hosts
   * the space.
   */
  readonly review: {
    get: (spaceId: string) => Promise<SpaceReviewState>;
    requestVerification: (spaceId: string, body: VerificationRequestBody) => Promise<SpaceReviewState>;
    withdrawVerification: (spaceId: string) => Promise<SpaceReviewState>;
    requestDiscovery: (spaceId: string, body: DiscoveryRequestBody) => Promise<SpaceReviewState>;
    withdrawDiscovery: (spaceId: string) => Promise<SpaceReviewState>;
  };

  /** The instance's legal basics (docs/systems/legal.md). The reads and the report are open to anyone. */
  readonly legal: {
    info: () => Promise<LegalInfoResponse>;
    document: (kind: LegalDocumentKind, language: string, upcoming?: boolean) => Promise<LegalDocumentResponse>;
    acceptTerms: (version: number) => Promise<{ termsVersion: number }>;
    report: (body: CreateReportBody) => Promise<CreateReportResponse>;
    notices: () => Promise<UserNoticeListResponse>;
    readNotice: (id: string) => Promise<{ success: boolean }>;
  };

  readonly livekit: {
    token: (channelId: string) => Promise<LiveKitTokenResponse>;
    dmToken: (dmChannelId: string) => Promise<LiveKitTokenResponse>;
  };

  readonly settings: {
    getStreaming: () => Promise<InstanceStreamingLimits>;
    updateStreaming: (data: Partial<InstanceStreamingLimits>) => Promise<InstanceStreamingLimits>;
    getInstance: () => Promise<InstanceAdminSettings>;
    updateInstance: (data: Partial<InstanceAdminSettings>) => Promise<InstanceAdminSettings>;
  };

  readonly instance: {
    info: () => Promise<InstanceInfoResponse>;
    /** What the operator says to everyone signed in, while it runs. */
    announcements: () => Promise<AnnouncementsResponse>;
  };

  readonly inbox: {
    /** Messages on this instance that mention the signed-in user, newest first (stores/inboxStore.ts). */
    mentions: (params?: { before?: string; limit?: number }) => Promise<MentionsResponse>;
  };

  readonly desktop: {
    release: () => Promise<DesktopReleaseResponse>;
  };

  readonly roles: {
    create: (spaceId: string, data: RoleWriteRequest) => Promise<Role>;
    update: (spaceId: string, roleId: string, data: RoleUpdateBody) => Promise<Role>;
    delete: (spaceId: string, roleId: string) => Promise<{ success: boolean }>;
  };

  readonly search: {
    channel: (channelId: string, params: { q?: string; from?: string; has?: string; before?: string; after?: string; offset?: number; limit?: number }) => Promise<{ results: MessageWithUser[]; totalCount: number }>;
    dm: (dmChannelId: string, params: { q?: string; from?: string; has?: string; before?: string; after?: string; offset?: number; limit?: number }) => Promise<{ results: DmMessageWithUser[]; totalCount: number }>;
  };

  readonly explore: {
    list: (q?: string, limit?: number, offset?: number) => Promise<{ spaces: ExploreSpace[]; total: number; totalAll: number; discoveryEnabled: boolean }>;
    publicJoin: (spaceId: string) => Promise<SpaceWithChannelsAndMembers>;
    requestJoin: (spaceId: string, message?: string) => Promise<JoinRequest>;
    getJoinRequests: (spaceId: string, status?: string) => Promise<{ requests: JoinRequest[] }>;
    decideJoinRequest: (spaceId: string, requestId: string, action: 'accept' | 'decline') => Promise<JoinRequest>;
    myJoinRequests: (status?: string) => Promise<{ requests: JoinRequest[] }>;
    /** What a click on a worn space tag shows (docs/systems/space-tags.md). */
    spaceTag: (spaceId: string) => Promise<SpaceTagCardResponse>;
  };

  /** The asker's own overlay link of a voice channel (docs/systems/voice-overlay.md). */
  readonly voiceOverlay: {
    get: (channelId: string) => Promise<VoiceOverlayLinkResponse>;
    create: (channelId: string) => Promise<CreateVoiceOverlayResponse>;
    remove: (channelId: string) => Promise<void>;
  };

  /** The public space directory, read through this instance's proxy (never the hub directly). */
  readonly directory: {
    list: (q?: string, limit?: number, offset?: number) => Promise<DirectoryFeed>;
  };

  readonly gif: {
    trending: (limit?: number, pos?: string) => Promise<{ results: GifResult[]; next: string }>;
    search: (q: string, limit?: number, pos?: string) => Promise<{ results: GifResult[]; next: string }>;
    enabled: () => Promise<{ enabled: boolean }>;
  };

  readonly federation: {
    initiatePeering: (data: { remoteOrigin: string }) => Promise<{ peer: FederationPeer; verified?: boolean }>;
    ensurePeered: (data: PeerEnsureRequest) => Promise<{ peeringStatus: string; peerId?: string; error?: string }>;
    peers: () => Promise<{ peers: FederationPeer[] }>;
    resetEvents: () => Promise<FederationResetEventsResponse>;
    acknowledgeResetEvent: (origin: string) => Promise<{ success: boolean }>;
    revokePeer: (id: string) => Promise<{ success: boolean }>;
    resetPeer: (id: string) => Promise<{ success: boolean }>;
    recheckPeer: (id: string) => Promise<{ recovered: boolean; status: string }>;
    rotatePeerSecret: (id: string) => Promise<{ success: boolean; gracePeriodMs: number }>;
    updatePeer: (id: string, data: { autoRotateIntervalDays: number }) => Promise<{ peer: FederationPeer }>;
    deletePeerPermanently: (id: string) => Promise<{ success: boolean }>;
    approvalRequests: () => Promise<{ requests: ApprovalRequest[] }>;
    approveRequest: (id: string) => Promise<{ success: boolean; peer?: FederationPeer }>;
    denyRequest: (id: string) => Promise<{ success: boolean }>;
    peeringSubscriptions: () => Promise<{ subscriptions: PeeringSubscription[] }>;
    cancelPeeringSubscription: (id: string) => Promise<{ success: boolean }>;
    peeringNotifications: (unreadOnly?: boolean) => Promise<{ notifications: PeeringNotification[] }>;
    markPeeringNotificationRead: (id: string) => Promise<{ success: boolean }>;
    markAllPeeringNotificationsRead: () => Promise<{ success: boolean; count: number }>;
  };

  readonly invites: {
    list: (status?: 'active' | 'archived') => Promise<{ invites: InviteLinkSummary[] }>;
    create: (body: CreateInviteRequest) => Promise<InviteLinkSummary>;
    update: (id: string, body: UpdateInviteRequest) => Promise<InviteLinkSummary>;
    revoke: (id: string) => Promise<{ invite: InviteLinkSummary }>;
    reinstate: (id: string, body: ReinstateInviteRequest) => Promise<ReinstateInviteResponse>;
    delete: (id: string) => Promise<{ success: boolean }>;
    redemptions: (id: string) => Promise<{ redemptions: InviteRedemption[] }>;
  };

  readonly admin: {
    emailStatus: () => Promise<AdminEmailStatus>;
    sendTestEmail: (to: string) => Promise<{ queued: boolean }>;
    legal: () => Promise<AdminLegalResponse>;
    saveLegalOperator: (operator: LegalOperator) => Promise<LegalOperator>;
    legalDocument: (id: string) => Promise<AdminLegalDocument>;
    legalTemplate: (kind: LegalDocumentKind, language: LegalTextLanguage) => Promise<{ text: string }>;
    publishLegalDocument: (body: PublishLegalDocumentBody) => Promise<{ id: string; version: number }>;
    reports: (status: 'open' | 'closed') => Promise<AdminReportListResponse>;
    decideReport: (id: string, body: DecideReportBody) => Promise<AdminReport>;
    storageStats: () => Promise<StorageStats>;
    storageOrphans: () => Promise<{ orphans: OrphanedFile[] }>;
    storageCleanup: (dryRun?: boolean) => Promise<CleanupResult>;
    cleanupOldMedia: (maxAgeDays: number, dryRun?: boolean) => Promise<CleanupResult>;
    cleanupTusSessions: (maxAgeHours: number, dryRun?: boolean) => Promise<CleanupResult>;
    listUsers: (params?: { q?: string; page?: number; pageSize?: number; showDeleted?: boolean; homeInstance?: string; role?: string; status?: 'suspended'; joinedAfter?: string; joinedBefore?: string; sort?: string }) => Promise<AdminUserListResponse>;
    listInstances: () => Promise<{ instances: string[] }>;
    setUserRole: (userId: string, isAdmin: boolean) => Promise<AdminUser>;
    resetUserPassword: (userId: string) => Promise<AdminResetPasswordResponse>;
    /** An account of this instance asks for the reason and the acting admin's password and second factor. */
    /** `deleteSpaces` takes the spaces the account owns with it; without it an owner is refused with `user_owns_spaces` and the list. */
    deleteUser: (userId: string, body?: { reason?: string; password?: string; twoFactorCode?: string; deleteSpaces?: boolean }) => Promise<{ success: boolean }>;
    // The console's own (admin.md, "The console").
    dashboard: () => Promise<AdminDashboard>;
    system: () => Promise<AdminSystemInfo>;
    createBackup: () => Promise<{ name: string }>;
    announcements: () => Promise<AnnouncementsResponse>;
    createAnnouncement: (body: { body: string; tone: AnnouncementTone; durationHours: number | null; onStatusPage: boolean }) => Promise<Announcement>;
    endAnnouncement: (id: string) => Promise<Announcement>;
    search: (query: string) => Promise<AdminSearchResponse>;
    bots: () => Promise<{ enabled: boolean; bots: AdminBotInfo[] }>;
    setBotsEnabled: (enabled: boolean) => Promise<{ enabled: boolean }>;
    deleteBot: (id: string) => Promise<{ success: boolean }>;
    exportUsers: () => Promise<Blob>;
    exportAudit: () => Promise<Blob>;
    userSessions: (userId: string) => Promise<{ sessions: SessionInfo[] }>;
    endUserSession: (userId: string, sessionId: string) => Promise<{ sessions: SessionInfo[] }>;
    endUserSessions: (userId: string) => Promise<{ sessions: SessionInfo[] }>;
    userSecurity: (userId: string) => Promise<{ events: SecurityEventInfo[] }>;
    userNotes: (userId: string) => Promise<AdminNotesResponse>;
    addUserNote: (userId: string, body: string) => Promise<AdminNotesResponse>;
    deleteUserNote: (userId: string, noteId: string) => Promise<AdminNotesResponse>;
    warnUser: (userId: string, body: { note: string; ground: 'terms' | 'illegal' }) => Promise<{ success: boolean }>;
    /** Removing content directly (docs/systems/admin.md, "Removing content"): each with its reason and ground. */
    removeMessage: (messageId: string, body: RemovalRequest) => Promise<{ success: boolean }>;
    removeProfileContent: (userId: string, body: RemoveProfileContentRequest) => Promise<{ success: boolean }>;
    removeSpaceContent: (spaceId: string, body: RemoveSpaceContentRequest) => Promise<{ success: boolean }>;
    removeSpaceExpression: (spaceId: string, body: RemoveSpaceExpressionRequest) => Promise<{ success: boolean }>;
    deleteSpace: (spaceId: string, body: RemovalRequest) => Promise<{ success: boolean }>;
    spaceExpressions: (spaceId: string) => Promise<AdminSpaceExpressions>;
    signupRules: () => Promise<SignupRulesResponse>;
    setSignupChallenge: (level: SignupChallengeLevel) => Promise<SignupRulesResponse>;
    addSignupRule: (body: { kind: SignupRuleKind; value?: string; usual?: boolean }) => Promise<SignupRulesResponse>;
    removeSignupRule: (kind: SignupRuleKind, value: string) => Promise<SignupRulesResponse>;
    starterSpaces: () => Promise<StarterSpacesResponse>;
    setStarterSpaces: (spaceIds: string[]) => Promise<StarterSpacesResponse>;
    // Platform administration (admin.md, "Platform administration").
    overview: () => Promise<PlatformOverview>;
    userDetail: (userId: string) => Promise<AdminUserDetail>;
    setStorageLimit: (userId: string, limitGb: number | null) => Promise<{ success: boolean }>;
    suspendUser: (userId: string, body: SuspendUserBody) => Promise<AdminUser>;
    unsuspendUser: (userId: string, body?: UnsuspendUserBody) => Promise<AdminUser>;
    setUserBadges: (userId: string, body: BadgeGrantBody) => Promise<AdminUser>;
    listSpaces: (params?: { q?: string; filter?: AdminSpaceFilter; visibility?: 'public'; page?: number; pageSize?: number }) => Promise<AdminSpaceListResponse>;
    spaceDetail: (spaceId: string) => Promise<AdminSpaceDetail>;
    setSpaceBadges: (spaceId: string, body: BadgeGrantBody) => Promise<AdminSpaceSummary>;
    revokeSpaceVanity: (spaceId: string, reason: string) => Promise<{ vanityCode: null }>;
    reviews: () => Promise<ReviewQueueResponse>;
    decideVerification: (spaceId: string, decision: VerificationDecision, body: ReviewDecisionBody) => Promise<SpaceReviewState>;
    decideDiscovery: (spaceId: string, decision: DiscoveryDecision, body: ReviewDecisionBody) => Promise<SpaceReviewState>;
    audit: (params?: { before?: string; limit?: number; targetType?: PlatformAuditTargetType; targetId?: string; action?: PlatformAuditAction }) => Promise<PlatformAuditResponse>;
  };

  /** The instance's custom emoji library. */
  readonly emojis: {
    list: () => Promise<{ emojis: CustomEmoji[] }>;
    /** Add one; `image` is the picture file, base64. */
    create: (data: { name: string; image: string }) => Promise<CustomEmoji>;
    rename: (id: string, name: string) => Promise<CustomEmoji>;
    remove: (id: string) => Promise<{ success: boolean }>;
  };

  stickers: {
    list: () => Promise<PersonalSticker[]>;
    upload: (data: { name: string; image: string }) => Promise<PersonalSticker>;
    collect: (data: { id: string; token: string; name: string }) => Promise<PersonalSticker>;
    rename: (id: string, name: string) => Promise<PersonalSticker>;
    remove: (id: string) => Promise<{ success: boolean }>;
  };

  /** Decorations people make, and the community's gallery of them (docs/systems/decorations.md). */
  decorations: {
    gallery: (query: { kind: CustomDecorationKind; sort: CustomDecorationSort; q?: string; offset?: number }) => Promise<CustomDecorationPage>;
    mine: () => Promise<{ items: CustomDecoration[]; max: number }>;
    create: (data: CreateCustomDecorationRequest) => Promise<CustomDecoration>;
    update: (id: string, data: UpdateCustomDecorationRequest) => Promise<CustomDecoration>;
    remove: (id: string) => Promise<{ success: boolean }>;
    /** An administrator takes someone's design away, with the reason told to its maker. */
    adminRemove: (id: string, data: { reason: string; ground: ReportGround }) => Promise<{ success: boolean }>;
  };

  constructor(baseUrl: string, getToken: () => string | null, onUnauthorized?: () => void) {
    /** Send a request and return the successful response; a failure throws. */
    async function send(
      method: string,
      path: string,
      body?: unknown,
      requireAuth = true,
    ): Promise<Response> {
      const headers: Record<string, string> = {};

      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      if (requireAuth) {
        const token = getToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new RequestTimeoutError();
        }
        throw err;
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401 && requireAuth && onUnauthorized) {
          onUnauthorized();
        }
        if (response.status === 429) {
          const body: unknown = await response.json().catch(() => ({}));
          const retryAfter = (body as { retryAfter?: number }).retryAfter
            ?? (parseInt(response.headers.get('retry-after') || '', 10) || 60);
          throw new RateLimitError(retryAfter, body);
        }
        throw HttpError.fromBody(response.status, await response.json().catch(() => null));
      }

      return response;
    }

    async function request<T>(
      method: string,
      path: string,
      body?: unknown,
      requireAuth = true,
    ): Promise<T> {
      const response = await send(method, path, body, requireAuth);
      return response.json() as Promise<T>;
    }

    /**
     * The page after `after` in a channel's or DM's history. `forward` says
     * whether the server honoured the cursor; a server that predates forward
     * paging answers with the newest page instead (docs/systems/api.md,
     * "Message history paging").
     */
    async function historyAfter<T>(path: string, after: string, limit: number): Promise<HistoryPageAfter<T>> {
      const params = new URLSearchParams();
      params.set('after', after);
      params.set('limit', String(limit));
      const response = await send('GET', `${path}?${params}`);
      const forward = response.headers.get(MESSAGE_PAGING_HEADER) === MESSAGE_PAGING_AFTER;
      const messages = await response.json() as T[];
      return { messages, forward };
    }
    this.stickers = {
      list: () => request('GET', '/stickers'),
      upload: (data) => request('POST', '/stickers', data),
      collect: ({ id, token, name }) => request('POST', `/stickers/${encodeURIComponent(id)}/collect`, { token, name }),
      rename: (id, name) => request('PATCH', `/stickers/${encodeURIComponent(id)}`, { name }),
      remove: (id) => request('DELETE', `/stickers/${encodeURIComponent(id)}`),
    };

    this.decorations = {
      gallery: ({ kind, sort, q, offset }) => {
        const params = new URLSearchParams({ kind, sort });
        if (q) params.set('q', q);
        if (offset) params.set('offset', String(offset));
        return request('GET', `/decorations?${params.toString()}`);
      },
      mine: () => request('GET', '/decorations/mine'),
      create: (data) => request('POST', '/decorations', data),
      update: (id, data) => request('PATCH', `/decorations/${encodeURIComponent(id)}`, data),
      remove: (id) => request('DELETE', `/decorations/${encodeURIComponent(id)}`),
      adminRemove: (id, data) => request('POST', `/admin/decorations/${encodeURIComponent(id)}/remove`, data),
    };

    this.bots = {
      list: () => request<BotsResponse>('GET', '/bots'),
      create: (name) => request<BotWithToken>('POST', '/bots', { name }),
      detail: (id) => request<BotDetail>('GET', `/bots/${id}`),
      update: (id, body) => request<BotInfo>('PATCH', `/bots/${id}`, body),
      rotate: (id) => request<BotWithToken>('POST', `/bots/${id}/token`),
      remove: (id) => request<{ success: boolean }>('DELETE', `/bots/${id}`),
      publicInfo: (id) => request<BotPublicInfo>('GET', `/bots/${id}/public`),
      addToSpace: (id, spaceId, permissions) => request<{ success: boolean }>('POST', `/bots/${id}/spaces/${spaceId}`, { permissions }),
    };

    this.commands = {
      list: (channelId) => request<{ commands: ChannelCommand[] }>('GET', `/channels/${channelId}/commands`),
      invoke: (channelId, botId, name, args, options) => request<{ success: boolean }>('POST', `/channels/${channelId}/commands/${botId}/${name}`, { args, ...(options ? { options } : {}) }),
    };

    this.sounds = {
      list: (spaceId) => request<{ sounds: SpaceSound[] }>('GET', `/spaces/${spaceId}/sounds`),
      add: (spaceId, body) => request<SpaceSound>('POST', `/spaces/${spaceId}/sounds`, body),
      rename: (id, name) => request<SpaceSound>('PATCH', `/sounds/${id}`, { name }),
      remove: (id) => request<{ success: boolean }>('DELETE', `/sounds/${id}`),
      audio: async (id) => (await send('GET', `/sounds/${id}/audio`)).blob(),
      play: (channelId, soundId) => request<{ success: boolean }>('POST', `/channels/${channelId}/soundboard/${soundId}/play`),
    };

    this.watch = {
      get: (channelId) => request<WatchStateResponse>('GET', `/channels/${channelId}/watch`),
      add: (channelId, url) => request<WatchStateResponse>('POST', `/channels/${channelId}/watch`, { url }),
      change: (channelId, action) => request<WatchStateResponse>('POST', `/channels/${channelId}/watch/state`, action),
      end: (channelId) => request<WatchStateResponse>('DELETE', `/channels/${channelId}/watch`),
      react: (channelId, reaction) => request<{ success: boolean }>('POST', `/channels/${channelId}/watch/react`, { reaction }),
    };

    const savedPath = (kind: SavedKind, messageId: string) => `/saved/${kind === 'channel' ? 'messages' : 'dm-messages'}/${messageId}`;
    this.saved = {
      list: (before) => request<SavedListResponse>('GET', `/saved${before ? `?before=${before}` : ''}`),
      ids: () => request<{ messageIds: string[] }>('GET', '/saved/ids'),
      save: (kind, messageId, remindAt) => request<SavedItem>('PUT', savedPath(kind, messageId), remindAt === undefined ? {} : { remindAt }),
      remove: (kind, messageId) => request<{ success: boolean }>('DELETE', savedPath(kind, messageId)),
    };

    this.keywords = {
      get: () => request<{ keywords: string[] }>('GET', '/users/@me/keywords'),
      set: (keywords) => request<{ keywords: string[] }>('PUT', '/users/@me/keywords', { keywords }),
      matches: (before) => request<MentionsResponse>('GET', `/users/@me/keyword-matches${before ? `?before=${before}` : ''}`),
    };

    this.forums = {
      posts: (channelId, query) => {
        const params = new URLSearchParams();
        if (query.tag) params.set('tag', query.tag);
        if (query.before) params.set('before', query.before);
        const suffix = params.toString();
        return request<ForumPostsResponse>('GET', `/channels/${channelId}/posts${suffix ? `?${suffix}` : ''}`);
      },
      createPost: (channelId, body) => request<ForumPost>('POST', `/channels/${channelId}/posts`, body),
      tags: (channelId) => request<{ tags: ForumTag[] }>('GET', `/channels/${channelId}/forum-tags`),
      setTags: (channelId, tags) => request<{ tags: ForumTag[] }>('PUT', `/channels/${channelId}/forum-tags`, { tags }),
      setPostTags: (threadId, tagIds) => request<{ tagIds: string[] }>('PUT', `/threads/${threadId}/tags`, { tagIds }),
    };

    this.channelFollows = {
      list: (channelId) => request<ChannelFollowsResponse>('GET', `/channels/${channelId}/follows`),
      targets: (channelId) => request<{ spaces: FollowTargetSpace[] }>('GET', `/channels/${channelId}/follow-targets`),
      create: (channelId, targetChannelId) => request<ChannelFollowInfo>('POST', `/channels/${channelId}/follows`, { targetChannelId }),
      remove: (id) => request<{ success: boolean }>('DELETE', `/channel-follows/${id}`),
    };

    this.webhooks = {
      list: (channelId) => request<{ webhooks: WebhookInfo[] }>('GET', `/channels/${channelId}/webhooks`),
      create: (channelId, name) => request<WebhookWithToken>('POST', `/channels/${channelId}/webhooks`, { name }),
      rename: (id, name) => request<WebhookInfo>('PATCH', `/webhooks/${id}`, { name }),
      rotate: (id) => request<WebhookWithToken>('POST', `/webhooks/${id}/rotate`),
      remove: (id) => request<{ success: boolean }>('DELETE', `/webhooks/${id}`),
    };

    this.events = {
      list: (spaceId) => request<{ events: SpaceEvent[] }>('GET', `/spaces/${spaceId}/events`),
      create: (spaceId, body) => request<SpaceEvent>('POST', `/spaces/${spaceId}/events`, body),
      update: (id, body) => request<SpaceEvent>('PATCH', `/events/${id}`, body),
      remove: (id) => request<{ success: boolean }>('DELETE', `/events/${id}`),
      rsvp: (id) => request<SpaceEvent>('PUT', `/events/${id}/rsvp`),
      unrsvp: (id) => request<SpaceEvent>('DELETE', `/events/${id}/rsvp`),
      attendees: (id) => request<{ attendees: User[] }>('GET', `/events/${id}/attendees`),
    };

    this.welcome = {
      get: (spaceId) => request<SpaceWelcome>('GET', `/spaces/${spaceId}/welcome`),
      update: (spaceId, body) => request<SpaceWelcome>('PUT', `/spaces/${spaceId}/welcome`, body),
      accept: (spaceId) => request<SpaceWelcome>('POST', `/spaces/${spaceId}/rules/accept`),
    };

    this.threads = {
      start: (messageId, name) => request<ThreadInfo>('POST', `/messages/${messageId}/thread`, name ? { name } : {}),
      list: (channelId, archived) => request<{ threads: ThreadInfo[] }>('GET', `/channels/${channelId}/threads${archived ? '?archived=1' : ''}`),
      open: (id) => request<ThreadOpened>('GET', `/threads/${id}`),
      follow: (id) => request<ThreadInfo>('PUT', `/threads/${id}/follow`),
      unfollow: (id) => request<ThreadInfo>('DELETE', `/threads/${id}/follow`),
      rename: (id, name) => request<ThreadInfo>('PATCH', `/threads/${id}`, { name }),
      remove: (id) => request<{ success: boolean }>('DELETE', `/threads/${id}`),
    };

    this.push = {
      key: () => request<PushKeyResponse>('GET', '/push/key'),
      subscribe: (data) => request<{ success: boolean }>('POST', '/push/subscriptions', data),
      unsubscribe: (endpoint) => request<{ success: boolean }>('DELETE', '/push/subscriptions', { endpoint }),
    };

    this.auth = {
      // Every way to an account comes through here, on whichever instance the client is for.
      register: async (data: RegisterRequest) => {
        const challenge = await solveSignupChallenge(() => request<SignupChallengeResponse>('GET', '/auth/challenge', undefined, false));
        return request<AuthResponse>('POST', '/auth/register', challenge ? { ...data, challenge } : data, false);
      },
      login: (data: LoginRequest) =>
        request<AuthResponse>('POST', '/auth/login', data, false),
      checkUsername: (username: string) =>
        request<CheckUsernameResponse>('GET', `/auth/check-username?username=${encodeURIComponent(username)}`, undefined, false),
      checkInvite: (token: string) =>
        request<CheckInviteResponse>('GET', `/auth/check-invite?token=${encodeURIComponent(token)}`, undefined, false),
      attachProof: (targetDomain: string) =>
        request<AttachProofResponse>('POST', '/auth/attach-proof', { targetDomain }),
      logout: () => request<{ success: boolean }>('POST', '/auth/logout'),
      sessions: () => request<SessionsResponse>('GET', '/auth/sessions'),
      endSession: (id: string) => request<SessionsResponse>('DELETE', `/auth/sessions/${encodeURIComponent(id)}`),
      endOtherSessions: () => request<SessionsResponse>('POST', '/auth/sessions/end-others'),
      forgotPassword: (email: string, locale: string) => request<{ success: boolean }>('POST', '/auth/password/forgot', { email, locale }, false),
      resetPassword: (token: string, password: string) => request<{ success: boolean }>('POST', '/auth/password/reset', { token, password }, false),
      verifyEmail: (token: string) => request<{ success: boolean; address: string }>('POST', '/auth/email/verify', { token }, false),
      loginSecondFactor: (data: LoginSecondFactorRequest) => request<AuthResponse>('POST', '/auth/login/2fa', data, false),
      security: () => request<SecurityOverview>('GET', '/auth/security'),
      twoFactorSetup: (password: string) => request<TwoFactorSetupResponse>('POST', '/auth/2fa/setup', { password }),
      twoFactorEnable: (code: string) => request<{ recoveryCodes: string[] }>('POST', '/auth/2fa/enable', { code }),
      twoFactorDisable: (password: string, code: string) => request<{ success: boolean }>('POST', '/auth/2fa/disable', { password, code }),
      twoFactorRecoveryCodes: (password: string, code: string) => request<{ recoveryCodes: string[] }>('POST', '/auth/2fa/recovery-codes', { password, code }),
      endAllSessions: () => request<{ success: boolean }>('POST', '/auth/sessions/end-all'),
    };

    this.users = {
      me: () => request<User>('GET', '/users/@me'),
      update: (data: UpdateUserRequest) => request<User>('PATCH', '/users/@me', data),
      get: (id: string) => request<User>('GET', `/users/${id}`),
      verifyPassword: (password: string) =>
        request<VerifyPasswordResponse>('POST', '/users/@me/verify-password', { password }),
      storage: () => request<StorageUsage>('GET', '/users/@me/storage'),
      dataExportStatus: () => request<DataExportStatus>('GET', '/users/@me/data-export'),
      linkedAccounts: () => request<LinkedAccountsResponse>('GET', '/users/@me/linked-accounts'),
      startLinkedAccount: (provider: LinkedAccountProvider) =>
        request<LinkedAccountStartResponse>('POST', `/users/@me/linked-accounts/${provider}/start`),
      completeLinkedAccount: (provider: LinkedAccountProvider, data: LinkedAccountCompleteRequest) =>
        request<LinkedAccountsResponse>('POST', `/users/@me/linked-accounts/${provider}`, data),
      updateLinkedAccount: (provider: LinkedAccountProvider, data: LinkedAccountUpdateRequest) =>
        request<LinkedAccountsResponse>('PATCH', `/users/@me/linked-accounts/${provider}`, data),
      unlinkAccount: (provider: LinkedAccountProvider) =>
        request<LinkedAccountsResponse>('DELETE', `/users/@me/linked-accounts/${provider}`),
      requestDataExport: (password: string, twoFactorCode?: string) => request<DataExportStatus>('POST', '/users/@me/data-export', { password, ...(twoFactorCode ? { twoFactorCode } : {}) }),
      downloadDataExport: async () => (await send('GET', '/users/@me/data-export/download')).blob(),
      email: () => request<AccountEmailStatus>('GET', '/users/@me/email'),
      changeEmail: (data: ChangeEmailRequest) => request<AccountEmailStatus>('PUT', '/users/@me/email', data),
      resendEmail: () => request<AccountEmailStatus>('POST', '/users/@me/email/resend'),
      cancelPendingEmail: () => request<AccountEmailStatus>('DELETE', '/users/@me/email/pending'),
      removeEmail: (password: string, twoFactorCode?: string) => request<AccountEmailStatus>('DELETE', '/users/@me/email', { password, ...(twoFactorCode ? { twoFactorCode } : {}) }),
      setLocale: (locale: string) => request<{ locale: string }>('PUT', '/users/@me/locale', { locale }),
      changeUsername: (data: ChangeUsernameRequest) => request<{ user: User }>('POST', '/users/@me/username', data),
      changePassword: (data: ChangePasswordRequest) =>
        request<ChangePasswordResponse>('POST', '/users/@me/change-password', data),
      federationCredential: (data: FederationCredentialRequest) =>
        request<FederationCredentialResponse>('POST', '/users/@me/federation-credential', data),
      deleteAccount: (data: DeleteAccountRequest) =>
        request<{ success: boolean }>('DELETE', '/users/@me', data),
      getMutuals: (id: string, homeUserId?: string) => {
        const params = new URLSearchParams();
        if (homeUserId) params.set('homeUserId', homeUserId);
        const qs = params.toString();
        return request<{ mutualFriends: User[]; mutualSpaces: { id: string; name: string; icon: string | null; avatarColor: string | null }[] }>(
          'GET', `/users/${id}/mutuals${qs ? `?${qs}` : ''}`
        );
      },
      getFederationRegistry: () =>
        request<{ registry: FederationRegistryEntry[]; updatedAt: number }>(
          'GET', '/users/@me/federation-registry'
        ),
      putFederationRegistry: (data: { registry: FederationRegistryEntry[]; updatedAt: number }) =>
        request<{ ok: boolean; updatedAt: number }>(
          'PUT', '/users/@me/federation-registry', data
        ),
      deleteFederationIdentity: (data: FederationIdentityDeleteRequest) =>
        request<FederationIdentityDeleteResponse>(
          'POST', '/users/@me/federation-identity/delete', data
        ),
      reattach: (data: ReattachRequest) =>
        request<ReattachResponse>('POST', '/users/@me/reattach', data),
      listBlocks: () => request<{ blocks: BlockedUser[] }>('GET', '/users/@me/blocks'),
      block: (userId: string) =>
        request<BlockedUser>('PUT', `/users/@me/blocks/${encodeURIComponent(userId)}`),
      unblock: (userId: string) =>
        request<{ success: boolean }>('DELETE', `/users/@me/blocks/${encodeURIComponent(userId)}`),
      profileImage: (data: ProfileImageRequest) =>
        request<ProfileImageResponse>('POST', '/users/@me/profile-image', data),
    };

    this.spaceLayout = {
      update: (data) =>
        request<{ items: SpaceLayoutItem[]; folders: SpaceFolder[]; updatedAt?: number }>('PUT', '/users/@me/space-layout', data),
    };

    this.notificationSettings = {
      list: () => request<NotificationSettingsResponse>('GET', '/users/@me/notification-settings'),
      updateSpace: (spaceId, data) =>
        request<NotificationSetting>('PATCH', `/spaces/${encodeURIComponent(spaceId)}/notification-settings`, data),
      updateChannel: (channelId, data) =>
        request<NotificationSetting>('PATCH', `/channels/${encodeURIComponent(channelId)}/notification-settings`, data),
    };

    this.spaces = {
      list: () => request<Space[]>('GET', '/spaces'),
      get: (id: string) => request<SpaceWithChannelsAndMembers>('GET', `/spaces/${id}`),
      create: (data: CreateSpaceRequest) => request<Space>('POST', '/spaces', data),
      update: (id: string, data: SpaceUpdateBody) => request<Space>('PATCH', `/spaces/${id}`, data),
      delete: (id: string) => request<{ success: boolean }>('DELETE', `/spaces/${id}`),
      invite: (id: string) => request<{ inviteCode: string }>('POST', `/spaces/${id}/invite`),
      join: (id: string, data: JoinSpaceRequest) => request<Space>('POST', `/spaces/${id}/join`, data),
      joinByCode: (inviteCode: string) => request<Space>('POST', '/spaces/join', { inviteCode }),
      members: (id: string) => request<MemberWithUser[]>('GET', `/spaces/${id}/members`),
      updateMember: (spaceId: string, userId: string, data: UpdateMemberRequest) =>
        request<MemberWithUser>('PATCH', `/spaces/${spaceId}/members/${userId}`, data),
      removeMember: (spaceId: string, userId: string, reason?: string) =>
        request<{ success: boolean }>('DELETE', `/spaces/${spaceId}/members/${userId}`, reason ? { reason } : undefined),
      getBans: (spaceId: string) =>
        request<any[]>('GET', `/spaces/${spaceId}/bans`),
      ban: (spaceId: string, userId: string, reason?: string, deleteMessagesSeconds?: number) =>
        request<{ success: boolean }>('POST', `/spaces/${spaceId}/bans`, { userId, reason, deleteMessagesSeconds }),
      setVanity: (spaceId: string, code: string | null) =>
        request<{ vanityCode: string | null }>('PUT', `/spaces/${spaceId}/vanity`, { code }),
      listInvites: (spaceId: string) =>
        request<{ invites: SpaceInviteLink[] }>('GET', `/spaces/${spaceId}/invites`),
      createInvite: (spaceId: string, data: CreateSpaceInviteRequest) =>
        request<{ invites: SpaceInviteLink[] }>('POST', `/spaces/${spaceId}/invites`, data),
      revokeInvite: (spaceId: string, code: string) =>
        request<{ invites: SpaceInviteLink[] }>('DELETE', `/spaces/${spaceId}/invites/${encodeURIComponent(code)}`),
      unban: (spaceId: string, userId: string) =>
        request<{ success: boolean }>('DELETE', `/spaces/${spaceId}/bans/${userId}`),
      transferOwnership: (spaceId: string, newOwnerId: string) =>
        request<Space>('PATCH', `/spaces/${spaceId}/transfer-ownership`, { newOwnerId }),
      invitePreview: (code: string) =>
        request<InvitePreview>('GET', `/spaces/invite/${encodeURIComponent(code)}/preview`, undefined, false),
      updateMyProfile: (spaceId: string, data: UpdateSpaceProfileRequest) =>
        request<MemberWithUser>('PATCH', `/spaces/${encodeURIComponent(spaceId)}/members/@me/profile`, data),
    };

    this.import = {
      discordPreview: (data) => request<DiscordImportPreview>('POST', '/import/discord/preview', data),
      discordApply: (data) => request<DiscordImportResult>('POST', '/import/discord/apply', data),
      discordExpressionsPreview: (data) => request<DiscordExpressionPreview>('POST', '/import/discord/expressions/preview', data),
      discordExpressionsApply: (data) => request<DiscordExpressionApplyResult>('POST', '/import/discord/expressions/apply', data),
      discordExpressionsCancel: (importId) =>
        request<{ success: boolean }>('DELETE', `/import/discord/expressions/${encodeURIComponent(importId)}`),
    };

    this.spaceExpressions = {
      available: () => request<AvailableExpressionsResponse>('GET', '/emojis/available'),
      emojis: (spaceId) => request<{ emojis: SpaceEmoji[]; max: number }>('GET', `/spaces/${encodeURIComponent(spaceId)}/emojis`),
      addEmoji: (spaceId, body) => request<SpaceEmoji>('POST', `/spaces/${encodeURIComponent(spaceId)}/emojis`, body),
      renameEmoji: (id, name) => request<SpaceEmoji>('PATCH', `/space-emojis/${encodeURIComponent(id)}`, { name }),
      removeEmoji: (id) => request<{ success: boolean }>('DELETE', `/space-emojis/${encodeURIComponent(id)}`),
      stickers: (spaceId) => request<{ stickers: SpaceSticker[]; max: number }>('GET', `/spaces/${encodeURIComponent(spaceId)}/stickers`),
      addSticker: (spaceId, body) => request<SpaceSticker>('POST', `/spaces/${encodeURIComponent(spaceId)}/stickers`, body),
      updateSticker: (id, body) => request<SpaceSticker>('PATCH', `/space-stickers/${encodeURIComponent(id)}`, body),
      removeSticker: (id) => request<{ success: boolean }>('DELETE', `/space-stickers/${encodeURIComponent(id)}`),
    };

    this.moderation = {
      getSettings: (spaceId) =>
        request<SpaceModerationSettings>('GET', `/spaces/${encodeURIComponent(spaceId)}/moderation`),
      updateSettings: (spaceId, data) =>
        request<SpaceModerationSettings>('PATCH', `/spaces/${encodeURIComponent(spaceId)}/moderation`, data),
      timeoutMember: (spaceId, userId, data) =>
        request<MemberResponse>(
          'PUT', `/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}/timeout`, data,
        ),
      removeTimeout: (spaceId, userId) =>
        request<MemberResponse>(
          'DELETE', `/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}/timeout`,
        ),
      auditLog: (spaceId, query = {}) => {
        const params = new URLSearchParams();
        if (query.before) params.set('before', query.before);
        if (query.limit !== undefined) params.set('limit', String(query.limit));
        if (query.action) params.set('action', query.action);
        if (query.actorId) params.set('actorId', query.actorId);
        const qs = params.toString();
        return request<AuditLogResponse>('GET', `/spaces/${encodeURIComponent(spaceId)}/audit-log${qs ? `?${qs}` : ''}`);
      },
    };

    this.channels = {
      list: (spaceId: string) => request<Channel[]>('GET', `/spaces/${spaceId}/channels`),
      create: (spaceId: string, data: CreateChannelRequest) =>
        request<Channel>('POST', `/spaces/${spaceId}/channels`, data),
      update: (id: string, data: ChannelUpdateBody) => request<Channel>('PATCH', `/channels/${id}`, data),
      delete: (id: string) => request<{ success: boolean }>('DELETE', `/channels/${id}`),
      messages: (id: string, before?: string, limit = 50) => {
        const params = new URLSearchParams();
        if (before) params.set('before', before);
        params.set('limit', String(limit));
        return request<MessageWithUser[]>('GET', `/channels/${id}/messages?${params}`);
      },
      messagesAfter: (id: string, after: string, limit = 50) =>
        historyAfter<MessageWithUser>(`/channels/${id}/messages`, after, limit),
      messagesAround: (id: string, messageId: string, limit = 50) => {
        const params = new URLSearchParams();
        params.set('messageId', messageId);
        params.set('limit', String(limit));
        return request<MessageWithUser[]>('GET', `/channels/${id}/messages/around?${params}`);
      },
      pins: (channelId: string) => request<MessageWithUser[]>('GET', `/channels/${channelId}/pins`),
      createPoll: (channelId: string, poll: CreatePollRequest) =>
        request<MessageWithUser>('POST', `/channels/${channelId}/polls`, poll),
      deleteMessages: (channelId: string, messageIds: string[]) =>
        request<{ deleted: number }>('POST', `/channels/${channelId}/messages/bulk-delete`, { messageIds }),
      sendMessage: (channelId: string, data: CreateMessageRequest) =>
        request<MessageWithUser>('POST', `/channels/${channelId}/messages`, data),
      getOverrides: (channelId: string) =>
        request<{ channelId: string; targetType: string; targetId: string; allow: string; deny: string; version?: string }[]>(
          'GET', `/channels/${channelId}/overrides`
        ),
      putOverride: (channelId: string, data: OverrideWriteBody) =>
        request<{ success: boolean; version?: string }>('PUT', `/channels/${channelId}/overrides`, data),
      deleteOverride: (channelId: string, targetType: string, targetId: string, version?: string) =>
        request<{ success: boolean }>('DELETE', `/channels/${channelId}/overrides/${targetType}/${targetId}${versionQuery(version)}`),
      updateLayout: (spaceId: string, data: { channels: Array<{ id: string; position: number; categoryId: string | null }>; categories: Array<{ id: string; position: number }> }) =>
        request<{ success: boolean }>('PATCH', `/spaces/${spaceId}/channel-layout`, data),
    };

    this.categories = {
      create: (spaceId: string, name: string) =>
        request<ChannelCategory>('POST', `/spaces/${spaceId}/categories`, { name }),
      update: (id: string, data: { name?: string; position?: number }) =>
        request<ChannelCategory>('PATCH', `/categories/${id}`, data),
      delete: (id: string) =>
        request<{ success: boolean }>('DELETE', `/categories/${id}`),
      getOverrides: (categoryId: string) =>
        request<{ categoryId: string; targetType: string; targetId: string; allow: string; deny: string; version?: string }[]>(
          'GET', `/categories/${categoryId}/overrides`
        ),
      putOverride: (categoryId: string, data: OverrideWriteBody) =>
        request<{ success: boolean; version?: string }>('PUT', `/categories/${categoryId}/overrides`, data),
      deleteOverride: (categoryId: string, targetType: string, targetId: string, version?: string) =>
        request<{ success: boolean }>('DELETE', `/categories/${categoryId}/overrides/${targetType}/${targetId}${versionQuery(version)}`),
    };

    this.messages = {
      update: (id: string, data: UpdateMessageRequest) => request<MessageWithUser>('PATCH', `/messages/${id}`, data),
      delete: (id: string) => request<{ success: boolean }>('DELETE', `/messages/${id}`),
      votePoll: (id: string, optionIds: string[]) => request<PollInfo>('PUT', `/messages/${id}/poll/votes`, { optionIds }),
      endPoll: (id: string) => request<PollInfo>('POST', `/messages/${id}/poll/end`),
      pollVoters: (id: string, optionId: string) =>
        request<{ voters: User[] }>('GET', `/messages/${id}/poll/voters?optionId=${encodeURIComponent(optionId)}`),
      forward: (id: string, destination: ForwardMessageRequest) =>
        request<MessageWithUser>('POST', `/messages/${id}/forward`, destination),
      translate: (id: string, target: TranslationTarget) =>
        request<TranslateMessageResponse>('POST', `/messages/${id}/translate`, { target }),
      pin: (id: string) => request<MessagePinState>('PUT', `/messages/${id}/pin`),
      unpin: (id: string) => request<MessagePinState>('DELETE', `/messages/${id}/pin`),
    };

    this.uploads = {
      url: (filename: string) => `${baseUrl}/uploads/${filename}`,
    };

    this.dm = {
      list: () => request<DmChannel[]>('GET', '/dm'),
      create: (data: CreateDmRequest) => request<DmChannel>('POST', '/dm', data),
      createGroup: (data: CreateGroupDmRequest) => request<DmChannel>('POST', '/dm/group', data),
      close: (id: string) => request<{ success: boolean }>('DELETE', `/dm/${id}`),
      messages: (id: string, before?: string, limit = 50) => {
        const params = new URLSearchParams();
        if (before) params.set('before', before);
        params.set('limit', String(limit));
        return request<DmMessageWithUser[]>('GET', `/dm/${id}/messages?${params}`);
      },
      messagesAfter: (id: string, after: string, limit = 50) =>
        historyAfter<DmMessageWithUser>(`/dm/${id}/messages`, after, limit),
      messagesAround: (id: string, messageId: string, limit = 50) => {
        const params = new URLSearchParams();
        params.set('messageId', messageId);
        params.set('limit', String(limit));
        return request<DmMessageWithUser[]>('GET', `/dm/${id}/messages/around?${params}`);
      },
      sendMessage: (id: string, data: CreateDmMessageRequest) =>
        request<DmMessageWithUser>('POST', `/dm/${id}/messages`, data),
      updateMessage: (id: string, data: UpdateMessageRequest) =>
        request<DmMessageWithUser>('PATCH', `/dm/messages/${id}`, data),
      forwardMessage: (id: string, destination: ForwardMessageRequest) =>
        request<DmMessageWithUser>('POST', `/dm/messages/${id}/forward`, destination),
      pins: (id: string) => request<DmMessageWithUser[]>('GET', `/dm/${id}/pins`),
      pinMessage: (id: string) => request<MessagePinState>('PUT', `/dm/messages/${id}/pin`),
      unpinMessage: (id: string) => request<MessagePinState>('DELETE', `/dm/messages/${id}/pin`),
      deleteMessage: (id: string) =>
        request<{ success: boolean }>('DELETE', `/dm/messages/${id}`),
      addMember: (dmChannelId: string, data: AddDmMemberRequest) =>
        request<DmChannel>('POST', `/dm/${dmChannelId}/members`, data),
      leave: (dmChannelId: string) =>
        request<{ success: boolean }>('DELETE', `/dm/${dmChannelId}/members`),
      // Owner-only methods: plain requests to this client's instance.
      // `utils/groupDmOwnerActions.ts` picks the owner's instance and names
      // the conversation and the member as that instance's copy does.
      updateMetadata: (channelId, body) =>
        request<DmChannel>('PATCH', `/dm/${channelId}`, body),
      kickMember: (channelId, target) => {
        // A member named by home identity: the URL segment is the home user
        // id and `homeInstance` asks the server to resolve it
        // (`resolveRemoteIdentityForClient`). Otherwise it is the local id.
        if ('homeUserId' in target) {
          const homeId = encodeURIComponent(target.homeUserId);
          const homeInst = encodeURIComponent(target.homeInstance);
          return request<{ success: boolean }>('DELETE', `/dm/${channelId}/members/${homeId}?homeInstance=${homeInst}`);
        }
        return request<{ success: boolean }>('DELETE', `/dm/${channelId}/members/${encodeURIComponent(target.userId)}`);
      },
      transferOwnership: (channelId, target) => {
        const body: TransferOwnershipRequest = 'homeUserId' in target
          ? { homeUserId: target.homeUserId, homeInstance: target.homeInstance }
          : { newOwnerId: target.userId };
        return request<DmChannel>('POST', `/dm/${channelId}/transfer`, body);
      },
      spaceInvite: (body) =>
        request<SpaceInviteResponse>('POST', '/dm/space-invite', body),
    };

    this.social = {
      friends: () => request<Friend[]>('GET', '/social/friends'),
      requests: () => request<FriendRequest[]>('GET', '/social/requests'),
      sendRequest: (body: SendFriendRequest) => request<{ success: boolean; requestId?: string }>('POST', '/social/requests', body),
      updateRequest: (id: string, status: 'accepted' | 'declined') =>
        request<{ success: boolean }>('PATCH', `/social/requests/${id}`, { status }),
      removeFriend: (id: string) => request<{ success: boolean }>('DELETE', `/social/friends/${id}`),
      cancelRequest: (id: string) => request<{ success: boolean }>('DELETE', `/social/requests/${id}`),
      search: (q: string) => request<UserSearchResult[]>('GET', `/social/search?q=${encodeURIComponent(q)}`),
    };

    this.legal = {
      info: () => request<LegalInfoResponse>('GET', '/legal'),
      document: (kind, language, upcoming) => request<LegalDocumentResponse>('GET', `/legal/documents/${kind}?lang=${encodeURIComponent(language)}${upcoming ? '&version=upcoming' : ''}`),
      acceptTerms: (version) => request<{ termsVersion: number }>('POST', '/legal/terms/accept', { version }),
      report: (body) => request<CreateReportResponse>('POST', '/legal/reports', body),
      notices: () => request<UserNoticeListResponse>('GET', '/legal/notices'),
      readNotice: (id) => request<{ success: boolean }>('POST', `/legal/notices/${id}/read`),
    };

    this.review = {
      get: (spaceId) => request<SpaceReviewState>('GET', `/spaces/${spaceId}/review`),
      requestVerification: (spaceId, body) => request<SpaceReviewState>('PUT', `/spaces/${spaceId}/verification`, body),
      withdrawVerification: (spaceId) => request<SpaceReviewState>('DELETE', `/spaces/${spaceId}/verification`),
      requestDiscovery: (spaceId, body) => request<SpaceReviewState>('PUT', `/spaces/${spaceId}/discovery`, body),
      withdrawDiscovery: (spaceId) => request<SpaceReviewState>('DELETE', `/spaces/${spaceId}/discovery`),
    };

    this.livekit = {
      token: (channelId: string) =>
        request<LiveKitTokenResponse>('POST', '/livekit/token', { channelId }),
      dmToken: (dmChannelId: string) =>
        request<LiveKitTokenResponse>('POST', '/livekit/token', { dmChannelId }),
    };

    this.settings = {
      getStreaming: () => request<InstanceStreamingLimits>('GET', '/settings/streaming'),
      updateStreaming: (data: Partial<InstanceStreamingLimits>) =>
        request<InstanceStreamingLimits>('PATCH', '/settings/streaming', data),
      getInstance: () => request<InstanceAdminSettings>('GET', '/settings/instance'),
      updateInstance: (data: Partial<InstanceAdminSettings>) =>
        request<InstanceAdminSettings>('PATCH', '/settings/instance', data),
    };

    this.instance = {
      info: () => request<InstanceInfoResponse>('GET', '/instance/info', undefined, false),
      announcements: () => request<AnnouncementsResponse>('GET', '/announcements'),
    };

    this.inbox = {
      mentions: (params = {}) => {
        const qs = new URLSearchParams();
        if (params.before) qs.set('before', params.before);
        if (params.limit) qs.set('limit', String(params.limit));
        const query = qs.toString();
        return request<MentionsResponse>('GET', `/users/@me/mentions${query ? `?${query}` : ''}`);
      },
    };

    this.desktop = {
      release: () => request<DesktopReleaseResponse>('GET', '/desktop/release', undefined, false),
    };

    this.roles = {
      create: (spaceId: string, data: RoleWriteRequest) =>
        request<Role>('POST', `/spaces/${spaceId}/roles`, data),
      update: (spaceId: string, roleId: string, data: RoleUpdateBody) =>
        request<Role>('PATCH', `/spaces/${spaceId}/roles/${roleId}`, data),
      delete: (spaceId: string, roleId: string) =>
        request<{ success: boolean }>('DELETE', `/spaces/${spaceId}/roles/${roleId}`),
    };

    this.search = {
      channel: (channelId: string, params: { q?: string; from?: string; has?: string; before?: string; after?: string; offset?: number; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params.q) qs.set('q', params.q);
        if (params.from) qs.set('from', params.from);
        if (params.has) qs.set('has', params.has);
        if (params.before) qs.set('before', params.before);
        if (params.after) qs.set('after', params.after);
        if (params.offset !== undefined) qs.set('offset', String(params.offset));
        if (params.limit !== undefined) qs.set('limit', String(params.limit));
        return request<{ results: MessageWithUser[]; totalCount: number }>('GET', `/channels/${channelId}/search?${qs}`);
      },
      dm: (dmChannelId: string, params: { q?: string; from?: string; has?: string; before?: string; after?: string; offset?: number; limit?: number }) => {
        const qs = new URLSearchParams();
        if (params.q) qs.set('q', params.q);
        if (params.from) qs.set('from', params.from);
        if (params.has) qs.set('has', params.has);
        if (params.before) qs.set('before', params.before);
        if (params.after) qs.set('after', params.after);
        if (params.offset !== undefined) qs.set('offset', String(params.offset));
        if (params.limit !== undefined) qs.set('limit', String(params.limit));
        return request<{ results: DmMessageWithUser[]; totalCount: number }>('GET', `/dm/${dmChannelId}/search?${qs}`);
      },
    };

    this.explore = {
      list: (q?: string, limit = 50, offset = 0) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        return request<{ spaces: ExploreSpace[]; total: number; totalAll: number; discoveryEnabled: boolean }>(
          'GET', `/spaces/explore?${params}`
        );
      },
      publicJoin: (spaceId: string) =>
        request<SpaceWithChannelsAndMembers>('POST', `/spaces/${spaceId}/public-join`),
      requestJoin: (spaceId: string, message?: string) =>
        request<JoinRequest>('POST', `/spaces/${spaceId}/request-join`, message ? { message } : {}),
      getJoinRequests: (spaceId: string, status?: string) => {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        return request<{ requests: JoinRequest[] }>('GET', `/spaces/${spaceId}/join-requests?${params}`);
      },
      decideJoinRequest: (spaceId: string, requestId: string, action: 'accept' | 'decline') =>
        request<JoinRequest>('PATCH', `/spaces/${spaceId}/join-requests/${requestId}`, { action }),
      myJoinRequests: (status?: string) => {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        return request<{ requests: JoinRequest[] }>('GET', `/users/@me/join-requests?${params}`);
      },
      spaceTag: (spaceId: string) => request<SpaceTagCardResponse>('GET', `/spaces/${spaceId}/tag`),
    };

    this.voiceOverlay = {
      get: (channelId: string) => request<VoiceOverlayLinkResponse>('GET', `/channels/${channelId}/overlay`),
      create: (channelId: string) => request<CreateVoiceOverlayResponse>('POST', `/channels/${channelId}/overlay`),
      remove: async (channelId: string) => {
        await request<{ success: boolean }>('DELETE', `/channels/${channelId}/overlay`);
      },
    };

    this.directory = {
      list: (q?: string, limit = 50, offset = 0) => {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        return request<DirectoryFeed>('GET', `/directory?${params}`);
      },
    };

    this.gif = {
      trending: (limit = 30, pos?: string) => {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (pos) params.set('pos', pos);
        return request<{ results: GifResult[]; next: string }>('GET', `/gif/trending?${params}`);
      },
      search: (q: string, limit = 30, pos?: string) => {
        const params = new URLSearchParams();
        params.set('q', q);
        params.set('limit', String(limit));
        if (pos) params.set('pos', pos);
        return request<{ results: GifResult[]; next: string }>('GET', `/gif/search?${params}`);
      },
      enabled: () => request<{ enabled: boolean }>('GET', '/gif/enabled'),
    };

    this.federation = {
      initiatePeering: (data: { remoteOrigin: string }) =>
        request<{ peer: FederationPeer; verified?: boolean }>(
          'POST', '/federation/peer/initiate', data
        ),
      ensurePeered: (data: PeerEnsureRequest) =>
        request<{ peeringStatus: string; peerId?: string; error?: string }>(
          'POST', '/federation/peer/ensure', data
        ),
      peers: () =>
        request<{ peers: FederationPeer[] }>(
          'GET', '/federation/peers'
        ),
      resetEvents: () =>
        request<FederationResetEventsResponse>('GET', '/federation/reset-events'),
      acknowledgeResetEvent: (origin: string) =>
        request<{ success: boolean }>('POST', '/federation/reset-events/acknowledge', { origin }),
      revokePeer: (id: string) =>
        request<{ success: boolean }>('DELETE', `/federation/peers/${id}`),
      resetPeer: (id: string) =>
        request<{ success: boolean }>('POST', `/federation/peers/${id}/reset`),
      recheckPeer: (id: string) =>
        request<{ recovered: boolean; status: string }>('POST', `/federation/peers/${id}/recheck`),
      rotatePeerSecret: (id: string) =>
        request<{ success: boolean; gracePeriodMs: number }>('POST', `/federation/peers/${id}/rotate`),
      updatePeer: (id: string, data: { autoRotateIntervalDays: number }) =>
        request<{ peer: FederationPeer }>('PATCH', `/federation/peers/${id}`, data),
      deletePeerPermanently: (id: string) =>
        request<{ success: boolean }>('DELETE', `/federation/peers/${id}/permanent`),
      approvalRequests: () =>
        request<{ requests: ApprovalRequest[] }>(
          'GET', '/federation/approval-requests'
        ),
      approveRequest: (id: string) =>
        request<{ success: boolean; peer?: FederationPeer }>(
          'POST', `/federation/approval-requests/${id}/approve`
        ),
      denyRequest: (id: string) =>
        request<{ success: boolean }>(
          'POST', `/federation/approval-requests/${id}/deny`
        ),
      peeringSubscriptions: () =>
        request<{ subscriptions: PeeringSubscription[] }>(
          'GET', '/federation/peering-subscriptions'
        ),
      cancelPeeringSubscription: (id: string) =>
        request<{ success: boolean }>(
          'DELETE', `/federation/peering-subscriptions/${id}`
        ),
      peeringNotifications: (unreadOnly = false) =>
        request<{ notifications: PeeringNotification[] }>(
          'GET',
          `/federation/peering-notifications${unreadOnly ? '?unread=1' : ''}`,
        ),
      markPeeringNotificationRead: (id: string) =>
        request<{ success: boolean }>(
          'POST', `/federation/peering-notifications/${id}/read`
        ),
      markAllPeeringNotificationsRead: () =>
        request<{ success: boolean; count: number }>(
          'POST', '/federation/peering-notifications/read-all'
        ),
    };

    this.invites = {
      list: (status: 'active' | 'archived' = 'active') =>
        request<{ invites: InviteLinkSummary[] }>('GET', `/admin/invites?status=${status}`),
      create: (body: CreateInviteRequest) =>
        request<InviteLinkSummary>('POST', '/admin/invites', body),
      update: (id: string, body: UpdateInviteRequest) =>
        request<InviteLinkSummary>('PATCH', `/admin/invites/${id}`, body),
      revoke: (id: string) =>
        request<{ invite: InviteLinkSummary }>('POST', `/admin/invites/${id}/revoke`),
      reinstate: (id: string, body: ReinstateInviteRequest) =>
        request<ReinstateInviteResponse>('POST', `/admin/invites/${id}/reinstate`, body),
      delete: (id: string) =>
        request<{ success: boolean }>('DELETE', `/admin/invites/${id}`),
      redemptions: (id: string) =>
        request<{ redemptions: InviteRedemption[] }>('GET', `/admin/invites/${id}/redemptions`),
    };

    this.emojis = {
      list: () => request<{ emojis: CustomEmoji[] }>('GET', '/emojis'),
      create: (data) => request<CustomEmoji>('POST', '/emojis', data),
      rename: (id, name) => request<CustomEmoji>('PATCH', `/emojis/${encodeURIComponent(id)}`, { name }),
      remove: (id) => request<{ success: boolean }>('DELETE', `/emojis/${encodeURIComponent(id)}`),
    };

    this.admin = {
      emailStatus: () => request<AdminEmailStatus>('GET', '/admin/email/status'),
      sendTestEmail: (to: string) => request<{ queued: boolean }>('POST', '/admin/email/test', { to }),
      legal: () => request<AdminLegalResponse>('GET', '/admin/legal'),
      saveLegalOperator: (operator) => request<LegalOperator>('PUT', '/admin/legal/operator', operator),
      legalDocument: (id) => request<AdminLegalDocument>('GET', `/admin/legal/documents/${id}`),
      legalTemplate: (kind, language) => request<{ text: string }>('GET', `/admin/legal/templates/${kind}?lang=${language}`),
      publishLegalDocument: (body) => request<{ id: string; version: number }>('POST', '/admin/legal/documents', body),
      reports: (status) => request<AdminReportListResponse>('GET', `/admin/reports?status=${status}`),
      decideReport: (id, body) => request<AdminReport>('POST', `/admin/reports/${id}/decide`, body),
      storageStats: () => request<StorageStats>('GET', '/admin/storage/stats'),
      storageOrphans: () => request<{ orphans: OrphanedFile[] }>('GET', '/admin/storage/orphans'),
      storageCleanup: (dryRun = false) => request<CleanupResult>('POST', '/admin/storage/cleanup', { dryRun }),
      cleanupOldMedia: (maxAgeDays: number, dryRun = false) =>
        request<CleanupResult>('POST', '/admin/storage/cleanup-media', { maxAgeDays, dryRun }),
      cleanupTusSessions: (maxAgeHours: number, dryRun = false) =>
        request<CleanupResult>('POST', '/admin/storage/cleanup-tus', { maxAgeHours, dryRun }),
      listUsers: (params) => {
        const qs = new URLSearchParams();
        if (params?.q) qs.set('q', params.q);
        if (params?.page !== undefined) qs.set('page', String(params.page));
        if (params?.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
        if (params?.showDeleted) qs.set('showDeleted', 'true');
        if (params?.homeInstance) qs.set('homeInstance', params.homeInstance);
        if (params?.role) qs.set('role', params.role);
        if (params?.status) qs.set('status', params.status);
        if (params?.joinedAfter) qs.set('joinedAfter', params.joinedAfter);
        if (params?.joinedBefore) qs.set('joinedBefore', params.joinedBefore);
        if (params?.sort) qs.set('sort', params.sort);
        return request<AdminUserListResponse>('GET', `/admin/users?${qs}`);
      },
      listInstances: () => request<{ instances: string[] }>('GET', '/admin/users/instances'),
      setUserRole: (userId, isAdmin) =>
        request<AdminUser>('PATCH', `/admin/users/${userId}/role`, { isAdmin }),
      resetUserPassword: (userId) =>
        request<AdminResetPasswordResponse>('POST', `/admin/users/${userId}/reset-password`),
      deleteUser: (userId, body) =>
        request<{ success: boolean }>('DELETE', `/admin/users/${userId}`, body),
      dashboard: () => request<AdminDashboard>('GET', '/admin/dashboard'),
      system: () => request<AdminSystemInfo>('GET', '/admin/system'),
      createBackup: () => request<{ name: string }>('POST', '/admin/system/backup'),
      announcements: () => request<AnnouncementsResponse>('GET', '/admin/announcements'),
      createAnnouncement: (body) => request<Announcement>('POST', '/admin/announcements', body),
      endAnnouncement: (id) => request<Announcement>('POST', `/admin/announcements/${id}/end`),
      search: (query) => request<AdminSearchResponse>('GET', `/admin/search?${new URLSearchParams({ q: query })}`),
      bots: () => request<{ enabled: boolean; bots: AdminBotInfo[] }>('GET', '/admin/bots'),
      setBotsEnabled: (enabled) => request<{ enabled: boolean }>('PUT', '/admin/bots/enabled', { enabled }),
      deleteBot: (id) => request<{ success: boolean }>('DELETE', `/admin/bots/${id}`),
      exportUsers: async () => (await send('GET', '/admin/users.csv')).blob(),
      exportAudit: async () => (await send('GET', '/admin/audit.csv')).blob(),
      userSessions: (userId) => request<{ sessions: SessionInfo[] }>('GET', `/admin/users/${userId}/sessions`),
      endUserSession: (userId, sessionId) => request<{ sessions: SessionInfo[] }>('DELETE', `/admin/users/${userId}/sessions/${sessionId}`),
      endUserSessions: (userId) => request<{ sessions: SessionInfo[] }>('POST', `/admin/users/${userId}/sessions/end-all`),
      userSecurity: (userId) => request<{ events: SecurityEventInfo[] }>('GET', `/admin/users/${userId}/security`),
      userNotes: (userId) => request<AdminNotesResponse>('GET', `/admin/users/${userId}/notes`),
      addUserNote: (userId, body) => request<AdminNotesResponse>('POST', `/admin/users/${userId}/notes`, { body }),
      deleteUserNote: (userId, noteId) => request<AdminNotesResponse>('DELETE', `/admin/users/${userId}/notes/${noteId}`),
      warnUser: (userId, body) => request<{ success: boolean }>('POST', `/admin/users/${userId}/warn`, body),
      removeMessage: (messageId, body) => request<{ success: boolean }>('POST', `/admin/messages/${encodeURIComponent(messageId)}/remove`, body),
      removeProfileContent: (userId, body) => request<{ success: boolean }>('POST', `/admin/users/${encodeURIComponent(userId)}/profile/remove`, body),
      removeSpaceContent: (spaceId, body) => request<{ success: boolean }>('POST', `/admin/spaces/${encodeURIComponent(spaceId)}/content/remove`, body),
      removeSpaceExpression: (spaceId, body) => request<{ success: boolean }>('POST', `/admin/spaces/${encodeURIComponent(spaceId)}/expressions/remove`, body),
      deleteSpace: (spaceId, body) => request<{ success: boolean }>('POST', `/admin/spaces/${encodeURIComponent(spaceId)}/delete`, body),
      spaceExpressions: (spaceId) => request<AdminSpaceExpressions>('GET', `/admin/spaces/${encodeURIComponent(spaceId)}/expressions`),
      signupRules: () => request<SignupRulesResponse>('GET', '/admin/signup-rules'),
      setSignupChallenge: (level) => request<SignupRulesResponse>('PUT', '/admin/signup-rules/challenge', { level }),
      addSignupRule: (body) => request<SignupRulesResponse>('POST', '/admin/signup-rules', body),
      removeSignupRule: (kind, value) => request<SignupRulesResponse>('DELETE', `/admin/signup-rules/${kind}/${encodeURIComponent(value)}`),
      starterSpaces: () => request<StarterSpacesResponse>('GET', '/admin/starter-spaces'),
      setStarterSpaces: (spaceIds) => request<StarterSpacesResponse>('PUT', '/admin/starter-spaces', { spaceIds }),
      overview: () => request<PlatformOverview>('GET', '/admin/overview'),
      userDetail: (userId) => request<AdminUserDetail>('GET', `/admin/users/${userId}`),
      setStorageLimit: (userId, limitGb) => request<{ success: boolean }>('PUT', `/admin/users/${userId}/storage-limit`, { limitGb }),
      suspendUser: (userId, body) => request<AdminUser>('POST', `/admin/users/${userId}/suspend`, body),
      unsuspendUser: (userId, body = {}) => request<AdminUser>('POST', `/admin/users/${userId}/unsuspend`, body),
      setUserBadges: (userId, body) => request<AdminUser>('PUT', `/admin/users/${userId}/badges`, body),
      listSpaces: (params) => {
        const qs = new URLSearchParams();
        if (params?.q) qs.set('q', params.q);
        if (params?.filter) qs.set('filter', params.filter);
        if (params?.visibility) qs.set('visibility', params.visibility);
        if (params?.page !== undefined) qs.set('page', String(params.page));
        if (params?.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
        return request<AdminSpaceListResponse>('GET', `/admin/spaces?${qs}`);
      },
      spaceDetail: (spaceId) => request<AdminSpaceDetail>('GET', `/admin/spaces/${spaceId}`),
      setSpaceBadges: (spaceId, body) => request<AdminSpaceSummary>('PUT', `/admin/spaces/${spaceId}/badges`, body),
      revokeSpaceVanity: (spaceId, reason) => request<{ vanityCode: null }>('POST', `/admin/spaces/${spaceId}/vanity/revoke`, { reason }),
      reviews: () => request<ReviewQueueResponse>('GET', '/admin/reviews'),
      decideVerification: (spaceId, decision, body) =>
        request<SpaceReviewState>('POST', `/admin/spaces/${spaceId}/verification/${decision}`, body),
      decideDiscovery: (spaceId, decision, body) =>
        request<SpaceReviewState>('POST', `/admin/spaces/${spaceId}/discovery/${decision}`, body),
      audit: (params) => {
        const qs = new URLSearchParams();
        if (params?.before) qs.set('before', params.before);
        if (params?.limit !== undefined) qs.set('limit', String(params.limit));
        if (params?.targetType) qs.set('targetType', params.targetType);
        if (params?.targetId) qs.set('targetId', params.targetId);
        if (params?.action) qs.set('action', params.action);
        return request<PlatformAuditResponse>('GET', `/admin/audit?${qs}`);
      },
    };
  }
}

/** The pages someone without a session is meant to be on: losing a session there sends them nowhere. */
const SIGNED_OUT_PAGES = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];

/**
 * Ends the home session: the token goes and the sign-in page opens. Used for
 * a 401 from home and for a socket the instance refused because the account
 * is suspended; the sign-in page says why once the password is given.
 */
export function handleUnauthorized(): void {
  localStorage.removeItem('backspace_token');
  if (!SIGNED_OUT_PAGES.some((page) => window.location.pathname.startsWith(page))) {
    window.location.href = '/login';
  }
}

export const api = new BackspaceApiClient(
  '/api',
  () => localStorage.getItem('backspace_token'),
  handleUnauthorized,
);

export function createApiClient(origin: string, getToken: () => string | null, onUnauthorized?: () => void): BackspaceApiClient {
  const baseUrl = origin ? `${origin}/api` : '/api';
  return new BackspaceApiClient(baseUrl, getToken, onUnauthorized);
}

