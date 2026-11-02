import { create } from 'zustand';
import type { SpaceEvent } from '@backspace/shared/src/events';
import { getApiForOrigin } from './spaceStore';

/** Spaces of two instances may share an id, so the origin is part of the key. */
export const eventSpaceKey = (origin: string, spaceId: string): string => `${origin}|${spaceId}`;

interface EventState {
  bySpace: ReadonlyMap<string, readonly SpaceEvent[]>;
  /** Fetches a space's events from the instance that hosts it. */
  load: (origin: string, spaceId: string) => Promise<void>;
  /** What the space was told: it does not say whether this reader is going, so that is kept. */
  applyUpdate: (origin: string, event: SpaceEvent) => void;
  applyDelete: (origin: string, spaceId: string, eventId: string) => void;
}

const inOrder = (events: readonly SpaceEvent[]): SpaceEvent[] => [...events].sort((a, b) => a.startsAt - b.startsAt);

export const useEventStore = create<EventState>((set, get) => ({
  bySpace: new Map(),

  load: async (origin, spaceId) => {
    const { events } = await getApiForOrigin(origin).events.list(spaceId);
    const next = new Map(get().bySpace);
    next.set(eventSpaceKey(origin, spaceId), inOrder(events));
    set({ bySpace: next });
  },

  applyUpdate: (origin, event) => {
    const key = eventSpaceKey(origin, event.spaceId);
    const current = get().bySpace.get(key);
    if (!current) return; // Nothing is shown yet; opening the space fetches it.
    const before = current.find((item) => item.id === event.id);
    const merged: SpaceEvent = { ...event, amGoing: event.amGoing ?? before?.amGoing ?? false };
    const next = new Map(get().bySpace);
    next.set(key, inOrder([...current.filter((item) => item.id !== event.id), merged]));
    set({ bySpace: next });
  },

  applyDelete: (origin, spaceId, eventId) => {
    const key = eventSpaceKey(origin, spaceId);
    const current = get().bySpace.get(key);
    if (!current) return;
    const next = new Map(get().bySpace);
    next.set(key, current.filter((item) => item.id !== eventId));
    set({ bySpace: next });
  },
}));
