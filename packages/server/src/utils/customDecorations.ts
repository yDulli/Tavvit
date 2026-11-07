import { randomUUID } from 'node:crypto';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, count, desc, eq, inArray, like } from 'drizzle-orm';
import {
  CUSTOM_DECORATION_FIELDS,
  KIND_OF_FIELD,
  PICTURE_DECORATION_KINDS,
  customDecorationIdOf,
  customDecorationRef,
  effectMotionOf,
  isCustomDecorationKind,
  normalizeNameStyle,
  type CustomDecoration,
  type CustomDecorationField,
  type CustomDecorationKind,
  type CustomDecorationSort,
  type CustomDecorationView,
  type NameStyle,
  type WornCustomDecorations,
} from '@backspace/shared/src/customDecorations.js';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { announceProfileChange } from './profileBroadcast.js';

/**
 * Decorations people make (docs/systems/decorations.md, "Made by people"): where their pictures
 * live, what a profile carries of one it wears, who may wear which, the gallery, and taking one
 * away again.
 */

type DecorationRow = typeof schema.customDecorations.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

/** Pictures live in their own directory, which the attachment janitor (reading only the top level) never sees. */
export function decorationDir(): string {
  return path.join(config.uploadDir, 'decorations');
}

export function decorationFilePath(id: string, still: boolean): string {
  return path.join(decorationDir(), `${id}${still ? '-still' : ''}.webp`);
}

/**
 * A picture's address on this instance, as a path like an account's picture: this instance's own
 * client fetches it from the page's origin, and a client that reads it from here while signed into
 * another instance makes it absolute on this one as it arrives (web `normalizeUserAssets`).
 */
function pictureUrl(id: string, still: boolean): string {
  return `/api/decorations/${id}${still ? '-still' : ''}.webp`;
}

/** A row's `style` column: a name style's look and colours, or an effect's motion, as JSON. */
function storedJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function storedStyle(value: string | null): NameStyle | null {
  return normalizeNameStyle(storedJson(value));
}

/** What a client needs to draw a design. */
export function viewOf(row: DecorationRow): CustomDecorationView {
  const kind = row.kind as CustomDecorationKind;
  const picture = PICTURE_DECORATION_KINDS.has(kind);
  return {
    id: row.id,
    kind,
    name: row.name,
    image: picture ? pictureUrl(row.id, false) : null,
    still: picture && row.animated === 1 ? pictureUrl(row.id, true) : null,
    style: kind === 'name' ? storedStyle(row.style) : null,
    motion: kind === 'effect' ? effectMotionOf(storedJson(row.style)) : null,
  };
}

// ─── The rows, kept at hand ──────────────────────────────────────────────────

/**
 * Every `User` the server sends asks for the designs it wears, so rows are kept in memory once
 * read: an id that names nothing is kept as null too. A change of a row forgets it. Bounded, so a
 * stream of made-up references cannot grow it without end.
 */
const rows = new Map<string, DecorationRow | null>();
const ROWS_KEPT = 5000;

function rowOf(id: string): DecorationRow | null {
  if (rows.has(id)) return rows.get(id) ?? null;
  const row = getDb().select().from(schema.customDecorations).where(eq(schema.customDecorations.id, id)).get() ?? null;
  if (rows.size >= ROWS_KEPT) rows.clear();
  rows.set(id, row);
  return row;
}

export function forgetCustomDecoration(id: string): void {
  rows.delete(id);
  counted = null;
}

/** Tests only. */
export function _resetCustomDecorationCache(): void {
  rows.clear();
  counted = null;
}

export function customDecorationRow(id: string): DecorationRow | null {
  return rowOf(id);
}

/** A design shown on a profile: the kind its field wears, and in the gallery or the wearer's own. */
function wornBy(row: DecorationRow | null, field: CustomDecorationField, wearerId: string): row is DecorationRow {
  return row !== null && row.kind === KIND_OF_FIELD[field] && (row.shared === 1 || row.creatorId === wearerId);
}

const WEARABLE_FIELDS = Object.keys(KIND_OF_FIELD) as CustomDecorationField[];

/** The made designs a profile wears, for `User.customDecorations`; null for none. */
export function wornCustomDecorationsOf(user: Pick<UserRow, 'id' | CustomDecorationField>): WornCustomDecorations | null {
  let worn: WornCustomDecorations | null = null;
  for (const field of WEARABLE_FIELDS) {
    const id = customDecorationIdOf(user[field]);
    if (id === null) continue;
    const row = rowOf(id);
    if (!wornBy(row, field, user.id)) continue;
    worn ??= {};
    worn[field] = viewOf(row);
  }
  return worn;
}

/** Whether `userId` may put the design `value` names on in `field`. */
export function mayWearCustomDecoration(field: CustomDecorationField, value: string, userId: string): boolean {
  const id = customDecorationIdOf(value);
  return id !== null && wornBy(rowOf(id), field, userId);
}

