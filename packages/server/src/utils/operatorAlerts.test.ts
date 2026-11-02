import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let tmpDir: string;

const settings = vi.hoisted(() => ({ diskPercent: 85, intervalHours: 24, disabled: false, dir: '', dbPath: '' }));
const mail = vi.hoisted(() => ({ enabled: true, sent: [] as Array<{ kind: string; to: string; locale: string; params?: Record<string, string> }>, decision: 'ok' }));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../config.js', () => ({
  config: {
    get alerts() { return { diskPercent: settings.diskPercent }; },
    get backup() { return { disabled: settings.disabled, intervalHours: settings.intervalHours, dir: settings.dir, offsiteCmd: null, keepScheduled: 7, keepPreMigration: 5, keepManual: 10, keepConsole: 5, handMaxAgeDays: 90 }; },
    get dbPath() { return settings.dbPath; },
  },
}));

vi.mock('../email/service.js', () => ({
  emailEnabled: () => mail.enabled,
  enqueueEmail: (request: { kind: string; to: string; locale: string; params?: Record<string, string> }) => {
    mail.sent.push(request);
    return mail.decision;
  },
}));

const { activeAlerts, checkOperatorAlerts, clearAlert, raiseAlert, recordServerStart, OFFSITE_STATUS_FILE } = await import('./operatorAlerts.js');

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function snapshot(ageMs: number, reason = 'scheduled'): void {
  const file = path.join(settings.dir, `backspace-${ageMs}-${reason}.db`);
  fs.writeFileSync(file, 'x');
  const at = new Date(NOW - ageMs);
  fs.utimesSync(file, at, at);
}

