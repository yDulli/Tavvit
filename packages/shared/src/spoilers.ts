/**
 * Spoilers in a message's text: `||hidden||`. The message keeps them as written, so an
 * instance that does not know them shows the marks and nothing is lost. A surface with
 * one line for a message shows the mask instead of the words; the embeds of a message
 * leave out what a spoiler holds, because a preview of the link would give it away.
 */
const SPOILER = /\|\|(?=\S)[\s\S]+?(?<=\S)\|\|/g;

/** The text with each spoiler replaced by `mask`. */
export function maskSpoilers(content: string, mask: string): string {
  return content.replace(SPOILER, mask);
}

/** The text without what its spoilers hold. */
export function withoutSpoilers(content: string): string {
  return content.replace(SPOILER, ' ');
}

/** The attachments of a request a sender marked as spoilers: ids the message really carries, and only strings. */
export function spoilerAttachmentIds(marked: unknown, attachmentIds: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(marked)) return new Set();
  const carried = new Set(attachmentIds);
  return new Set(marked.filter((id): id is string => typeof id === 'string' && carried.has(id)));
}
