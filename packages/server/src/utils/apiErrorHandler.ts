import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { errorBody } from './httpErrors.js';

/**
 * What a client hears when a route throws, and what the log keeps.
 *
 * - **Never the error's own message.** The JSON parser's quotes the body it could not
 *   read ("password":"..."), and a 500's names the code's insides.
 * - **Only server faults reach the log,** by name, code and stack. The message of a 4xx
 *   is what the client sent, and has no business in a log.
 * - **An answer already in the contract passes through:** the rate limiter throws the body
 *   its `errorResponseBuilder` made.
 */
export function apiErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const candidate = error as unknown as { code?: unknown; error?: unknown; statusCode?: unknown };
  if (typeof candidate.statusCode === 'number' && typeof candidate.error === 'string' && typeof candidate.code === 'string') {
    return reply.code(candidate.statusCode).send(error);
  }
  const statusCode = typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
  if (statusCode >= 500) {
    request.log.error({ errorName: error.name, errorCode: error.code, stack: error.stack?.split('\n').slice(1).join('\n') }, 'Unhandled error in a route');
    return reply.code(statusCode).send(errorBody(statusCode, 'internal_error'));
  }
  if (statusCode === 429) return reply.code(429).send(errorBody(429, 'rate_limited'));
  if (statusCode === 404) return reply.code(404).send(errorBody(404, 'not_found'));
  return reply.code(statusCode).send(errorBody(statusCode, 'validation_failed'));
}
