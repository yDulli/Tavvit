import { useEffect, useMemo } from 'react';
import type { SpaceSticker } from '@backspace/shared/src/spaceExpressions';
import { useEmojiStore, type KnownEmoji, type OriginExpressions } from '../stores/emojiStore';
import { useInstanceStore } from '../stores/instanceStore';
import { useSpaceStore, type TaggedSpace } from '../stores/spaceStore';
import { homeHostOf, normalizeOriginToHost } from './identity';

/**
 * Which custom emoji and space stickers are on offer where (docs/systems/emoji.md, "Pickers and
 * shortcodes"), between the emoji store (per instance, utils-free) and the space list.
 *
 * Where something is written decides what it may use, as the server decides it
 * (server/src/utils/emojiUse.ts): in a space's channel, that space's emoji first, then its
 * instance's library, then the instance's other spaces the person is in; in a direct message, the
 * library and spaces of this page's instance, which is the writer's home. Two sets may hold an
 * emoji of the same name: the first keeps the name as its shortcode, the later ones are offered
 * as `name~2`, `name~3`…, so what a person picks is what is sent.
 */

/** Where an emoji is picked or typed: the instance whose emoji the text names, and the space it is in (null: a direct message). */
export interface EmojiContext {
  origin: string;
  spaceId: string | null;
}

/** A direct message names the writer's home's emoji; for the person writing here, this page's instance. */
export const DIRECT_MESSAGE_EMOJI_CONTEXT: EmojiContext = { origin: '', spaceId: null };

/** One group of a picker: a space's emoji and stickers, or the instance's library. */
export interface EmojiSet {
  /** `library`, or `space-<spaceId>`. */
  key: string;
  spaceId: string | null;
  /** The space as the list shows it; null for the library. */
  space: TaggedSpace | null;
  emojis: readonly KnownEmoji[];
  stickers: readonly SpaceSticker[];
}

/** Shortcodes for the sets on offer: what a person types (`name`, `name~2`) and back. */
export interface ShortcodeIndex {
  idsByShortcode: ReadonlyMap<string, string>;
  shortcodeById: ReadonlyMap<string, string>;
}

/** Where a channel's text belongs: its host and its space, or the direct message context. */
export function emojiContextOfChannel(channelId: string | null | undefined): EmojiContext {
  if (!channelId) return DIRECT_MESSAGE_EMOJI_CONTEXT;
  const state = useSpaceStore.getState();
  const spaceId = state.channelToSpaceMap.get(channelId);
  if (spaceId === undefined) return DIRECT_MESSAGE_EMOJI_CONTEXT;
  return { origin: state.channelOriginMap.get(channelId) ?? '', spaceId };
}

/** `emojiContextOfChannel` for render. */
export function useEmojiContextOfChannel(channelId: string | null | undefined): EmojiContext {
  const spaceId = useSpaceStore((s) => (channelId ? s.channelToSpaceMap.get(channelId) : undefined));
  const origin = useSpaceStore((s) => (channelId ? s.channelOriginMap.get(channelId) ?? '' : ''));
  return useMemo(
    () => (spaceId === undefined ? DIRECT_MESSAGE_EMOJI_CONTEXT : { origin, spaceId }),
    [origin, spaceId],
  );
}

/**
 * The sets on offer in `context`, in the order they are shown and their names take precedence: the
 * context's space, the library, then the instance's other spaces the person is in, as the space
 * list orders them. A space the list does not show (left meanwhile) is not offered.
 */
