import type { DiscoveryStatus, PlatformActor } from './platform.js';

// The legal basics of an instance (docs/systems/legal.md): who runs it, its
// terms and privacy policy in published versions, reports of illegal content,
// and the notices that tell a person what was decided about them.
//
// Whoever runs an instance is its provider, so all of this is theirs to fill
// in and to answer for. The software gives them the place for it and a draft
// to start from.

// ─── Who runs the instance ──────────────────────────────────────────────────

export const LEGAL_OPERATOR_KINDS = ['person', 'organization'] as const;
export type LegalOperatorKind = (typeof LEGAL_OPERATOR_KINDS)[number];

export const LEGAL_LIMITS = {
  LINE_MAX: 300,
  ADDRESS_MAX: 600,
  EMAIL_MAX: 254,
  TEXT_MAX: 200_000,
  CHANGES_MAX: 2_000,
  MIN_AGE_LOWEST: 13,
  MIN_AGE_HIGHEST: 18,
  MIN_AGE_DEFAULT: 16,
} as const;

/** What the imprint names and the drafts are written with. */
export interface LegalOperator {
  kind: LegalOperatorKind;
  /** The person's full name or the organization's name with its legal form. */
  name: string;
  /** Who represents an organization; null for a person. */
  representative: string | null;
  /** A postal address where the operator can be served. A P.O. box does not do. */
  address: string;
  email: string;
  phone: string | null;
  /** Register and number, e.g. "Handelsregister Amtsgericht Musterstadt, HRB 12345". */
  register: string | null;
  vatId: string | null;
  /** Responsible for editorial content (§ 18 Abs. 2 MStV), when there is any. */
  editorial: string | null;
  /** Who hosts the server: name and address, named in the privacy policy. */
  hosting: string | null;
  /** The data protection officer, when there is one. */
  dpo: string | null;
  /** Who may register, confirmed when signing up. */
  minimumAge: number;
}

// ─── Published documents ────────────────────────────────────────────────────

