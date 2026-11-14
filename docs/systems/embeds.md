# Embed & Link Preview System

Source files:
- `packages/server/src/utils/embedClassifier.ts` — URL classification and provider detection
- `packages/server/src/utils/embedResolver.ts` — URL extraction, embed resolution pipeline, DB persistence, batch fetching
- `packages/server/src/utils/metadataFetcher.ts` — OpenGraph/HTML metadata scraping with Cheerio
- `packages/server/src/utils/ssrf.ts` — SSRF protection (URL validation, DNS resolution, per-hop redirect re-validation)
- `packages/server/src/utils/ipClass.ts` (address classification: parses an IPv4, IPv6 or IPv4-mapped IPv6 address and reports which range it falls in)
- `packages/web/src/components/chat/EmbedRenderer.tsx` — Client-side embed routing by type
- `packages/web/src/components/chat/embeds/GenericEmbed.tsx` — Generic link preview card
- `packages/web/src/components/chat/embeds/ImageEmbed.tsx` — Direct image embed with lightbox
- `packages/web/src/components/chat/embeds/RichEmbed.tsx` — Rich iframe embed (Spotify)
- `packages/web/src/components/chat/embeds/VideoEmbed.tsx` — Video embed (YouTube, Vimeo, direct)
- `packages/shared/src/types.ts` — `Embed`, `EmbedType`, `EmbedProvider` type definitions
- `packages/shared/src/bluesky.ts` — [Bluesky posts](#12-bluesky-posts): Bluesky's hosts, the post a link names (`parseBlueskyPostUrl`), the card's data (`BlueskyPost`) and the check every arriving post goes through (`blueskyPostOf`)
- `packages/server/src/utils/bluesky.ts` — Reading a post from Bluesky's public interface (`readBlueskyPost`, `postFromView`, `textParts`), a picture for Copy and Save (`fetchBlueskyPicture`)
- `packages/web/src/components/chat/embeds/BlueskyEmbed.tsx`, `BlueskyVideo.tsx` — The post's card, and its video's player
- `packages/web/src/components/chat/MediaViewer.tsx` — [The media viewer](#13-the-media-viewer) every picture opens in

---

## Type Definitions

```typescript
type EmbedType = 'generic' | 'video' | 'image' | 'audio' | 'rich' | 'post';
type EmbedProvider = 'youtube' | 'vimeo' | 'spotify' | 'bluesky';

interface Embed {
  id: string;               // Snowflake
  messageId: string | null;   // FK -> messages.id (space messages)
  dmMessageId: string | null; // FK -> dm_messages.id (DMs)
  url: string;               // Original URL from message content
  embedType: EmbedType;
  provider: EmbedProvider | null;
  title: string | null;
  description: string | null;
  image: string | null;      // Thumbnail / og:image URL
  embedUrl: string | null;   // iframe-safe embed URL
  width: number | null;      // Image/thumbnail pixel width
  height: number | null;     // Image/thumbnail pixel height
  color: string | null;      // Reserved, always null currently
  createdAt: number;         // Epoch ms
  post?: BlueskyPost | null; // A `post` embed's card (#12); kept in `embeds.data`
}
```

DB schema: see `embeds` table in [database.md](database.md). Constraint: exactly one of `messageId`/`dmMessageId` is set.

---

## Pipeline Overview

```
Message created/edited
  -> extractUrls(content)         // regex, dedupe, limit 5
  -> for each URL:
       classifyUrl(url)           // extension match or provider detection
       fetchUrlMetadata(url)      // if needsMetadataFetch (SSRF-validated)
       probeRemoteImageDimensions // if image with unknown dimensions
       INSERT into embeds table
  -> broadcast embeds_resolved / dm_embeds_resolved via WebSocket
```

---

## 1. URL Extraction

`embedResolver.ts:extractUrls()`

**Regex:** `https?:\/\/[^\s<>"{}|\\^`[\]]+`

- Matches `http://` and `https://` URLs in message content
- Deduplicates while preserving order (first occurrence wins)
- **Limit:** 5 URLs per message (`MAX_EMBEDS_PER_MESSAGE = 5`)
- Returns empty array for null/empty content

---

## 2. URL Classification

`embedClassifier.ts:classifyUrl()`

Classification runs in two phases: extension matching (no URL parsing needed), then provider matching (requires valid `URL` object).

### Phase 1 — Direct Media Extensions

Regex-based, checked before URL parsing. These skip metadata fetch entirely.

| Pattern | EmbedType | Provider | needsMetadataFetch |
|---------|-----------|----------|--------------------|
| `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.avif` | `image` | null | false |
| `.mp3`, `.ogg`, `.wav`, `.flac`, `.opus` | `audio` | null | false |
| `.mp4`, `.webm`, `.mov` | `video` | null | false |

Extension matching is case-insensitive and tolerates query strings (`(\?.*)?$`).

### Phase 2 — Provider Matching

Requires successful `new URL()` parsing. Hostname normalized by stripping `www.` prefix.

#### YouTube

Hosts: `youtube.com`, `m.youtube.com`, `youtu.be`

Supported URL patterns via `extractYouTubeId()`:
| Pattern | Example |
|---------|---------|
| `/watch?v=ID` | `youtube.com/watch?v=dQw4w9WgXcQ` |
| `/shorts/ID` | `youtube.com/shorts/dQw4w9WgXcQ` |
| `/embed/ID` | `youtube.com/embed/dQw4w9WgXcQ` |
| `/v/ID` (legacy) | `youtube.com/v/dQw4w9WgXcQ` |
| Short link | `youtu.be/dQw4w9WgXcQ` |

Video ID regex: `[A-Za-z0-9_-]+`

Result: `embedType: 'video'`, `provider: 'youtube'`, `embedUrl: https://www.youtube-nocookie.com/embed/{videoId}`, `needsMetadataFetch: true`

Privacy: Uses `youtube-nocookie.com` domain for embed iframes.

#### Vimeo

Host: `vimeo.com`

Pattern: `vimeo.com/{numericId}` (regex: `/^\/(\d+)/`)

Result: `embedType: 'video'`, `provider: 'vimeo'`, `embedUrl: https://player.vimeo.com/video/{id}`, `needsMetadataFetch: true`

#### Spotify

Host: `open.spotify.com`

Pattern: `open.spotify.com/{type}/{id}` where type is `track`, `album`, or `playlist`, id is `[A-Za-z0-9]+`

Result: `embedType: 'rich'`, `provider: 'spotify'`, `embedUrl: https://open.spotify.com/embed/{type}/{id}`, `needsMetadataFetch: true`

#### Bluesky

Host: `bsky.app` (also `www.`), over HTTPS or HTTP, no port and no credentials.

Pattern: `/profile/{handle or DID}/post/{record key}` (`parseBlueskyPostUrl`): a handle as a domain name, lower-cased, or a `did:plc:` or `did:web:` identifier; a record key of `[A-Za-z0-9._~:-]`, 1 to 512 characters.

Result: `embedType: 'post'`, `provider: 'bluesky'`, `embedUrl: null`, `needsMetadataFetch: false`: the post is read from Bluesky's public interface, not from its page ([Bluesky posts](#12-bluesky-posts)).

#### Fallthrough

Any URL that does not match a provider: `embedType: 'generic'`, `provider: null`, `embedUrl: null`, `needsMetadataFetch: true`

Invalid URLs (fail `new URL()` parsing): same as fallthrough.

---

## 3. SSRF Protection

`ssrf.ts:validateExternalUrl()` and `ssrf.ts:safeFetch()`

All outbound fetches to user- or peer-supplied URLs go through `safeFetch()`, which validates the target with `validateExternalUrl()` (below) and re-validates the destination of every redirect hop. `validateExternalUrl()` throws on any violation.

### Validation Steps

1. **URL parsing** — `new URL(url)` must succeed
2. **Scheme check** — only `http:` and `https:` allowed
3. **DNS resolution** — `dns.promises.lookup(hostname)` resolves hostname to IP
4. **Private IP check** — `isPrivateIp(address)` rejects anything that is not a publicly routable address

Step 3 resolves `URL.hostname` with the square brackets around an IPv6 literal
stripped first, because `dns.lookup` does not accept them. That is also what
makes an IPv6-literal URL usable: with the brackets attached, resolution always
failed and the URL was refused for the wrong reason.

### Blocked IP Ranges

`ssrf.ts:isPrivateIp()` is a thin wrapper: it calls `classifyAddress()`
(`utils/ipClass.ts`) and reports true for anything that does not come back
`public`. The classifier parses the address into octets or 16-bit groups and
tests range membership, so a range's boundaries are exact rather than whatever
a string prefix happens to cover.

`classifyAddress()` returns one of `public`, `loopback`, `private`,
`link-local`, `cgnat`, `unspecified`, `multicast` or `reserved`. Only `public`
is allowed out.

| Range | Class | Description |
|-------|-------|-------------|
| `127.0.0.0/8` | `loopback` | Loopback, the whole /8 |
| `0.0.0.0` | `unspecified` | Binds every interface |
| `0.0.0.0/8` (rest) | `reserved` | This-network |
| `10.0.0.0/8` | `private` | RFC 1918 |
| `172.16.0.0/12` | `private` | RFC 1918, 172.16 through 172.31 inclusive and nothing either side of it |
| `192.168.0.0/16` | `private` | RFC 1918 |
| `169.254.0.0/16` | `link-local` | Includes the cloud instance-metadata address |
| `100.64.0.0/10` | `cgnat` | RFC 6598 carrier-grade NAT |
| `192.0.0.0/24`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24` | `reserved` | Protocol assignments, benchmarking, TEST-NET-1/2/3 |
| `224.0.0.0/4` | `multicast` | RFC 5771 |
| `240.0.0.0/4` | `reserved` | Includes the broadcast address |
| `::` | `unspecified` | Reaches loopback on most stacks |
| `::1` | `loopback` | IPv6 loopback |
| `fc00::/7` | `private` | Unique local, `fc` and `fd` |
| `fe80::/10` | `link-local` | The full /10, `fe80` through `febf` |
| `ff00::/8` | `multicast` | |

**IPv4-mapped IPv6** is unwrapped to its IPv4 form before classification, in (An IPv4 address carried in NAT64, `64:ff9b::/96`, or 6to4, `2002::/16`, is classed by the address it carries, and the rest of `::/8`, the IPv4-compatible form among it, and `2001:db8::/32` as reserved: a gateway hands such a packet on to the IPv4 address inside.)
both spellings: the hex form `::ffff:7f00:1` that the WHATWG URL parser emits
and the dotted form `::ffff:127.0.0.1` that glibc's `inet_ntop` emits. Which
one arrives depends on the resolution path, so both are handled. A mapped
address that unwraps to a public IPv4 stays `public`.

**Fail-closed.** Anything the classifier cannot parse (an empty string, a
malformed address, an out-of-range octet) returns `reserved`, never `public`.
A classifier that answers "public" when it does not understand its input is
worse than none at all, because callers read `public` as permission.

### Redirect Handling

Outbound fetches use `safeFetch()` (`ssrf.ts`), which follows redirects **manually** (`redirect: 'manual'`) and runs `validateExternalUrl()` against every hop's destination before following it, capped at 5 redirects. A redirect from a public host to a private/internal address (loopback, link-local, RFC1918) is therefore blocked, closing the redirect-based SSRF bypass. Callers — `fetchUrlMetadata`, `probeRemoteImageDimensions`, and `fetchSpaceInviteSnapshot` — all route through `safeFetch` rather than calling `validateExternalUrl` + `fetch` separately.

**Residual:** `validateExternalUrl` resolves DNS and `fetch` resolves again, leaving a narrow DNS-rebinding TOCTOU window. Closing it fully requires pinning the resolved IP at connect time via a custom dispatcher; the redirect re-validation closes the practical, attacker-controlled bypass.

---

### Pinned addresses (1.32.7)

Every connection `safeFetch` opens goes through `publicOnlyDispatcher`, an undici `Agent` whose `lookup` is `publicOnlyLookup`: a name is refused when ANY of its addresses is not public, and the addresses checked are the ones connected to. Before, the check resolved the name once and `fetch` resolved it again for the connection, so DNS rebinding, or a private address beside a public one, reached the server's own network, and `GET /api/utils/metadata` handed back what it read. `validateExternalUrl` checks every address as well. `federationFetch` pins the same way for an origin a stranger asserted while `FEDERATION_ALLOW_PRIVATE_PEERS` is off. `undici` is a direct dependency for this alone: it is what Node's fetch is built on, and the only way to hand it a lookup.

## 4. Metadata Fetching

`metadataFetcher.ts:fetchUrlMetadata()`

### Flow

1. `safeFetch(url)` — SSRF-validated fetch (initial URL + every redirect hop); throws on block, caught to return `null`
2. Request sent with `User-Agent: TavvitBot/1.0`, 5-second timeout via `AbortController`
3. **Content-Type detection** — if response is `image/*`, `video/*`, or `audio/*`, returns early with `contentType` field set (no HTML parsing)
4. **Size guard** — rejects responses with `Content-Length > 512KB`
5. **Stream-read with hard limit** — reads body via `ReadableStream`, stops at 512KB even for chunked (unknown-length) responses
6. **HTML parsing** via Cheerio

### Metadata Extraction

Parsed from HTML using Cheerio with the following priority:

| Field | Primary Source | Fallback |
|-------|---------------|----------|
| `title` | `og:title` | `<title>` element |
| `description` | `og:description` | `<meta name="description">` |
| `image` | `og:image` | none |
| `siteName` | `og:site_name` | none |
| `imageWidth` | `og:image:width` | none |
| `imageHeight` | `og:image:height` | none |

`imageWidth`/`imageHeight` are only included when they parse as finite positive integers.

### Return Type

```typescript
interface UrlMetadata {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  url: string;
  contentType?: string;     // Set only for direct media (image/video/audio)
  imageWidth?: number;      // From og:image:width (HTML pages only)
  imageHeight?: number;     // From og:image:height (HTML pages only)
}
```

---

## 5. Embed Resolution

`embedResolver.ts:resolveEmbeds()`

Main pipeline function. Iterates over extracted URLs, resolves each independently (one URL failure does not block others).

A complete canonical `sticker:<absolute asset URL>` value returns no embeds (`extractUrls` checks `stickerUrl` first): `StickerMessage` renders that asset directly, so it must not also be unfurled as an image embed. Other content keeps the normal extraction path. An instance older than this check does unfurl a sticker sent to a space it hosts, so the client also draws no embeds for a sticker message. Token grammar: [uploads.md](uploads.md#14-personal-stickers).

### Per-URL Resolution Logic

```
classify URL
  |
  |-- image (by extension)?
  |     -> set image = url, skip metadata fetch
  |
  |-- needsMetadataFetch?
  |     -> fetchUrlMetadata(url)
  |     -> if metadata.contentType is media -> override embedType, set image = url
  |     -> else -> extract title/description/image/dimensions from OG metadata
  |     -> if generic + no title -> skip URL (no embed created)
  |
  |-- YouTube provider?
  |     -> set fallback thumbnail: https://img.youtube.com/vi/{id}/hqdefault.jpg
  |     -> set fallback dimensions: 480x360
  |
  |-- image with unknown dimensions?
  |     -> probeRemoteImageDimensions(image)
  |
  -> INSERT embed row into DB
```

### Content-Type Override

When `fetchUrlMetadata` returns a `contentType` field (indicating the URL points directly to a media file rather than an HTML page), the classifier's `embedType` is overridden:

| Content-Type prefix | Override to |
|---------------------|-------------|
| `image/` | `image` (+ sets `image = url`) |
| `video/` | `video` |
| `audio/` | `audio` |

When Content-Type is detected as media, OG metadata fields (title, description, image) are ignored.

### YouTube Thumbnail Fallback

For YouTube URLs, before metadata fetch, a predictable thumbnail URL is pre-populated:
- URL: `https://img.youtube.com/vi/{videoId}/hqdefault.jpg`
- Dimensions: 480x360 (hardcoded, matches hqdefault.jpg)

If the metadata fetch returns an `og:image`, it does **not** override this fallback for `image` (the `||` operator means the pre-populated non-null value wins). However, OG dimensions would only populate `width`/`height` if they were still null (using `??`), so the hardcoded 480x360 persists.

### Generic Embed Skip Rule

If `effectiveEmbedType` remains `generic` after metadata fetch and no `title` was extracted, the URL is silently skipped — no embed row is created.

### DB Insertion

Each embed gets a unique Snowflake ID. The `messageId` / `dmMessageId` field is set based on the `isDm` flag. All inserts are synchronous (Drizzle `.run()`).

---

Since 1.32.7 the 5 second abort of `fetchUrlMetadata` covers the body as well as the headers: a server that answered at once and then sent a byte every few minutes held the connection and the half-read page for as long. At most 6 messages have their previews worked out at once and 300 wait (`resolveEmbeds`); past that a message gets no preview.

## 6. Image Dimension Probing

`embedResolver.ts:probeRemoteImageDimensions()`

Used for direct image URLs where dimensions are unknown (not provided by OG tags or provider defaults).

### Mechanism

1. **SSRF-validated fetch** — `safeFetch(url)` validates the URL and every redirect hop; a block throws and is caught to return `null`
2. **Range request** — fetches first 32KB (`PROBE_BYTES = 32_768`) with header `Range: bytes=0-32767`
3. **Timeout** — 3-second abort (`PROBE_TIMEOUT_MS = 3_000`)
4. **Graceful body read** — reads up to `PROBE_BYTES` via `ReadableStream`, then aggressively cancels the connection via `reader.cancel()`
5. **Dimension extraction** — passes buffer to `sharp(buffer).metadata()`, returns `{width, height}` if both are positive integers

### Headers

```
User-Agent: TavvitBot/1.0
Accept: image/*
Range: bytes=0-32767
```

### Response Handling

- Accepts HTTP `200` (server ignored Range) or `206` (partial content)
- Any other status returns `null`
- If the server returns more than 32KB (ignored Range header), only the first 32KB is read
- All failures (network, timeout, unrecognized format, SSRF) silently return `null`

---

## 7. WebSocket Events

### Broadcast Delivery

After all embeds for a message are resolved, a single event is broadcast:

| Context | Event Type | Delivery | Fields |
|---------|-----------|----------|--------|
| Space channel | `embeds_resolved` | `connectionManager.sendToChannel(spaceId, channelId, ...)` | `messageId`, `channelId`, `embeds[]` |
| DM | `dm_embeds_resolved` | `connectionManager.sendToDmMembers(channelId, ...)` | `messageId`, `dmChannelId`, `embeds[]` |

If no embeds were resolved (all URLs skipped or failed), no event is broadcast.

### Client-Side Handling

`useWebSocket.ts` handles both events by patching the message in `useChatStore`:
1. Finds the message array for the channel/DM
2. Maps over messages, replacing the `embeds` array for the matching `messageId`
3. For federated contexts (`!isHome`): resolves relative image URLs via `resolveAssetUrl(embed.image, origin)`

---

## 8. Edit Re-resolution

When a message is edited, embeds are re-resolved via a **delete-then-resolve** pattern (not using `reResolveEmbeds` — that function exists but is currently unused).

### Edit Flow (identical for REST and WebSocket handlers)

1. Update message content in DB
2. **Synchronous delete** — `DELETE FROM embeds WHERE messageId = ?` (or `dmMessageId`)
3. Broadcast `message_updated` / `dm_message_updated` with empty `embeds[]`
4. **Asynchronous re-resolve** — `setImmediate(() => resolveEmbeds(...).catch(() => {}))` runs the full pipeline
5. New embeds arrive via `embeds_resolved` / `dm_embeds_resolved` event

This two-phase approach ensures the edit broadcast is immediate (with stale embeds removed), while new embeds arrive shortly after via a separate event.

### Callsites

| Handler | File | Line |
|---------|------|------|
| REST `PATCH /api/messages/:id` | `routes/messages.ts` | Inline delete + `setImmediate(resolveEmbeds)` |
| WS `message_edit` | `ws/events.ts` | Inline delete + `setImmediate(resolveEmbeds)` |
| REST `PATCH /api/dm/messages/:id` | `routes/dm.ts` | Inline delete + `setImmediate(resolveEmbeds)` |
| WS `dm_message_edit` | `ws/events.ts` | Inline delete + `setImmediate(resolveEmbeds)` |

---

## 9. Batch Fetching

Two functions load embeds for message lists (used when fetching message history):

| Function | Filters by | Returns |
|----------|-----------|---------|
| `fetchEmbedsForMessages(messageIds[])` | `embeds.messageId IN (...)` | `Map<messageId, embedRow[]>` |
| `fetchDmEmbedsForMessages(dmMessageIds[])` | `embeds.dmMessageId IN (...)` | `Map<dmMessageId, embedRow[]>` |

`embedRowToEmbed()` converts a DB row to the shared `Embed` type (maps nulls, casts enum strings).

---

## 10. Client Rendering

`EmbedRenderer` dispatches by `embed.embedType`:

```
EmbedRenderer
  |-- 'post'    -> BlueskyEmbed (provider bluesky; else GenericEmbed)
  |-- 'video'   -> VideoEmbed
  |-- 'image'   -> ImageEmbed
  |-- 'audio'   -> inline <audio> element
  |-- 'rich'    -> RichEmbed
  |-- 'generic' -> GenericEmbed (default)
```

`EmbedRenderer` takes the message's `onReply` and `onForward` (`Message.tsx`: Reply where the person may write, Forward where the message can be forwarded) and hands them to an embed that opens pictures in the media viewer.

### VideoEmbed

Two modes based on whether a provider is present:

**Direct video** (`!provider && !embedUrl`):
- Renders `<video>` element with `controls`, `preload="none"`, 16:9 aspect ratio

**Provider iframe** (YouTube/Vimeo):
- Initial state: thumbnail image with play button overlay (glass-bubble style)
- On click: replaces with `<iframe>` loading `embedUrl?autoplay=1&origin={window.location.origin}`
- iframe permissions: `accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share`, `allowFullScreen`
- Footer shows the provider's name (`embeds/providerLabel.ts`: `youtube` is YouTube, the others capitalized) and the linked title

### ImageEmbed

- When `embed.width && embed.height` are populated: wraps the `<img>` in a box sized by `mediaBox` (`chat/mediaBox.ts`: `aspect-ratio` and a width that fits 400 × 300 without enlarging), the one attachments use. Eliminates layout shift on image load.
- When dimensions are null: no wrapper sizing, no fallback aspect-ratio. Inner `<img>` renders within 400 × 300: the `max-w` of the button around it, its own `max-h-[300px]`. The absent fallback is deliberate — see the *Dimension reservation contract* section below.
- Inner `<img>`: `object-contain`, `loading="lazy"`, `referrerPolicy="no-referrer"`.
- Image source: `embed.image ?? embed.url`.
- Click opens the [media viewer](#13-the-media-viewer) via `useUIStore.openImagePreview()`.

### RichEmbed (Spotify)

Click-to-load pattern (no auto-loading of third-party iframes):

**Unloaded state** (default):
- Shows thumbnail, provider label, title, description, "Click to load" prompt
- Entire card is a `<button>` that triggers load

**Loaded state**:
- Renders `<iframe>` with `sandbox="allow-scripts allow-same-origin allow-popups"`
- iframe permissions: `autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture`

Height determination via `getIframeHeight()`:
1. `embed.height` if set
2. `PROVIDER_HEIGHTS[provider]` — currently only `spotify: 152`
3. Default: `200`

### GenericEmbed

- Returns `null` if no `embed.title` (no-op render)
- Shows provider name (from `embed.provider` or parsed hostname), linked title (2-line clamp), description (2-line clamp)
- If `embed.image` exists: 80x80 thumbnail on the right side

### AudioEmbed (inline in EmbedRenderer)

- Shows linked title (if present) + native `<audio>` element with `controls`, `preload="metadata"`
- Max width 400px, a hairline card

### Common Styling

All embed cards share:
- `max-w-[400px]` constraint
- no margin of their own: the message spaces its parts (6px, `.msg-content`)
- `.surface-card` (a hairline over the page) and `rounded-lg` corners; the provider in `font-mono text-label`, the title in the primary text colour with an underline under the pointer, so violet is left to the link in the message itself
- `referrerPolicy="no-referrer"` on all images

---

Since 1.32.7 every link in a preview or a card passes `webAddress` (http and https only, `utils/webAddress.ts`) and every embedded player `playerAddress` (only `EMBED_FRAME_ORIGINS`, now in `packages/shared/src/constants.ts` and shared with the server's `frame-src`). What another instance sends arrives as it was sent; a `javascript:` or `data:` address is dropped there, not left to the CSP alone.

## Dimension reservation contract

Embed renderers and the embed resolver share a bidirectional contract to prevent layout shift in the message list when embeds load.

**Server side.** `resolveEmbeds` in `packages/server/src/utils/embedResolver.ts` MUST attempt to populate `embeds.width` and `embeds.height` for every `image`-type embed it produces. The two paths are:
- `og:image:width` / `og:image:height` extracted from HTML metadata when the URL points at an HTML page with an OG image (`metadataFetcher.ts`, then `embedResolver.ts:182-185`).
- `probeRemoteImageDimensions` for direct image URLs and for HTML pages whose Content-Type is `image/*` (`embedResolver.ts:196-202`). The probe sends a `Range: bytes=0-32767` request and reads dimensions from the partial buffer via `sharp(buffer).metadata()`.

YouTube uses hardcoded 480×360 for `hqdefault.jpg` (`embedResolver.ts:153-154`). Vimeo uses OG dimensions from the metadata fetch.

**Client side.** Every embed renderer whose output contains an image, iframe, or video MUST reserve dimensions when they are known. The reference pattern is `mediaBox` in `packages/web/src/components/chat/mediaBox.ts` — wrap the media in a box with `style={mediaBox(width, height)}`: its `aspect-ratio` and a width that fits 400 × 300 (inline style, not Tailwind, because they are runtime values), with `max-w-full` beside it for narrow columns.

A Bluesky card (`BlueskyEmbed`) takes its sizes from the post itself, which Bluesky gives as each picture's and video's shape: one picture and the video by `mediaBox`, two to four pictures in a grid of a fixed 16:9 shape; a video without its shape stands in a 16:9 frame like the YouTube player, a structurally fixed layout.

When dimensions are not populated (probe failed, no OG tags, non-image type), the renderer must NOT apply a fallback `aspect-ratio` with a default ratio (e.g. 4/3). A fallback wrapper produces visible letterbox bars on content whose true ratio differs and was the cause of the revert in commit `0c84029`. Renderers without dimensions must use either a structurally fixed layout (iframe with hardcoded height, fixed-size thumbnail) or render unsized; the message list's anchoring model re-applies its anchor on every size change and media load, which absorbs residual shift. See `docs/systems/message-list.md`, "Anchoring model".

**Why bidirectional.** If only the server populates dims but the client ignores them, the database fills with unused data and embeds shift on load (the symptom from 2026-04-24 onward). If only the client reserves but the server doesn't populate, every embed falls into the unreserved branch and the contract has no effect. Both halves are required.

---

## 11. Utility Endpoint

`GET /api/utils/metadata?url=` (auth required)

Exposes `fetchUrlMetadata()` directly as a REST endpoint. Returns the `UrlMetadata` object, or `{}` if fetch fails. This is independent of the embed pipeline and can be used for ad-hoc URL previews.

---

## 12. Bluesky posts

A link to a post on Bluesky becomes a card of the post: who wrote it, its text with its links, mentions and hashtags, its pictures, video or link card, the post it quotes, and how many replied, reposted and liked it when the link was posted.

**Reading it** (`utils/bluesky.ts`). The server asks Bluesky's public interface, `https://public.api.bsky.app` (`BLUESKY_API_ORIGIN`, no account, through `safeFetch`, 5 seconds, at most 1 MB): `com.atproto.identity.resolveHandle` for the account behind a handle, then `app.bsky.feed.getPosts` for the post. `postFromView` keeps what the card shows (`BlueskyPost` in `packages/shared/src/bluesky.ts`):
- the author's DID, handle, display name and avatar;
- the text as runs (`textParts`): facets count UTF-8 bytes, so the text is cut as bytes, and a link becomes its address, a mention the profile on Bluesky, a hashtag its page there; a facet inside a character, past the end, over another or to anything but http(s) stays plain text;
- one to four pictures (thumbnail, full size, description, shape), or a video (HLS playlist, still, description, shape, and `loops` for one posted as a GIF), or a link card;
- a quoted post with its text and pictures (`app.bsky.embed.record#viewRecord`, also beside media); a quoted list, feed, starter pack, or a quote that is gone or blocked, shows no quote;
- the counts, and `sensitive` when the post, its author or the quote carries `porn`, `sexual`, `nudity`, `graphic-media`, `gore` or `!warn`.

A post labelled `!hide`, `!takedown` or `!suspend` gets no card at all. One that cannot be read (gone, for signed-in people only, Bluesky away) becomes an ordinary preview of its page through the generic path. The card is stored in `embeds.data` as JSON; its plain fields name the author (`Name (@handle)`), the first 500 characters of the text and the first picture, which is what a client that draws no posts (`embedType` it does not know) shows as a generic card.

**Only Bluesky's hosts.** Every address in a post is checked where it is made and again wherever one arrives (`blueskyPostOf`: `embedRowToEmbed` on the server, `BlueskyEmbed` on the client for what another instance sends): pictures and avatars only on `https://cdn.bsky.app`, videos only on `https://video.bsky.app` or `https://video.cdn.bsky.app`, the post and the quote only as `https://bsky.app/profile/…/post/…`; links in the text and the link card may lead anywhere a link in a message may (http and https), and open in a new tab. Anything else is dropped; a post whose own address does not hold is no post.

**The card** (`BlueskyEmbed.tsx`). The text, the author's name and the counts come from this server and show at once. The pictures and the video come from Bluesky and wait for the person's yes like any other preview ([legal.md](legal.md), "Content from other servers"): one notice for the hosts the post needs (`ExternalHostsNotice`, "Load" allows each of them until the app closes), the avatar as initials until `cdn.bsky.app` is allowed, a link card's and a quote's pictures only then. A post labelled sensitive keeps its pictures and video covered, and fetches nothing, until "Show". One picture takes its own shape (`mediaBox`); two to four fill a 16:9 grid. A picture opens the [media viewer](#13-the-media-viewer) on itself with the others beside it, with the message's Reply and Forward, and Copy and Save reading the file through `GET /api/embeds/bluesky-picture` (the picture host sends no CORS headers; api.md).

**The video** (`BlueskyVideo.tsx`). Its still and a play button until played. On the first play the light build of hls.js is loaded (`import('hls.js/light')`, a chunk of its own) and plays the playlist through Media Source; a browser without Media Source (Safari on an iPhone) plays HLS itself. Then Tavvit's own controls: play and pause (also by clicking the picture), the time, a timeline, sound and volume, picture in picture, full screen; the keys Space and K, M, F and the arrows (5 seconds) while the player has focus. A GIF plays in a loop without sound and offers no sound. A video that cannot play shows "Watch on Bluesky". The browser fetches the playlist's parts itself, which the CSP allows for Bluesky's two video hosts alone ([web-security.md](web-security.md)).

## 13. The media viewer

`MediaViewer.tsx`, over everything (`activeModal: 'imagePreview'`). `useUIStore.openImagePreview(url)` opens one picture (an image embed, an attachment, a sticker); `openMediaViewer({ items, index, onReply?, onForward? })` several, each a `MediaViewerItem`: the picture, a thumbnail for the strip, its description, the page it belongs to (`pageUrl`, for Open in browser and Copy link), and a `loadFile` where the page cannot fetch the file itself.

- Closes with its X, Escape or a click beside the picture.
- Several pictures: "2 of 4" at the top, arrows at the sides and the arrow keys, round the end; a strip of thumbnails at the bottom, the current one marked.
- Zoom up to 5×: the zoom button, + and -, the wheel (at the pointer), a double click; a zoomed picture is moved by dragging it. A new picture starts unzoomed.
- Actions: Open in browser, Copy link, Copy image (as PNG; a GIF, and anything that fails, as its link), Save, and Reply and Forward when the message came with them; those close the viewer first.
- The description shows under the picture.

---

## Constants Summary

| Constant | Value | Location |
|----------|-------|----------|
| `MAX_EMBEDS_PER_MESSAGE` | 5 | `embedResolver.ts` |
| `PROBE_BYTES` | 32,768 (32KB) | `embedResolver.ts` |
| `PROBE_TIMEOUT_MS` | 3,000ms | `embedResolver.ts` |
| Metadata fetch timeout | 5,000ms | `metadataFetcher.ts` |
| HTML body size limit | 512,000 bytes (512KB) | `metadataFetcher.ts` |
| User-Agent | `TavvitBot/1.0` | both fetchers |
| Spotify iframe height | 152px | `RichEmbed.tsx` |
| Default rich iframe height | 200px | `RichEmbed.tsx` |
| YouTube thumbnail dimensions | 480x360 | `embedResolver.ts` |
| Bluesky read timeout / body limit | 5,000ms / 1 MB | `bluesky.ts` |
| Bluesky picture for Copy and Save | 10,000ms, at most 20 MB, images only | `bluesky.ts` |
| Bluesky text / pictures | 3,000 characters / 4 | `BLUESKY_LIMITS`, `packages/shared/src/bluesky.ts` |

**Spoilers.** `extractUrls` leaves out what a `||spoiler||` holds: a preview of the link would give it away.
