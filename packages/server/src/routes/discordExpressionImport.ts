import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { CUSTOM_EMOJI_LIMITS } from '@backspace/shared/src/customEmoji.js';
import {
  DISCORD_EXPRESSION_LIMITS,
  DISCORD_SNOWFLAKE,
  discordAssetUrl,
  discordExpressionKey,
  planDiscordExpressionImport,
  type DiscordExpressionApplyRequest,
  type DiscordExpressionApplyResult,
  type DiscordExpressionItem,
  type DiscordExpressionListing,
  type DiscordExpressionOutcome,
  type DiscordExpressionPreview,
  type DiscordExpressionPreviewRequest,
  type DiscordExpressionResult,
} from '@backspace/shared/src/discordExpressionImport.js';
import type { ErrorCode } from '@backspace/shared/src/errors.js';
import { SPACE_EXPRESSION_LIMITS } from '@backspace/shared/src/spaceExpressions.js';
import { MAX_STICKER_BYTES } from '@backspace/shared/src/stickers.js';
import { getDb, schema } from '../db/index.js';
import { recordAudit } from '../utils/auditLog.js';
import { authenticate } from '../utils/auth.js';
import { ASSET_TIMEOUT_MS, fetchDiscordAsset, listGuildExpressions, parseBotToken } from '../utils/discordApi.js';
import {
  accountHasRunningImport,
  closeDiscordSession,
  createDiscordSession,
  discordSessionExpiry,
  discordSessionFor,
  discordSessionRoom,
  endDiscordSession,
  setDiscordSessionEndHandler,
  type DiscordExpressionSession,
} from '../utils/discordExpressionSessions.js';
import { createFixedWindowLimit } from '../utils/fixedWindowLimit.js';
import { sendError } from '../utils/httpErrors.js';
import {
  addSpaceEmoji,
  addSpaceSticker,
  expressionManagerRefusal,
  importedDiscordIds,
  listSpaceEmojis,
  listSpaceStickers,
  spaceEmojiCount,
  spaceStickerCount,
} from '../utils/spaceExpressions.js';
import { connectionManager } from '../ws/handler.js';

/**
 * Bringing a Discord server's emoji and stickers into a space (docs/systems/spaces.md, "Importing
 * emoji and stickers from Discord").
 *
 * The look-up takes the token of the person's own bot and the server's id, asks Discord for the two
 * lists and keeps only the listing (utils/discordExpressionSessions.ts); the token is a local of
 * that one request and nothing writes it anywhere. The import then runs in batches the client asks
 * for one after another, and plans again against the space before every picture, so names stay
 * free and room is counted as it is now. Pictures come from Discord's content servers with no
 * token (utils/discordApi.ts) and go through the same add as an upload (utils/spaceExpressions.ts):
 * re-encoded, counted on the importer's storage, checked against the space's room and the
 * importer's right right before their row goes in.
 *
 * A batch aims to answer well inside the client's request time, but a busy machine can make one
 * slower. The client then asks again; every answer carries what was settled after the cursor it
 * sends, and an import that is over keeps its outcome a few minutes, so nothing settled is ever
 * missing from the report.
 */

const previewLimit = createFixedWindowLimit({
  max: DISCORD_EXPRESSION_LIMITS.PREVIEWS_PER_WINDOW,
  windowMs: DISCORD_EXPRESSION_LIMITS.PREVIEW_WINDOW_MS,
});

/** Tests only: forget every account's look-ups. */
export function _resetDiscordExpressionPreviewLimit(): void {
  previewLimit.reset();
}

function spaceExists(spaceId: string): boolean {
  return getDb().select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get() !== undefined;
}

/** Sends the refusal and answers true unless `userId` may bring emoji and stickers into the space now (expressionManagerRefusal). */
function refusedImporter(reply: FastifyReply, spaceId: string, userId: string): boolean {
  const refusal = expressionManagerRefusal(spaceId, userId);
  if (!refusal) return false;
  sendError(reply, refusal.status, refusal.code, refusal.details);
  return true;
}

/** The space's room for emoji and stickers now. */
function roomOf(spaceId: string): { emoji: number; stickers: number } {
  return {
    emoji: Math.max(0, SPACE_EXPRESSION_LIMITS.EMOJI_PER_SPACE - spaceEmojiCount(spaceId)),
    stickers: Math.max(0, SPACE_EXPRESSION_LIMITS.STICKERS_PER_SPACE - spaceStickerCount(spaceId)),
  };
}

