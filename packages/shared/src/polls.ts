/**
 * Polls in a space channel (docs/systems/api.md, "Polls"). A poll is a message: its content
 * is the question, so every surface that shows a message as text shows that.
 */

export const POLL_LIMITS = {
  QUESTION_MAX_LENGTH: 300,
  OPTION_MAX_LENGTH: 80,
  OPTIONS_MIN: 2,
  OPTIONS_MAX: 10,
  /** How many voters of one answer a reader can list. */
  VOTERS_MAX: 100,
} as const;

/** How long a poll can run, in hours. Null is until someone ends it. */
export const POLL_DURATIONS_HOURS = [1, 4, 8, 24, 72, 168] as const;

export interface PollOptionInfo {
  id: string;
  label: string;
  votes: number;
}

export interface PollInfo {
  multiple: boolean;
  /** When it ends by itself; null when it does not. */
  endsAt: number | null;
  /** When someone ended it. */
  endedAt: number | null;
  options: PollOptionInfo[];
  /** How many people voted, whatever the number of answers each chose. */
  voters: number;
  /**
   * The answers the reader chose. Only an answer to that reader has it: what goes to the
   * whole channel is the same for everyone in it.
   */
  myVotes?: string[];
}

export interface CreatePollRequest {
  question: string;
  options: string[];
  multiple?: boolean;
  durationHours?: number | null;
}

/** Whether a poll takes no more votes. */
export function pollClosed(poll: Pick<PollInfo, 'endsAt' | 'endedAt'>, now: number): boolean {
  return poll.endedAt !== null || (poll.endsAt !== null && poll.endsAt <= now);
}
