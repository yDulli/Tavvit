import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { PollInfo } from '@backspace/shared/src/polls.js';
import { getDb, schema } from '../db/index.js';

/**
 * The polls among these messages, by message. `readerId` adds that reader's own answers;
 * without it (what goes to a whole channel) a poll says only how the count stands.
 */
export function fetchPollsForMessages(messageIds: readonly string[], readerId?: string): Map<string, PollInfo> {
  const result = new Map<string, PollInfo>();
  if (messageIds.length === 0) return result;
  const db = getDb();

  const polls = db.select().from(schema.polls).where(inArray(schema.polls.messageId, [...messageIds])).all();
  if (polls.length === 0) return result;
  const polled = polls.map((poll) => poll.messageId);

  const options = db.select().from(schema.pollOptions)
    .where(inArray(schema.pollOptions.messageId, polled))
    .orderBy(asc(schema.pollOptions.position))
    .all();
  const votesByOption = new Map(db.select({ optionId: schema.pollVotes.optionId, count: sql<number>`count(*)` })
    .from(schema.pollVotes)
    .where(inArray(schema.pollVotes.messageId, polled))
    .groupBy(schema.pollVotes.optionId)
    .all()
    .map((row) => [row.optionId, row.count]));
  const votersByMessage = new Map(db.select({ messageId: schema.pollVotes.messageId, count: sql<number>`count(distinct ${schema.pollVotes.userId})` })
    .from(schema.pollVotes)
    .where(inArray(schema.pollVotes.messageId, polled))
    .groupBy(schema.pollVotes.messageId)
    .all()
    .map((row) => [row.messageId, row.count]));

  const mine = new Map<string, string[]>();
  if (readerId) {
    const rows = db.select({ messageId: schema.pollVotes.messageId, optionId: schema.pollVotes.optionId })
      .from(schema.pollVotes)
      .where(and(inArray(schema.pollVotes.messageId, polled), eq(schema.pollVotes.userId, readerId)))
      .all();
    for (const row of rows) mine.set(row.messageId, [...(mine.get(row.messageId) ?? []), row.optionId]);
  }

  for (const poll of polls) {
    result.set(poll.messageId, {
      multiple: poll.multiple,
      endsAt: poll.endsAt,
      endedAt: poll.endedAt,
      options: options
        .filter((option) => option.messageId === poll.messageId)
        .map((option) => ({ id: option.id, label: option.label, votes: votesByOption.get(option.id) ?? 0 })),
      voters: votersByMessage.get(poll.messageId) ?? 0,
      ...(readerId ? { myVotes: mine.get(poll.messageId) ?? [] } : {}),
    });
  }
  return result;
}

/** Whether this message is a poll: its question is not edited under the votes already cast. */
export function isPollMessage(messageId: string): boolean {
  return getDb().select({ messageId: schema.polls.messageId }).from(schema.polls)
    .where(eq(schema.polls.messageId, messageId)).get() !== undefined;
}
