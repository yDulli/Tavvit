import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: new Proxy({}, {
    get: (_target, name) => () => {
      if (name === 'getUserSpaceEntries' || name === 'getAllOnlineUserIds') return [];
      if (name === 'getRoomParticipants' || name === 'getUserSpaces') return new Set();
      return undefined;
    },
  }),
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) db.exec(statement);
    }
  }
}

let legalRoutes: (app: FastifyInstance) => Promise<void>;

beforeAll(async () => {
  ({ legalRoutes } = await import('./legal.js'));
}, 120_000);

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });
  app = Fastify();
  await app.register(legalRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

function operatorIs(fields: Record<string, unknown>): void {
  testDb.insert(schema.instanceSettings).values({ id: 1, legalOperator: JSON.stringify(fields), updatedAt: 1 }).run();
}

const OPERATOR = { kind: 'person', name: 'A. Operator', address: 'Somewhere 1\n12345 Town', email: 'security@example.org', minimumAge: 16 };

describe('/.well-known/security.txt', () => {
  it('is not there while nobody has said who runs the instance', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/security.txt' });
    expect(res.statusCode).toBe(404);
  });

  it('names the operator\'s address, to anyone, as plain text', async () => {
    operatorIs(OPERATOR);
    const res = await app.inject({ method: 'GET', url: '/.well-known/security.txt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('Contact: mailto:security@example.org\n');
    expect(res.body).toMatch(/^Canonical: https?:\/\/\S+\/\.well-known\/security\.txt$/m);
    expect(res.body).toMatch(/^Policy: https?:\/\/\S+\/developers\/docs\/security$/m);
  });

  it('expires ahead of today, by no more than the year the standard asks', async () => {
    operatorIs(OPERATOR);
    const res = await app.inject({ method: 'GET', url: '/.well-known/security.txt' });
    const expires = Date.parse(/^Expires: (.+)$/m.exec(res.body)?.[1] ?? '');
    const year = 366 * 24 * 60 * 60 * 1000;
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires).toBeLessThan(Date.now() + year);
  });

  it('gives nothing else of who runs it', async () => {
    operatorIs(OPERATOR);
    const res = await app.inject({ method: 'GET', url: '/.well-known/security.txt' });
    expect(res.body).not.toContain('Somewhere');
    expect(res.body).not.toContain('A. Operator');
  });

  it('is not there when what is stored does not hold up', async () => {
    operatorIs({ ...OPERATOR, email: 'not an address\nInjected: yes' });
    const res = await app.inject({ method: 'GET', url: '/.well-known/security.txt' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('Injected');
  });
});
