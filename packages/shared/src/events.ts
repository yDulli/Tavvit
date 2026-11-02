/** Events in a space (docs/systems/events.md): a time, a place, who is going. No series yet. */

export const EVENT_LIMITS = {
  TITLE_MAX_LENGTH: 100,
  DESCRIPTION_MAX_LENGTH: 1000,
  LOCATION_MAX_LENGTH: 200,
  /** Upcoming events one space can hold. */
  UPCOMING_MAX: 100,
  /** How many of those going a list names. */
  ATTENDEES_MAX: 100,
} as const;

/** How long before it starts someone going hears of it. */
export const EVENT_REMINDER_BEFORE_MS = 15 * 60_000;
/** How long after its end an event stays in the list. */
export const EVENT_KEPT_AFTER_MS = 24 * 3600 * 1000;

export interface SpaceEvent {
  id: string;
  spaceId: string;
  title: string;
  description: string | null;
  /** A place in words, or a channel of the space, or neither. */
  location: string | null;
  channelId: string | null;
  startsAt: number;
  endsAt: number | null;
  createdBy: string | null;
  createdAt: number;
  going: number;
  /** Whether the reader is going. Only an answer to one reader has it. */
  amGoing?: boolean;
}

export interface SpaceEventRequest {
  title: string;
  description?: string | null;
  location?: string | null;
  channelId?: string | null;
  startsAt: number;
  endsAt?: number | null;
}