/** The plan for `listing` against what the space holds now. */
function planAgainstSpace(listing: DiscordExpressionListing, spaceId: string, selection: ReadonlySet<string> | null): DiscordExpressionItem[] {
  const room = roomOf(spaceId);
  return planDiscordExpressionImport(listing, {
    emojiNames: listSpaceEmojis(spaceId).map((row) => row.name),
    stickerNames: listSpaceStickers(spaceId).map((row) => row.name),
    importedDiscordIds: importedDiscordIds(spaceId),
    emojiRoom: room.emoji,
    stickerRoom: room.stickers,
    selection,
  });
}

/** The entries of the listing that are not settled yet. */
function unsettledListing(session: DiscordExpressionSession): DiscordExpressionListing {
  return {
    emojis: session.listing.emojis.filter((entry) => !session.settled.has(discordExpressionKey('emoji', entry.discordId))),
    stickers: session.listing.stickers.filter((entry) => !session.settled.has(discordExpressionKey('sticker', entry.discordId))),
  };
}

function listingKeys(listing: DiscordExpressionListing): Set<string> {
  return new Set([
    ...listing.emojis.map((entry) => discordExpressionKey('emoji', entry.discordId)),
    ...listing.stickers.map((entry) => discordExpressionKey('sticker', entry.discordId)),
  ]);
}

/**
 * The space's audit entry for an import, once, when anything came over: written when the import is
 * over (through, stopped, ended by the person), or when its open session ends without that (it ran
 * out or was replaced). A running import is never ended from outside, so the entry always counts
 * everything the import brought. It may run inside another person's request, from the session
 * sweep, which recordAudit allows: it never throws.
 */
function auditImport(session: DiscordExpressionSession): void {
  if (session.audited) return;
  session.audited = true;
  const imported = (kind: 'emoji' | 'sticker') => session.results.filter((result) => result.kind === kind && result.outcome === 'imported').length;
  const emoji = imported('emoji');
  const stickers = imported('sticker');
  if (emoji + stickers === 0 || !spaceExists(session.spaceId)) return;
  recordAudit({
    spaceId: session.spaceId,
    actorId: session.userId,
    action: 'discord_expressions_import',
    targetType: 'space',
    targetId: session.spaceId,
    changes: [{ key: 'emoji', to: emoji }, { key: 'stickers', to: stickers }],
  });
}

setDiscordSessionEndHandler(auditImport);

/** Refusals that say the importer may not go on now: the batch ends there, and the next call says why. */
const HALTING_REFUSALS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'missing_permission', 'member_timed_out', 'email_verification_required', 'rules_not_accepted',
  // This account's picture work is busy, or the queue is full: the entry is tried again later.
  'rate_limited',
]);

type ItemOutcome =
  | { kind: 'settled'; outcome: DiscordExpressionOutcome; name?: string }
  | { kind: 'retry' }
  | { kind: 'halt' }
  | { kind: 'stop'; reason: 'storage_limit_reached' | 'disk_full' };

/** Brings one entry over: its picture from Discord's content servers, then the same add as an upload. */
async function importOne(session: DiscordExpressionSession, item: DiscordExpressionItem, fetchTimeoutMs: number): Promise<ItemOutcome> {
  const url = discordAssetUrl(item);
  if (!url) return { kind: 'settled', outcome: 'image_refused' };
  const bytes = await fetchDiscordAsset(url, item.kind === 'emoji' ? CUSTOM_EMOJI_LIMITS.MAX_SOURCE_BYTES : MAX_STICKER_BYTES, fetchTimeoutMs);
  if (!bytes) return { kind: 'settled', outcome: 'download_failed' };
  const added = item.kind === 'emoji'
    ? await addSpaceEmoji({ spaceId: session.spaceId, actorId: session.userId, name: item.name, source: bytes, discordId: item.discordId })
    : await addSpaceSticker({ spaceId: session.spaceId, actorId: session.userId, name: item.name, description: null, source: bytes, discordId: item.discordId });
  if (added.ok) return { kind: 'settled', outcome: 'imported', name: added.value.name };
  const { refusal } = added;
  if (refusal.alreadyHere) return { kind: 'settled', outcome: 'already_here' };
  if (HALTING_REFUSALS.has(refusal.code)) return { kind: 'halt' };
  switch (refusal.code) {
    // Someone took the name while the picture was on its way: the next plan names it again.
    case 'space_emoji_name_taken':
    case 'space_sticker_name_taken':
      return { kind: 'retry' };
    case 'space_emoji_limit_reached':
    case 'space_sticker_limit_reached':
      return { kind: 'settled', outcome: 'no_room' };
    case 'storage_limit_reached':
    case 'disk_full':
      return { kind: 'stop', reason: refusal.code };
    default:
      return { kind: 'settled', outcome: 'image_refused' };
  }
}

/** Thrown out of a batch when the space went away under it. */
class SpaceGone extends Error {}

