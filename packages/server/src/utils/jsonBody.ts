import type { FastifyInstance } from 'fastify';

/**
 * The JSON body parser. A request that says it carries JSON and carries nothing (a DELETE from a
 * program that sends the header on every call) is a request without a body, as it was before
 * Fastify 5, which refuses it. The documented routes change only by adding to them
 * (docs/systems/developers.md), so a bot that worked keeps working. Anything with content goes
 * through Fastify's own parser, with its guard against `__proto__` and `constructor` keys.
 */
export function registerJsonBodyParser(app: FastifyInstance): void {
  const jsonParser = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') {
      done(null, undefined);
      return;
    }
    jsonParser(request, text, done);
  });
}
