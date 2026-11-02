import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { peerNamedByHeaders } from '../routes/federation/handlers/s2sAuth.js';
import { authenticate } from './auth.js';
import { sendError } from './httpErrors.js';

/**
 * The most a request may make this server read before it has shown who sent it
 * (docs/systems/api.md, "Body size"). Fastify reads and parses a body before any preHandler
 * runs, and `authenticate` is one, so a stranger could otherwise make the server take in a
 * route's whole bodyLimit before being refused: a megabyte on most routes, several on those that
 * take a picture as base64, 10 MiB for federation; and slowly, over many connections at once.
 * No public route needs more: the largest public body, a report, is 64 KiB.
 */
export const ANONYMOUS_BODY_LIMIT = 64 * 1024;

const FEDERATION_ROUTES = '/api/federation/';

/** How a body could pass the limit: a stated length above it, or no stated length at all. */
function beyondAnonymousLimit(request: FastifyRequest): 'length' | 'unknown' | null {
  if (request.headers['transfer-encoding'] !== undefined) return 'unknown';
  const length = Number(request.headers['content-length']);
  return Number.isFinite(length) && length > ANONYMOUS_BODY_LIMIT ? 'length' : null;
}

/**
 * Before more than ANONYMOUS_BODY_LIMIT bytes are read, the sender shows who it is: a peer by
 * federation headers naming one this instance knows (its signature covers the body and is checked
 * after the reading, as before), anyone else by the credential `authenticate` checks, which the
 * route checks again. A route whose own limit is no larger is left alone, and so is every request
 * that states a length within it.
 */
export function registerBodyGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.routeOptions.bodyLimit <= ANONYMOUS_BODY_LIMIT) return;
    const beyond = beyondAnonymousLimit(request);
    if (beyond === null) return;
    if (request.routeOptions.url?.startsWith(FEDERATION_ROUTES)) {
      if (!peerNamedByHeaders(request)) return sendError(reply, 401, 'unauthorized');
      return;
    }
    if (request.headers.authorization === undefined) {
      return sendError(reply, beyond === 'unknown' ? 411 : 413, 'validation_failed');
    }
    await authenticate(request, reply);
    if (reply.sent) return reply;
  });
}
