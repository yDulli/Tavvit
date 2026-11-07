import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  isLinkedAccountProvider,
  type LinkedAccountCompleteRequest,
  type LinkedAccountProvider,
  type LinkedAccountsResponse,
  type LinkedAccountStartResponse,
  type LinkedAccountUpdateRequest,
} from '@backspace/shared';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import { availableProviders } from '../utils/linkedAccountProviders.js';
import {
  announceLinkedAccounts,
  linkAccount,
  listLinkedAccounts,
  startLinking,
  takeLinking,
  unlinkAccount,
  updateLinkedAccount,
  type LinkedIdentity,
} from '../utils/linkedAccounts.js';
import { TwitchCodeRefused, TwitchUnavailable, twitchAuthorizeUrl, twitchIdentityOfCode } from '../utils/twitchApi.js';
import { checkTwitchLiveSoon, withdrawTwitchLive } from '../utils/twitchLive.js';

/** What the service hands back on the way back: printable characters, and not many of them. */
const CODE = /^[\x21-\x7e]{1,512}$/;

type ProviderRequest = FastifyRequest<{ Params: { provider: string } }>;

/**
 * Linked accounts (docs/systems/linked-accounts.md): accounts elsewhere a person proves are theirs
 * by signing in there. Only for the person's own account, homed on this instance; not for bots.
 * How a link is made, and why it cannot be made for somebody else, is in utils/linkedAccounts.ts.
 */
export async function linkedAccountRoutes(app: FastifyInstance) {
  const listFor = (userId: string): LinkedAccountsResponse => ({ available: availableProviders(), accounts: listLinkedAccounts(userId) });

  /**
   * The service the path names, for an account homed here; `offered`: one this
   * instance can link now. Sends the refusal and gives null otherwise.
   */
  function providerOf(request: ProviderRequest, reply: FastifyReply, offered: boolean): LinkedAccountProvider | null {
    const { provider } = request.params;
    if (!isLinkedAccountProvider(provider)) {
      sendError(reply, 404, 'linked_account_not_found');
      return null;
    }
    if (offered && !availableProviders().includes(provider)) {
      sendError(reply, 503, 'linked_account_unavailable');
      return null;
    }
    const row = getDb().select({ homeInstance: schema.users.homeInstance }).from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!row) {
      sendError(reply, 404, 'user_not_found');
      return null;
    }
    // A copy of an account homed elsewhere links at its home.
    if (row.homeInstance) {
      sendError(reply, 403, 'linked_account_home_only');
      return null;
    }
    return provider;
  }

  /** Who signed in at the service, from the code it gave. Sends the refusal and gives null when that cannot be known. */
  async function identityOf(provider: LinkedAccountProvider, code: string, request: FastifyRequest, reply: FastifyReply): Promise<LinkedIdentity | null> {
    try {
      switch (provider) {
        case 'twitch': return await twitchIdentityOfCode(code);
      }
    } catch (error) {
      if (error instanceof TwitchCodeRefused) {
        // Twitch's words for the operator; never the code.
        request.log.warn({ twitch: error.twitchMessage }, 'Twitch refused a linking code');
        sendError(reply, 400, 'linked_account_expired');
        return null;
      }
      if (error instanceof TwitchUnavailable) {
        request.log.warn({ reason: error.reason }, 'Twitch did not answer while linking');
        sendError(reply, 502, 'linked_account_failed');
        return null;
      }
      throw error;
    }
  }

  // GET /api/users/@me/linked-accounts - What this server can link, and what the person linked
  app.get('/api/users/@me/linked-accounts', { preHandler: authenticate }, async (request, reply) => {
    return reply.code(200).send(listFor(request.userId));
  });

  // POST /api/users/@me/linked-accounts/:provider/start - Where to sign in at the service
  app.post<{ Params: { provider: string } }>('/api/users/@me/linked-accounts/:provider/start', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const provider = providerOf(request, reply, true);
    if (!provider) return reply;
    const state = startLinking(request.userId, provider);
    let url: string;
    switch (provider) {
      case 'twitch': url = twitchAuthorizeUrl(state); break;
    }
    const answer: LinkedAccountStartResponse = { url };
    return reply.code(200).send(answer);
  });

  // POST /api/users/@me/linked-accounts/:provider - Complete a link with what the service handed back
  app.post<{ Params: { provider: string }; Body: Partial<LinkedAccountCompleteRequest> | undefined }>('/api/users/@me/linked-accounts/:provider', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const provider = providerOf(request, reply, true);
    if (!provider) return reply;
    const code = request.body?.code;
    if (typeof code !== 'string' || !CODE.test(code)) return sendError(reply, 400, 'validation_failed', { field: 'code' });
    const userId = request.userId;

    // Only a state this account started: see utils/linkedAccounts.ts on why.
    const check = takeLinking(request.body?.state, userId, provider);
    if (check === 'expired') return sendError(reply, 400, 'linked_account_expired');
    if (check === 'other_account') return sendError(reply, 403, 'linked_account_other_account');

    const identity = await identityOf(provider, code, request, reply);
    if (!identity) return reply;
    if (linkAccount(userId, provider, identity) === 'taken') return sendError(reply, 409, 'linked_account_taken');
    announceLinkedAccounts(userId);
    // Linked while live: shown within seconds rather than at the next round.
    if (provider === 'twitch') checkTwitchLiveSoon();
    return reply.code(200).send(listFor(userId));
  });

  // PATCH /api/users/@me/linked-accounts/:provider - What a linked account shows
  app.patch<{ Params: { provider: string }; Body: LinkedAccountUpdateRequest | undefined }>('/api/users/@me/linked-accounts/:provider', {
    preHandler: authenticate,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const provider = providerOf(request, reply, false);
    if (!provider) return reply;
    const { showOnProfile, showLive } = request.body ?? {};
    if (showOnProfile !== undefined && typeof showOnProfile !== 'boolean') return sendError(reply, 400, 'validation_failed', { field: 'showOnProfile' });
    if (showLive !== undefined && typeof showLive !== 'boolean') return sendError(reply, 400, 'validation_failed', { field: 'showLive' });
    if (showOnProfile === undefined && showLive === undefined) return sendError(reply, 400, 'no_fields_to_update');
    const userId = request.userId;
    if (!updateLinkedAccount(userId, provider, { showOnProfile, showLive })) return sendError(reply, 404, 'linked_account_not_found');
    if (provider === 'twitch') {
      if (showLive === false) withdrawTwitchLive(userId);
      if (showLive === true) checkTwitchLiveSoon();
    }
    announceLinkedAccounts(userId);
    return reply.code(200).send(listFor(userId));
  });

  // DELETE /api/users/@me/linked-accounts/:provider - Unlink
  app.delete<{ Params: { provider: string } }>('/api/users/@me/linked-accounts/:provider', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const provider = providerOf(request, reply, false);
    if (!provider) return reply;
    const userId = request.userId;
    if (!unlinkAccount(userId, provider)) return sendError(reply, 404, 'linked_account_not_found');
    if (provider === 'twitch') withdrawTwitchLive(userId);
    announceLinkedAccounts(userId);
    return reply.code(200).send(listFor(userId));
  });
}
