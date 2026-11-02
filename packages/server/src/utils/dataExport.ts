/**
 * A copy of what this instance holds about one account, for the person it is about
 * (GDPR Art. 15 and 20). docs/systems/legal.md, "Data export".
 *
 * They ask with their password; a file is built in the background, kept for a week
 * and served only to them. It holds what they wrote and set, not what others wrote
 * to them: Art. 15(4), and those are other people's words. Credentials are left out:
 * nothing in here lets someone who gets the file into the account.
 *
 * The file is a plain ZIP without compression, written here: media does not shrink
 * and the server has no zip library. One export is built at a time, and rows are read in
 * pages with the event loop let go between them, so an account with years of messages
 * does not stop a server that holds everybody's connections.
 */
import { soundFilePath } from './soundFiles.js';
import { once } from 'node:events';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { DataExportStatus } from '@backspace/shared';
import { config } from '../config.js';
import { getDb, getRawDb, schema } from '../db/index.js';
import { diskWouldFill } from './accountLimits.js';
import { emojiFilePath } from './emojiImage.js';
import { uploadNameOf } from './profileImageRefs.js';
import { generateSnowflake } from './snowflake.js';
import { stickerAssetPath } from './stickerAssets.js';

/** How long the file stays. */
const EXPORT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** How often one account may ask. Building a copy is real work; a person needs one rarely. */
const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** How long after a failed one the next may be asked for (requestDataExport). */
const FAILED_EXPORT_COOLDOWN_MS = 60 * 60 * 1000;
/** A build that started before this long ago was cut off by a restart. */
const EXPORT_STALE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const PAGE_SIZE = 1000;
/** A plain ZIP counts in 32 bits; the files stop short of that, and the README says what was left out. */
const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024 * 1024;
/** A plain ZIP counts its entries in 16 bits. */
const MAX_ENTRIES = 60_000;

interface ZipEntry {
  name: string;
  file: string;
}

/** Columns of `users` that are credentials or the server's own bookkeeping. */
const USER_COLUMNS_LEFT_OUT = new Set(['passwordHash', 'federationHealPending', 'isDeleted']);

function zipFilePath(id: string): string {
  return path.join(config.exportDir, `${id}.zip`);
}