// ─── Who wears what ──────────────────────────────────────────────────────────

/**
 * How many profiles wear each design, worked out at most every half minute, and again as soon as
 * someone changes what they wear (`forgetWearerCounts`), so wearing one shows in the gallery at once.
 */
let counted: { at: number; byId: Map<string, number> } | null = null;
const COUNTS_FOR_MS = 30_000;

export function forgetWearerCounts(): void {
  counted = null;
}

export function wearerCounts(now: number = Date.now()): Map<string, number> {
  if (counted && now - counted.at < COUNTS_FOR_MS) return counted.byId;
  const db = getDb();
  const byId = new Map<string, number>();
  for (const field of WEARABLE_FIELDS) {
    const column = schema.users[field];
    const found = db.select({ ref: column, n: count() }).from(schema.users)
      .where(and(like(column, 'custom:%'), eq(schema.users.isDeleted, 0)))
      .groupBy(column).all();
    for (const { ref, n } of found) {
      const id = customDecorationIdOf(ref);
      if (id !== null) byId.set(id, (byId.get(id) ?? 0) + n);
    }
  }
  counted = { at: now, byId };
  return byId;
}

// ─── The gallery and one's own ───────────────────────────────────────────────

function decorationsFor(found: DecorationRow[], viewerId: string): CustomDecoration[] {
  if (found.length === 0) return [];
  const counts = wearerCounts();
  const creatorIds = [...new Set(found.map((row) => row.creatorId))];
  const creators = new Map(getDb().select({
    id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, isDeleted: schema.users.isDeleted,
  }).from(schema.users).where(inArray(schema.users.id, creatorIds)).all().map((user) => [user.id, user]));
  return found.map((row) => {
    const creator = creators.get(row.creatorId);
    return {
      ...viewOf(row),
      creator: creator && creator.isDeleted !== 1 ? { id: creator.id, username: creator.username, displayName: creator.displayName } : null,
      shared: row.shared === 1,
      wearers: counts.get(row.id) ?? 0,
      createdAt: row.createdAt,
      mine: row.creatorId === viewerId,
    };
  });
}

/**
 * A page of the community's gallery: shared designs of one kind, the most worn or the newest
 * first, those whose name holds `query` (without regard to case) when one is given.
 */
export function galleryPage(input: { kind: CustomDecorationKind; sort: CustomDecorationSort; query: string; offset: number; limit: number; viewerId: string }): { items: CustomDecoration[]; total: number } {
  const db = getDb();
  const all = db.select({ id: schema.customDecorations.id, name: schema.customDecorations.name, createdAt: schema.customDecorations.createdAt })
    .from(schema.customDecorations)
    .where(and(eq(schema.customDecorations.kind, input.kind), eq(schema.customDecorations.shared, 1)))
    .all();
  const wanted = input.query.toLocaleLowerCase();
  const matching = wanted ? all.filter((row) => row.name.toLocaleLowerCase().includes(wanted)) : all;
  const counts = input.sort === 'popular' ? wearerCounts() : null;
  matching.sort((a, b) => {
    if (counts) {
      const difference = (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0);
      if (difference !== 0) return difference;
    }
    return b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1);
  });
  const page = matching.slice(input.offset, input.offset + input.limit).map((row) => row.id);
  if (page.length === 0) return { items: [], total: matching.length };
  const full = new Map(db.select().from(schema.customDecorations).where(inArray(schema.customDecorations.id, page)).all().map((row) => [row.id, row]));
  const ordered = page.map((id) => full.get(id)).filter((row): row is DecorationRow => row !== undefined);
  return { items: decorationsFor(ordered, input.viewerId), total: matching.length };
}

/** Everything one person made, shared or not, the newest first. */
export function ownDecorations(userId: string): CustomDecoration[] {
  const found = getDb().select().from(schema.customDecorations)
    .where(eq(schema.customDecorations.creatorId, userId))
    .orderBy(desc(schema.customDecorations.createdAt)).all();
  return decorationsFor(found, userId);
}

export function decorationFor(row: DecorationRow, viewerId: string): CustomDecoration {
  return decorationsFor([row], viewerId)[0]!;
}

export function ownDecorationCount(userId: string): number {
  return getDb().select({ n: count() }).from(schema.customDecorations)
    .where(eq(schema.customDecorations.creatorId, userId)).get()?.n ?? 0;
}

// ─── Storing ─────────────────────────────────────────────────────────────────