export const LEGAL_DOCUMENT_KINDS = ['terms', 'privacy'] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export function isLegalDocumentKind(value: unknown): value is LegalDocumentKind {
  return typeof value === 'string' && (LEGAL_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** The languages a document can be written in. A reader of any other language gets English. */
export const LEGAL_TEXT_LANGUAGES = ['en', 'de'] as const;
export type LegalTextLanguage = (typeof LEGAL_TEXT_LANGUAGES)[number];

export function isLegalTextLanguage(value: unknown): value is LegalTextLanguage {
  return typeof value === 'string' && (LEGAL_TEXT_LANGUAGES as readonly string[]).includes(value);
}

/** One published version of a document, without its text. */
export interface LegalDocumentMeta {
  id: string;
  kind: LegalDocumentKind;
  /** Counts up per kind. A person's acceptance of the terms names one. */
  version: number;
  languages: LegalTextLanguage[];
  publishedAt: number;
  /** From when it applies. Later than `publishedAt` gives people time to read a change. */
  effectiveAt: number;
  /** What changed, for the people who read the earlier version. */
  changes: string | null;
}

/** The version that applies now and, when one is announced, the one that will. */
export interface LegalDocumentState {
  current: LegalDocumentMeta | null;
  upcoming: LegalDocumentMeta | null;
}

/** `GET /api/legal`, public. */
export interface LegalInfoResponse {
  operator: LegalOperator | null;
  terms: LegalDocumentState;
  privacy: LegalDocumentState;
}

/** `GET /api/legal/documents/:kind`, public. */
export interface LegalDocumentResponse extends LegalDocumentMeta {
  language: LegalTextLanguage;
  text: string;
}

export interface AdminLegalDocumentMeta extends LegalDocumentMeta {
  publishedBy: PlatformActor | null;
}

/** `GET /api/admin/legal`. */
export interface AdminLegalResponse {
  operator: LegalOperator | null;
  documents: AdminLegalDocumentMeta[];
}

/** `GET /api/admin/legal/documents/:id`. */
export interface AdminLegalDocument extends AdminLegalDocumentMeta {
  texts: Partial<Record<LegalTextLanguage, string>>;
}

/** `POST /api/admin/legal/documents`. */
export interface PublishLegalDocumentBody {
  kind: LegalDocumentKind;
  texts: Partial<Record<LegalTextLanguage, string>>;
  /** Null applies it at once. */
  effectiveAt: number | null;
  changes: string | null;
}

// ─── Reports (DSA Art. 16) ──────────────────────────────────────────────────

/** What a report says is wrong. `child_safety` is the one a reporter may leave unsigned (Art. 16(2)(c)). */
export const REPORT_CATEGORIES = [
  'hate',
  'violence',
  'child_safety',
  'terrorism',
  'defamation',
  'privacy',
  'copyright',
  'fraud',
  'other_illegal',
  'terms_violation',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(value);
}

/** What a report points at. `link` is the public form's: an address or a description of the place. */
export const REPORT_TARGET_TYPES = ['message', 'dm_message', 'user', 'space', 'link', 'decoration'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export function isReportTargetType(value: unknown): value is ReportTargetType {
  return typeof value === 'string' && (REPORT_TARGET_TYPES as readonly string[]).includes(value);
}

/**
 * What became of a report. `handled` closes one that was dealt with elsewhere in
 * the admin area, such as a space that was deleted; the other three restrict
 * something here and now and need a ground.
 */
export const REPORT_DECISIONS = ['no_action', 'handled', 'content_removed', 'account_suspended', 'listing_withdrawn'] as const;
export type ReportDecision = (typeof REPORT_DECISIONS)[number];

export function isReportDecision(value: unknown): value is ReportDecision {
  return typeof value === 'string' && (REPORT_DECISIONS as readonly string[]).includes(value);
}

/** What a restriction rests on: the law, or the instance's terms (Art. 17(3)(d), (e)). */
export const REPORT_GROUNDS = ['illegal', 'terms'] as const;
export type ReportGround = (typeof REPORT_GROUNDS)[number];

export function isReportGround(value: unknown): value is ReportGround {
  return typeof value === 'string' && (REPORT_GROUNDS as readonly string[]).includes(value);
}

export const REPORT_LIMITS = {
  EXPLANATION_MIN: 20,
  EXPLANATION_MAX: 4_000,
  NAME_MAX: 120,
  EMAIL_MAX: 254,
  URL_MAX: 2_000,
  NOTE_MIN: 3,
  NOTE_MAX: 2_000,
  PAGE_SIZE: 50,
} as const;

/** `POST /api/legal/reports`: open to anyone, with or without an account. */
export interface CreateReportBody {
  category: ReportCategory;
  explanation: string;
  targetType: ReportTargetType;
  /** The message, person or space, for a report made inside the app. */
  targetId?: string;
  /** The address or place, for a report from the public form. */
  targetUrl?: string;
  reporterName?: string;
  reporterEmail?: string;
  /** "What I say here is true to the best of my knowledge" (Art. 16(2)(d)). */
  goodFaith: boolean;
}

export interface CreateReportResponse {
  id: string;
  receivedAt: number;
}

/** What was reported, as it was at that moment: the content may be gone when an admin reads it. */
export interface ReportSnapshot {
  authorId: string | null;
  authorName: string | null;
  content: string | null;
  attachments: string[];
  /** The space and channel, or the conversation. */
  place: string | null;
  createdAt: number | null;
}

export interface AdminReport {
  id: string;
  status: 'open' | 'closed';
  category: ReportCategory;
  explanation: string;
  targetType: ReportTargetType;
  targetId: string | null;
  targetUrl: string | null;
  snapshot: ReportSnapshot | null;
  /** For a reported space: its Discovery status now, which says whether there is a listing to withdraw. */
  listingStatus: DiscoveryStatus | null;
  reporterUser: PlatformActor | null;
  reporterName: string | null;
  reporterEmail: string | null;
  createdAt: number;
  decision: ReportDecision | null;
  ground: ReportGround | null;
  note: string | null;
  decidedBy: PlatformActor | null;
  decidedAt: number | null;
}

/** `GET /api/admin/reports`. */
export interface AdminReportListResponse {
  reports: AdminReport[];
  open: number;
}

/** `POST /api/admin/reports/:id/decide`. */
export interface DecideReportBody {
  decision: ReportDecision;
  /** Required for every decision that restricts something. */
  ground: ReportGround | null;
  /** The reason, which the person affected reads. */
  note: string;
  /** For `account_suspended`: hours, or null until lifted. */
  durationHours?: number | null;
}

// ─── Notices to a person (DSA Art. 16(5), 17) ───────────────────────────────

export const USER_NOTICE_KINDS = ['content_removed', 'account_suspended', 'listing_withdrawn', 'address_withdrawn', 'warning', 'report_decided'] as const;
export type UserNoticeKind = (typeof USER_NOTICE_KINDS)[number];

/** What the instance's operator decided, told to the person it concerns. */
export interface UserNotice {
  id: string;
  kind: UserNoticeKind;
  ground: ReportGround | null;
  /** The operator's reason. A reporter is told the outcome, not the reason. */
  note: string | null;
  /** What it was about: an excerpt of the message, a space's name. */
  subject: string | null;
  /** When a suspension ends; null until lifted, or when not a suspension. */
  until: number | null;
  /** For `report_decided`: what became of the report. */
  decision: ReportDecision | null;
  createdAt: number;
  readAt: number | null;
}

/** `GET /api/legal/notices`. */
export interface UserNoticeListResponse {
  notices: UserNotice[];
}
