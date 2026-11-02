import type { FastifyInstance } from 'fastify';
import { isTranslationTarget } from '@backspace/shared/src/translation.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { TranslationFailed, translateContent, translationAvailable } from '../utils/translation.js';
import { visibleChannelMessage, visibleDmMessage } from './saved.js';

/**
 * A message in another language, on request. It takes a message and not a text, so nobody can
 * use this server as a free translator: whoever asks must be able to read what they ask about.
 * Not for bots: a program can translate what it reads itself, with its own account at a provider.
 */
export async function translationRoutes(app: FastifyInstance) {
  // POST /api/messages/:id/translate - This message in this language
  app.post<{ Params: { id: string }; Body: { target?: unknown } }>('/api/messages/:id/translate', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const target = request.body?.target;
    if (!isTranslationTarget(target)) return sendError(reply, 400, 'validation_failed', { field: 'target' });
    if (!translationAvailable()) return sendError(reply, 503, 'translation_unavailable');

    const { id } = request.params;
    const { userId } = request;
    // One who may not read it hears what one who asks about nothing hears.
    const message = visibleChannelMessage(userId, id)?.row ?? visibleDmMessage(userId, id);
    if (!message) return sendError(reply, 404, 'message_not_found');
    if (message.type !== 'user' || !message.content) return sendError(reply, 400, 'validation_failed', { field: 'content' });

    try {
      const outcome = await translateContent(userId, id, message.content, target);
      if (!outcome.ok) return sendError(reply, 429, outcome.code);
      return reply.code(200).send(outcome.answer);
    } catch (error) {
      if (!(error instanceof TranslationFailed)) throw error;
      // The status alone: the words a person asked about stay out of the log.
      request.log.warn({ providerStatus: error.providerStatus }, 'translation provider failed');
      return sendError(reply, 502, 'translation_failed');
    }
  });
}