/** What the import has settled and how it stands, with the results after the client's cursor. */
function standing(session: DiscordExpressionSession, after: number): DiscordExpressionApplyResult {
  const selected = session.selection ?? [];
  const done = selected.filter((key) => session.settled.has(key)).length;
  return {
    done,
    total: selected.length,
    finished: session.closed?.finished ?? false,
    stopped: session.closed?.stopped ?? null,
    results: session.results.slice(after),
  };
}

/**
 * One batch: at most BATCH_ITEMS pictures, none started after BATCH_BUDGET_MS, and no fetch from
 * Discord allowed past BATCH_DEADLINE_MS. Plans again before each picture, so a failed one frees
 * its room for the next, and asks again whether the importer may still add. A skip that cannot
 * change is settled as soon as it shows; running out of room is settled only once nothing is left
 * to bring.
 */
async function runBatch(session: DiscordExpressionSession): Promise<void> {
  const started = Date.now();
  const deadline = started + DISCORD_EXPRESSION_LIMITS.BATCH_DEADLINE_MS;
  const selected = new Set(session.selection ?? []);
  const imported = { emoji: 0, sticker: 0 };
  let stopped: DiscordExpressionApplyResult['stopped'] = null;
  let attempts = 0;

  const settle = (item: DiscordExpressionItem, outcome: DiscordExpressionOutcome, name: string = item.name) => {
    session.settled.add(item.key);
    // What was not picked is no part of this import, and the report leaves it out.
    if (outcome === 'not_selected') return;
    const result: DiscordExpressionResult = { key: item.key, kind: item.kind, discordId: item.discordId, name, outcome };
    session.results.push(result);
  };

  try {
    for (;;) {
      if (session.cancelled) break;
      if (!spaceExists(session.spaceId)) throw new SpaceGone();
      // The importer may have been banned, timed out, demoted or deleted since the last picture.
      if (expressionManagerRefusal(session.spaceId, session.userId)) break;
      const plan = planAgainstSpace(unsettledListing(session), session.spaceId, selected);
      for (const item of plan) {
        if (item.action === 'skip' && item.skip !== 'no_room') settle(item, item.skip ?? 'not_selected');
      }
      const next = plan.find((item) => item.action === 'import');
      if (!next) {
        for (const item of plan) if (item.skip === 'no_room') settle(item, 'no_room');
        break;
      }
      const now = Date.now();
      const fetchTimeoutMs = Math.min(ASSET_TIMEOUT_MS, deadline - now);
      if (attempts >= DISCORD_EXPRESSION_LIMITS.BATCH_ITEMS || now - started >= DISCORD_EXPRESSION_LIMITS.BATCH_BUDGET_MS || fetchTimeoutMs < 1000) break;
      attempts += 1;
      let outcome: ItemOutcome;
      try {
        outcome = await importOne(session, next, fetchTimeoutMs);
      } catch (err) {
        if (!spaceExists(session.spaceId)) throw new SpaceGone();
        throw err;
      }
      if (outcome.kind === 'stop') {
        stopped = outcome.reason;
        break;
      }
      if (outcome.kind === 'halt') break;
      if (outcome.kind === 'retry') continue;
      settle(next, outcome.outcome, outcome.name);
      if (outcome.outcome === 'imported') imported[next.kind] += 1;
    }
  } finally {
    if (imported.emoji > 0) connectionManager.sendToSpace(session.spaceId, { type: 'space_emojis_changed', spaceId: session.spaceId });
    if (imported.sticker > 0) connectionManager.sendToSpace(session.spaceId, { type: 'space_stickers_changed', spaceId: session.spaceId });
    if (imported.emoji + imported.sticker > 0 && spaceExists(session.spaceId)) {
      // What the invite page's welcome for people coming from Discord rests on.
      getDb().update(schema.spaces).set({ discordImportedAt: Date.now() }).where(eq(schema.spaces.id, session.spaceId)).run();
    }
  }

  const finished = stopped === null && [...selected].every((key) => session.settled.has(key));
  if (finished || stopped !== null || session.cancelled) {
    closeDiscordSession(session, { finished, stopped });
    auditImport(session);
  }
}