const causes = (): string[] => activeAlerts().map((alert) => alert.cause).sort();

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of fs.readFileSync(path.join(dir, file), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  testDb = drizzle(sqlite, { schema });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tavvit-alerts-'));
  settings.diskPercent = 100;
  settings.intervalHours = 24;
  settings.disabled = false;
  settings.dir = tmpDir;
  settings.dbPath = path.join(tmpDir, 'db.sqlite');
  mail.enabled = true;
  mail.sent = [];
  mail.decision = 'ok';
  testDb.insert(schema.instanceSettings).values({ id: 1, installedAt: NOW - HOUR, updatedAt: 1 }).run();
  testDb.insert(schema.users).values([
    { id: 'boss', username: 'boss', passwordHash: 'x', isAdmin: 1, email: 'boss@example.org', emailVerifiedAt: 1, locale: 'de', createdAt: 1 },
    { id: 'unconfirmed', username: 'unconfirmed', passwordHash: 'x', isAdmin: 1, email: 'maybe@example.org', createdAt: 1 },
    { id: 'gone', username: 'gone', passwordHash: 'x', isAdmin: 1, isDeleted: 1, email: 'gone@example.org', emailVerifiedAt: 1, createdAt: 1 },
    { id: 'member', username: 'member', passwordHash: 'x', email: 'member@example.org', emailVerifiedAt: 1, createdAt: 1 },
  ]).run();
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('the disk', () => {
  it('warns from the threshold on, and stops when there is room again', () => {
    settings.diskPercent = 1;
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual(['disk_high']);
    expect(Number(activeAlerts()[0]?.detail)).toBeGreaterThan(0);
    settings.diskPercent = 100;
    checkOperatorAlerts(NOW + HOUR);
    expect(causes()).toEqual([]);
  });

  it('says nothing below the threshold', () => {
    settings.diskPercent = 101;
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual([]);
  });
});

describe('backups', () => {
  it('warn when the newest is more than two intervals old', () => {
    settings.diskPercent = 101;
    snapshot(49 * HOUR);
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual(['backup_old']);
    expect(activeAlerts()[0]?.detail).toBe('49');
  });

  it('say nothing while a recent one is there', () => {
    settings.diskPercent = 101;
    snapshot(49 * HOUR);
    snapshot(HOUR);
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual([]);
  });

  it('give a new instance time for its first', () => {
    settings.diskPercent = 101;
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual([]);
  });

  it('warn when an old instance has none', () => {
    settings.diskPercent = 101;
    testDb.update(schema.instanceSettings).set({ installedAt: NOW - 3 * DAY }).run();
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual(['backup_old']);
  });

  it('are not expected where they are switched off', () => {
    settings.diskPercent = 101;
    settings.disabled = true;
    testDb.update(schema.instanceSettings).set({ installedAt: NOW - 30 * DAY }).run();
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual([]);
  });
});

describe('the copy off this machine', () => {
  const said = (status: object) => fs.writeFileSync(path.join(tmpDir, OFFSITE_STATUS_FILE), JSON.stringify(status));

  it('warns when it failed, with what it said', () => {
    settings.diskPercent = 101;
    said({ ok: false, at: NOW, reason: 'rsync: connection refused' });
    checkOperatorAlerts(NOW);
    expect(activeAlerts()).toEqual([expect.objectContaining({ cause: 'offsite_failed', detail: 'rsync: connection refused' })]);
  });

  it('warns when the last good one is days old', () => {
    settings.diskPercent = 101;
    said({ ok: true, at: NOW - 4 * DAY });
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual(['offsite_failed']);
  });

  it('stops when one has worked', () => {
    settings.diskPercent = 101;
    said({ ok: false, at: NOW });
    checkOperatorAlerts(NOW);
    said({ ok: true, at: NOW });
    checkOperatorAlerts(NOW + 5 * 60_000);
    expect(causes()).toEqual([]);
  });

  it('asks nothing of someone who does not use it', () => {
    settings.diskPercent = 101;
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual([]);
  });

  it('takes nonsense in the file for a failure, not for a success', () => {
    settings.diskPercent = 101;
    said({ what: 'ever' });
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual(['offsite_failed']);
  });
});

describe('starting over and over', () => {
  it('is a loop from four starts in fifteen minutes', () => {
    settings.diskPercent = 101;
    for (const minutes of [14, 10, 5]) recordServerStart(NOW - minutes * 60_000);
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual([]);
    recordServerStart(NOW);
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual(['restart_loop']);
  });

  it('is no loop over a day of updates', () => {
    settings.diskPercent = 101;
    for (const hours of [20, 15, 10, 5, 1]) recordServerStart(NOW - hours * HOUR);
    checkOperatorAlerts(NOW);
    expect(causes()).toEqual([]);
  });

  it('keeps only the last few, however long it goes on', () => {
    for (let at = 0; at < 100; at += 1) recordServerStart(NOW + at);
    const stored = JSON.parse(testDb.select().from(schema.instanceSettings).get()?.recentStarts ?? '[]') as number[];
    expect(stored).toHaveLength(20);
  });
});

describe('telling the administrators', () => {
  it('mails those with a confirmed address, in their language, and nobody else', () => {
    raiseAlert('disk_high', '91', NOW);
    expect(mail.sent).toEqual([expect.objectContaining({ kind: 'operator_disk_high', to: 'boss@example.org', locale: 'de', params: { detail: '91' } })]);
  });

  it('mails once a day for a cause that stays', () => {
    raiseAlert('disk_high', '91', NOW);
    raiseAlert('disk_high', '92', NOW + HOUR);
    raiseAlert('disk_high', '93', NOW + 23 * HOUR);
    expect(mail.sent).toHaveLength(1);
    raiseAlert('disk_high', '94', NOW + 25 * HOUR);
    expect(mail.sent).toHaveLength(2);
  });

  it('mails each cause on its own', () => {
    raiseAlert('disk_high', '91', NOW);
    raiseAlert('backup_old', '60', NOW);
    expect(mail.sent.map((sent) => sent.kind).sort()).toEqual(['operator_backup_old', 'operator_disk_high']);
  });

  it('does not start over for something that comes and goes', () => {
    raiseAlert('disk_high', '91', NOW);
    clearAlert('disk_high');
    raiseAlert('disk_high', '91', NOW + HOUR);
    expect(mail.sent).toHaveLength(1);
  });

  it('counts no mail that was not sent, and tries again', () => {
    mail.decision = 'held';
    raiseAlert('disk_high', '91', NOW);
    mail.decision = 'ok';
    raiseAlert('disk_high', '91', NOW + HOUR);
    expect(mail.sent).toHaveLength(2);
  });

  it('still shows in the console where there is no mail', () => {
    mail.enabled = false;
    raiseAlert('disk_high', '91', NOW);
    expect(mail.sent).toEqual([]);
    expect(causes()).toEqual(['disk_high']);
  });

  it('keeps when a problem began while it goes on, and starts anew after it ended', () => {
    raiseAlert('disk_high', '91', NOW);
    raiseAlert('disk_high', '92', NOW + HOUR);
    expect(activeAlerts()[0]?.since).toBe(NOW);
    expect(activeAlerts()[0]?.detail).toBe('92');
    clearAlert('disk_high');
    raiseAlert('disk_high', '91', NOW + 2 * HOUR);
    expect(activeAlerts()[0]?.since).toBe(NOW + 2 * HOUR);
  });

  it('never stops what found out, even when the database is the problem', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    sqlite.exec('DROP TABLE operator_alerts');
    expect(() => raiseAlert('disk_high', '91', NOW)).not.toThrow();
    expect(() => clearAlert('disk_high')).not.toThrow();
    expect(error).toHaveBeenCalled();
    sqlite.exec('CREATE TABLE operator_alerts (cause text primary key, active integer not null default 1, detail text, since integer not null, last_mailed_at integer)');
    error.mockRestore();
  });
});
