import type { FastifyInstance } from 'fastify';
import { eq, or, sql } from 'drizzle-orm';
import { cleanKeyword, KEYWORD_LIMITS, matchesKeyword } from '@backspace/shared/src/notificationRules.js';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { MENTIONS_PAGE_DEFAULT, MENTIONS_PAGE_MAX, readerMessagesPage } from './inbox.js';

export function keywordsOf(userId: string): string[] {
  return getDb().select({ word: schema.notificationKeywords.word }).from(schema.notificationKeywords)
    .where(eq(schema.notificationKeywords.userId, userId)).orderBy(sql`rowid`).all().map((row) => row.word);
}

const likePattern = (word: string): string => `%${word.replace(/[\\%_]/g, '\\$&')}%`;

export async function keywordRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/users/@me/keywords - The words that alert this person
  app.get('/api/users/@me/keywords', { preHandler: authenticate }, async (request, reply) => {
    return reply.code(200).send({ keywords: keywordsOf(request.userId) });
  });

  // PUT /api/users/@me/keywords - All of them
  app.put<{ Body: { keywords?: unknown } }>('/api/users/@me/keywords', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const asked = request.body?.keywords;
    if (!Array.isArray(asked)) return sendError(reply, 400, 'validation_failed', { field: 'keywords' });
    const words: string[] = [];
    for (const item of asked) {
      const word = cleanKeyword(item);
      if (!word) return sendError(reply, 400, 'validation_failed', { field: 'keywords' });
      if (!words.includes(word)) words.push(word);
    }
    if (words.length > KEYWORD_LIMITS.MAX) return sendError(reply, 400, 'keyword_limit_reached', { max: KEYWORD_LIMITS.MAX });
    const now = Date.now();
    getDb().transaction((tx) => {
      tx.delete(schema.notificationKeywords).where(eq(schema.notificationKeywords.userId, request.userId)).run();
      for (const word of words) {
        tx.insert(schema.notificationKeywords).values({ userId: request.userId, word, createdAt: now }).run();
      }
    });
    return reply.code(200).send({ keywords: words });
  });

  // GET /api/users/@me/keyword-matches - Messages in this instance's spaces that hold one of the words, newest first
  app.get<{ Querystring: { before?: string; limit?: string } }>('/api/users/@me/keyword-matches', {
    preHandler: authenticate,
    // Each page reads through the histories of every space the person is in.
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { before } = request.query;
    if (before !== undefined && !/^\d{1,20}$/.test(before)) return sendError(reply, 400, 'validation_failed');
    const requested = request.query.limit === undefined ? MENTIONS_PAGE_DEFAULT : Number(request.query.limit);
    if (!Number.isInteger(requested) || requested < 1) return sendError(reply, 400, 'validation_failed');
    const words = keywordsOf(request.userId);
    if (words.length === 0) return reply.code(200).send({ mentions: [], nextBefore: null });
    // A cheap text prefilter, as the channel search reads text; the shared rule decides.
    const textMatch = or(...words.map((word) => sql`${schema.messages.content} LIKE ${likePattern(word)} ESCAPE '\\'`));
    const page = readerMessagesPage(request.userId, before, Math.min(requested, MENTIONS_PAGE_MAX), textMatch, (content) => (
      matchesKeyword(content, words) ? 'keyword' : null
    ));
    return reply.code(200).send(page);
  });
}
