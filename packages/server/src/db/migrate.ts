import Database from 'better-sqlite3';
import crypto from 'crypto';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';
import { insertDmMember } from '../utils/dmMemberClosed.js';

/**
 * Ensure data invariants after schema migration. Idempotent — safe to run
 * on every boot. Uses raw better-sqlite3 handle (not Drizzle ORM).
 */
export function ensureDefaults(db: Database.Database): void {
  // 1. Ensure the single-row instance_settings row exists
  const row = db.prepare('SELECT id FROM instance_settings WHERE id = 1').get();
  if (!row) {
    // A brand-new database is a PRIVATE instance. The column defaults come from
    // the upstream schema (public discovery on, federated sign-up on, peering
    // auto-accepted, directory browsing on) and cannot be changed without a
    // table rebuild, so the first row is written explicitly. This runs only
    // when no row exists: an existing instance keeps every setting it has.
    //   discovery_enabled = 0            no public space discovery between strangers
    //   federated_registration_open = 0  no accounts created from other instances
    //   auto_accept_peering = 0          if federation is ever switched on, peers need approval
    //   directory_browse_enabled = 0     never browse a public directory
    //   signup_challenge = 'normal'      a new account starts with a small task in the browser
    db.prepare(
      `INSERT OR IGNORE INTO instance_settings
        (id, instance_name, max_bitrate_kbps, min_bitrate_kbps, bitrate_step_kbps,
         allowed_resolutions, allowed_framerates, max_resolution, max_framerate,
         discovery_enabled, federated_registration_open, auto_accept_peering,
         directory_browse_enabled, signup_challenge, updated_at)
       VALUES (1, ?, 20000, 500, 500, ?, ?, 1080, 60, 0, 0, 0, 0, 'normal', ?)`
    ).run(DEFAULT_INSTANCE_NAME, '540,720,1080', '30,45,60', Date.now());
    console.log('[defaults] Inserted default instance_settings row (private instance defaults)');
  }

  // 2. Ensure a unique Snowflake worker ID is persisted (0-1023)
  const settings = db.prepare('SELECT worker_id FROM instance_settings WHERE id = 1').get() as
    { worker_id: number | null } | undefined;
  if (!settings || settings.worker_id === null) {
    const workerId = crypto.randomInt(0, 1024);
    db.prepare('UPDATE instance_settings SET worker_id = ? WHERE id = 1').run(workerId);
    console.log(`[defaults] Generated Snowflake worker ID: ${workerId}`);
  }

  // 2b. Ensure a persistent instance epoch (incarnation UUID) exists. A fresh
  // DB mints a new one — this is the discriminator for detecting resets.
  // The id=1 row is guaranteed by step 1's INSERT OR IGNORE above.
  const epochRow = db.prepare('SELECT instance_id FROM instance_settings WHERE id = 1').get() as
    { instance_id: string | null } | undefined;
  if (!epochRow || epochRow.instance_id === null) {
    const instanceId = crypto.randomUUID();
    const res = db.prepare('UPDATE instance_settings SET instance_id = ? WHERE id = 1').run(instanceId);
    if (res.changes !== 1) throw new Error('ensureDefaults: instance_settings id=1 row missing — cannot mint epoch');
    console.log('[defaults] Generated instance epoch');
  }

  // 2c. Ensure installed_at is set. Existing databases get the oldest local
  // account's creation time, a fresh one gets now. Never overwritten.
  const installedRow = db.prepare('SELECT installed_at FROM instance_settings WHERE id = 1').get() as
    { installed_at: number | null } | undefined;
  if (!installedRow || installedRow.installed_at === null) {
    const oldest = db.prepare(
      "SELECT created_at FROM users WHERE home_instance IS NULL AND account_kind = 'person' AND (is_deleted IS NULL OR is_deleted = 0) ORDER BY created_at ASC LIMIT 1",
    ).get() as { created_at: number } | undefined;
    const installedAt = oldest?.created_at ?? Date.now();
    db.prepare('UPDATE instance_settings SET installed_at = ? WHERE id = 1').run(installedAt);
    console.log('[defaults] Recorded installed_at');
  }

  // Nobody is made an administrator here: with open registration that would be whoever came
  // first. `tavvit-admin` is the only way, and the startup summary says so while there is none.
}

