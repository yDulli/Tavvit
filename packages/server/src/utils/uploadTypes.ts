import path from 'node:path';

/**
 * The types this server knows a stored file as (docs/systems/uploads.md, "Types"): a local upload
 * is the type of its name's extension, and anything else is `application/octet-stream`.
 */
export const EXT_MIMETYPES: Readonly<Record<string, string>> = {
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.tiff': 'image/tiff', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.opus': 'audio/opus',
  '.weba': 'audio/webm', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
};

const KNOWN_TYPES: ReadonlySet<string> = new Set(Object.values(EXT_MIMETYPES));

/** Shown in the page rather than downloaded: pictures, video and sound, and never an SVG, which is a document. */
const INLINE_TYPES: ReadonlySet<string> = new Set(
  [...KNOWN_TYPES].filter((type) => /^(image|video|audio)\//.test(type) && type !== 'image/svg+xml'),
);

export function mimetypeFromFilename(name: string): string {
  return EXT_MIMETYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/** A type as written, down to what it is: lower case, without parameters, the first of a list. */
function essenceOf(value: string | null | undefined): string {
  return (value ?? '').split(/[;,]/)[0]?.trim().toLowerCase() ?? '';
}

/**
 * The type a file relayed by a peer is kept as: the peer's word only for a type this server knows,
 * otherwise the type of the file's name. A peer could otherwise have a document stored, and later
 * served from this origin, as whatever type it wrote ("image/png,text/html").
 */
export function relayedMimetype(peerValue: string | null | undefined, originalName: string): string {
  const essence = essenceOf(peerValue);
  return KNOWN_TYPES.has(essence) ? essence : mimetypeFromFilename(originalName);
}

/**
 * How a stored file is served: as a known type, shown in the page only when it is a picture, a
 * video or a sound, and downloaded otherwise. Whatever was stored, the answer never carries a type
 * the browser would read as a document.
 */
export function servedUploadType(stored: string | null | undefined): { type: string; inline: boolean } {
  const essence = essenceOf(stored);
  if (!KNOWN_TYPES.has(essence)) return { type: 'application/octet-stream', inline: false };
  return { type: essence, inline: INLINE_TYPES.has(essence) };
}