export function emojiSetsFor(context: EmojiContext, offer: OriginExpressions | undefined, spaces: readonly TaggedSpace[]): EmojiSet[] {
  if (!offer) return [];
  const listed = spaces.filter((space) => (space._instanceOrigin ?? '') === context.origin);
  const bySpaceId = new Map(offer.spaces.map((entry) => [entry.spaceId, entry]));
  const toSet = (space: TaggedSpace): EmojiSet | null => {
    const entry = bySpaceId.get(space.id);
    if (!entry || (entry.emojis.length === 0 && entry.stickers.length === 0)) return null;
    return {
      key: `space-${space.id}`,
      spaceId: space.id,
      space,
      emojis: entry.emojis.map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated, spaceId: space.id })),
      stickers: entry.stickers,
    };
  };
  const current = context.spaceId ? listed.find((space) => space.id === context.spaceId) : undefined;
  const sets: EmojiSet[] = [];
  const currentSet = current ? toSet(current) : null;
  if (currentSet) sets.push(currentSet);
  if (offer.library.length > 0) {
    sets.push({
      key: 'library',
      spaceId: null,
      space: null,
      emojis: offer.library.map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated, spaceId: null })),
      stickers: [],
    });
  }
  for (const space of listed) {
    if (space.id === context.spaceId) continue;
    const set = toSet(space);
    if (set) sets.push(set);
  }
  return sets;
}

/** The shortcodes of `sets`: a name for the first emoji to carry it, `name~2`… for the next. */
export function shortcodeIndex(sets: readonly EmojiSet[]): ShortcodeIndex {
  const idsByShortcode = new Map<string, string>();
  const shortcodeById = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const set of sets) {
    for (const emoji of set.emojis) {
      if (shortcodeById.has(emoji.id)) continue;
      const count = (seen.get(emoji.name) ?? 0) + 1;
      seen.set(emoji.name, count);
      const shortcode = count === 1 ? emoji.name : `${emoji.name}~${count}`;
      idsByShortcode.set(shortcode, emoji.id);
      shortcodeById.set(emoji.id, shortcode);
    }
  }
  return { idsByShortcode, shortcodeById };
}

/** The shortcodes on offer in `context` now, for turning what a person typed into tokens and back. */
export function shortcodeIndexFor(context: EmojiContext): ShortcodeIndex {
  const offer = useEmojiStore.getState().origins.get(context.origin);
  return shortcodeIndex(emojiSetsFor(context, offer, useSpaceStore.getState().spaces));
}

/**
 * The sets on offer in `context`, for render, loading the instance's offer when first needed and
 * again when the space list shows a space of that instance the offer does not know yet (joined
 * since it was loaded).
 */
export function useEmojiSets(context: EmojiContext): EmojiSet[] {
  const offer = useEmojiStore((s) => s.origins.get(context.origin));
  const spaces = useSpaceStore((s) => s.spaces);
  useEffect(() => {
    useEmojiStore.getState().ensureOrigin(context.origin);
  }, [context.origin]);
  useEffect(() => {
    if (offer?.status !== 'ready') return;
    const known = new Set(offer.spaces.map((space) => space.spaceId));
    const missing = spaces.some((space) => (space._instanceOrigin ?? '') === context.origin && !known.has(space.id));
    if (missing) void useEmojiStore.getState().loadOrigin(context.origin);
  }, [offer, spaces, context.origin]);
  return useMemo(() => emojiSetsFor(context, offer, spaces), [context, offer, spaces]);
}

/**
 * The instance whose emoji a person's direct messages and reactions name: their home. `issuingOrigin`
 * is the instance that issued the row (a person without a recorded home lives there). `''` is this
 * page's own instance; an instance this client is not connected to keeps its address, and its
 * pictures wait for the reader's yes (GatedPicture).
 */
export function emojiOriginOfPerson(person: { homeInstance?: string | null } | null | undefined, issuingOrigin: string): string {
  if (!person?.homeInstance) return issuingOrigin;
  const host = homeHostOf(person.homeInstance);
  if (host === homeHostOf(window.location.host)) return '';
  const connected = useInstanceStore.getState().instances.find((instance) => homeHostOf(instance.origin) === host);
  return connected ? connected.origin : `https://${normalizeOriginToHost(person.homeInstance)}`;
}
