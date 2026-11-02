import type { GrantedSpaceBadgeId, SpaceBadgeId } from './badges.js';
import type { AdminUser, AvatarColor } from './types.js';

// The platform's own administration (docs/systems/admin.md, "Platform
// administration"): what the instance's administrators decide over accounts
// and spaces, apart from anything a space's roles allow. Verification and
// Discovery approval of spaces, account suspensions, the badges an admin
// gives, and the platform audit log that records each of these.
//
// Only an instance admin (`users.is_admin`) decides here. A space's owner
// asks; no space role, owner group or permission bit can decide.

// ─── Space review ───────────────────────────────────────────────────────────

/** A space's verification: null while never requested. Only 'verified' shows the badge. */
export const VERIFICATION_STATUSES = ['pending', 'needs_info', 'verified', 'rejected', 'revoked'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** A space's Discovery listing: null while never submitted. Only 'approved' lists the space. */
export const DISCOVERY_STATUSES = ['pending', 'changes_requested', 'approved', 'rejected', 'withdrawn'] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];

export type ReviewProcess = 'verification' | 'discovery';

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return typeof value === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

export function isDiscoveryStatus(value: unknown): value is DiscoveryStatus {
  return typeof value === 'string' && (DISCOVERY_STATUSES as readonly string[]).includes(value);
}

/** What a space is about, as its owner names it in a request. */
export const SPACE_CATEGORIES = [
  'gaming',
  'music',
  'art',
  'technology',
  'education',
  'science',
  'entertainment',
  'sports',
  'community',
  'other',
] as const;
export type SpaceCategory = (typeof SPACE_CATEGORIES)[number];

export function isSpaceCategory(value: unknown): value is SpaceCategory {
  return typeof value === 'string' && (SPACE_CATEGORIES as readonly string[]).includes(value);
}

export const REVIEW_LIMITS = {
  REASON_MIN_LENGTH: 20,
  REASON_MAX_LENGTH: 1000,
  PROOF_MIN_LENGTH: 10,
  PROOF_MAX_LENGTH: 1000,
  NOTE_MAX_LENGTH: 1000,
  URL_MAX_LENGTH: 200,
  MAX_PROFILES: 5,
} as const;

/**
 * What happened in a review. `submit` and `withdraw` are the owner's;
 * `approve` to `admin_withdraw` an admin's; `changed` is the instance
 * reacting to an edit (a listed space's name, picture or description changed,
 * or it went private); `migrated` moved a space listed before approvals
 * existed into review.
 */
export const REVIEW_ACTIONS = [
  'submit',
  'withdraw',
  'approve',
  'reject',
  'request_info',
  'request_changes',
  'revoke',
  'admin_withdraw',
  'changed',
  'migrated',
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === 'string' && (REVIEW_ACTIONS as readonly string[]).includes(value);
}

interface DecisionRule<S extends string> {
  /** The statuses the decision may be made on. */
  from: readonly S[];
  /** The status it leaves. */
  to: S;
  /** Whether the admin must say why (the owner reads it). */
  noteRequired: boolean;
  /** The review action the decision records. */
  action: ReviewAction;
}

/** An admin's decisions on a verification request. */
export const VERIFICATION_DECISIONS = {
  approve: { from: ['pending', 'needs_info'], to: 'verified', noteRequired: false, action: 'approve' },
  reject: { from: ['pending', 'needs_info'], to: 'rejected', noteRequired: true, action: 'reject' },
  request_info: { from: ['pending'], to: 'needs_info', noteRequired: true, action: 'request_info' },
  revoke: { from: ['verified'], to: 'revoked', noteRequired: true, action: 'revoke' },
} as const satisfies Record<string, DecisionRule<VerificationStatus>>;
export type VerificationDecision = keyof typeof VERIFICATION_DECISIONS;

