import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Fastify, { type FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSLATION_LIMITS } from '@backspace/shared/src/translation.js';
import * as schema from '../db/schema.js';
import { PermissionBits, permissionsToString } from '../utils/permissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

const provider = vi.hoisted(() => ({
  value: { provider: 'none', deeplApiKey: '', libreUrl: '', libreApiKey: '' } as {
    provider: string; deeplApiKey: string; libreUrl: string; libreApiKey: string;
  },
}));

vi.mock('../config.js', async (original) => {
  const actual = await original<typeof import('../config.js')>();
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get: (target, key) => (key === 'translation' ? provider.value : Reflect.get(target, key)),
    }),
  };
});

import { signJwt } from '../utils/auth.js';
import { __resetTranslationForTests } from '../utils/translation.js';
import { translationRoutes } from './translation.js';

const SPACE = 'space-1';
const GENERAL = 'general';
const SECRET = 'secret';
const DM = 'dm-1';
const OWNER = '1001';
const MEMBER = '1002';
const STRANGER = '1003';
const NOW = 1_700_000_000_000;

const headers = (userId: string) => ({ authorization: `Bearer ${signJwt({ userId, username: `user${userId}` })}` });

let app: FastifyInstance;
const fetchMock = vi.fn<typeof fetch>();

function message(id: string, channelId: string, content: string, type: 'user' | 'system' = 'user') {
  testDb.insert(schema.messages).values({ id, channelId, userId: OWNER, content, type, createdAt: NOW }).run();
}

const ask = (userId: string, id: string, target: unknown = 'de') => app.inject({
  method: 'POST', url: `/api/messages/${id}/translate`, headers: headers(userId), payload: { target },
});

