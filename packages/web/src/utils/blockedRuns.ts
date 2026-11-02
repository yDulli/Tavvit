/**
 * Which messages in a list belong to a run written by blocked people.
 *
 * A run is two or more neighbours, or one message, from blocked authors with
 * no other author's message between them. The list shows a run as one quiet
 * line ("3 blocked messages") with a way to reveal it, instead of a line per
 * message, so a conversation does not fill with gaps.
 *
 * System messages are never part of a run: they are not written by the blocked
 * person, and hiding "X left the group" would hide a fact about the room.
 */

export interface BlockableMessage {
  id: string;
  userId: string;
  type?: 'user' | 'system';
}

export interface BlockedRunPlan {
  /** First message id of each run, to how many messages the run holds. */
  counts: ReadonlyMap<string, number>;
  /** Every message id that is in a run, to the first id of its run. */
  startOf: ReadonlyMap<string, string>;
}

export const EMPTY_BLOCKED_PLAN: BlockedRunPlan = { counts: new Map(), startOf: new Map() };

export function planBlockedRuns(
  messages: readonly BlockableMessage[],
  isBlocked: (userId: string) => boolean,
): BlockedRunPlan {
  const counts = new Map<string, number>();
  const startOf = new Map<string, string>();
  let runStart: string | null = null;

  for (const message of messages) {
    const blocked = message.type !== 'system' && isBlocked(message.userId);
    if (!blocked) {
      runStart = null;
      continue;
    }
    if (runStart === null) {
      runStart = message.id;
      counts.set(runStart, 0);
    }
    startOf.set(message.id, runStart);
    counts.set(runStart, (counts.get(runStart) ?? 0) + 1);
  }

  return counts.size === 0 ? EMPTY_BLOCKED_PLAN : { counts, startOf };
}