/** An admin's decisions on a Discovery listing. */
export const DISCOVERY_DECISIONS = {
  approve: { from: ['pending', 'changes_requested'], to: 'approved', noteRequired: false, action: 'approve' },
  reject: { from: ['pending', 'changes_requested'], to: 'rejected', noteRequired: true, action: 'reject' },
  request_changes: { from: ['pending'], to: 'changes_requested', noteRequired: true, action: 'request_changes' },
  withdraw: { from: ['approved', 'pending', 'changes_requested'], to: 'withdrawn', noteRequired: true, action: 'admin_withdraw' },
} as const satisfies Record<string, DecisionRule<DiscoveryStatus>>;
export type DiscoveryDecision = keyof typeof DISCOVERY_DECISIONS;

export function isVerificationDecision(value: unknown): value is VerificationDecision {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VERIFICATION_DECISIONS, value);
}

export function isDiscoveryDecision(value: unknown): value is DiscoveryDecision {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DISCOVERY_DECISIONS, value);
}

/** Whether an admin's verification decision applies to a space in `status`. */
export function verificationDecisionApplies(decision: VerificationDecision, status: VerificationStatus | null): boolean {
  return status !== null && (VERIFICATION_DECISIONS[decision].from as readonly VerificationStatus[]).includes(status);
}

/** Whether an admin's Discovery decision applies to a space in `status`. */
export function discoveryDecisionApplies(decision: DiscoveryDecision, status: DiscoveryStatus | null): boolean {
  return status !== null && (DISCOVERY_DECISIONS[decision].from as readonly DiscoveryStatus[]).includes(status);
}

/** The owner may send a verification request again from anything but a standing verification. */
export function canRequestVerification(status: VerificationStatus | null): boolean {
  return status !== 'verified';
}

/** The owner may take back a verification request that is still open. */
export function canWithdrawVerification(status: VerificationStatus | null): boolean {
  return status === 'pending' || status === 'needs_info';
}

/** The owner may take back a Discovery request or listing that is open or approved. */
export function canWithdrawDiscovery(status: DiscoveryStatus | null): boolean {
  return status === 'pending' || status === 'changes_requested' || status === 'approved';
}

/** Open requests: what the admin queue shows. */
export function isOpenVerification(status: VerificationStatus | null): boolean {
  return status === 'pending' || status === 'needs_info';
}

export function isOpenDiscovery(status: DiscoveryStatus | null): boolean {
  return status === 'pending' || status === 'changes_requested';
}

/** Someone named in a review or in the audit log. Null on the wire once the account is gone. */
export interface PlatformActor {
  id: string;
  username: string;
  displayName: string | null;
}

export interface ReviewEvent {
  id: string;
  process: ReviewProcess;
  action: ReviewAction;
  /** The status the event left; null when it left none (a withdrawn verification request). */
  status: VerificationStatus | DiscoveryStatus | null;
  actor: PlatformActor | null;
  /** The admin's reason, which the owner reads too. */
  note: string | null;
  createdAt: number;
}

export interface VerificationRequestView {
  /** The space's name and description when the request was sent. */
  name: string;
  description: string | null;
  category: SpaceCategory;
  website: string | null;
  profiles: string[];
  reason: string;
  proof: string;
  requestedAt: number;
  requestedBy: PlatformActor | null;
  decidedAt: number | null;
  decidedBy: PlatformActor | null;
  decisionNote: string | null;
}

export interface DiscoveryRequestView {
  category: SpaceCategory;
  requestedAt: number;
  requestedBy: PlatformActor | null;
  decidedAt: number | null;
  decidedBy: PlatformActor | null;
  decisionNote: string | null;
}

/** Both reviews of one space, for its owner and for the instance's admins. */
export interface SpaceReviewState {
  spaceId: string;
  verification: {
    status: VerificationStatus | null;
    request: VerificationRequestView | null;
    history: ReviewEvent[];
  };
  discovery: {
    status: DiscoveryStatus | null;
    request: DiscoveryRequestView | null;
    history: ReviewEvent[];
  };
}

/** `PUT /api/spaces/:id/verification`: the owner's request. */
export interface VerificationRequestBody {
  category: SpaceCategory;
  website?: string | null;
  profiles?: string[];
  reason: string;
  proof: string;
}

/** `PUT /api/spaces/:id/discovery`: the owner's request for a listing. */
export interface DiscoveryRequestBody {
  category: SpaceCategory;
}

