import { asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { ErrorCode, ErrorDetails } from '@backspace/shared/src/errors.js';
import {
  DISCOVERY_DECISIONS,
  REVIEW_LIMITS,
  VERIFICATION_DECISIONS,
  discoveryDecisionApplies,
  isDiscoveryStatus,
  isReviewAction,
  isSpaceCategory,
  isVerificationStatus,
  verificationDecisionApplies,
  type DiscoveryDecision,
  type DiscoveryRequestView,
  type DiscoveryStatus,
  type PlatformActor,
  type ReviewAction,
  type ReviewEvent,
  type ReviewProcess,
  type ReviewQueueCountPayload,
  type SpaceCategory,
  type SpaceReviewState,
  type VerificationDecision,
  type VerificationRequestView,
  type VerificationStatus,
} from '@backspace/shared/src/platform.js';
import { getDb, schema } from '../db/index.js';
import { generateSnowflake } from './snowflake.js';
import { platformActors } from './platformAudit.js';

// The platform's reviews of a space (docs/systems/admin.md, "Verification"
// and "Discovery approval"). A space's owner asks; an instance admin decides.
// Each process has one status field on the space and one request row; every
// step, the owner's and the admin's and the instance's own, is a row in
// space_review_events, which is the history both sides read. Nothing here
// checks who is asking: the routes do (the owner by `spaces.owner_id`, an
// admin by `users.is_admin`), and only they call these functions.

type SpaceRow = typeof schema.spaces.$inferSelect;
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export interface ReviewRefusal {
  status: number;
  code: ErrorCode;
  details?: ErrorDetails;
}

export function verificationStatusOf(row: Pick<SpaceRow, 'verificationStatus'>): VerificationStatus | null {
  return isVerificationStatus(row.verificationStatus) ? row.verificationStatus : null;
}

export function discoveryStatusOf(row: Pick<SpaceRow, 'discoveryStatus'>): DiscoveryStatus | null {
  return isDiscoveryStatus(row.discoveryStatus) ? row.discoveryStatus : null;
}

export { LISTED_IN_DISCOVERY_SQL } from './discoveryListing.js';

// ─── Reading ────────────────────────────────────────────────────────────────

function storedProfiles(stored: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function categoryOf(value: string): SpaceCategory {
  return isSpaceCategory(value) ? value : 'other';
}

function verificationView(
  row: typeof schema.spaceVerificationRequests.$inferSelect,
  actors: Map<string, PlatformActor>,
): VerificationRequestView {
  return {
    name: row.name,
    description: row.description,
    category: categoryOf(row.category),
    website: row.website,
    profiles: storedProfiles(row.profiles),
    reason: row.reason,
    proof: row.proof,
    requestedAt: row.requestedAt,
    requestedBy: actors.get(row.requestedBy) ?? null,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy ? actors.get(row.decidedBy) ?? null : null,
    decisionNote: row.decisionNote,
  };
}

function discoveryView(
  row: typeof schema.spaceDiscoveryRequests.$inferSelect,
  actors: Map<string, PlatformActor>,
): DiscoveryRequestView {
  return {
    category: categoryOf(row.category),
    requestedAt: row.requestedAt,
    requestedBy: actors.get(row.requestedBy) ?? null,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy ? actors.get(row.decidedBy) ?? null : null,
    decisionNote: row.decisionNote,
  };
}

function statusOfEvent(process: ReviewProcess, value: string | null): VerificationStatus | DiscoveryStatus | null {
  if (value === null) return null;
  if (process === 'verification') return isVerificationStatus(value) ? value : null;
  return isDiscoveryStatus(value) ? value : null;
}

/** The open verification and Discovery requests of these spaces, keyed by space id, with every named person. */
export function reviewRequestsOf(spaceIds: readonly string[]): {
  verification: Map<string, VerificationRequestView>;
  discovery: Map<string, DiscoveryRequestView>;
} {
  const verification = new Map<string, VerificationRequestView>();
  const discovery = new Map<string, DiscoveryRequestView>();
  if (spaceIds.length === 0) return { verification, discovery };
  const db = getDb();
  const verificationRows = db.select().from(schema.spaceVerificationRequests)
    .where(inArray(schema.spaceVerificationRequests.spaceId, [...spaceIds])).all();
  const discoveryRows = db.select().from(schema.spaceDiscoveryRequests)
    .where(inArray(schema.spaceDiscoveryRequests.spaceId, [...spaceIds])).all();
  const actors = platformActors([
    ...verificationRows.flatMap((row) => [row.requestedBy, row.decidedBy ?? '']),
    ...discoveryRows.flatMap((row) => [row.requestedBy, row.decidedBy ?? '']),
  ].filter((id) => id !== ''));
  for (const row of verificationRows) verification.set(row.spaceId, verificationView(row, actors));
  for (const row of discoveryRows) discovery.set(row.spaceId, discoveryView(row, actors));
  return { verification, discovery };
}

/** Both reviews of one space with their full history, oldest first. */
export function reviewStateOf(space: Pick<SpaceRow, 'id' | 'verificationStatus' | 'discoveryStatus'>): SpaceReviewState {
  const db = getDb();
  const requests = reviewRequestsOf([space.id]);
  const events = db.select().from(schema.spaceReviewEvents)
    .where(eq(schema.spaceReviewEvents.spaceId, space.id))
    .orderBy(asc(schema.spaceReviewEvents.createdAt), asc(schema.spaceReviewEvents.id))
    .all();
  const actors = platformActors(events.map((event) => event.actorId));
  const history = (process: ReviewProcess): ReviewEvent[] => events
    .filter((event) => event.process === process && isReviewAction(event.action))
    .map((event) => ({
      id: event.id,
      process,
      action: event.action as ReviewAction,
      status: statusOfEvent(process, event.status),
      actor: actors.get(event.actorId) ?? null,
      note: event.note,
      createdAt: event.createdAt,
    }));
  return {
    spaceId: space.id,
    verification: {
      status: verificationStatusOf(space),
      request: requests.verification.get(space.id) ?? null,
      history: history('verification'),
    },
    discovery: {
      status: discoveryStatusOf(space),
      request: requests.discovery.get(space.id) ?? null,
      history: history('discovery'),
    },
  };
}

/** Whether either review of a space waits for an admin. */
export function isOpenReview(verification: VerificationStatus | null, discovery: DiscoveryStatus | null): boolean {
  return verification === 'pending' || verification === 'needs_info' || discovery === 'pending' || discovery === 'changes_requested';
}

/** How many requests wait for an admin: the queue's size, for the admins' count. */
export function openReviewCounts(): ReviewQueueCountPayload {
  const db = getDb();
  const verification = db.select({ n: sql<number>`count(*)` }).from(schema.spaces)
    .where(or(eq(schema.spaces.verificationStatus, 'pending'), eq(schema.spaces.verificationStatus, 'needs_info'))).get();
  const discovery = db.select({ n: sql<number>`count(*)` }).from(schema.spaces)
    .where(or(eq(schema.spaces.discoveryStatus, 'pending'), eq(schema.spaces.discoveryStatus, 'changes_requested'))).get();
  return { verificationOpen: verification?.n ?? 0, discoveryOpen: discovery?.n ?? 0 };
}

// ─── What an owner sends ────────────────────────────────────────────────────

export interface ParsedVerificationRequest {
  category: SpaceCategory;
  website: string | null;
  profiles: string[];
  reason: string;
  proof: string;
}

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** A public address an owner gives: http or https, at most URL_MAX_LENGTH once normalised. Never fetched. */
function reviewUrl(value: unknown): string | null | ReviewRefusal {
  const refusal: ReviewRefusal = { status: 400, code: 'review_url_invalid', details: { max: REVIEW_LIMITS.URL_MAX_LENGTH } };
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return refusal;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (/\s/.test(trimmed) || CONTROL.test(trimmed)) return refusal;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return refusal;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return refusal;
  return url.href.length <= REVIEW_LIMITS.URL_MAX_LENGTH ? url.href : refusal;
}

function isRefusal(value: unknown): value is ReviewRefusal {
  return typeof value === 'object' && value !== null && 'code' in value;
}

function boundedText(value: unknown, min: number, max: number, code: ErrorCode): string | ReviewRefusal {
  const refusal: ReviewRefusal = { status: 400, code, details: { min, max } };
  if (typeof value !== 'string') return refusal;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || CONTROL.test(trimmed)) return refusal;
  return trimmed;
}

export function parseVerificationRequest(body: unknown): { ok: true; value: ParsedVerificationRequest } | { ok: false; refusal: ReviewRefusal } {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (!isSpaceCategory(input.category)) return { ok: false, refusal: { status: 400, code: 'review_category_invalid' } };
  const website = reviewUrl(input.website);
  if (isRefusal(website)) return { ok: false, refusal: website };
  const rawProfiles = input.profiles === undefined || input.profiles === null ? [] : input.profiles;
  if (!Array.isArray(rawProfiles)) return { ok: false, refusal: { status: 400, code: 'review_url_invalid', details: { max: REVIEW_LIMITS.URL_MAX_LENGTH } } };
  const profiles: string[] = [];
  for (const entry of rawProfiles) {
    const url = reviewUrl(entry);
    if (isRefusal(url)) return { ok: false, refusal: url };
    if (url !== null && !profiles.includes(url)) profiles.push(url);
  }
  if (profiles.length > REVIEW_LIMITS.MAX_PROFILES) {
    return { ok: false, refusal: { status: 400, code: 'review_too_many_profiles', details: { max: REVIEW_LIMITS.MAX_PROFILES } } };
  }
  const reason = boundedText(input.reason, REVIEW_LIMITS.REASON_MIN_LENGTH, REVIEW_LIMITS.REASON_MAX_LENGTH, 'review_reason_invalid');
  if (isRefusal(reason)) return { ok: false, refusal: reason };
  const proof = boundedText(input.proof, REVIEW_LIMITS.PROOF_MIN_LENGTH, REVIEW_LIMITS.PROOF_MAX_LENGTH, 'review_proof_invalid');
  if (isRefusal(proof)) return { ok: false, refusal: proof };
  return { ok: true, value: { category: input.category, website, profiles, reason, proof } };
}

export function parseDiscoveryCategory(body: unknown): SpaceCategory | ReviewRefusal {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  return isSpaceCategory(input.category) ? input.category : { status: 400, code: 'review_category_invalid' };
}

/** An admin's note: trimmed, null when empty; refused when required and missing, or too long. */
export function parseReviewNote(body: unknown, required: boolean): string | null | ReviewRefusal {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const raw = input.note;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { status: 400, code: 'validation_failed', details: { field: 'note' } };
  const note = typeof raw === 'string' ? raw.trim() : '';
  if (note.length > REVIEW_LIMITS.NOTE_MAX_LENGTH || CONTROL.test(note)) {
    return { status: 400, code: 'review_note_too_long', details: { max: REVIEW_LIMITS.NOTE_MAX_LENGTH } };
  }
  if (note.length === 0) return required ? { status: 400, code: 'review_note_required' } : null;
  return note;
}

export { isRefusal as isReviewRefusal };

// ─── Steps ──────────────────────────────────────────────────────────────────

interface EventInput {
  process: ReviewProcess;
  action: ReviewAction;
  status: VerificationStatus | DiscoveryStatus | null;
  actorId: string;
  note: string | null;
}

function insertEvent(tx: Tx, spaceId: string, event: EventInput, now: number): void {
  tx.insert(schema.spaceReviewEvents).values({
    id: generateSnowflake(),
    spaceId,
    process: event.process,
    action: event.action,
    status: event.status,
    actorId: event.actorId,
    note: event.note,
    createdAt: now,
  }).run();
}

/** A step taken: what the routes announce (reviewNotify.ts) and audit. */
export interface ReviewStep {
  process: ReviewProcess;
  action: ReviewAction;
  status: VerificationStatus | DiscoveryStatus | null;
  note: string | null;
}

/** The owner sends a verification request, or sends it again with new content. */
export function submitVerification(space: SpaceRow, actorId: string, request: ParsedVerificationRequest, now: number = Date.now()): ReviewStep {
  const values = {
    name: space.name,
    description: space.description,
    category: request.category,
    website: request.website,
    profiles: JSON.stringify(request.profiles),
    reason: request.reason,
    proof: request.proof,
    requestedBy: actorId,
    requestedAt: now,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  };
  getDb().transaction((tx) => {
    tx.insert(schema.spaceVerificationRequests).values({ spaceId: space.id, ...values })
      .onConflictDoUpdate({ target: schema.spaceVerificationRequests.spaceId, set: values }).run();
    tx.update(schema.spaces).set({ verificationStatus: 'pending' }).where(eq(schema.spaces.id, space.id)).run();
    insertEvent(tx, space.id, { process: 'verification', action: 'submit', status: 'pending', actorId, note: null }, now);
  });
  return { process: 'verification', action: 'submit', status: 'pending', note: null };
}

/** The owner takes an open verification request back; the space is "not requested" again. */
export function withdrawVerification(space: SpaceRow, actorId: string, now: number = Date.now()): ReviewStep {
  getDb().transaction((tx) => {
    tx.update(schema.spaces).set({ verificationStatus: null }).where(eq(schema.spaces.id, space.id)).run();
    insertEvent(tx, space.id, { process: 'verification', action: 'withdraw', status: null, actorId, note: null }, now);
  });
  return { process: 'verification', action: 'withdraw', status: null, note: null };
}

/** The owner asks for a listing, or sends the request again (a new category, after a refusal or a withdrawal). */
export function submitDiscovery(space: SpaceRow, actorId: string, category: SpaceCategory, now: number = Date.now()): ReviewStep {
  const values = {
    category,
    requestedBy: actorId,
    requestedAt: now,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  };
  getDb().transaction((tx) => {
    tx.insert(schema.spaceDiscoveryRequests).values({ spaceId: space.id, ...values, approvedSnapshot: null })
      .onConflictDoUpdate({ target: schema.spaceDiscoveryRequests.spaceId, set: values }).run();
    tx.update(schema.spaces).set({ discoveryStatus: 'pending' }).where(eq(schema.spaces.id, space.id)).run();
    insertEvent(tx, space.id, { process: 'discovery', action: 'submit', status: 'pending', actorId, note: null }, now);
  });
  return { process: 'discovery', action: 'submit', status: 'pending', note: null };
}

/** The owner takes a Discovery request or a listing back. */
export function withdrawDiscovery(space: SpaceRow, actorId: string, now: number = Date.now()): ReviewStep {
  getDb().transaction((tx) => {
    tx.update(schema.spaces).set({ discoveryStatus: 'withdrawn' }).where(eq(schema.spaces.id, space.id)).run();
    insertEvent(tx, space.id, { process: 'discovery', action: 'withdraw', status: 'withdrawn', actorId, note: null }, now);
  });
  return { process: 'discovery', action: 'withdraw', status: 'withdrawn', note: null };
}

/**
 * The request the admin decided on is the one standing: sent at
 * `requestedAt`, when the admin's client said so. A request sent again since
 * is decided by nobody until someone has seen it.
 */
function decidedOnCurrentRequest(storedRequestedAt: number | undefined, seen: number | undefined): boolean {
  return seen === undefined || storedRequestedAt === undefined || storedRequestedAt === seen;
}

/** An admin decides on a verification. Refused when the decision does not apply to the status now. */
export function decideVerification(
  space: SpaceRow,
  decision: VerificationDecision,
  actorId: string,
  note: string | null,
  requestedAt: number | undefined,
  now: number = Date.now(),
): ReviewStep | ReviewRefusal {
  const rule = VERIFICATION_DECISIONS[decision];
  const db = getDb();
  return db.transaction((tx) => {
    const current = tx.select({ verificationStatus: schema.spaces.verificationStatus }).from(schema.spaces)
      .where(eq(schema.spaces.id, space.id)).get();
    const request = tx.select({ requestedAt: schema.spaceVerificationRequests.requestedAt })
      .from(schema.spaceVerificationRequests).where(eq(schema.spaceVerificationRequests.spaceId, space.id)).get();
    if (!current || !request || !verificationDecisionApplies(decision, verificationStatusOf(current))
      || !decidedOnCurrentRequest(request.requestedAt, requestedAt)) {
      return { status: 409, code: 'review_status_conflict' } satisfies ReviewRefusal;
    }
    tx.update(schema.spaces).set({ verificationStatus: rule.to }).where(eq(schema.spaces.id, space.id)).run();
    tx.update(schema.spaceVerificationRequests)
      .set({ decidedBy: actorId, decidedAt: now, decisionNote: note })
      .where(eq(schema.spaceVerificationRequests.spaceId, space.id)).run();
    insertEvent(tx, space.id, { process: 'verification', action: rule.action, status: rule.to, actorId, note }, now);
    return { process: 'verification', action: rule.action, status: rule.to, note } satisfies ReviewStep;
  });
}

/** An admin decides on a Discovery listing. An approval keeps what it approved. */
export function decideDiscovery(
  space: SpaceRow,
  decision: DiscoveryDecision,
  actorId: string,
  note: string | null,
  requestedAt: number | undefined,
  now: number = Date.now(),
): ReviewStep | ReviewRefusal {
  const rule = DISCOVERY_DECISIONS[decision];
  const db = getDb();
  return db.transaction((tx) => {
    const current = tx.select().from(schema.spaces).where(eq(schema.spaces.id, space.id)).get();
    const request = tx.select().from(schema.spaceDiscoveryRequests)
      .where(eq(schema.spaceDiscoveryRequests.spaceId, space.id)).get();
    if (!current || !request || !discoveryDecisionApplies(decision, discoveryStatusOf(current))
      || !decidedOnCurrentRequest(request.requestedAt, requestedAt)) {
      return { status: 409, code: 'review_status_conflict' } satisfies ReviewRefusal;
    }
    if (decision === 'approve' && current.visibility !== 'public' && current.visibility !== 'request') {
      return { status: 409, code: 'discovery_requires_listable_visibility' } satisfies ReviewRefusal;
    }
    if (decision === 'approve' && (externalPicture(current.icon) || externalPicture(current.banner))) {
      return { status: 409, code: 'discovery_requires_uploaded_pictures' } satisfies ReviewRefusal;
    }
    tx.update(schema.spaces).set({ discoveryStatus: rule.to }).where(eq(schema.spaces.id, space.id)).run();
    const snapshot = decision === 'approve'
      ? JSON.stringify({
        name: current.name,
        description: current.description,
        icon: current.icon,
        banner: current.banner,
        category: request.category,
      })
      : request.approvedSnapshot;
    tx.update(schema.spaceDiscoveryRequests)
      .set({ decidedBy: actorId, decidedAt: now, decisionNote: note, approvedSnapshot: snapshot })
      .where(eq(schema.spaceDiscoveryRequests.spaceId, space.id)).run();
    insertEvent(tx, space.id, { process: 'discovery', action: rule.action, status: rule.to, actorId, note }, now);
    return { process: 'discovery', action: rule.action, status: rule.to, note } satisfies ReviewStep;
  });
}

// ─── Edits of a reviewed space ──────────────────────────────────────────────

type ListingFields = Pick<SpaceRow, 'name' | 'description' | 'icon' | 'banner' | 'visibility'>;

/**
 * What an edit or a transfer does to one review: the status written with it,
 * and whether the request under review changed. A changed request takes the
 * time of the change as its `requested_at`, so a decision an admin made on
 * the earlier version is refused (`decidedOnCurrentRequest`) rather than
 * approving what nobody saw.
 */
export interface ReviewEditChange<S> {
  status: S;
  revised: boolean;
}

export interface ReviewEdit {
  discovery: ReviewEditChange<DiscoveryStatus> | null;
  verification: ReviewEditChange<VerificationStatus> | null;
}

function listingChanged(before: ListingFields, after: ListingFields): boolean {
  return before.name !== after.name || (before.description ?? null) !== (after.description ?? null)
    || (before.icon ?? null) !== (after.icon ?? null) || (before.banner ?? null) !== (after.banner ?? null);
}

/**
 * Discovery after an edit: a space made private leaves Discovery, open
 * requests included; a listed space whose name, description, icon or banner
 * changes goes back to review; an open request takes such an edit as a new
 * version. Nothing reaches Discovery unseen.
 */
function discoveryAfterEdit(before: SpaceRow, after: ListingFields): ReviewEditChange<DiscoveryStatus> | null {
  const status = discoveryStatusOf(before);
  if (status !== 'approved' && status !== 'pending' && status !== 'changes_requested') return null;
  const wasOpen = before.visibility === 'public' || before.visibility === 'request';
  if (wasOpen && after.visibility === 'private') return { status: 'withdrawn', revised: false };
  if (!listingChanged(before, after)) return null;
  return { status: status === 'approved' ? 'pending' : status, revised: true };
}

/**
 * Verification after an edit: a verification vouches for the space under
 * its name, so a renamed space is reviewed again and shows no badge until
 * then; an open request takes the new name as a new version.
 */
function verificationAfterEdit(before: SpaceRow, after: ListingFields): ReviewEditChange<VerificationStatus> | null {
  const status = verificationStatusOf(before);
  if (status !== 'verified' && status !== 'pending' && status !== 'needs_info') return null;
  if (before.name === after.name) return null;
  return { status: status === 'verified' ? 'pending' : status, revised: true };
}

/** What an edit does to both reviews, written with the edit (routes/spaces.ts PATCH). */
export function reviewsAfterEdit(before: SpaceRow, after: ListingFields): ReviewEdit {
  return { discovery: discoveryAfterEdit(before, after), verification: verificationAfterEdit(before, after) };
}

/**
 * What a new owner does to the verification: it vouches for who runs the
 * space, so a standing or open verification is reviewed again under the new
 * owner. Discovery is about what the listing shows and stays as it is.
 */
export function reviewsAfterTransfer(space: SpaceRow): ReviewEdit {
  const status = verificationStatusOf(space);
  if (status !== 'verified' && status !== 'pending' && status !== 'needs_info') return { discovery: null, verification: null };
  return { discovery: null, verification: { status: status === 'verified' ? 'pending' : status, revised: true } };
}

/**
 * The instance's own steps after an edit or a transfer moved a review
 * (`reviewsAfterEdit`, `reviewsAfterTransfer`), recorded once the change is
 * written: a revised request takes the time of the change (a verification
 * request the space's current name and description too), and each moved
 * review gets a 'changed' step. Returns the steps to announce.
 */
export function recordEditSteps(
  space: Pick<SpaceRow, 'id' | 'name' | 'description'>,
  actorId: string,
  edit: ReviewEdit,
  now: number = Date.now(),
): ReviewStep[] {
  const steps: ReviewStep[] = [];
  getDb().transaction((tx) => {
    if (edit.discovery) {
      if (edit.discovery.revised) {
        tx.update(schema.spaceDiscoveryRequests).set({ requestedAt: now })
          .where(eq(schema.spaceDiscoveryRequests.spaceId, space.id)).run();
      }
      insertEvent(tx, space.id, { process: 'discovery', action: 'changed', status: edit.discovery.status, actorId, note: null }, now);
      steps.push({ process: 'discovery', action: 'changed', status: edit.discovery.status, note: null });
    }
    if (edit.verification) {
      if (edit.verification.revised) {
        tx.update(schema.spaceVerificationRequests)
          .set({ name: space.name, description: space.description, requestedAt: now })
          .where(eq(schema.spaceVerificationRequests.spaceId, space.id)).run();
      }
      insertEvent(tx, space.id, { process: 'verification', action: 'changed', status: edit.verification.status, actorId, note: null }, now);
      steps.push({ process: 'verification', action: 'changed', status: edit.verification.status, note: null });
    }
  });
  return steps;
}

/** A picture another site serves: it can change there without any edit here, so a listing never shows one. */
export function externalPicture(value: string | null): boolean {
  const trimmed = value?.trim() ?? '';
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

/** A space's Discovery listing state from its row, for the condition the routes check before a submission. */
export function listableSpace(space: Pick<SpaceRow, 'visibility'>): boolean {
  return space.visibility === 'public' || space.visibility === 'request';
}

/** The spaces whose verification or Discovery request is open, for the queue. */
export function openReviewSpaceIds(): { verification: string[]; discovery: string[] } {
  const db = getDb();
  const verification = db.select({ id: schema.spaces.id }).from(schema.spaces)
    .where(or(eq(schema.spaces.verificationStatus, 'pending'), eq(schema.spaces.verificationStatus, 'needs_info'))).all();
  const discovery = db.select({ id: schema.spaces.id }).from(schema.spaces)
    .where(or(eq(schema.spaces.discoveryStatus, 'pending'), eq(schema.spaces.discoveryStatus, 'changes_requested'))).all();
  return { verification: verification.map((row) => row.id), discovery: discovery.map((row) => row.id) };
}
