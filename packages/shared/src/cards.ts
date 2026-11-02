/**
 * Cards: what a bot or a webhook can show besides text (docs/systems/bots.md, "Cards").
 *
 * Nothing in a card is fetched from anywhere. A picture has to be one of the message's own
 * uploads and a link is only a link, so a card can neither track who reads it nor make the
 * server or anyone's browser call an address.
 */

export const CARD_LIMITS = {
  PER_MESSAGE: 5,
  TITLE_MAX_LENGTH: 256,
  TEXT_MAX_LENGTH: 2000,
  FIELDS_PER_CARD: 10,
  FIELD_NAME_MAX_LENGTH: 100,
  FIELD_VALUE_MAX_LENGTH: 1024,
  FOOTER_MAX_LENGTH: 200,
  URL_MAX_LENGTH: 2048,
  /** All the words of a message's cards together. */
  TOTAL_WORDS_MAX_LENGTH: 6000,
} as const;

export interface MessageCardField {
  name: string;
  value: string;
  /** Shown beside its neighbours rather than on a line of its own. */
  inline?: boolean;
}

export interface MessageCard {
  title?: string;
  text?: string;
  /** Where the title leads: http or https, and nothing is fetched from it. */
  url?: string;
  /** `#rrggbb`, the card's edge. */
  color?: string;
  fields?: MessageCardField[];
  footer?: string;
  /** One of this message's own attachments, shown in the card instead of beside it. */
  imageAttachmentId?: string;
}

/** The cards as they are kept, or the first field that is not as it should be. */
export type CardsResult = { cards: MessageCard[] } | { field: string };

const COLOR = /^#[0-9a-f]{6}$/;

function words(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.length <= max ? trimmed : null;
}

function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Cards as a sender gave them, checked. `textOf` runs over every word that will be shown:
 * the server passes what takes the mentions out, since a card alerts nobody.
 */
export function cleanCards(value: unknown, textOf: (text: string) => string = (text) => text): CardsResult {
  if (!Array.isArray(value) || value.length > CARD_LIMITS.PER_MESSAGE) return { field: 'cards' };
  const cards: MessageCard[] = [];
  let total = 0;
  const counted = (text: string): string => {
    total += text.length;
    return textOf(text);
  };

  for (const [at, entry] of value.entries()) {
    const field = (name: string): CardsResult => ({ field: `cards[${at}].${name}` });
    if (typeof entry !== 'object' || entry === null) return { field: `cards[${at}]` };
    const given = entry as Record<string, unknown>;
    const card: MessageCard = {};

    const title = words(given.title, CARD_LIMITS.TITLE_MAX_LENGTH);
    if (title === null) return field('title');
    if (title) card.title = counted(title);

    const text = words(given.text, CARD_LIMITS.TEXT_MAX_LENGTH);
    if (text === null) return field('text');
    if (text) card.text = counted(text);

    const footer = words(given.footer, CARD_LIMITS.FOOTER_MAX_LENGTH);
    if (footer === null) return field('footer');
    if (footer) card.footer = counted(footer);

    const url = words(given.url, CARD_LIMITS.URL_MAX_LENGTH);
    if (url === null || (url && !isWebAddress(url))) return field('url');
    if (url) card.url = url;

    if (given.color !== undefined) {
      const color = typeof given.color === 'string' ? given.color.toLowerCase() : '';
      if (!COLOR.test(color)) return field('color');
      card.color = color;
    }

    if (given.imageAttachmentId !== undefined) {
      if (typeof given.imageAttachmentId !== 'string' || given.imageAttachmentId === '') return field('imageAttachmentId');
      card.imageAttachmentId = given.imageAttachmentId;
    }

    if (given.fields !== undefined) {
      if (!Array.isArray(given.fields) || given.fields.length > CARD_LIMITS.FIELDS_PER_CARD) return field('fields');
      const fields: MessageCardField[] = [];
      for (const [fieldAt, item] of given.fields.entries()) {
        const named = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
        const name = words(named.name, CARD_LIMITS.FIELD_NAME_MAX_LENGTH);
        const shown = words(named.value, CARD_LIMITS.FIELD_VALUE_MAX_LENGTH);
        if (!name || !shown) return field(`fields[${fieldAt}]`);
        fields.push({ name: counted(name), value: counted(shown), ...(named.inline === true ? { inline: true } : {}) });
      }
      if (fields.length > 0) card.fields = fields;
    }

    if (!card.title && !card.text && !card.fields && !card.imageAttachmentId) return { field: `cards[${at}]` };
    cards.push(card);
  }

  if (total > CARD_LIMITS.TOTAL_WORDS_MAX_LENGTH) return { field: 'cards' };
  return { cards };
}

/**
 * What stands for the cards where only words fit: a push, the inbox, search, a client that
 * does not know cards. Kept as the message's content when the sender wrote none, so all of
 * these work without knowing about cards, and a client that does know shows the card alone.
 */
export function cardsSummary(cards: readonly MessageCard[]): string | null {
  for (const card of cards) {
    const words = card.title ?? card.text ?? card.fields?.[0]?.name;
    if (words) return words;
  }
  return null;
}

/** Every word in the cards, for the space's automatic rules. */
export function cardWords(cards: readonly MessageCard[]): string {
  return cards.flatMap((card) => [
    card.title,
    card.text,
    card.footer,
    ...(card.fields ?? []).flatMap((field) => [field.name, field.value]),
  ]).filter(Boolean).join('\n');
}

/** The attachments shown inside a card, which must not appear beside it as well. */
export function cardImageIds(cards: readonly MessageCard[] | undefined): ReadonlySet<string> {
  return new Set((cards ?? []).flatMap((card) => (card.imageAttachmentId ? [card.imageAttachmentId] : [])));
}

/** Cards as a row keeps them. A row the server wrote itself, so it is read, not checked again. */
export function parseStoredCards(stored: string | null | undefined): MessageCard[] | undefined {
  if (!stored) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as MessageCard[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Discord's `embeds` as cards, for programs that already post in that form: build servers and
 * monitors often have nothing else. What a card does not show stays out, above all every picture
 * at an address elsewhere. The result still goes through `cleanCards`.
 */
export function cardsFromDiscordEmbeds(embeds: unknown): unknown {
  if (!Array.isArray(embeds)) return embeds;
  return embeds.map((embed: unknown) => {
    if (typeof embed !== 'object' || embed === null) return embed;
    const { title, description, url, color, fields, footer } = embed as Record<string, unknown>;
    const footerText = typeof footer === 'object' && footer !== null ? (footer as { text?: unknown }).text : undefined;
    return {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { text: description } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(typeof color === 'number' && color >= 0 && color <= 0xffffff
        ? { color: `#${Math.trunc(color).toString(16).padStart(6, '0')}` }
        : {}),
      ...(fields !== undefined ? { fields } : {}),
      ...(footerText !== undefined ? { footer: footerText } : {}),
    };
  });
}
