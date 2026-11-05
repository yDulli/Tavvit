/**
 * A body read up to `max` bytes: its text, or that it was longer. For answers from fixed services
 * (a Discord template, a video's oEmbed), so a far larger answer than any real one cannot fill the
 * server's memory. A failed read throws.
 */
export async function readCapped(response: Response, max: number): Promise<{ text: string } | { tooLarge: true }> {
  const read = await readCappedBytes(response, max);
  return 'tooLarge' in read ? read : { text: new TextDecoder().decode(read.bytes) };
}

/** The same, for a picture: the bytes as they came. */
export async function readCappedBytes(response: Response, max: number): Promise<{ bytes: Buffer } | { tooLarge: true }> {
  if (!response.body) return { bytes: Buffer.alloc(0) };
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
  return { bytes: Buffer.concat(chunks) };
}