/** An admin's decision; `note` is required where the rule says so. */
export interface ReviewDecisionBody {
  note?: string | null;
  /**
   * When the request the admin decided on was sent. A request sent again
   * since is refused with review_status_conflict rather than decided unseen.
   */
  requestedAt?: number;
}

// ─── Accounts ───────────────────────────────────────────────────────────────

export const SUSPENSION_LIMITS = {
  REASON_MIN_LENGTH: 3,
  REASON_MAX_LENGTH: 500,
  /** The longest time-limited suspension; longer is "until lifted". */
  MAX_DURATION_HOURS: 24 * 365,
} as const;

/** The lengths the admin area offers, in hours; null is "until lifted". */
export const SUSPENSION_DURATIONS = [1, 24, 72, 168, 720, null] as const;
export type SuspensionDuration = (typeof SUSPENSION_DURATIONS)[number];

/** An account's suspension while it stands; the person reads the reason when they sign in. */
export interface UserSuspension {
  since: number;
  /** When it ends by itself; null until an admin lifts it. */
  until: number | null;
  reason: string;
}

/** `POST /api/admin/users/:id/suspend`. */
export interface SuspendUserBody {
  reason: string;
  /** Hours from now, at most SUSPENSION_LIMITS.MAX_DURATION_HOURS; null until lifted. */
  durationHours: number | null;
}

/** `POST /api/admin/users/:id/unsuspend`. */
export interface UnsuspendUserBody {
  reason?: string | null;
}

// ─── Platform audit log ─────────────────────────────────────────────────────

export const PLATFORM_AUDIT_ACTIONS = [
  'user_suspend',
  'user_unsuspend',
  'user_role',
  'user_password_reset',
  'user_delete',
  'user_badges',
  'space_badges',
  'verification_approve',
  'verification_reject',
  'verification_request_info',
  'verification_revoke',
  'discovery_approve',
  'discovery_reject',
  'discovery_request_changes',
  'discovery_withdraw',
  'space_vanity_revoke',
  'settings_update',
  'invite_create',
  'invite_update',
  'invite_revoke',
  'invite_reinstate',
  'invite_delete',
  'storage_cleanup',
  'peer_trust',
  'legal_operator_update',
  'legal_publish',
  'report_decide',
  'announcement_create',
  'announcement_end',
  'user_note_add',
  'user_note_delete',
  'user_warn',
  'user_sessions_end',
  'user_storage_limit',
  'signup_rule_add',
  'signup_rule_remove',
  'signup_challenge_update',
  'bots_update',
  'bot_delete',
  'starter_spaces_update',
  'backup_create',
  'accounts_export',
  'audit_export',
] as const;
export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

/** What a `peer_trust` entry says happened to another instance. */
export const PEER_TRUST_CHANGES = ['initiated', 'approved', 'denied', 'revoked', 'reset', 'removed', 'rotated'] as const;
export type PeerTrustChange = (typeof PEER_TRUST_CHANGES)[number];

export function isPeerTrustChange(value: unknown): value is PeerTrustChange {
  return typeof value === 'string' && (PEER_TRUST_CHANGES as readonly string[]).includes(value);
}