/**
 * What a membership held in a space goes with it (utils/spaceMemberRemoval.ts). Before that held
 * for leaving and for a kick, both left the roles and the overrides naming the person behind, and
 * they came back to whoever joined again. This takes what was left so far: roles, and channel and
 * category overrides on a member, of people who are not in that space. Idempotent, and nothing to
 * do on a database that never had such a row. Answers how many rows went; `beforeChanges` runs once
 * before the first of them does.
 */
export function removeGrantsWithoutMembership(db: Database.Database, options: { beforeChanges?: () => void } = {}): number {
  const withoutMembership = {
    member_roles: `NOT EXISTS (
      SELECT 1 FROM space_members m WHERE m.space_id = member_roles.space_id AND m.user_id = member_roles.user_id
    )`,
    channel_overrides: `target_type = 'member' AND NOT EXISTS (
      SELECT 1 FROM channels c JOIN space_members m ON m.space_id = c.space_id
      WHERE c.id = channel_overrides.channel_id AND m.user_id = channel_overrides.target_id
    )`,
    category_overrides: `target_type = 'member' AND NOT EXISTS (
      SELECT 1 FROM channel_categories c JOIN space_members m ON m.space_id = c.space_id
      WHERE c.id = category_overrides.category_id AND m.user_id = category_overrides.target_id
    )`,
  } as const;
  const tables = Object.keys(withoutMembership) as Array<keyof typeof withoutMembership>;
  const waiting = tables.reduce((total, table) => total
    + (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${withoutMembership[table]}`).get() as { n: number }).n, 0);
  if (waiting === 0) return 0;

  // Rows go for good: the snapshot a migration takes comes first, as for every pass that rewrites rows.
  options.beforeChanges?.();
  const removed = db.transaction(() => tables.reduce((total, table) => total
    + db.prepare(`DELETE FROM ${table} WHERE ${withoutMembership[table]}`).run().changes, 0))();
  console.log(`[defaults] removed ${removed} role or override row(s) of people who are no longer in the space`);
  return removed;
}

/**
 * One-time, idempotent recovery of 1-on-1 DM threads broken before the DM
 * tombstone fix: those had the deleted partner's dm_members row removed, making
 * the thread UI-unreachable. For each ownerId-NULL channel with exactly one
 * member, re-insert membership for any distinct dm_messages author that is
 * missing from dm_members and still exists in users. Safe to run every boot.
 */
export function backfillOneOnOneDmMembership(db: Database.Database): void {
  const broken = db.prepare(`
    SELECT dc.id AS channelId
    FROM dm_channels dc
    WHERE dc.owner_id IS NULL
      AND (SELECT COUNT(*) FROM dm_members dm WHERE dm.dm_channel_id = dc.id) = 1
  `).all() as { channelId: string }[];
  if (broken.length === 0) return;

  const missingAuthors = db.prepare(`
    SELECT DISTINCT msg.user_id AS userId
    FROM dm_messages msg
    JOIN users u ON u.id = msg.user_id
    WHERE msg.dm_channel_id = ?
      AND msg.user_id NOT IN (SELECT user_id FROM dm_members WHERE dm_channel_id = ?)
  `);

  let restored = 0;
  const run = db.transaction(() => {
    for (const { channelId } of broken) {
      const authors = missingAuthors.all(channelId, channelId) as { userId: string }[];
      for (const { userId } of authors) { insertDmMember(db, channelId, userId); restored++; }
    }
  });
  run();
  if (restored > 0) console.log(`[backfill] restored ${restored} deleted-partner DM membership row(s)`);
}
