import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { RoomServiceClient } from 'livekit-server-sdk';
import type { PublicStatus, ServiceState, StatusNote } from '@backspace/shared/src/publicStatus.js';
import { config } from '../config.js';
import { getDb, getRawDb, schema } from '../db/index.js';
import { emailState } from '../email/service.js';
import { diskIsNearlyFull } from '../utils/accountLimits.js';

/**
 * The public status page's facts (docs/systems/operations.md, "Status page"): whether each part
 * runs, and what the operator says about a problem. It names no count, version or address.
 * Anyone can ask, and answers from a short memory, so that asking costs nothing and cannot be used
 * to make this server call LiveKit over and over.
 */

const REMEMBER_MS = 30_000;
const NOTES_SHOWN = 20;
/** How long a note about something that is over stays on the page. */
const NOTES_STAY_MS = 7 * 24 * 60 * 60 * 1000;
const VOICE_TIMEOUT_MS = 5_000;

async function voiceState(): Promise<ServiceState> {
  const { apiUrl, url, apiKey, apiSecret } = config.livekit;
  const host = apiUrl ?? url;
  if (!host || !apiKey || !apiSecret) return 'off';
  try {
    const asked = new RoomServiceClient(host, apiKey, apiSecret).listRooms();
    const late = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('timeout')), VOICE_TIMEOUT_MS).unref();
    });
    await Promise.race([asked, late]);
    return 'ok';
  } catch {
    return 'down';
  }
}

function mailState(): ServiceState {
  const state = emailState();
  if (state === 'off') return 'off';
  return state === 'ok' ? 'ok' : 'down';
}

function chatState(): ServiceState {
  try {
    getRawDb().prepare('SELECT 1').get();
    return 'ok';
  } catch {
    return 'down';
  }
}

function notesOf(now: number): StatusNote[] {
  const { announcements } = schema;
  const rows = getDb().select().from(announcements)
    .where(and(
      eq(announcements.onStatusPage, 1),
      or(
        isNull(announcements.endedAt),
        gt(announcements.endedAt, now - NOTES_STAY_MS),
      ),
      or(isNull(announcements.endsAt), gt(announcements.endsAt, now - NOTES_STAY_MS)),
    ))
    .orderBy(desc(sql`CAST(${announcements.id} AS INTEGER)`))
    .limit(NOTES_SHOWN)
    .all();
  return rows.map((row) => {
    const ranOut = row.endsAt !== null && row.endsAt <= now ? row.endsAt : null;
    return {
      id: row.id,
      tone: row.tone as StatusNote['tone'],
      body: row.body,
      createdAt: row.createdAt,
      endedAt: row.endedAt ?? ranOut,
    };
  });
}

export async function publicStatusRoutes(app: FastifyInstance): Promise<void> {
  let remembered: { at: number; status: PublicStatus } | null = null;
  let underWay: Promise<PublicStatus> | null = null;

  const build = async (now: number): Promise<PublicStatus> => ({
    checkedAt: now,
    services: {
      chat: chatState(),
      uploads: diskIsNearlyFull() ? 'down' : 'ok',
      voice: await voiceState(),
      mail: mailState(),
    },
    notes: notesOf(now),
  });

  app.get('/api/status', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    const now = Date.now();
    if (remembered && now - remembered.at < REMEMBER_MS) return reply.code(200).send(remembered.status);
    // Those who ask while it is being looked up wait for the same answer.
    underWay ??= build(now).finally(() => { underWay = null; });
    const status = await underWay;
    remembered = { at: now, status };
    return reply.code(200).send(status);
  });
}
