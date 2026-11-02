import type { SignupChallengeLevel } from './signupChallenge.js';
/**
 * What the admin console (docs/systems/admin.md, "The console") and the server say to
 * each other, and the limits both hold to.
 */

// ─── Announcements ──────────────────────────────────────────────────────────

export const ANNOUNCEMENT_TONES = ['info', 'warning'] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];

export const ANNOUNCEMENT_LIMITS = {
  BODY_MIN_LENGTH: 3,
  BODY_MAX_LENGTH: 500,
  /** How many can run at once: more would be a wall, and nobody reads a wall. */
  MAX_ACTIVE: 3,
  /** The longest one may be set to run by itself, in hours. Past that an admin ends it. */
  MAX_DURATION_HOURS: 24 * 30,
} as const;

export function isAnnouncementTone(value: unknown): value is AnnouncementTone {
  return typeof value === 'string' && (ANNOUNCEMENT_TONES as readonly string[]).includes(value);
}

/** What everyone signed in sees on a banner while it runs. Plain text. */
export interface Announcement {
  id: string;
  tone: AnnouncementTone;
  body: string;
  createdAt: number;
  /** When it ends by itself; null runs until an admin ends it. */
  endsAt: number | null;
  /** When an admin ended it. */
  endedAt: number | null;
  /** Also on the public status page, for anyone, signed in or not. */
  onStatusPage: boolean;
}

export interface AnnouncementsResponse {
  announcements: Announcement[];
}

// ─── The dashboard ──────────────────────────────────────────────────────────

/** How many days the dashboard's series cover, today included. */
export const DASHBOARD_DAYS = 30;

export interface AdminDashboard {
  generatedAt: number;
  /** The day each series starts on, as days since 1970-01-01 UTC. */
  firstDay: number;
  /** One number per day, oldest first, `DASHBOARD_DAYS` long. */
  series: {
    /** Accounts created here. */
    signups: number[];
    /** Space and DM messages written here. */
    messages: number[];
    /** Accounts that wrote at least one message that day. */
    activeAccounts: number[];
    /** Mail the transport accepted. */
    mail: number[];
  };
  accounts: {
    total: number;
    online: number;
    suspended: number;
    admins: number;
    /** Local accounts with two-factor sign-in on. */
    twoFactor: number;
    /** Local accounts with a confirmed address. */
    confirmedEmail: number;
  };
  spaces: {
    total: number;
    listed: number;
    verified: number;
  };
  open: {
    reports: number;
    reviews: number;
    /** Problems with the server itself (`AdminSystemInfo.alerts`). */
    alerts: number;
  };
}

// ─── The system page ────────────────────────────────────────────────────────

export const OPERATOR_ALERT_CAUSES = ['disk_high', 'backup_failed', 'backup_old', 'offsite_failed', 'restart_loop'] as const;
export type OperatorAlertCause = (typeof OPERATOR_ALERT_CAUSES)[number];

/** Something the operator has to hear about, for as long as it holds. */
export interface OperatorAlert {
  cause: OperatorAlertCause;
  /** The figure or the error that goes with it, where there is one. */
  detail: string | null;
  since: number;
}

export type SnapshotReasonName = 'pre-migration' | 'scheduled' | 'manual' | 'console';

export interface BackupInfo {
  name: string;
  reason: SnapshotReasonName;
  bytes: number;
  createdAt: number;
}

export interface AdminSystemInfo {
  version: string;
  commit: string | null;
  nodeVersion: string;
  uptimeSeconds: number;
  memory: {
    /** All the server process holds. */
    rssBytes: number;
    heapUsedBytes: number;
  };
  /** How late the server gets to what it has to do, over its last ten seconds. Null just after a start. */
  eventLoop: {
    p50Ms: number;
    p99Ms: number;
    maxMs: number;
  } | null;
  sockets: {
    open: number;
    people: number;
  };
  database: {
    /** The database file and its write-ahead log. */
    bytes: number;
  };
  /** The disk the data lies on; null where the system does not say. */
  disk: {
    freeBytes: number;
    totalBytes: number;
  } | null;
  alerts: OperatorAlert[];
  backups: BackupInfo[];
  /** How often a backup is taken by itself, in hours; 0 is never. */
  backupIntervalHours: number;
  services: {
    /** 'off', 'ok', 'held' or 'blocked'. */
    email: string;
    twoFactor: boolean;
    /** Who translates messages on request. Null: only a person's own browser, or a link out. */
    translation: 'deepl' | 'libretranslate' | null;
    voice: boolean;
    federation: boolean;
  };
}

// ─── Searching the instance ─────────────────────────────────────────────────

export const ADMIN_SEARCH_LIMITS = {
  QUERY_MIN_LENGTH: 2,
  QUERY_MAX_LENGTH: 100,
  /** Per kind. It finds, it does not list: the lists have their own pages. */
  RESULTS: 8,
} as const;

export interface AdminSearchUser {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  avatarColor: string | null;
  isAdmin: boolean;
  suspended: boolean;
  /** The instance it is homed on; null is this one. */
  homeInstance: string | null;
}

export interface AdminSearchSpace {
  id: string;
  name: string;
  icon: string | null;
  avatarColor: string | null;
  memberCount: number;
  visibility: 'public' | 'request' | 'private';
}

export interface AdminSearchResponse {
  users: AdminSearchUser[];
  spaces: AdminSearchSpace[];
}

// ─── One account ────────────────────────────────────────────────────────────

export const ADMIN_NOTE_LIMITS = {
  BODY_MIN_LENGTH: 1,
  BODY_MAX_LENGTH: 1000,
} as const;

export const WARNING_LIMITS = {
  NOTE_MIN_LENGTH: 10,
  NOTE_MAX_LENGTH: 500,
} as const;

/** What the admins keep for each other about an account. It is in the person's data export. */
export interface AdminNote {
  id: string;
  body: string;
  /** Who wrote it; null once that account is gone. */
  author: { id: string; username: string; displayName: string | null } | null;
  createdAt: number;
}

export interface AdminNotesResponse {
  notes: AdminNote[];
}

// ─── Who may sign up ────────────────────────────────────────────────────────

export const SIGNUP_RULE_KINDS = ['email_domain', 'username'] as const;
export type SignupRuleKind = (typeof SIGNUP_RULE_KINDS)[number];

export const SIGNUP_RULE_LIMITS = {
  NOTE_MAX_LENGTH: 200,
  /** Per kind. This is a list a person keeps, not a feed of a provider's blocklist. */
  MAX_RULES: 2000,
} as const;

/** Names an operator usually wants nobody else to have, offered in one click. */
export const USUAL_RESERVED_USERNAMES = [
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'help', 'security', 'system', 'root', 'official', 'owner', 'team', 'info', 'abuse', 'legal', 'noreply', 'tavvit',
] as const;

export function isSignupRuleKind(value: unknown): value is SignupRuleKind {
  return typeof value === 'string' && (SIGNUP_RULE_KINDS as readonly string[]).includes(value);
}

export interface SignupRule {
  kind: SignupRuleKind;
  value: string;
  note: string | null;
  createdAt: number;
}

export interface SignupRulesResponse {
  rules: SignupRule[];
  /** What a browser has to solve before an account is created (signupChallenge.ts). */
  challengeLevel: SignupChallengeLevel;
}

// ─── Where a new account starts ─────────────────────────────────────────────

export const STARTER_SPACES_MAX = 5;

export interface StarterSpacesResponse {
  spaces: AdminSearchSpace[];
}