const deeplAnswers = (language: string, ...texts: string[]) => new Response(JSON.stringify({
  translations: texts.map((text) => ({ detected_source_language: language, text })),
}), { status: 200 });

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  testDb = drizzle(sqlite, { schema });
  migrate(testDb, { migrationsFolder: path.join(here, '../../drizzle') });
  __resetTranslationForTests();
  provider.value = { provider: 'deepl', deeplApiKey: 'key:fx', libreUrl: '', libreApiKey: '' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);

  for (const id of [OWNER, MEMBER, STRANGER]) {
    testDb.insert(schema.users).values({ id, username: `user${id}`, displayName: `User ${id}`, passwordHash: 'x', createdAt: NOW }).run();
  }
  testDb.insert(schema.spaces).values({ id: SPACE, name: 'Space', ownerId: OWNER, createdAt: NOW }).run();
  testDb.insert(schema.roles).values({
    id: SPACE, spaceId: SPACE, name: '@everyone', position: 0,
    permissions: permissionsToString(PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY),
    createdAt: NOW,
  }).run();
  for (const id of [OWNER, MEMBER]) testDb.insert(schema.spaceMembers).values({ spaceId: SPACE, userId: id, joinedAt: NOW }).run();
  for (const id of [GENERAL, SECRET]) testDb.insert(schema.channels).values({ id, spaceId: SPACE, name: id, type: 'text', createdAt: NOW }).run();
  testDb.insert(schema.channelOverrides).values({
    channelId: SECRET, targetType: 'role', targetId: SPACE, allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL),
  }).run();
  testDb.insert(schema.dmChannels).values({ id: DM, createdAt: NOW }).run();
  testDb.insert(schema.dmMembers).values({ dmChannelId: DM, userId: OWNER }).run();
  testDb.insert(schema.dmMembers).values({ dmChannelId: DM, userId: MEMBER }).run();

  message('m1', GENERAL, 'Hello <@1002>, look at https://example.com now');
  message('m2', SECRET, 'hidden');
  testDb.insert(schema.dmMessages).values({ id: 'm3', dmChannelId: DM, userId: OWNER, content: 'between two', createdAt: NOW }).run();
  message('m4', GENERAL, 'someone joined', 'system');
  message('m5', GENERAL, '123 🎉');

  app = Fastify();
  await app.register(translationRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('translating a message', () => {
  it('sends the words alone, and puts them back round what stays', async () => {
    fetchMock.mockResolvedValueOnce(deeplAnswers('EN', 'Hallo', ', schau dir an', 'jetzt'));
    const res = await ask(MEMBER, 'm1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      text: 'Hallo <@1002>, schau dir an https://example.com jetzt',
      sourceLanguage: 'en',
      targetLanguage: 'de',
      sameLanguage: false,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api-free.deepl.com/v2/translate');
    expect((init?.headers as Record<string, string>).authorization).toBe('DeepL-Auth-Key key:fx');
    const body = JSON.parse(String(init?.body)) as { text: string[]; target_lang: string };
    expect(body.text).toEqual(['Hello', ', look at', 'now']);
    expect(body.target_lang).toBe('DE');
    expect(String(init?.body)).not.toContain('1002');
    expect(String(init?.body)).not.toContain('example.com');
  });

  it('names the regions DeepL wants, and uses the paid address for a paid key', async () => {
    provider.value = { ...provider.value, deeplApiKey: 'paid' };
    fetchMock.mockImplementation(async () => deeplAnswers('DE', 'a', 'b', 'c'));
    await ask(MEMBER, 'm1', 'en');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.deepl.com/v2/translate');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).target_lang).toBe('EN-US');
    await ask(MEMBER, 'm1', 'pt');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).target_lang).toBe('PT-BR');
    await ask(MEMBER, 'm1', 'zh');
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).target_lang).toBe('ZH-HANS');
  });

  it('works with LibreTranslate at the address the operator gave', async () => {
    provider.value = { provider: 'libretranslate', deeplApiKey: '', libreUrl: 'http://libre:5000/', libreApiKey: 'k' };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      translatedText: ['Hallo', ', schau', 'jetzt'],
      detectedLanguage: [{ language: 'en', confidence: 90 }, { language: 'en', confidence: 90 }, { language: 'en', confidence: 90 }],
    }), { status: 200 }));
    const res = await ask(MEMBER, 'm1');
    expect(res.json().text).toBe('Hallo <@1002>, schau https://example.com jetzt');
    expect(res.json().sourceLanguage).toBe('en');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://libre:5000/translate');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ source: 'auto', target: 'de', format: 'text', api_key: 'k' });
  });

  it('says so when the message is in that language already', async () => {
    fetchMock.mockResolvedValueOnce(deeplAnswers('DE', 'x', 'y', 'z'));
    const res = await ask(MEMBER, 'm1');
    expect(res.json()).toMatchObject({ sameLanguage: true, text: 'Hello <@1002>, look at https://example.com now' });
  });

  it('asks nobody when there are no words', async () => {
    const res = await ask(MEMBER, 'm5');
    expect(res.json()).toMatchObject({ sameLanguage: true, sourceLanguage: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks once for a message many people read, and again after an edit', async () => {
    fetchMock.mockImplementation(async () => deeplAnswers('EN', 'a', 'b', 'c'));
    await ask(MEMBER, 'm1');
    await ask(OWNER, 'm1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await ask(OWNER, 'm1', 'fr');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    testDb.update(schema.messages).set({ content: 'Other <@1002> words, https://example.com too' }).run();
    await ask(MEMBER, 'm1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('who may', () => {
  it('needs an account', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/messages/m1/translate', payload: { target: 'de' } });
    expect(res.statusCode).toBe(401);
  });

  it('is for who can read the message, and does not even say to others that it exists', async () => {
    for (const [who, id] of [[STRANGER, 'm1'], [MEMBER, 'm2'], [STRANGER, 'm3']] as const) {
      const res = await ask(who, id);
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('message_not_found');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(deeplAnswers('EN', 'zwischen zweien'));
    expect((await ask(MEMBER, 'm3')).statusCode).toBe(200);
  });

  it('takes a language from the list, and a message that exists', async () => {
    expect((await ask(MEMBER, 'm1', 'xx')).json().code).toBe('validation_failed');
    expect((await ask(MEMBER, 'm1', { evil: true })).json().code).toBe('validation_failed');
    expect((await ask(MEMBER, 'nope')).json().code).toBe('message_not_found');
    expect((await ask(MEMBER, 'm4')).json().code).toBe('validation_failed');
  });

  it('takes no text of its own and no address, so it translates nothing else', async () => {
    fetchMock.mockImplementation(async () => deeplAnswers('EN', 'a', 'b', 'c'));
    await app.inject({
      method: 'POST', url: '/api/messages/m1/translate', headers: headers(MEMBER),
      payload: { target: 'de', text: 'translate this instead', url: 'http://169.254.169.254/' },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api-free.deepl.com/v2/translate');
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain('translate this instead');
  });
});

describe('when it cannot', () => {
  it('answers that no translator is set up, and calls nobody', async () => {
    provider.value = { provider: 'none', deeplApiKey: '', libreUrl: '', libreApiKey: '' };
    const res = await ask(MEMBER, 'm1');
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('translation_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers that the translator failed, whatever it said', async () => {
    fetchMock.mockResolvedValueOnce(new Response('quota', { status: 456 }));
    expect((await ask(MEMBER, 'm1')).json().code).toBe('translation_failed');
    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect((await ask(MEMBER, 'm1')).json().code).toBe('translation_failed');
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect((await ask(MEMBER, 'm1')).json().code).toBe('translation_failed');
    fetchMock.mockResolvedValueOnce(deeplAnswers('EN', 'too few'));
    expect((await ask(MEMBER, 'm1')).json().code).toBe('translation_failed');
  });

  it('stops a person at the day\'s limit, and only that person, until the next day', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    fetchMock.mockImplementation(async (_url, init) => {
      const { text } = JSON.parse(String(init?.body)) as { text: string[] };
      return deeplAnswers('EN', ...text.map(() => 'x'));
    });
    const long = 'a'.repeat(TRANSLATION_LIMITS.CHARS_PER_DAY - 10);
    message('long', GENERAL, long);
    message('next', GENERAL, 'more than ten characters here');
    expect((await ask(MEMBER, 'long')).statusCode).toBe(200);
    const stopped = await ask(MEMBER, 'next');
    expect(stopped.statusCode).toBe(429);
    expect(stopped.json().code).toBe('translation_limit_reached');
    expect((await ask(OWNER, 'next')).statusCode).toBe(200);
    // What was translated before costs nothing.
    expect((await ask(MEMBER, 'next')).statusCode).toBe(200);
    vi.setSystemTime(NOW + 86_400_000);
    message('later', GENERAL, 'another day and some more');
    expect((await ask(MEMBER, 'later')).statusCode).toBe(200);
  });
});