export async function discordExpressionImportRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/import/discord/expressions/preview - Look the server's emoji and stickers up
  app.post<{ Body: DiscordExpressionPreviewRequest }>('/api/import/discord/expressions/preview', {
    preHandler: authenticate,
    bodyLimit: 4096,
    schema: {
      body: {
        type: 'object', required: ['spaceId', 'guildId', 'token'], additionalProperties: false,
        properties: {
          spaceId: { type: 'string', maxLength: 32 },
          guildId: { type: 'string', maxLength: 64 },
          token: { type: 'string', maxLength: 256 },
        },
      },
    },
  }, async (request, reply) => {
    const { spaceId } = request.body;
    if (refusedImporter(reply, spaceId, request.userId)) return reply;
    const guildId = request.body.guildId.trim();
    if (!DISCORD_SNOWFLAKE.test(guildId)) return sendError(reply, 400, 'discord_server_id_invalid');
    const token = parseBotToken(request.body.token);
    if (!token) return sendError(reply, 400, 'discord_bot_token_invalid');
    // One import at a time per account, and none pushed out to make room for another.
    if (accountHasRunningImport(request.userId)) return sendError(reply, 409, 'discord_import_running');
    if (!discordSessionRoom()) return sendError(reply, 429, 'rate_limited');
    // Counted once the request could reach Discord: a typo costs nothing.
    if (!previewLimit.consume(request.userId)) return sendError(reply, 429, 'rate_limited');

    const listed = await listGuildExpressions(guildId, token);
    if (!listed.ok) return sendError(reply, listed.status, listed.code, listed.details);
    // The look-up took a moment: the right, or the space, may be gone.
    if (refusedImporter(reply, spaceId, request.userId)) return reply;
    if (accountHasRunningImport(request.userId)) return sendError(reply, 409, 'discord_import_running');

    const session = createDiscordSession({ userId: request.userId, spaceId, listing: listed.listing });
    if (!session) return sendError(reply, 429, 'rate_limited');
    const preview: DiscordExpressionPreview = {
      importId: session.importId,
      expiresAt: discordSessionExpiry(session),
      items: planAgainstSpace(listed.listing, spaceId, null),
      room: roomOf(spaceId),
      limits: { emoji: SPACE_EXPRESSION_LIMITS.EMOJI_PER_SPACE, stickers: SPACE_EXPRESSION_LIMITS.STICKERS_PER_SPACE },
    };
    return reply.code(200).send(preview);
  });

  // POST /api/import/discord/expressions/apply - Bring the next batch over, or say how the import stands
  app.post<{ Body: DiscordExpressionApplyRequest }>('/api/import/discord/expressions/apply', {
    preHandler: authenticate,
    bodyLimit: 64 * 1024,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object', required: ['importId'], additionalProperties: false,
        properties: {
          importId: { type: 'string', maxLength: 64 },
          selection: {
            type: 'array',
            maxItems: DISCORD_EXPRESSION_LIMITS.MAX_LISTED_EMOJI + DISCORD_EXPRESSION_LIMITS.MAX_LISTED_STICKERS,
            items: { type: 'string', maxLength: 40 },
          },
          after: { type: 'integer', minimum: 0, maximum: DISCORD_EXPRESSION_LIMITS.MAX_LISTED_EMOJI + DISCORD_EXPRESSION_LIMITS.MAX_LISTED_STICKERS },
        },
      },
    },
  }, async (request, reply) => {
    const session = discordSessionFor(request.body.importId, request.userId);
    if (!session) return sendError(reply, 404, 'discord_import_expired');
    const after = request.body.after ?? 0;
    // Over already: what it settled, again, for an answer that never arrived.
    if (session.closed) return reply.code(200).send(standing(session, after));
    if (session.running) return sendError(reply, 409, 'discord_import_running');
    if (refusedImporter(reply, session.spaceId, request.userId)) return reply;
    if (session.selection === null) {
      const keys = listingKeys(session.listing);
      if (request.body.selection !== undefined) {
        const picked = new Set(request.body.selection);
        for (const key of picked) {
          if (!keys.has(key)) return sendError(reply, 400, 'validation_failed', { field: 'selection' });
        }
        session.selection = [...picked];
      } else {
        session.selection = [...keys];
      }
    }

    session.running = true;
    try {
      await runBatch(session);
    } catch (err) {
      if (err instanceof SpaceGone) {
        closeDiscordSession(session, { finished: false, stopped: null });
        return sendError(reply, 404, 'space_not_found');
      }
      throw err;
    } finally {
      session.running = false;
    }
    return reply.code(200).send(standing(session, after));
  });

  // DELETE /api/import/discord/expressions/:importId - Stop. What came over stays.
  app.delete<{ Params: { importId: string } }>('/api/import/discord/expressions/:importId', { preHandler: authenticate }, async (request, reply) => {
    const session = discordSessionFor(request.params.importId, request.userId);
    if (session && !session.closed) {
      // A batch in progress finishes the picture it is on and ends the import itself.
      if (session.running) session.cancelled = true;
      else endDiscordSession(session.importId);
    }
    return reply.code(200).send({ success: true });
  });
}
