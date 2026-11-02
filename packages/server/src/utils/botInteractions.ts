import { BOT_LIMITS } from '@backspace/shared/src/bots.js';
import { generateSnowflake } from './snowflake.js';

/**
 * Commands that were asked and may still be answered (docs/systems/bots.md, "Commands"). In
 * memory: after a restart a bot answers with an ordinary message, or not at all, which is no
 * worse than a bot that was restarted itself.
 */
export interface OpenInteraction {
  botId: string;
  channelId: string;
  spaceId: string;
  /** Who asked: the only one an answer "for you alone" goes to. */
  userId: string;
  replies: number;
  expiresAt: number;
}

const open = new Map<string, OpenInteraction>();

/** Remembers a command that was asked. The id goes to the bot and to nobody else. */
export function openInteraction(
  fields: Pick<OpenInteraction, 'botId' | 'channelId' | 'spaceId' | 'userId'>,
  now: number = Date.now(),
): string {
  for (const [id, interaction] of open) {
    if (interaction.expiresAt <= now) open.delete(id);
  }
  const id = generateSnowflake();
  open.set(id, { ...fields, replies: 0, expiresAt: now + BOT_LIMITS.INTERACTION_TTL_MS });
  return id;
}

/** The command `botId` was asked under this id, if it may still answer. Anyone else's looks like none at all. */
export function interactionFor(id: string, botId: string, now: number = Date.now()): OpenInteraction | null {
  const interaction = open.get(id);
  if (!interaction || interaction.botId !== botId || interaction.expiresAt <= now) return null;
  return interaction;
}