/** Writes a picture where it will be served, through a temporary file, so nobody ever reads half of one. */
export async function writeDecorationFile(id: string, still: boolean, bytes: Buffer): Promise<void> {
  const target = decorationFilePath(id, still);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

async function unlinkQuietly(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function deleteDecorationFiles(id: string): Promise<void> {
  await unlinkQuietly(decorationFilePath(id, false));
  await unlinkQuietly(decorationFilePath(id, true));
}

/**
 * Pictures in the decorations directory that no design names: from a removal that stopped between
 * the row and the files, a design whose row never came (the server stopped between its files and
 * its row), a still frame beside a design that does not move, or a temporary file a write left.
 * At the start every such file goes (index.ts); the hourly storage janitor leaves those younger than
 * `minAgeMs`, whose row may still be on its way in.
 */
export function removeUnusedDecorationFiles(minAgeMs = 0, now: number = Date.now()): number {
  let names: string[];
  try {
    names = readdirSync(decorationDir());
  } catch {
    return 0;
  }
  const moving = new Map(getDb().select({ id: schema.customDecorations.id, animated: schema.customDecorations.animated })
    .from(schema.customDecorations).all().map((row) => [row.id, row.animated === 1]));
  let removed = 0;
  for (const name of names) {
    const match = /^(\d{1,20})(-still)?\.webp$/.exec(name);
    const id = match?.[1];
    if (id !== undefined && moving.has(id) && (match?.[2] === undefined || moving.get(id) === true)) continue;
    const file = path.join(decorationDir(), name);
    try {
      if (minAgeMs > 0 && now - statSync(file).mtimeMs < minAgeMs) continue;
      unlinkSync(file);
      removed += 1;
    } catch (error) {
      console.warn('[decorations] Could not remove an unused file:', error instanceof Error ? error.message : error);
    }
  }
  return removed;
}

// ─── Taking one away ─────────────────────────────────────────────────────────

/** The update that takes a made design out of one profile field. */
function cleared(field: CustomDecorationField): Partial<typeof schema.users.$inferInsert> {
  switch (field) {
    case 'avatarFrame': return { avatarFrame: null };
    case 'profileEffect': return { profileEffect: null };
    case 'nameplate': return { nameplate: null };
    case 'nameEffect': return { nameEffect: null };
  }
}

/** Who wears a design now: the profiles whose field of its kind names it. */
export function wearersOfDesign(row: Pick<DecorationRow, 'id' | 'kind'>): string[] {
  if (!isCustomDecorationKind(row.kind)) return [];
  const field = CUSTOM_DECORATION_FIELDS[row.kind];
  return getDb().select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users[field], customDecorationRef(row.id))).all()
    .map((user) => user.id);
}

/**
 * Everyone who sees these people gets their profile again as it shows now (`user_updated`), so a
 * design that went, or that its maker took out of the gallery, goes from every screen at once
 * rather than on the next load; a browser may still hold its picture, but nothing names it.
 */
export function announceWearers(userIds: readonly string[]): void {
  const db = getDb();
  for (const id of userIds) {
    const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (user) announceProfileChange(user);
  }
}

/**
 * Removes a design: its row, its files, and the reference on every profile that wore it, which
 * shows nothing in its place from then on, and is announced so (`announceWearers`). Answers the
 * row it removed, or null when there was none.
 */
export async function removeCustomDecoration(id: string): Promise<DecorationRow | null> {
  const taken = takeCustomDecoration(id);
  if (!taken) return null;
  announceWearers(taken.wearers);
  await deleteDecorationFiles(id);
  return taken.row;
}

/**
 * The database part of removing a design, with nothing awaited: its row, and the reference on every
 * profile that wore it. Answers the row and who wore it.
 */
function takeCustomDecoration(id: string): { row: DecorationRow; wearers: string[] } | null {
  const db = getDb();
  const row = db.select().from(schema.customDecorations).where(eq(schema.customDecorations.id, id)).get();
  if (!row) return null;
  const wearers = wearersOfDesign(row);
  if (isCustomDecorationKind(row.kind) && wearers.length > 0) {
    const field = CUSTOM_DECORATION_FIELDS[row.kind];
    db.update(schema.users).set(cleared(field)).where(eq(schema.users[field], customDecorationRef(row.id))).run();
  }
  db.delete(schema.customDecorations).where(eq(schema.customDecorations.id, id)).run();
  forgetCustomDecoration(id);
  return { row, wearers };
}

/**
 * Removes every design a person made, as their account goes (utils/userDeletion.ts): the rows and
 * the references at once, announced to whoever sees the others who wore them, the files after,
 * without holding up the deletion.
 */
export function removeDecorationsOfUser(userId: string): void {
  const own = getDb().select({ id: schema.customDecorations.id }).from(schema.customDecorations)
    .where(eq(schema.customDecorations.creatorId, userId)).all();
  for (const { id } of own) {
    const taken = takeCustomDecoration(id);
    if (!taken) continue;
    announceWearers(taken.wearers.filter((wearer) => wearer !== userId));
    deleteDecorationFiles(id).catch((error: unknown) => {
      console.warn(`[decorations] could not delete the files of ${id}:`, error instanceof Error ? error.message : error);
    });
  }
}