export function isPlatformAuditAction(value: unknown): value is PlatformAuditAction {
  return typeof value === 'string' && (PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(value);
}

export type PlatformAuditTargetType = 'user' | 'space' | 'instance';

/** One value an audit entry records: a status, a time, a list of badges or fields. */
export type PlatformAuditValue = string | number | boolean | null | string[];

export interface PlatformAuditEntry {
  id: string;
  /** A PlatformAuditAction; a newer instance may send one this client does not know. */
  action: string;
  actor: PlatformActor | null;
  targetType: PlatformAuditTargetType;
  targetId: string;
  /** The target's name when the action was taken. */
  targetLabel: string | null;
  reason: string | null;
  details: Record<string, PlatformAuditValue> | null;
  createdAt: number;
}

export const PLATFORM_AUDIT_PAGE_SIZE = 50;

export interface PlatformAuditResponse {
  entries: PlatformAuditEntry[];
  hasMore: boolean;
}

// ─── Admin area ─────────────────────────────────────────────────────────────

/** `GET /api/admin/overview`: counts read from the database and the live sockets, nothing estimated. */
export interface PlatformOverview {
  users: {
    /** Accounts homed here, not deleted. */
    total: number;
    /** Accounts with a socket open on this instance now. */
    online: number;
    /** Accounts created in the last 7 days. */
    new7d: number;
    /** Accounts that wrote in a space or a DM in the last 7 days. */
    active7d: number;
    suspended: number;
    admins: number;
  };
  activity: {
    /** Space and DM messages written in the last 7 days. */
    messages7d: number;
  };
  spaces: {
    total: number;
    /** Approved and open to join: listed whenever the instance's Discovery is on. */
    listed: number;
    verified: number;
    /** The instance-wide switch; while off, approved spaces are not shown. */
    discoveryEnabled: boolean;
  };
  reviews: {
    verificationOpen: number;
    discoveryOpen: number;
  };
}

/** A space as the admin area lists it. */
export interface AdminSpaceSummary {
  id: string;
  name: string;
  icon: string | null;
  avatarColor: AvatarColor | null;
  owner: PlatformActor | null;
  memberCount: number;
  visibility: 'public' | 'request' | 'private';
  directoryListed: boolean;
  verificationStatus: VerificationStatus | null;
  discoveryStatus: DiscoveryStatus | null;
  /** Every badge the space shows. */
  badges: SpaceBadgeId[];
  /** The badges an admin gave it. */
  grantedBadges: GrantedSpaceBadgeId[];
  createdAt: number;
}

export interface AdminSpaceListResponse {
  spaces: AdminSpaceSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export type AdminSpaceFilter = 'all' | 'listed' | 'verified' | 'open_review';

export interface AdminSpaceDetail {
  space: AdminSpaceSummary;
  description: string | null;
  banner: string | null;
  /** Its own invite address, if it took one. */
  vanityCode: string | null;
  review: SpaceReviewState;
  audit: PlatformAuditEntry[];
}

/** An open verification request in the admin queue. */
export interface VerificationQueueItem {
  space: AdminSpaceSummary;
  description: string | null;
  status: VerificationStatus;
  request: VerificationRequestView;
}

/** An open Discovery request in the admin queue, with what the listing would show. */
export interface DiscoveryQueueItem {
  space: AdminSpaceSummary;
  description: string | null;
  banner: string | null;
  status: DiscoveryStatus;
  request: DiscoveryRequestView;
}

/** `GET /api/admin/reviews`: every open request, oldest first. */
export interface ReviewQueueResponse {
  verification: VerificationQueueItem[];
  discovery: DiscoveryQueueItem[];
}

export type AdminUserFilter = 'all' | 'suspended' | 'admins';

/** `GET /api/admin/users/:id`: one account in the admin area. */
export interface AdminUserDetail {
  user: AdminUser;
  ownedSpaces: Array<{ id: string; name: string; memberCount: number }>;
  memberships: number;
  friends: number;
  /** Messages written in spaces and DMs on this instance. */
  messages: number;
  storage: AdminAccountStorage;
  audit: PlatformAuditEntry[];
}

/** What an account's files take up, and the limit that applies to it. */
export interface AdminAccountStorage {
  usedBytes: number;
  /** Null when no limit applies. */
  limitBytes: number | null;
  /** Its own limit, set by an admin; 0 means none. Null: the instance's applies. */
  ownLimitBytes: number | null;
}

/** `PUT /api/admin/users/:id/badges` and `PUT /api/admin/spaces/:id/badges`. */
export interface BadgeGrantBody {
  badges: string[];
  reason?: string | null;
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** To a space's owner: one of its reviews moved. */
export interface SpaceReviewUpdatedPayload {
  spaceId: string;
  spaceName: string;
  process: ReviewProcess;
  action: ReviewAction;
  status: VerificationStatus | DiscoveryStatus | null;
  note: string | null;
}

/** To the instance's admins: the number of open requests changed. */
export interface ReviewQueueCountPayload {
  verificationOpen: number;
  discoveryOpen: number;
}
