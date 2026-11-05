/**
 * Puts text on the clipboard. False when the browser refused: no permission, a page that is not
 * secure, or an engine without the clipboard API. Every caller says so to the person, who can still
 * select the text and copy it themselves.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