/** The time and date as a ZIP stores them. */
function dosStamp(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Writes the entries as a ZIP, stored and not compressed. Reads each file twice: a stored entry states its checksum first. */
export async function writeZip(target: string, entries: readonly ZipEntry[], now: Date = new Date()): Promise<void> {
  const out = createWriteStream(target);
  const stamp = dosStamp(now);
  let offset = 0;
  const write = async (chunk: Buffer): Promise<void> => {
    offset += chunk.length;
    if (!out.write(chunk)) await once(out, 'drain');
  };
  const central: Buffer[] = [];
  for (const entry of entries) {
    let checksum = 0;
    let size = 0;
    for await (const chunk of createReadStream(entry.file)) {
      checksum = crc32(chunk as Buffer, checksum);
      size += (chunk as Buffer).length;
    }
    const name = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // The name is UTF-8.
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(size, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    await write(local);
    await write(name);
    for await (const chunk of createReadStream(entry.file)) await write(chunk as Buffer);
  }
  const start = offset;
  for (const part of central) await write(part);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - start, 12);
  end.writeUInt32LE(start, 16);
  await write(end);
  out.end();
  await once(out, 'finish');
}

/** A table's rows for one account, a page at a time, as one JSON document per line. */
async function writeLines(file: string, select: string, userId: string): Promise<void> {
  const out = createWriteStream(file);
  const page = getRawDb().prepare(`${select} AND t.rowid > ? ORDER BY t.rowid LIMIT ${PAGE_SIZE}`);
  let after = 0;
  for (;;) {
    const rows = page.all(userId, after) as Array<Record<string, unknown> & { _row: number }>;
    if (rows.length === 0) break;
    for (const { _row, ...row } of rows) {
      after = _row;
      if (!out.write(`${JSON.stringify(row)}\n`)) await once(out, 'drain');
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  out.end();
  await once(out, 'finish');
}

/** A file's name for inside the archive: its own name, with nothing that would lead out of its folder. */
function archiveName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'file';
}

async function buildArchive(userId: string, target: string): Promise<void> {
  const db = getDb();
  const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!row) throw new Error('the account is gone');

  const work = await mkdtemp(path.join(config.exportDir, 'build-'));
  try {
    const entries: ZipEntry[] = [];
    const addJson = async (name: string, value: unknown): Promise<void> => {
      const file = path.join(work, name);
      await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
      entries.push({ name, file });
    };
    const addLines = async (name: string, select: string): Promise<void> => {
      const file = path.join(work, name);
      await writeLines(file, select, userId);
      entries.push({ name, file });
    };

    const account = Object.fromEntries(Object.entries(row).filter(([key]) => !USER_COLUMNS_LEFT_OUT.has(key)));
    await addJson('account.json', account);

    const raw = getRawDb();
    await addJson('security.json', {
      usernameChangedAt: row.usernameChangedAt,
      usernamesGivenUp: raw.prepare('SELECT username, until FROM retired_usernames WHERE user_id = ?').all(userId),
      pushDevices: raw.prepare('SELECT endpoint, created_at AS createdAt, last_success_at AS lastSuccessAt FROM push_subscriptions WHERE user_id = ?').all(userId),
      twoFactorSince: row.twoFactorEnabledAt,
      events: raw.prepare(`SELECT kind, client_label AS clientLabel, address_hint AS addressHint, count, created_at AS createdAt
        FROM security_events WHERE user_id = ? ORDER BY created_at`).all(userId),
      devices: raw.prepare('SELECT first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt FROM known_devices WHERE user_id = ?').all(userId),
      sessions: raw.prepare(`SELECT client_label AS clientLabel, address_hint AS addressHint, created_at AS createdAt, last_active_at AS lastActiveAt
        FROM sessions WHERE user_id = ?`).all(userId),
    });
    await addJson('people.json', {
      friends: raw.prepare(`SELECT u.id, u.username, u.display_name AS displayName, f.created_at AS since
        FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ?`).all(userId),
      friendRequestsSent: raw.prepare(`SELECT r.id, u.username, r.status, r.created_at AS createdAt
        FROM friend_requests r JOIN users u ON u.id = r.to_id WHERE r.from_id = ?`).all(userId),
      friendRequestsReceived: raw.prepare(`SELECT r.id, u.username, r.status, r.created_at AS createdAt
        FROM friend_requests r JOIN users u ON u.id = r.from_id WHERE r.to_id = ?`).all(userId),
      blocked: raw.prepare(`SELECT u.id, u.username, b.created_at AS since
        FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?`).all(userId),
    });
    await addJson('spaces.json', {
      memberships: raw.prepare(`SELECT s.id, s.name, m.joined_at AS joinedAt, m.nickname, m.bio, m.avatar, m.banner, s.owner_id = m.user_id AS owner
        FROM space_members m JOIN spaces s ON s.id = m.space_id WHERE m.user_id = ?`).all(userId),
      bans: raw.prepare(`SELECT s.name AS space, b.reason, b.created_at AS createdAt
        FROM bans b JOIN spaces s ON s.id = b.space_id WHERE b.user_id = ?`).all(userId),
      joinRequests: raw.prepare(`SELECT s.name AS space, j.message, j.status, j.created_at AS createdAt
        FROM join_requests j JOIN spaces s ON s.id = j.space_id WHERE j.user_id = ?`).all(userId),
    });
    await addJson('settings.json', {
      notifications: raw.prepare('SELECT * FROM notification_settings WHERE user_id = ?').all(userId),
      folders: raw.prepare('SELECT * FROM space_folders WHERE user_id = ?').all(userId),
      spaceLayout: raw.prepare('SELECT * FROM user_space_layout WHERE user_id = ?').all(userId),
      readPositions: raw.prepare('SELECT * FROM read_states WHERE user_id = ?').all(userId),
      otherInstances: raw.prepare(`SELECT origin, label, username, status, added_at AS addedAt, last_connected_at AS lastConnectedAt
        FROM user_federation_registry WHERE user_id = ?`).all(userId),
    });
    await addJson('reports-and-notices.json', {
      reportsYouMade: raw.prepare(`SELECT id, status, category, explanation, target_type AS targetType, target_url AS targetUrl, created_at AS createdAt
        FROM content_reports WHERE reporter_user_id = ?`).all(userId),
      noticesToYou: raw.prepare('SELECT * FROM user_notices WHERE user_id = ?').all(userId),
      administratorsNotesAboutYou: raw.prepare('SELECT body, created_at AS createdAt FROM admin_notes WHERE user_id = ?').all(userId),
      administratorsLogAboutYou: raw.prepare(`SELECT action, reason, created_at AS createdAt
        FROM platform_audit_log WHERE target_type = 'user' AND target_id = ?`).all(userId),
    });
    await addLines('messages.jsonl', `SELECT t.rowid AS _row, t.id, c.name AS channel, s.name AS space, t.content, t.created_at AS createdAt, t.edited_at AS editedAt
      FROM messages t JOIN channels c ON c.id = t.channel_id JOIN spaces s ON s.id = c.space_id WHERE t.user_id = ?`);
    await addLines('direct-messages.jsonl', `SELECT t.rowid AS _row, t.id, t.dm_channel_id AS conversation, t.content, t.created_at AS createdAt, t.edited_at AS editedAt
      FROM dm_messages t WHERE t.user_id = ?`);
    await addLines('reactions.jsonl', `SELECT t.rowid AS _row, t.message_id AS message, t.emoji, t.created_at AS createdAt
      FROM reactions t WHERE t.user_id = ?`);
    await addLines('direct-message-reactions.jsonl', `SELECT t.rowid AS _row, t.dm_message_id AS message, t.emoji, t.created_at AS createdAt
      FROM dm_reactions t WHERE t.user_id = ?`);
    await addLines('bots.jsonl', `SELECT t.rowid AS _row, t.id AS bot, t.description AS description, t.created_at AS createdAt, t.last_used_at AS lastUsedAt
      FROM bots t WHERE t.owner_id = ?`);
    await addLines('saved-messages.jsonl', `SELECT t.rowid AS _row, t.message_id AS message, t.dm_message_id AS directMessage, t.remind_at AS remindAt, t.created_at AS createdAt
      FROM saved_messages t WHERE t.user_id = ?`);
    await addLines('notification-keywords.jsonl', `SELECT t.rowid AS _row, t.word AS word, t.created_at AS createdAt
      FROM notification_keywords t WHERE t.user_id = ?`);
    await addLines('webhooks-made.jsonl', `SELECT t.rowid AS _row, t.id AS webhook, t.channel_id AS channel, t.name AS name, t.created_at AS createdAt
      FROM webhooks t WHERE t.created_by = ?`);
    await addLines('channel-follows-made.jsonl', `SELECT t.rowid AS _row, t.id AS follow, t.source_channel_id AS sourceChannel, t.target_channel_id AS targetChannel, t.created_at AS createdAt
      FROM channel_follows t WHERE t.created_by = ?`);
    await addLines('events-announced.jsonl', `SELECT t.rowid AS _row, t.id AS event, t.space_id AS space, t.title AS title, t.starts_at AS startsAt, t.created_at AS createdAt
      FROM space_events t WHERE t.created_by = ?`);
    await addLines('event-answers.jsonl', `SELECT t.rowid AS _row, t.event_id AS event, e.title AS title, e.starts_at AS startsAt, t.created_at AS createdAt
      FROM space_event_rsvps t LEFT JOIN space_events e ON e.id = t.event_id WHERE t.user_id = ?`);
    await addLines('thread-follows.jsonl', `SELECT t.rowid AS _row, t.thread_id AS thread, t.joined_at AS joinedAt
      FROM thread_members t WHERE t.user_id = ?`);
    await addLines('poll-votes.jsonl', `SELECT t.rowid AS _row, t.message_id AS message, t.option_id AS answer, t.created_at AS createdAt
      FROM poll_votes t WHERE t.user_id = ?`);

    // The files they put here, as far as the format reaches.
    const files: ZipEntry[] = [];
    const addFile = (folder: string, label: string, file: string): void => {
      files.push({ name: `files/${folder}/${archiveName(label)}`, file });
    };
    for (const [label, value] of [['avatar', row.avatar], ['banner', row.banner]] as const) {
      const name = uploadNameOf(value);
      if (name) addFile('profile', `${label}${path.extname(name)}`, path.join(config.uploadDir, name));
    }
    for (const member of raw.prepare('SELECT space_id AS spaceId, avatar, banner FROM space_members WHERE user_id = ?')
      .all(userId) as Array<{ spaceId: string; avatar: string | null; banner: string | null }>) {
      for (const [label, value] of [['avatar', member.avatar], ['banner', member.banner]] as const) {
        const name = uploadNameOf(value);
        if (name) addFile('space-profiles', `${member.spaceId}-${label}${path.extname(name)}`, path.join(config.uploadDir, name));
      }
    }
    for (const attachment of raw.prepare('SELECT id, filename, original_name AS originalName FROM attachments WHERE uploader_id = ?')
      .all(userId) as Array<{ id: string; filename: string; originalName: string }>) {
      const name = uploadNameOf(attachment.filename);
      if (name) addFile('attachments', `${attachment.id}-${archiveName(attachment.originalName)}`, path.join(config.uploadDir, name));
    }
    for (const sticker of raw.prepare('SELECT sticker_id AS id, name FROM personal_stickers WHERE user_id = ?')
      .all(userId) as Array<{ id: string; name: string }>) {
      addFile('stickers', `${sticker.id}-${archiveName(sticker.name)}.webp`, stickerAssetPath(sticker.id));
    }
    for (const sound of raw.prepare('SELECT id, name FROM space_sounds WHERE created_by = ?').all(userId) as Array<{ id: string; name: string }>) {
      addFile('sounds', `${sound.id}-${archiveName(sound.name)}.audio`, soundFilePath(sound.id));
    }
    for (const emoji of raw.prepare('SELECT id, name FROM custom_emojis WHERE created_by = ?').all(userId) as Array<{ id: string; name: string }>) {
      addFile('emoji', `${emoji.name}.webp`, emojiFilePath(emoji.id));
    }

    let total = 0;
    for (const entry of entries) total += (await stat(entry.file)).size;
    const left: string[] = [];
    for (const file of files) {
      const size = existsSync(file.file) ? (await stat(file.file)).size : null;
      if (size === null) continue;
      if (total + size > MAX_TOTAL_BYTES || entries.length >= MAX_ENTRIES) {
        left.push(file.name);
        continue;
      }
      total += size;
      entries.push(file);
    }
    // The archive takes its size again on the disk, for a week: not past the reserve the database
    // writes into (utils/accountLimits.ts). It fails, and can be asked for again later.
    if (diskWouldFill(total)) throw new Error('No room on the disk for the archive');

    const readme = path.join(work, 'README.txt');
    await writeFile(readme, [
      'A copy of what this server holds about your account, made at your request.',
      '',
      'account.json                 your profile and account settings',
      'people.json                  your friends, friend requests and the people you blocked',
      'spaces.json                  the spaces you are in, bans and join requests',
      'settings.json                notification settings, folders, connected servers',
      'reports-and-notices.json     reports you made, notices you were sent, what administrators noted and logged about your account',
      'security.json                your sign-ins and what happened around them',
      'messages.jsonl               what you wrote in spaces, one message per line',
      'direct-messages.jsonl        what you wrote in direct messages and group chats',
      'reactions.jsonl, direct-message-reactions.jsonl',
      'poll-votes.jsonl             your answers to polls',
      'bots.jsonl                   the bots you run',
      'saved-messages.jsonl         the messages you saved, and your reminders',
      'notification-keywords.jsonl  the words that alert you',
      'webhooks-made.jsonl          the webhooks you made',
      'channel-follows-made.jsonl   the announcement channels you had a channel follow',
      'events-announced.jsonl       the events you announced',
      'event-answers.jsonl          the events you said you are going to',
      'thread-follows.jsonl         the threads you follow',
      'files/                       your profile pictures, attachments, stickers and emoji',
      '',
      "What other people wrote to you is not in here: those are their words. Your password is not in here either; the server only keeps a value it can check a password against.",
      ...(left.length > 0 ? ['', `These files did not fit into one archive. Write to the operator of this server for them:`, ...left] : []),
      '',
    ].join('\n'));
    entries.unshift({ name: 'README.txt', file: readme });

    await writeZip(target, entries);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

let queue: Promise<void> = Promise.resolve();

/** Builds exports one after the other. */
function enqueueBuild(id: string, userId: string): Promise<void> {
  queue = queue.then(async () => {
    const db = getDb();
    try {
      await mkdir(config.exportDir, { recursive: true });
      await buildArchive(userId, zipFilePath(id));
      const { size } = await stat(zipFilePath(id));
      db.update(schema.dataExports).set({ status: 'ready', sizeBytes: size }).where(eq(schema.dataExports.id, id)).run();
    } catch (error) {
      console.error('[data-export] could not build an export:', error instanceof Error ? error.message : 'unknown error');
      await rm(zipFilePath(id), { force: true }).catch(() => {});
      db.update(schema.dataExports).set({ status: 'failed' }).where(eq(schema.dataExports.id, id)).run();
    }
  });
  return queue;
}

export type DataExportRefusal = { hours: number };

/**
 * Starts a new export, or says how long until the person may ask again. A failed one waits an hour:
 * failing one on purpose, by deleting something while it is built, must not make for a new
 * archive on the disk as often as one is asked for.
 */
export function requestDataExport(userId: string, now: number = Date.now()): { refused: DataExportRefusal } | { done: Promise<void> } {
  const db = getDb();
  const latest = db.select().from(schema.dataExports).where(eq(schema.dataExports.userId, userId))
    .orderBy(sql`${schema.dataExports.createdAt} DESC`).get();
  const cooldown = latest?.status === 'failed' ? FAILED_EXPORT_COOLDOWN_MS : EXPORT_COOLDOWN_MS;
  if (latest && now - latest.createdAt < cooldown) {
    return { refused: { hours: Math.ceil((cooldown - (now - latest.createdAt)) / (60 * 60 * 1000)) } };
  }
  for (const old of db.select({ id: schema.dataExports.id }).from(schema.dataExports).where(eq(schema.dataExports.userId, userId)).all()) {
    void rm(zipFilePath(old.id), { force: true }).catch(() => {});
  }
  db.delete(schema.dataExports).where(eq(schema.dataExports.userId, userId)).run();
  const id = generateSnowflake();
  db.insert(schema.dataExports).values({ id, userId, status: 'pending', createdAt: now, expiresAt: now + EXPORT_LIFETIME_MS }).run();
  return { done: enqueueBuild(id, userId) };
}

export function dataExportStatus(userId: string): DataExportStatus {
  const row = getDb().select().from(schema.dataExports).where(eq(schema.dataExports.userId, userId))
    .orderBy(sql`${schema.dataExports.createdAt} DESC`).get();
  if (!row) return { status: 'none', createdAt: null, expiresAt: null, sizeBytes: null };
  return {
    status: row.status === 'ready' || row.status === 'failed' ? row.status : 'pending',
    createdAt: row.createdAt,
    expiresAt: row.status === 'ready' ? row.expiresAt : null,
    sizeBytes: row.sizeBytes,
  };
}

/** The finished file of this person, if they have one that has not run out. */
export function dataExportFile(userId: string, now: number = Date.now()): string | null {
  const row = getDb().select().from(schema.dataExports).where(and(
    eq(schema.dataExports.userId, userId),
    eq(schema.dataExports.status, 'ready'),
  )).get();
  if (!row || row.expiresAt <= now) return null;
  const file = zipFilePath(row.id);
  return existsSync(file) ? file : null;
}

/**
 * Removes what ran out and what a restart cut off, what belongs to a deleted account,
 * and any file with no row. A file in here never outlives its week.
 */
export async function sweepDataExports(now: number = Date.now()): Promise<void> {
  const db = getDb();
  db.update(schema.dataExports).set({ status: 'failed' }).where(and(
    eq(schema.dataExports.status, 'pending'),
    lt(schema.dataExports.createdAt, now - EXPORT_STALE_MS),
  )).run();
  db.delete(schema.dataExports).where(lt(schema.dataExports.expiresAt, now)).run();
  db.$client.prepare('DELETE FROM data_exports WHERE user_id IN (SELECT id FROM users WHERE is_deleted = 1)').run();
  if (!existsSync(config.exportDir)) return;
  const kept = new Set(db.select({ id: schema.dataExports.id }).from(schema.dataExports).all().map((row) => `${row.id}.zip`));
  for (const name of await readdir(config.exportDir)) {
    // A folder in here is a build in progress, or one a restart cut off.
    if (name.startsWith('build-') && db.select({ id: schema.dataExports.id }).from(schema.dataExports).where(eq(schema.dataExports.status, 'pending')).get()) continue;
    if (!kept.has(name)) await rm(path.join(config.exportDir, name), { recursive: true, force: true });
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

function sweepAndLog(): void {
  sweepDataExports().catch((error: unknown) => {
    console.error('[data-export] sweep failed:', error instanceof Error ? error.message : 'unknown error');
  });
}

export function startDataExportSweeper(): void {
  if (timer) return;
  sweepAndLog();
  timer = setInterval(sweepAndLog, SWEEP_INTERVAL_MS);
  timer.unref();
}

export function stopDataExportSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
