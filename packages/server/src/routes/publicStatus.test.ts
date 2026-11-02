import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;

const facts = vi.hoisted(() => ({ voice: false, voiceWorks: true, asked: 0, mail: 'off', diskFull: false }));

vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

vi.mock('../config.js', async () => {
  const real = await import('../config.js');
  return {
    config: new Proxy(real.config, {
      get(target, prop: string) {
        if (prop === 'livekit') return facts.voice ? { apiUrl: 'http://lk:7880', url: null, apiKey: 'k', apiSecret: 's' } : { apiUrl: null, url: null, apiKey: null, apiSecret: null };
        return (target as Record<string, unknown>)[prop];
      },
    }),
  };
});

vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    async listRooms() {
      facts.asked += 1;
      if (!facts.voiceWorks) throw new Error('unreachable');
      return [{ name: 'a-room-nobody-should-hear-about', numParticipants: 3 }];
    }
  },
}));

vi.mock('../email/service.js', () => ({ emailState: () => facts.mail }));
vi.mock('../utils/accountLimits.js', () => ({ diskIsNearlyFull: () => facts.diskFull }));

let publicStatusRoutes: (app: FastifyInstance) => Promise<void>;

beforeAll(async () => {
  ({ publicStatusRoutes } = await import('./publicStatus.js'));
}, 120_000);

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of fs.readFileSync(path.join(dir, file), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  testDb = drizzle(sqlite, { schema });
  Object.assign(facts, { voice: false, voiceWorks: true, asked: 0, mail: 'off', diskFull: false });
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  app = Fastify();
  await app.register(publicStatusRoutes);
  await app.ready();
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  sqlite.close();
});

const status = async () => {
  const res = await app.inject({ method: 'GET', url: '/api/status' });
  expect(res.statusCode).toBe(200);
  return res;
};

function note(id: string, fields: Partial<typeof schema.announcements.$inferInsert>): void {
  testDb.insert(schema.announcements).values({ id, tone: 'warning', body: `Note ${id}`, createdBy: 'boss', createdAt: NOW - 1000, onStatusPage: 1, ...fields }).run();
}

describe('the status of the services', () => {
  it('answers anyone, with no sign-in', async () => {
    const res = await status();
    expect(res.json().services.chat).toBe('ok');
  });

  it('says what is off where it is not set up', async () => {
    const { services } = (await status()).json();
    expect(services).toEqual({ chat: 'ok', uploads: 'ok', voice: 'off', mail: 'off' });
  });

  it('says voice is down when LiveKit does not answer', async () => {
    facts.voice = true;
    facts.voiceWorks = false;
    expect((await status()).json().services.voice).toBe('down');
  });

  it('says voice runs when it answers, and nothing about its rooms', async () => {
    facts.voice = true;
    const res = await status();
    expect(res.json().services.voice).toBe('ok');
    expect(res.body).not.toContain('a-room-nobody-should-hear-about');
    expect(res.body).not.toContain('numParticipants');
  });

  it('says uploads are down when the disk is nearly full', async () => {
    facts.diskFull = true;
    expect((await status()).json().services.uploads).toBe('down');
  });

  it('says mail is down when held back, without saying why', async () => {
    facts.mail = 'blocked';
    const res = await status();
    expect(res.json().services.mail).toBe('down');
    expect(res.body).not.toContain('blocked');
  });

  it('gives away no number, version or address', async () => {
    facts.voice = true;
    const res = await status();
    expect(Object.keys(res.json()).sort()).toEqual(['checkedAt', 'notes', 'services']);
    expect(Object.keys(res.json().services).sort()).toEqual(['chat', 'mail', 'uploads', 'voice']);
    expect(res.body).not.toContain('http://lk:7880');
  });

  it('asks LiveKit once in a while, however many ask here', async () => {
    facts.voice = true;
    await Promise.all(Array.from({ length: 10 }, () => status()));
    await status();
    expect(facts.asked).toBe(1);
    vi.setSystemTime(NOW + 31_000);
    await status();
    expect(facts.asked).toBe(2);
  });
});

describe('notes from the operator', () => {
  it('shows only what was marked for this page', async () => {
    note('1', { onStatusPage: 0, body: 'For members only' });
    note('2', { body: 'We are looking into it' });
    const res = await status();
    expect(res.json().notes.map((n: { id: string }) => n.id)).toEqual(['2']);
    expect(res.body).not.toContain('For members only');
  });

  it('says one is still going on, and when one ended', async () => {
    note('1', {});
    note('2', { endedAt: NOW - DAY });
    note('3', { endsAt: NOW - DAY });
    const notes = (await status()).json().notes as Array<{ id: string; endedAt: number | null }>;
    expect(notes.find((n) => n.id === '1')?.endedAt).toBeNull();
    expect(notes.find((n) => n.id === '2')?.endedAt).toBe(NOW - DAY);
    expect(notes.find((n) => n.id === '3')?.endedAt).toBe(NOW - DAY);
  });

  it('leaves out what ended more than a week ago', async () => {
    note('1', { endedAt: NOW - 8 * DAY });
    note('2', { endsAt: NOW - 8 * DAY });
    expect((await status()).json().notes).toEqual([]);
  });

  it('does not say who wrote it', async () => {
    note('1', {});
    const res = await status();
    expect(res.body).not.toContain('boss');
  });
});
