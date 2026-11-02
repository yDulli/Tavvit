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

/**
 * A JSON body as it came, as a string, for a route that checks a signature over the exact bytes.
 * Fastify 5 refuses to add a JSON parser where the inherited one is not its default, and the
 * root's is the one above, so the inherited one goes first. Call it only inside `app.register`:
 * the removal, and this parser, stay in that scope.
 */
export function registerRawJsonBodyParser(scope: FastifyInstance, bodyLimit: number): void {
  scope.removeContentTypeParser('application/json');
  scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit }, (_request, body, done) => {
    done(null, body);
  });
}
