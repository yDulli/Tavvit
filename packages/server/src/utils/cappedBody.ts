/**
 * A body read up to `max` bytes: its text, or that it was longer. For answers from fixed services
 * (a Discord template, a video's oEmbed), so a far larger answer than any real one cannot fill the
 * server's memory. A failed read throws.
 */
export async function readCapped(response: Response, max: number): Promise<{ text: string } | { tooLarge: true }> {
  if (!response.body) return { text: '' };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)) };
}
