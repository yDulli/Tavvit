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

/** The methods that carry a body a handler takes fields from. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A request of those methods whose body is missing, or is the JSON `null`, reads as an empty
 * object. Most handlers take their fields straight out of `request.body`: without this, such a
 * request threw in them and was answered 500, where the handler's own check of its fields
 * answers 400. A body that is a string (a route that checks a signature over the bytes) or a
 * list is left as it came.
 */
export function registerEmptyBodyDefault(app: FastifyInstance): void {
  app.addHook('preValidation', async (request) => {
    if ((request.body === undefined || request.body === null) && BODY_METHODS.has(request.method)) request.body = {};
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
