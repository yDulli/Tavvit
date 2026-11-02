/**
 * Message ids and read positions are decimal snowflakes of the instance that
 * issued them, and their length grows over time, so they are compared as
 * numbers, never as strings. One implementation for the chat store and the
 * inbox, so "read" means the same thing in both.
 */
export function isNewerId(candidate: string, than: string | undefined): boolean {
  if (than === undefined) return true;
  try {
    return BigInt(candidate) > BigInt(than);
  } catch {
    return false;
  }
}
