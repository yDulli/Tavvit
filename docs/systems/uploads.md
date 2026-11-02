# File & Upload System

Source files:
- `packages/server/src/routes/uploads.ts` -- File serving (cache, security, Range)
- `packages/server/src/routes/files.ts` -- tus protocol endpoints (`/api/files/*`), PRE_CREATE / PRE_PATCH / POST_FINISH hooks, janitor helpers
- `packages/server/src/utils/thumbnail.ts` -- Image thumbnail generation (sharp), video thumbnail extraction (ffmpeg), image dimension probing, profile image resizing, media metadata extraction (incl. video codec)
- `packages/server/src/utils/mediaPlayable.ts` -- `classifyVideoPlayable(mimetype, codec)` web-playability classifier (drives `attachments.playable`)
- `packages/server/src/utils/fileCleanup.ts` -- File deletion helpers (disk + thumbnail + attachment record cleanup)
- `packages/server/src/utils/storageJanitor.ts` -- Storage stats, orphan detection, cleanup routines (orphaned files, unlinked attachments, dangling references, old media), federation GC, soft-deleted DM channel purge
- `packages/web/src/stores/transferStore.ts` -- Client transfer manager (uploads via tus-js-client, downloads via fetch + FS Access)
- `packages/web/src/stores/composerStore.ts` -- Per-channel staged transfer IDs, draft text, replyTo
- `packages/web/src/stores/pendingMessageStore.ts` -- Optimistic attachment-bearing message bubbles awaiting transfer completion
- `packages/web/src/stores/pendingMessageRehydrate.ts` -- Orchestrator that fires the deferred `POST /messages` once all transfers in a bubble complete
- `packages/web/src/utils/imageActions.ts` -- Client-side image save-to-disk and copy-to-clipboard actions
- `packages/web/src/utils/cropImage.ts` -- Client-side image cropping pipeline (canvas-based, WebP output)
- `packages/web/src/components/chat/AttachmentRenderer.tsx` -- Attachment display component (images, video, audio, generic files, federation badges)
- `packages/web/src/components/chat/AttachmentProgress.tsx` -- Radial-progress overlay for in-flight transfers in optimistic bubbles
- `packages/web/src/components/layout/TransferIndicator.tsx` -- Channel-header transfer indicator + global tray panel
- `packages/web/src/components/chat/ImagePreview.tsx` -- Full-screen image preview modal with save/copy toolbar
- `packages/server/src/routes/stickers.ts` -- Personal sticker collection, upload (base64 JSON, not tus) and asset serving
- `packages/server/src/utils/stickerAssets.ts` -- Sticker asset paths, the reference scan and the unused-asset cleanup
- `packages/shared/src/stickers.ts` -- Sticker token grammar (`stickerUrl`, `stickerIdOf`) and limits
- `packages/web/src/components/chat/StickerPicker.tsx`, `StickerUploadForm.tsx`, `StickerUploadPreview.tsx`, `StickerMessage.tsx` -- Picker, batch upload form, sticker message row
- `packages/web/src/utils/stickerMessages.ts` -- What a sticker message is and what a one-line surface shows for it

DB tables: `attachments`, `instance_settings` (maxUploadSizeBytes), `sticker_assets`, `personal_stickers`. See `docs/systems/database.md` for full schemas.

**Out of scope:** Federation file replication/download queue (see `docs/systems/federation.md`), admin storage stats UI, admin user management.

**Personal stickers** have their own small upload path, storage directory and cleanup phase; see [section 14](#14-personal-stickers). The tus pipeline and the attachment lifecycle do not handle them.

### Capability Matrix

| Browser | Picker (`showOpenFilePicker`) | Drag-drop FS handle | Save destination handle | Reload survival |
|---------|-------------------------------|---------------------|-------------------------|-----------------|
| Chrome / Edge | yes | yes | yes | Auto-resume |
| Firefox / Safari | — | — | — | Re-pick required |

Paste-from-clipboard yields a `File`, not a handle, on every browser -- never reload-resumable.

---

## 1. Upload Pipeline (tus)

The server speaks the [tus resumable upload protocol](https://tus.io/protocols/resumable-upload) on `/api/files/*` (see `routes/files.ts`). Uploads are chunked, resumable across tab reload and network drop, and authenticated on every request.

### Endpoint Group: `/api/files/*`

| Method | Path | Purpose | Auth | Hooks |
|--------|------|---------|------|-------|
| `POST` | `/api/files/` | Create upload session. Returns `Location` as a path (`/api/files/<id>`, see below) and `Upload-Expires` (24 h). | JWT | PRE_CREATE: rate limit 30/min/user, size validation, snowflake assignment |
| `HEAD` | `/api/files/:uploadId` | Resume probe. Returns `Upload-Offset`. | JWT + ownership | -- |
| `PATCH` | `/api/files/:uploadId` | Append bytes at offset. | JWT + ownership | PRE_PATCH: slowloris rate ~1000/min/IP |
| `DELETE` | `/api/files/:uploadId` | Abort and discard partial bytes. | JWT + ownership | -- |
| `OPTIONS` | `/api/files/` | tus capability advertisement (extensions, max size). | none | -- |

### Storage Layout

| Path | Owner | Contents |
|------|-------|----------|
| `${uploadDir}/.tus/` | tus | In-progress uploads + per-upload `<id>.json` metadata sidecar. |
| `${uploadDir}/` | server | Final files renamed on `POST_FINISH` to `${snowflakeId}-${32 hex}${ext}` (`storedUploadName`, see Security). |

### POST_FINISH Hook

When the final PATCH completes, the hook:

1. Verifies `metadata.userId === req.user.id` (defense in depth -- ownership was already enforced on PATCH).
2. Renames `${uploadDir}/.tus/<uploadId>` to `${uploadDir}/${snowflakeId}-${32 hex}${ext}`, where `ext = path.extname(metadata.originalName).toLowerCase()`.
3. Runs media processing (sharp for images, ffmpeg/ffprobe for video/audio) -- same code path as the legacy multipart endpoint used to.
4. Inserts an `attachments` row with `messageId = NULL` (linked to a message later when the user sends).
5. Returns the new `Attachment` JSON in the final-PATCH response body, so the client can stage the attachment ID without an extra round trip.

### Janitor

| Trigger | Function / Path | Sweeps |
|---------|-----------------|--------|
| User cancels mid-upload | Client `tus.abort(true)` → tus DELETE | Immediate cleanup of the `.tus/` payload + sidecar. |
| User discards a paused/failed bubble | `transferStore.abortUpload` → manual `fetch DELETE` (when no live tus instance) | Immediate cleanup of the `.tus/` payload + sidecar. |
| Janitor tick (every ~30 s) | `cleanupTusUploads()` | Invokes `@tus/file-store.deleteExpired()` (24 h `Upload-Expires` default, configurable via `tusExpirationMs`). |
| Janitor tick (every ~30 s) | `cleanupTusStragglers()` | Defensive unlink of any `.tus/` entry whose mtime is older than `tusStragglerSweepMs` (48 h default) — catches orphans the tus library missed (payload without sidecar, sidecar without payload). |
| Admin-triggered | `POST /api/admin/storage/cleanup-tus` → `cleanupStaleTusSessions(thresholdMs, dryRun)` | Manual sweep with configurable `maxAgeHours` (default 1 h). Supports preview (`dryRun=true`) before live deletion. |
| Janitor tick (post-finalize) | `getUnlinkedAttachments()` | 1 h grace for finalized attachment rows that were never linked to a message. |

Stats: `getStorageStats()` exposes `staleTusSessions` + `staleTusSize` for the admin Storage Overview, computed via `getStaleTusInfo(60 * 60 * 1000)` — entries with mtime older than 1 h. The display threshold is fixed (matches the cleanup default); the admin route's `maxAgeHours` is what's actually configurable.

### Limits per account

So that no single account can fill the disk (`utils/accountLimits.ts`, `shared/src/accountLimits.ts`). The operator sets them under Admin console → Storage; 0 means no limit, and instance admins have none. The size of one file is its own limit (`maxUploadSizeBytes`), checked first.

| Limit | Default | Where | Refusal |
|-------|---------|-------|---------|
| Files one account keeps | 5 GB, `instance_settings.storage_per_account_bytes`, or its own `users.storage_limit_bytes` (0: none; null: the instance's) | `onUploadCreate`, again in `onUploadFinish` | 413 `storage_limit_reached` |
| Spaces one account owns | 25, `instance_settings.spaces_per_account` | `POST /api/spaces`, the Discord import into a new space. Handing a space over is not limited. | 409 `space_limit_reached` |
| Room on the disk | Keeps the smaller of 2 GB and 5% free, whoever uploads | `onUploadCreate` (`fs.statfsSync`). A disk that cannot be asked is no reason to refuse. | 507 `disk_full` |

**What counts** is `storageUsedByAccount`: the sizes in `attachments` under `uploader_id`, the account's own and those of the bots it runs, one per `filename`, without `source_url` (a copy fetched from another instance). So a file held through several messages counts once, a forwarded copy counts for the person who forwarded it, and five bots do not make five times the room. It has to: if only the original counted, forwarding a file to yourself and deleting the original would free the room while the file stays. Thumbnails do not count. Soundboard clips count on the account that added them (`space_sounds.size` by `created_by`), for as long as their space keeps them (1.32.8): a clip is checked against the account's room and the disk's reserve before its file is written, and held like an upload under way while it is. Pictures of profiles, emoji and stickers have limits of their own and leave `attachments`, or never enter it. A group DM's icon is a picture too: what bounds those files is that an account is in at most 100 groups (`utils/groupDmLimits.ts`), and each icon is written anew at an icon's size. Lowering a limit takes nothing away; only new uploads are refused.

**Uploads under way** (`reserveUpload`) count from the moment they start. Their bytes are in `.tus/` and in no table yet: without this, uploads started side by side would all pass, and uploads never finished would take room nothing counts. The check and the reservation run with nothing awaited between them. What is held goes when the upload finishes, is cancelled (`POST_TERMINATE`) or expires (`tusExpirationMs`), and is forgotten on a restart, which is why `onUploadFinish` checks once more and removes the staged file when it no longer fits.

**An upload has to say how long it is.** `Upload-Defer-Length` answers 400: a length given later would pass every limit unchecked.

The refusals are JSON in a tus body (`refusedUpload`), which `uploadFailure` in `stores/transferStore.ts` reads for the code. A person sees their figure under Settings → Account (`StorageSection`, `GET /api/users/@me/storage`).

### Security

- JWT verified on every tus request (PRE_CREATE, PRE_PATCH, finalize, HEAD, DELETE).
- **Federated uploads use a per-origin JWT.** When the target space is hosted on a remote instance, the client must send that instance's scoped token (resolved via `getTokenForOrigin(origin)` in `crossStoreResolvers.ts`), not the home-instance token — otherwise the remote rejects the request as it can't verify the home signature or resolve the userId.
- **CORS for federated tus uploads.** The server's `@fastify/cors` registration in `index.ts` permits the tus protocol's request headers (`Tus-Resumable`, `Upload-Length`, `Upload-Offset`, `Upload-Metadata`, `Upload-Defer-Length`, `Upload-Concat`, `Upload-Checksum`, `X-HTTP-Method-Override`) and exposes the response headers tus-js-client needs to read across origins (`Location`, `Tus-Resumable`, `Tus-Version`, `Tus-Extension`, `Tus-Max-Size`, `Tus-Checksum-Algorithm`, `Upload-Offset`, `Upload-Length`, `Upload-Metadata`, `Upload-Expires`). Without these, browser preflight blocks cross-origin POST/HEAD/PATCH/DELETE on `/api/files/*`.
- **`Location` is relative (`relativeLocation: true`).** An absolute Location would have to be assembled from `Host` / `X-Forwarded-Host`, which is whatever the fronting proxy chose to send; nginx's `$host` drops the port, so an instance on a custom public port handed out a Location pointing at a port the client never used (#44). tus-js-client resolves a relative Location against the endpoint it uploaded to, and `transferStore` stores the resolved absolute URL (`utils/tusUrl.ts`: `tusEndpoint(origin)` gives the absolute endpoint, `resolveTusUrl(location, origin)` resolves the Location; home origin when `origin` is empty) so resume and cancel work for federated uploads too.
- PRE_PATCH ownership check: `metadata.userId === req.user.id`. Required to prevent in-flight upload hijack between session creation and finalize.
- Size validated against `instance_settings.maxUploadSizeBytes` at PRE_CREATE; tus's own `maxSize` is set as defense-in-depth.
- Original filename round-trips through tus metadata (base64-encoded per spec); the on-disk filename uses snowflake + random part + sanitized extension only.
- **The name is the key.** `GET /api/uploads/<name>` answers anyone, without a session, because a picture in a page is fetched without one: a file in a DM or a private channel is protected by its name alone. A snowflake is a reading of the clock (worker id and sequence are visible in any id anyone sees), so a name of the snowflake alone could be counted through. Every stored name is `storedUploadName(id, ext)` (`utils/uploadNames.ts`): the snowflake, a hyphen and 128 random bits. Uploads, files replicated from a peer (`federationWorker.ts`) and profile pictures downloaded from a home (`federation/profile.ts`) all use it. Files of messages and DM messages stored before 1.32.4 are renamed by the hourly storage janitor (`utils/legacyUploadNames.ts`), at most 500 a run and only once they are a day old, so a file still on its way to a peer is not pulled from under it. The new name is derived from the old one with a key of this server (HKDF from `JWT_SECRET`), so a run cut off half way finds the same name again: a hard link first, then the rows (`attachments.filename`, `thumbnail_filename`) in one transaction, then the old name goes, with nothing in between. A file a picture field also shows is left alone: it is public anyway. An address to an old name that someone pasted into a message stops working; that was the guessable key.

---

## 2. MIME Type Handling

### Extension-to-MIME Map (`EXT_MIMETYPES`)

Used as fallback when serving files without a DB record (thumbnails, orphans).

| Category | Extensions | MIME types |
|----------|-----------|------------|
| Images | `.webp`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`, `.avif`, `.tiff`, `.bmp`, `.ico` | `image/webp`, `image/jpeg`, `image/png`, `image/gif`, `image/svg+xml`, `image/avif`, `image/tiff`, `image/bmp`, `image/x-icon` |
| Video | `.mp4`, `.webm`, `.mov` | `video/mp4`, `video/webm`, `video/quicktime` |
| Audio | `.mp3`, `.ogg`, `.wav`, `.flac`, `.aac`, `.opus` | `audio/mpeg`, `audio/ogg`, `audio/wav`, `audio/flac`, `audio/aac`, `audio/opus` |
| Documents | `.pdf` | `application/pdf` |

Fallback MIME for unknown extensions: `application/octet-stream`.

### Resizable Image Types (`RESIZABLE_MIMETYPES`)

Only these MIME types receive thumbnail generation:

```
image/jpeg, image/png, image/webp, image/gif, image/avif, image/tiff
```

**Not resizable:** `image/svg+xml`, `image/bmp`, `image/x-icon` -- these are served as-is.

---

## 3. Media Processing

Processing occurs inline during upload, before the response is sent. All processing is non-fatal -- failures are logged but the upload still succeeds.

### Image Processing

**Condition:** `isResizableImage(mimetype)` returns true

1. **Thumbnail generation** (`thumbnail.ts:generateThumbnail`)
   - Skip if width <= 800px (`THUMBNAIL_MAX_WIDTH`)
   - Skip if animated (GIF with `metadata.pages > 1` -- Sharp would flatten to single frame)
   - Resize to max 800px width, `withoutEnlargement: true`
   - Output: WebP at quality 80 (`THUMBNAIL_QUALITY`)
   - Filename: `${snowflakeId}_thumb.webp` (via `thumbFilename()`)
   - Returns `null` if skipped or on error

2. **Dimension probing** (`thumbnail.ts:probeImageDimensions`)
   - Uses `sharp(filepath).metadata()` to extract `width` and `height`
   - Works for all formats including animated GIFs

### Video Processing

**Condition:** `mimetype.startsWith('video/')`

1. **Thumbnail extraction** (`thumbnail.ts:generateVideoThumbnail`)
   - Requires ffmpeg on system PATH (availability cached on first check)
   - Extracts a single frame using ffmpeg, trying seek times `['1', '0']` (falls back to 0s for short clips)
   - ffmpeg command: `-ss {time} -i {filepath} -frames:v 1 -f image2pipe -vcodec png -`
   - Frame is piped to stdout as PNG buffer (max 50 MB)
   - The PNG frame is then processed through sharp:
     - Dimensions read from frame metadata (rotation-corrected by ffmpeg)
     - Resized to max 800px width, converted to WebP quality 80
   - Returns `{ thumbnailFilename, width, height }` (dimensions are from the original frame, not the thumbnail)

2. **Metadata probing** (`thumbnail.ts:probeMediaMeta`)
   - ffprobe for dimensions + codec: `-select_streams v:0 -show_entries stream=width,height,codec_name -of json`
   - ffprobe for duration: `-show_entries format=duration -of json`
   - Duration rounded to 2 decimal places
   - If thumbnail extraction failed, dimensions fall back to ffprobe values
   - Returns `codec` (the primary video stream's `codec_name`) when available

3. **Web-playability classification** (`mediaPlayable.ts:classifyVideoPlayable`)
   - The finish hook calls `classifyVideoPlayable(mimetype, codec)` and stores the result in `attachments.playable` (tri-state, see below).
   - The browser `<video>` element can't decode every uploaded format. The dominant failure case is a macOS screen recording — a `video/quicktime` (.mov) container holding an **HEVC (H.265)** stream — which Chromium, Firefox and stock Electron can't decode. The file uploads fine and a server-side ffmpeg poster is generated, but inline playback silently fails (stuck at 0:00 with no error).
   - `attachments.playable` is a deliberate tri-state:
     - `0` / `false` — codec is confidently undecodable in mainstream browsers (HEVC, ProRes, WMV, MPEG-1/2, etc.). The client renders a download fallback card directly, no flash of a dead player.
     - `1` / `true` — web-standard codec (H.264/AVC, VP8/VP9, AV1, Theora) in a web container (`video/mp4`, `video/webm`, `video/ogg`). Plays inline.
     - `NULL` — unknown / optimistic. Codec couldn't be probed (ffmpeg absent or probe failed), or it's a web-safe codec in a container with inconsistent cross-browser support (H.264 in .mov). The client attempts inline playback and degrades via the `<video>` `onError` handler.
   - `false` is never widened beyond codecs known to fail everywhere, so an instance without ffmpeg keeps prior behaviour (attempt playback) rather than regressing every video to "unplayable".
   - **The verdict is computed Chromium-first and is not authoritative per-client.** Web-playability of HEVC is browser-dependent — WebKit (Safari/iOS) decodes it via the OS while Chromium/Firefox/Electron don't. The client therefore treats `playable === false` as "needs a capability check": it pre-renders the fallback only when the current browser also can't decode the format (`BROWSER_SUPPORTS_HEVC` in `AttachmentRenderer.tsx`). See §9 Attachment Rendering.

### Audio Processing

**Condition:** `mimetype.startsWith('audio/')`

1. **Duration probing** (`thumbnail.ts:probeMediaMeta`)
   - ffprobe for duration only (same command as video duration)
   - No thumbnail or dimension extraction

### ffmpeg Availability

- Checked once via `execFile('ffprobe', ['-version'])` with 5s timeout
- Result cached in module-level `ffmpegAvailable` variable
- If unavailable: video thumbnails and all media metadata extraction are silently disabled
- All ffmpeg/ffprobe calls use 10-second timeout (`FFMPEG_TIMEOUT`)

---

## 4. Profile Image Resizing

Profile images (avatars, banners, space icons) use the general upload pipeline but are additionally resized server-side after the user/space update.

### `thumbnail.ts:resizeProfileImage(filepath, type)`

| Type | Max dimension (px) |
|------|--------------------|
| `avatar` | 256 |
| `icon` | 256 |
| `banner` | 1280 |

**Behavior:**
- Uses sharp with `{ animated: true }` to preserve GIF animation
- No-op if image width is already <= max dimension
- Writes to temp file (`filepath + '.tmp'`), then atomically renames (`fs.renameSync`) to avoid corruption
- Non-fatal: on error, original file is preserved, temp file cleaned up

### Profile Upload Lifecycle

When a user sets an avatar/banner, a space sets an icon/banner, or a member sets a space profile picture/banner:

1. Client uploads file via `POST /api/uploads` (creates attachment record)
2. Client sends `PATCH /users/@me`, `PATCH /spaces/:id` (or `POST /spaces`) or `PATCH /spaces/:id/members/@me/profile` with the filename
3. Server strips `/api/uploads/` prefix if present and checks the file is the caller's own (see "Profile pictures" below)
4. The replaced file is deleted from disk (`deleteUploadFile`), with its attachment record, once nothing else shows it
5. New attachment record cleaned up (reference now lives in the `users`/`spaces`/`space_members` row)
6. File resized in-place via `resizeProfileImage`

The attachment record for profile images is intentionally deleted -- the authoritative reference moves to the `users.avatar`/`users.banner`, `spaces.icon`/`spaces.banner` or `space_members.avatar`/`space_members.banner` column.

### Profile pictures

`utils/profileImageRefs.ts` holds the rules every picture field shares:

- **Which files are pictures** (`profileImageFilenames`): account pictures and banners, space profile pictures and banners, space icons and banners, the icons of group DMs that are not soft-deleted. The storage janitor's orphan sweep and its unlinked-attachment phase both read this list, so a picture is never swept as an orphan, however its upload's attachment row went.
- **Whether a file is still shown** (`profileImageInUse`): asked before a replaced picture is deleted (account, space, space profile, space deletion) and by `tombstoneUser`, which hands back only files nothing else shows.
- **Written anew before it is shown** (1.32.8): `resizeProfileImage` re-encodes the file at the field's size in its own format (JPEG, PNG, WebP, GIF, AVIF only) and answers whether it could. Every field (account, space, space profile, bot, group DM icon) calls it before the row takes the file, and refuses with `400 profile_image_invalid` when it could not, so no field shows an upload as it was sent.
- **What a field may be set to** (`ownProfileUploadOf`, the group DM icon included since 1.32.8): a file on this instance must be an upload of the caller's own that no message holds (an `attachments` row with their `uploader_id` and neither `message_id` nor `dm_message_id`), or the picture the field already shows. Anything else is `400 avatar_url_invalid` / `banner_url_invalid` / `icon_url_invalid`. Without this rule, naming someone else's file would resize it in place and replacing it later would delete it. An address on another site (`http(s)://`) is kept as it always was for accounts and spaces; a space profile takes none.

### Mobile Transfer-Chrome Surfaces

In-flight transfers (chat attachments, profile/banner uploads) are surfaced via the shared `TransferIndicator` component. Mount points:

- **Chat header (desktop):** every `MainContent.tsx` header variant — DM, group DM, space text channel, voice.
- **Chat header (mobile):** `MobileChatScreen.tsx` mounts `<TransferIndicator />` in its custom header.
- **Settings/Instance screens (mobile):** mounted via `MobileScreenHeader.tsx`'s `rightActions` slot on every settings screen — `MobileSettingsScreen` (hub + each direct panel). This guarantees that a profile-picture or banner upload triggered from settings has visible progress chrome and an abort affordance regardless of the user's current screen.

The component is lightweight when idle — the underlying `transferStore` Map subscription is a single `useMemo` over `Array.from(...).filter(t => t.tray)`, and the rendered button is a small icon (no badge) until at least one transfer is active. Safe to mount on every settings screen without performance impact.

The dropdown panel uses `touchstart` + `mousedown` listeners for click-outside dismissal so a single tap on iOS Safari closes the tray. Panel width is `min(300px, calc(100vw - 16px))` to prevent right-edge clipping on narrow viewports while keeping the desktop panel size unchanged.

---

## 5. Thumbnail Generation Details

### Filename Convention

```
thumbnail.ts:thumbFilename(original)
  input:  "1234567890123456-0f3a…c9.png"
  output: "1234567890123456-0f3a…c9_thumb.webp"
```

Strips the original extension, appends `_thumb.webp`.

### Parameters

| Parameter | Value |
|-----------|-------|
| Max width | 800px (`THUMBNAIL_MAX_WIDTH`) |
| Format | WebP |
| Quality | 80 (`THUMBNAIL_QUALITY`) |
| Enlargement | Disabled (`withoutEnlargement: true`) |

### When Thumbnails Are NOT Generated

- Image width <= 800px (already small enough)
- Animated images (GIF with multiple pages) -- Sharp would strip animation
- SVG, BMP, ICO (not in `RESIZABLE_MIMETYPES`)
- ffmpeg unavailable (video thumbnails only)
- Any processing error (non-fatal, logged)

---

## 6. File Serving

### Endpoint: `GET /api/uploads/:filename`

| Property | Value |
|----------|-------|
| Auth | None (public) |
| Path safety | `path.basename(filename)` prevents directory traversal |

### MIME Resolution Priority

1. `attachments.mimetype` from DB (lookup by filename)
2. `EXT_MIMETYPES` map (extension-based fallback for thumbnails/orphans)
3. `application/octet-stream` (final fallback)

### Response Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `Cache-Control` | `public, max-age=31536000, immutable` | 1-year cache, immutable (filenames are a snowflake and a random part, never reused) |
| `Content-Type` | Resolved MIME type | |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME sniffing |
| `Content-Security-Policy` | `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'` | Prevents script execution in uploaded files |
| `X-Frame-Options` | `DENY` | Prevents iframe embedding |
| `Accept-Ranges` | `bytes` | Advertises Range support |
| `Content-Length` | File size in bytes | |

**The served-file policy is enforcing, and it owns the response.** The app-wide
CSP hook in `index.ts` attaches the app policy only when a route has not
already set `Content-Security-Policy`, so it stands aside here rather than
overwriting a sandbox with something looser. Any future route that sets
an enforcing policy takes on the same ownership: the app policy will not be
merged into it. One case is worth knowing about because it is easy to get
backwards: the 404 branch returns before these headers are set, so a request
for a missing file gets the ordinary app policy, not the sandbox. Both are
asserted in `test/http-security-headers.test.ts`. Full construction and rollout
state in `docs/systems/web-security.md`.

### Content-Disposition (Forced Download)

Files that trigger `Content-Disposition: attachment`:
- **SVGs** (`image/svg+xml`) -- prevents XSS via inline SVG rendering
- **Non-media files** (anything not `image/*`, `video/*`, or `audio/*`)

Filename is URI-encoded: `attachment; filename="${encodeURIComponent(originalName)}"`.

### Range Requests (A/V Seeking)

When `Range` header is present:
1. Parse one `bytes=start-end`, `bytes=start-` or `bytes=-suffix` (`byteRange` in `routes/uploads.ts`), the end clamped to the file. Anything else (several ranges, a reversed or malformed one) is ignored and the whole file sent; a range starting past the end answers `416` with `Content-Range: bytes */size`.
2. Set `Content-Range: bytes start-end/totalSize`
3. Set `Content-Length` to chunk size
4. Return `206 Partial Content` with `fs.createReadStream({ start, end })`

Without Range header: streams entire file with `200 OK`.

---

## 7. File Cleanup Utilities

### `fileCleanup.ts:deleteUploadFile(filename)`

Deletes a file and its thumbnail from disk.

```
path.basename(filename)  -- directory traversal prevention
fs.unlinkSync(filePath)  -- tolerates ENOENT
fs.unlinkSync(thumbPath) -- always attempted, silently ignored if missing
```

### `fileCleanup.ts:deleteAttachmentFiles(rows)`

Batch deletion: calls `deleteUploadFile` for each `{ filename }` in the array.

### `fileCleanup.ts:deleteAttachmentByFilename(filename)`

Deletes the attachment DB record and its thumbnail from disk. Used when profile images are set/replaced (the reference moves to `users`/`spaces` tables).

```
1. Look up attachment record by filename
2. Delete thumbnail file from disk (if thumbnailFilename is set)
3. Delete attachment DB record
```

Idempotent: no-op if no record exists.

---

## 8. Storage Janitor

### File Classification

`storageJanitor.ts:classifyFile()` categorizes files by extension for storage stats:

| Category | Extensions |
|----------|-----------|
| `image` | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.ico`, `.bmp`, `.avif` |
| `video` | `.mp4`, `.webm`, `.mov`, `.avi`, `.mkv` |
| `audio` | `.mp3`, `.ogg`, `.wav`, `.flac`, `.aac`, `.m4a`, `.opus` |
| `document` | `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.txt`, `.csv`, `.json`, `.xml` |
| `other` | Everything else |

### Referenced File Detection

**`getReferencedFilenames()`** builds a set of all filenames that should exist on disk:
- User avatars (`users.avatar` where not null)
- User banners (`users.banner` where not null)
- Space icons (`spaces.icon` where not null)
- Space banners (`spaces.banner` where not null)
- Attachment filenames (`attachments.filename`)
- Attachment thumbnails (`attachments.thumbnailFilename` where not null)

All values are `path.basename()`-normalized.

**`getProfileReferencedFilenames()`** is a subset: only user avatars/banners and space icons/banners. Used to protect profile images during cleanup.

### Unlinked Attachment Detection

`getUnlinkedAttachments()` finds attachment records where:
- `messageId IS NULL` AND `dmMessageId IS NULL` (never linked to a message)
- `createdAt < (now - 1 hour)` (`UNLINKED_AGE_MS = 3,600,000ms`)
- Filename is NOT in profile-referenced set (protects in-use profile images)

These are files uploaded but never sent in a message (abandoned uploads, profile images whose attachment record should have been cleaned up).

### Dangling Attachment Detection

`getDanglingAttachments()` finds attachment records whose message no longer exists:
- Space messages: `attachments.message_id IS NOT NULL` but no matching `messages.id`
- DM messages: `attachments.dm_message_id IS NOT NULL` but no matching `dm_messages.id`

Uses raw SQL with LEFT JOIN for efficiency.

### Storage Stats (`getStorageStats()`)

Returns `StorageStats` object:

```typescript
{
  totalFiles: number;        // All files on disk
  totalSize: number;         // Total bytes on disk
  referencedFiles: number;   // Files with DB references
  referencedSize: number;    // Bytes of referenced files
  orphanedFiles: number;     // Files on disk with no DB reference
  orphanedSize: number;      // Bytes of orphaned files
  unlinkedAttachments: number; // DB records with no message link (>1h old)
  unlinkedSize: number;
  danglingAttachments: number; // DB records pointing to deleted messages
  danglingSize: number;
  breakdown: StorageBreakdown[]; // Per-category {type, count, size}, sorted by size desc
}
```

### Cleanup Routines

#### `cleanupStorage(dryRun: boolean) -> CleanupResult`

Three-phase cleanup:

**Phase 1: Orphaned disk files** -- Files on disk not referenced by any DB record (attachment, profile).
- Deletes file + thumbnail via `deleteUploadFile`

**Phase 2: Unlinked attachment records** -- Attachment DB records with no message link, older than 1 hour.
- If file is used as a profile image: keep file, delete only the thumbnail and DB record
- If file is not a profile image: delete file, thumbnail, and DB record

**Phase 3: Dangling attachment records** -- Attachment DB records pointing to deleted messages.
- Deletes file, thumbnail, and DB record

**Phase 4: Unused sticker assets** -- `cleanupUnusedStickerAssets` in `utils/stickerAssets.ts`; see [section 14](#14-personal-stickers), "Cleanup".
- Deletes the asset row and its file when nothing on this instance names it and the row is past its 24-hour grace period
- Deletes temporary sticker files older than one hour
- Its counts are added to `deletedFiles` and `freedBytes`; it removes no attachment records

#### `cleanupOldMedia(maxAgeDays: number, dryRun: boolean) -> CleanupResult`

Age-based media cleanup:
- Finds attachments where `(message_id IS NOT NULL OR dm_message_id IS NOT NULL) AND created_at < cutoff`
- Skips files used as profile images
- Deletes file, thumbnail, and DB record

#### `CleanupResult`

```typescript
{
  dryRun: boolean;
  deletedFiles: number;
  freedBytes: number;
  deletedAttachmentRecords: number;
  errors: string[];
}
```

When `dryRun = true`: counts are computed but no files/records are deleted.

### Federation GC (`runFederationJanitor()`)

Periodic cleanup of federation data (called by background worker):

| Task | Function | Criteria |
|------|----------|---------|
| Expired outbox entries | `cleanupFederationOutbox()` | `expiresAt < now` |
| Old mutation log | `cleanupFederationMutationLog(90)` | `mutatedAt < (now - 90 days)` |
| Stale file queue | `cleanupFederationFileQueue()` | Completed entries > 7 days old, OR `expiresAt < now` |
| Soft-deleted DM channels | `cleanupSoftDeletedDmChannels()` | `deletedAt < (now - 24 hours)` |

#### Soft-Deleted DM Channel Purge

`cleanupSoftDeletedDmChannels()` hard-deletes DM channels that were soft-deleted more than 24 hours ago. Cascades in transaction:

```
1. Collect message IDs and attachment filenames
2. Transaction:
   - Delete dm_reactions (by message IDs)
   - Delete embeds (by message IDs)
   - Delete attachments DB records (by message IDs)
   - Delete federation_file_queue entries (by message IDs)
   - Delete dm_messages
   - Delete dm_members
   - Delete read_states
   - Delete federation_outbox entries (by channel ID as contextId)
   - Delete federation_mutation_log entries (by channel ID as contextId)
   - Delete dm_channels record
3. Delete attachment files from disk (outside transaction)
```

### Admin Endpoints

The admin routes (`routes/admin.ts`) expose the janitor functions via REST:

| Endpoint | Method | Function |
|----------|--------|----------|
| `GET /api/admin/storage/stats` | GET | `getStorageStats()` |
| `GET /api/admin/storage/orphans` | GET | `getOrphanedFiles()` |
| `POST /api/admin/storage/cleanup` | POST | `cleanupStorage(dryRun)` |
| `POST /api/admin/storage/cleanup-media` | POST | `cleanupOldMedia(maxAgeDays, dryRun)` |
| `POST /api/admin/storage/cleanup-tus` | POST | `cleanupStaleTusSessions(maxAgeHours * 3600 * 1000, dryRun)` |

All require JWT + admin role. See `docs/systems/api.md` for request/response formats.

---

## 9. Client-Side Architecture

Three stores with strict separation of concerns:

| Store | Source file | Ownership |
|-------|-------------|-----------|
| `transferStore` | `packages/web/src/stores/transferStore.ts` | Every byte transfer (uploads + downloads). Source of truth for the global tray. Persists transfer metadata via `transferStore@v1`. Tus uploads route the bearer token through `getTokenForOrigin(origin)` so federated uploads use the per-instance JWT, not the home-instance one. |
| `composerStore` | `packages/web/src/stores/composerStore.ts` | Per-channel staged transfer IDs + draft text + replyTo. Replaces `MessageInput` component-local state. Persists via `composerStore@v1`. |
| `pendingMessageStore` | `packages/web/src/stores/pendingMessageStore.ts` | Composed-but-not-yet-sent attachment-bearing bubbles, keyed by `clientId`. Persists via `pendingMessageStore@v1`. Text-only messages are out of scope -- they keep the existing `chatStore.sendMessage` `temp_*` optimistic path. |

### Optimistic Bubble Lifecycle

1. User attaches a file -> `transferStore.startUpload` (eager, fires before Send) -> the new transferId joins `composerStore[channelId].stagedTransferIds`.
2. User clicks Send -> `pendingMessageStore.append({ ... transferIds })` -> `composerStore.clear`. The bubble renders in `MessageList` at its `createdAtLocal` position.
3. The orchestrator (`packages/web/src/stores/pendingMessageRehydrate.ts`) polls `listReadyForDeferredSend()`; once every transfer in the bubble is `completed` with an `attachmentId`, it fires `POST /messages` with the collected `attachmentIds` and removes the bubble on success.
4. WS echo dedup: when a real message arrives in the channel (`chatStore.addMessage` or `addRealtimeMessage`) whose content + sorted attachmentIds match a pending bubble (`pendingMessageStore.matchAndRemove`), the oldest matching bubble is removed (FIFO tiebreaker). The author is not compared: the attachment ids were issued to this client's uploads, so a match is the echo. Until then the bubble renders as the user's row on the channel's instance (`myRowForOrigin`, client-federation.md §5); no bubble renders while that instance has not named the row.
5. Failure: bubble flips to `state: 'failed'`. Retry re-runs failed transfers only; discard aborts everything and clears the bubble.

### Reload Survival

- `transferStore`, `composerStore`, `pendingMessageStore` all use Zustand `persist` against versioned `localStorage` keys (`transferStore@v1`, `composerStore@v1`, `pendingMessageStore@v1`).
- File handles (Chrome/Edge picker + drag-drop only) are persisted to IndexedDB via `idbHandles.ts` keyed by `transfer.fileHandleId`. Permission is re-prompted on resume only when the explicit Resume click provides a user-gesture; the boot path queries silently and never prompts.
- Bytes themselves never persist. On unsupported browsers the user re-picks (uploads) or restarts (downloads).
- TTL: pending bubbles whose `tusExpiresAt` is past are dropped on rehydrate with a one-time toast.
- All-transfers-already-complete branch: if every transferId in a rehydrated pending bubble already has an `attachmentId`, the deferred `POST /messages` fires immediately on app start.

#### Boot-time normalization

On store rehydrate (`onRehydrateStorage` in `transferStore.ts` -> `normalizeRehydratedTransfers`):

1. Any transfer left in `'active'` state (defensive — `partialize` already filters most) is demoted to `'paused'`. No live worker exists post-reload.
2. For each `'paused'` transfer, if the bytes are unrecoverable (upload with no `fileHandleId`; download with no `destFileHandleId`), the transfer is marked `'failed'` with an actionable message ("File no longer available — discard and re-upload" / "Download cannot resume — bytes lost. Restart the download."). The UI then surfaces the discard control instead of a misleading paused state.
3. For each `'paused'` transfer with a stored handle, the rehydrate path *silently* queries permission via `queryHandlePermission` (never calls `requestPermission`, so no user-gesture is required and no prompt appears). If `'granted'`, the transfer auto-resumes on the next tick. If `'prompt'` or `'denied'`, it stays paused — the user's click on Resume provides the user-gesture for `requestPermission`.

Idempotent: re-running is harmless (already-resumed transfers move to `'active'`, no-op for completed/failed).

The paused state is visually distinct in `AttachmentProgress.tsx`: a grey conic-gradient ring with a centered pause-icon disk (instead of the bright ring + percentage text used while active), so the user can immediately tell "nothing is happening" from "in progress".

### Attachment Rendering (`AttachmentRenderer.tsx`)

URL resolution for attachment/thumbnail:
- If filename starts with `http` or `/`: used as-is (federated or absolute path)
- Otherwise: prefixed with `/api/uploads/`

| MIME category | Rendering |
|---------------|-----------|
| `image/*` | A button holding the `<img>`: click-to-preview, lazy loading, its box from width/height (`mediaBox`), max 400x300px, uses thumbnail if available. A run of two or more pictures is a gallery (`AttachmentList`): 400px wide, cells cut to fit, rows of two (4:3) before rows of three (square), so it never ends on a lone picture |
| `video/*` | `VideoAttachment` sub-component. Playable (`playable !== false`): `<video src>` with native controls, poster from thumbnail, preload `none` (with dimensions) or `metadata` (without), max 400px wide / 300px tall, with an `onError` handler that falls back to the download card. Unplayable (`playable === false`, e.g. HEVC .mov): renders the download card directly — poster (if any) under a "Can't play here — download" overlay, plus filename, duration, size and a one-tap download. **Browser-aware:** the `playable === false` verdict is computed Chromium-first, so the client only pre-fails when *this* browser also can't decode the format. WebKit (Safari/iOS) decodes HEVC via the OS, so a Safari user still gets inline playback (gated on `BROWSER_SUPPORTS_HEVC`, a one-time `canPlayType` probe for `hvc1`/`hev1`); the `onError` handler remains the safety net. Never a silently broken player. |
| `audio/*` | Audio card with icon, filename, size, `<audio>` with native controls, preload `metadata`, max 400px wide |
| Other | Download card with file icon, filename, size and a download mark; the whole card is the button |

#### Federation Status Badges

Inline badges shown for federated attachments:

| `federationStatus` | Badge | Tooltip |
|--------------------|-------|---------|
| `remote` | Cloud icon (muted) | "Hosted on {username}'s instance. Download to keep a local copy." |
| `remote_partial` | Warning triangle (amber) | "File couldn't be cached on {username}'s instance (limit: {N} MB). They can still view it from yours." |

The `federationMeta` JSON is parsed for display details (source username, rejection limits).

### Image Preview (`ImagePreview.tsx`)

Full-screen overlay (`z-[200]`) with a `bg-black/80` backdrop.

- Opens via `useUIStore.openImagePreview(url)` (triggered by clicking an image in `AttachmentRenderer`)
- Shows full-resolution image (not thumbnail) -- max 90vw x 90vh, `object-contain`
- Toolbar (top-right): Save, Copy, Close buttons
- Click backdrop to close, click image to prevent close propagation
- Managed by `activeModal === 'imagePreview'` state

---

## 10. Client-Side: Image Actions

### `imageActions.ts:saveImage(url, filename?)`

Downloads an image by fetching as blob and creating a temporary download link:

```
1. Derive filename from URL (last path segment) or use provided name
2. fetch(url) -> blob -> URL.createObjectURL -> <a download> click -> revoke
3. Fallback on error: window.open(url) + toast "Opened in new tab"
```

### `imageActions.ts:copyImageToClipboard(url)`

Copies image to clipboard as PNG:

```
1. GIF detection (by URL extension or Tenor/Klipy domain pattern):
   - If GIF: copy URL as text instead (preserves animation)
2. fetch(url) -> blob
3. If response type is image/gif: copy URL as text
4. If PNG: use blob directly
5. Otherwise: convert to PNG via canvas (drawImage -> toBlob('image/png'))
6. navigator.clipboard.write([ClipboardItem({ 'image/png': pngBlob })])
7. Fallback on error: copy URL as text + toast
```

**GIF detection patterns (`isGifUrl`):**
- URL path ends with `.gif`
- URL matches `media.tenor.com` or `static.klipy.com`

---

## 11. Client-Side: Image Cropping

### `cropImage.ts:cropImage(imageSrc, pixelCrop, outputType?, options?)`

Used by profile image editors (avatar/banner crop dialogs, integrated with `react-easy-crop`).

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `imageSrc` | `string` | required | Image URL or data URI |
| `pixelCrop` | `PixelCrop` | required | `{ x, y, width, height }` in pixels |
| `outputType` | `string` | `'image/webp'` | MIME type for output |
| `options.maxDimension` | `number?` | none | Max width/height (downscale if exceeded) |
| `options.quality` | `number?` | `0.85` | Compression quality (0-1) |
| `options.outputType` | `string?` | uses `outputType` param | Overrides the positional param |

**Pipeline:**

```
1. Load image with crossOrigin='anonymous'
2. Draw crop region at original size onto canvas
3. If maxDimension set and crop exceeds it:
   - Scale uniformly: scale = maxDimension / max(width, height)
   - Draw scaled onto second canvas
4. Export via canvas.toBlob(finalType, quality)
5. WebP fallback: if toBlob returns null for WebP, retry as PNG (old Safari compatibility)
```

Returns a `Blob` (Promise).

### `PixelCrop` Interface

```typescript
interface PixelCrop {
  x: number;      // Left offset in source image pixels
  y: number;      // Top offset in source image pixels
  width: number;  // Crop width in pixels
  height: number; // Crop height in pixels
}
```

---

## 12. Asset URL Resolution (Federation)

### `assetUrls.ts`

Handles URL rewriting for federated content:

| Function | Purpose |
|----------|---------|
| `stripUploadPrefix(filename)` | Strips `/api/uploads/` prefix from filename; no-op for bare filenames and absolute URLs |
| `resolveAssetUrl(filename, origin)` | Converts relative filename to absolute URL for remote origins; pass-through for `http`-prefixed URLs |
| `normalizeUserAssets(user, origin)` | Rewrites `user.avatar` and `user.banner` for remote origins; also sets `homeInstance`/`homeUserId` for users local to the remote instance |
| `normalizeMessageAssets(message, origin)` | Rewrites user assets + attachment filenames/thumbnails for remote origins; recurses into `replyTo` |

These functions are called client-side when displaying content from federated instances, ensuring relative upload paths are resolved to the correct remote server.

---

## 13. Download Pipeline

`transferStore.startDownload(url, opts)` is the single client-side entry point for saving any file (right-click Save Image / Save Video / Save Audio, the file-card download button, and the `ImagePreview` toolbar). The store branches on capability:

### Path 1: FS Access (Chrome/Edge with `showSaveFilePicker`)

1. Prompt the user via `showSaveFilePicker`. Persist the returned handle to IndexedDB.
2. Open a writable; stream `fetch` body to disk; update progress per chunk.
3. **Pause:** `controller.abort()` and close the writable. **Resume:** re-permission the handle, query the existing file size, restart `fetch` with `Range: bytes=<size>-`.
4. Reload survival: the handle persists in IDB and the partial bytes are already on disk -- resume picks up where the previous tab left off.

### Path 2: Blob fallback (Safari/Firefox/paste-no-handle)

1. `fetch` accumulates body to in-memory chunks.
2. On completion: `URL.createObjectURL` + temporary anchor click + `URL.revokeObjectURL`.
3. Pause is unsupported (the tray button is disabled with a tooltip). Reload discards the in-memory blob with a one-time toast.

### Triggers

| Source file | Site |
|-------------|------|
| `packages/web/src/utils/imageActions.ts` | `saveImage()` -- right-click Save Image, `ImagePreview` toolbar |
| `packages/web/src/components/chat/messageMenuItems.tsx` | Save Image / Save Video / Save Audio menu entries |
| `packages/web/src/components/chat/AttachmentRenderer.tsx` | File-card download button (replaces the previous native `<a download>`) |

---

## 14. Personal Stickers

Each account keeps a collection of stickers: small images it can send as a message or use as a reaction. A sticker travels as text, never as an attachment, so it needs no new message, reaction, WebSocket or federation field.

### Token

A sticker is the whole content of a message, or the whole `emoji` of a reaction, written as

```
sticker:<origin>/api/stickers/assets/<sha256>.webp
```

`<origin>` is `getOurOrigin()` of the instance that stores the asset (`PUBLIC_ORIGIN`, else `https://DOMAIN`). `stickerUrl` in `packages/shared/src/stickers.ts` accepts a value only when it is exactly one canonical http(s) URL with that path, no userinfo, query or fragment, and returns the URL to draw; `stickerIdOf` returns the hash. Anything else, including text that merely contains a token, is ordinary text. The origin is written into every token, so changing `PUBLIC_ORIGIN` or `DOMAIN` later leaves earlier stickers pointing at the old address.

The client reads `isStickerMessage` and `messageTextForPreview` from `utils/stickerMessages.ts`. The timeline row draws the image (`StickerMessage`) and draws no embeds for it. Every one-line surface (DM sidebar preview, desktop notification body, reply quote, search result) shows the localized word "Sticker". A sticker message has no Edit action, is skipped by the Up key, and hides Copy Text. A reaction pill draws the image at 28 px and its hover card at full width above the reactor names.

### Upload and collection

`POST /api/stickers` takes `{ name, image }`, the image as canonical base64 inside the JSON body of the authenticated API client (not tus: stickers are small and are stored once per content hash). The route:

1. refuses a name `normalizeStickerName` refuses (`sticker_name_invalid` with `details.max`: blank, over 100 characters after trimming, a line break, a control or bidirectional character, or nothing visible; the name is stored trimmed), more than 30 uploads per account per minute (`429 rate_limited`, a fixed window keyed on the row id, so each federated account counts on its own) and a full collection (`409 sticker_collection_full`, 200 entries, `MAX_PERSONAL_STICKERS`);
2. decodes the bytes with sharp: at most 5 MiB in, at most 16,777,216 decoded pixels across all frames, PNG, JPEG, WebP or GIF only (SVG and anything else is `400 sticker_invalid_image` with `details.max`, the limit in MB);
3. re-encodes to WebP, keeping animation and frame delays, fitting every frame into 512 x 512 without enlarging, and refuses a result larger than 5 MiB. Metadata and any bytes outside the image are dropped;
4. names the asset by the SHA-256 of the encoded bytes, writes (or makes fresh again) its `sticker_assets` row, writes the file to a temporary name and renames it into place, then adds the collection entry.

`POST /api/stickers/:id/collect` takes `{ token, name }` and adds an existing local asset: the token must be exactly this instance's token for that id (`400 sticker_not_local` otherwise) and the asset must exist (`404 sticker_not_found`). The client sends a localized default name. Collecting is idempotent: an entry already in the collection is returned unchanged, even when the collection is full. `PATCH /api/stickers/:id` takes `{ name }` and renames only the caller's entry (`404 sticker_not_found` when the caller has none for that id); another account's entry for the same asset keeps its own name, and messages and reactions are unaffected because they carry the token, not the name. Collect and rename apply the same name rule as upload. `DELETE /api/stickers/:id` removes only the caller's entry; the asset stays for messages and reactions that use it. No WebSocket event follows any of these; the picker reads the collection each time it opens.

The picker renames and removes entries only in its Manage mode, so picking a sticker never changes one. Rename replaces the grid with a form, the way the upload form does, rather than a dialog over it: the picker sits in a popover or sheet that closes on an outside click, so a portaled dialog would close the picker that owns it, and the desktop context menu draws under those popovers, so tiles have no right-click menu. In every picker host (composer popover, reaction popover, phone sheet), Escape closes an open rename or upload form first and puts focus back on the tile or the upload button; the next Escape closes the picker (`components/chat/pickerEscape.tsx`). A search box above the grid (shown once the collection has an entry) keeps the entries whose name contains the trimmed query, ignoring case (`filterStickers`).

The upload form takes up to 20 images at once (`MAX_STICKER_BATCH`, fewer when the collection has less room) from the file picker, a drop or a paste. It previews and names them locally and sends nothing until the user confirms. It then uploads them one at a time: each accepted image leaves the form and is added to the picker, each refused one stays with its reason under its name, and the batch stops at the first refusal every later image would meet (`rate_limited`, `sticker_collection_full`). Nothing is rolled back.

Collecting is in the context menu ("Add to my stickers") of a sticker message, a local image attachment and a sticker reaction pill; the pill opens the same image menu (`buildImageMenuItems`) instead of the message menu. A sticker token is first collected by reference (`POST /api/stickers/:id/collect`). When the home instance answers `sticker_not_local`, the browser reads the image from the canonical asset URL in the token (the address it already draws the sticker from) without cookies and past the HTTP cache, requires an `image/webp` answer of at most 5 MiB, and uploads it like a picked file; the home instance re-encodes it and stores its own copy under a new hash, so saving the same sticker again returns the existing entry. An unreachable instance, a missing CORS answer or a non-WebP answer shows "The image could not be loaded"; a home refusal shows its coded text. A local image attachment (`/api/uploads/...` on the page's own origin) is read from its original URL, capped at 5 MiB while streaming, and uploaded the same way. The server never fetches a URL a client names.

### Serving

`GET /api/stickers/assets/:sha256.webp` is public, like `/api/uploads/:filename`: anyone holding the link can read the image. It answers `404 sticker_not_found` for a malformed name, an unknown id, or a row whose file is missing, and otherwise sends the file with `Cache-Control: public, max-age=31536000, immutable`, `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self'` and `X-Frame-Options: DENY`. The collection routes need a JWT and only ever read or change the caller's own entries.

### Storage and cleanup

Files live in `UPLOAD_DIR/stickers/<sha256>.webp`. The attachment phases of the janitor read only the top level of `UPLOAD_DIR`, and the storage stats do not count this directory. Back it up with the rest of the upload directory.

Phase 4 of `cleanupStorage` (`cleanupUnusedStickerAssets`) removes an asset when no collection entry, channel message, DM message, channel reaction or DM reaction on this instance names it and its `created_at` is more than 24 hours old. The upload sets `created_at` to the upload time before it writes the file, also for bytes that already have a row, so a file being uploaded is never inside the cleanup's reach; the cleanup runs synchronously from its reference scan to its last delete. Temporary files older than an hour are removed too.

### Across instances

A sticker message or reaction crosses instances as its token, through the existing DM message and reaction relay and the existing channel routes. Viewers' browsers load the image from the origin in the token, the way they load an image embed from its host; no instance downloads or replicates the asset, and the file size checks of [federation file replication](federation.md#7-file-replication) do not apply.

- A user sends stickers from their home collection (`api.stickers` is the home client). In a space hosted on another instance, the message is stored there and the image still comes from the home instance.
- The cleanup above counts only rows on its own instance. A sticker used only in a space on another instance stops rendering there once its owner removes it from their collection and no local message or reaction uses it.
- "Add to my stickers" on another instance's sticker makes a copy in the home collection (see Upload and collection). The copy no longer depends on the other instance: it keeps rendering after the original owner removes theirs.
- What an older version shows: a 1.10.0 or older client shows the token as a line of text with a link, and a sticker reaction as a pill holding that text. A current instance resolves no embed for a token (embeds.md, `extractUrls`). A space hosted on a 1.10.0 or older instance does: a sticker sent there gets an image embed of its asset URL, so that instance's own clients see the text and the image, and a current client hides the embed and draws the sticker once. A relayed DM gets no embed on any version, because the receiving side of the relay resolves none.

---

## Boundary with Federation

This spec covers **local** file storage and serving. The boundary:

| This spec (uploads.md) | Federation spec (federation.md) |
|------------------------|---------------------------------|
| Multipart upload reception | File download queue (`federation_file_queue`) |
| Thumbnail/metadata generation | Size validation against remote peer limits |
| Disk storage and serving | `file_rejected` relay event |
| Orphan detection and cleanup | File queue worker (background download) |
| Storage stats and admin cleanup | `remoteMaxUploadSize` on peer records |
| `attachments` record creation | `sourceUrl`, `federationStatus`, `federationMeta` fields |

The `attachments` table contains federation-specific columns (`sourceUrl`, `federationStatus`, `federationMeta`) that are populated by the federation file download worker, not by the upload pipeline.

## Spoilers and forwards

`attachments.spoiler` is set when the message is sent, from `spoilerAttachments`, and only for files the message carries. `AttachmentRenderer` covers a picture or video until a reader asks; the file itself is served as ever, so this protects from seeing by accident and no more.

Forwarding copies a message's files under new names (`routes/forward.ts`, with `COPYFILE_FICLONE` where the disk can). The copy is an attachment like any other, so deleting either message leaves the other whole and the janitor sees both as referenced.

## Voice messages

A voice message is an ordinary audio attachment that carries its waveform: `attachments.voice_waveform`, up to 64 bar heights from 0 to 100 as `12,40,7` (`shared/src/voiceMessages.ts`). It needs no rights of its own: SEND_MESSAGES and ATTACH_FILES, as any file.

**Recording** (`utils/voiceRecorder.ts`, `VoiceRecorderBar`) happens in the browser with `MediaRecorder`, in the first format it offers: Opus in WebM, or `audio/mp4` on an iPhone. Nothing leaves the device until the person sends it from the preview. On a window it is click and stop; on a phone, hold and let go. A recording stops by itself after five minutes, and one shorter than half a second is thrown away as a slip of the finger. An analyser samples the loudness ten times a second, and `barsFromLevels` makes the bars when it ends.

**The file name decides what it is:** the server takes the type from the extension, not from the client. A recording is named `.weba` (`audio/webm`) or `.m4a` (`audio/mp4`), which both file routes know, because `.webm` reads as a video.

**Upload** runs through the usual tus pipeline. Two metadata fields come along, `voiceWaveform` and `voiceDuration`, and `onUploadFinish` takes them only for audio and only if the waveform parses (`parseWaveform`). ffprobe gives the length when it can; a recording in the browser's own format often states none, and then the length measured while recording is used, capped at the limit. It is only ever shown.

The message goes out as a pending bubble, as with any file, so it survives a slow upload. The waveform travels with the attachment: REST, socket, the DM relay (`FederationRelayAttachment.voiceWaveform`, checked again on arrival), and a forward copies it.

**Playing** (`VoiceMessagePlayer`): play and pause, the bars to jump around in (a slider, with arrow keys for five seconds), the time, and 1, 1.5 or 2 times the speed. An audio attachment with no waveform keeps the normal player.

## Limits on every writer (1.32.7)

Every path that writes a file now keeps to the account's storage, the disk's reserve, or both:

- **Forwards:** copies are hard links named by `storedUploadName`, count on the forwarder, and are checked and held as uploads are (`routes/forward.ts`). A copy that cannot be a link is made only while the disk keeps its reserve (`DiskFullError`, `utils/attachmentCopies.ts`).
- **Follow copies:** the copies an announcement follow brings count on whoever set the follow up (`storageAccountOf`, `channel_follows.created_by`) and are checked before copying; refused, the post arrives without its files. Before, deleting the original freed the poster's storage while the hard-linked file stayed.
- **Picture fields:** an own upload goes into a field only as an image of at most `PICTURE_UPLOAD_MAX_BYTES` (8 MB), and `resizeProfileImage` always writes it anew at the field's size. Setting a field drops the upload's record, so before, any upload of any size could be made to count for nothing. A member's own picture and banner for a space are deleted when the membership goes: leave, kick, ban, space deletion (`releaseMemberPictures`).
- **Animated profile pictures** (`POST /api/users/@me/profile-image`) are counted and refused as uploads, and named like them.
- **Stickers:** at most 50 new ones a day per account, and none past the disk reserve.
- **Uploads under way** keep their reservation for 15 minutes without bytes (`touchUpload` on every PATCH), not for the whole tus expiry: started and never sent, a few of them refused every upload on the instance for a day.
- **Data exports** stop before writing past the disk reserve; after a failed one the next waits an hour.
- **Files from peers** are counted as they arrive and stop at the declared size, never past `MAX_UPLOAD_SIZE`; they wait while the disk is at its reserve. At most 25 attachments of one relayed message are kept.
- **Media work:** sharp reads at most 120 megapixels for an upload's thumbnail and 64 for a picture field, every frame together; at most two media jobs (sharp or ffmpeg) run at once. ffmpeg and ffprobe open only the file, as one of the containers in `FFMPEG_INPUT_LIMITS` (`-protocol_whitelist file`, `-format_whitelist`): no HLS or concat playlist can make the server fetch an address or read another file.

**Serving:** the stored type is no longer sent as it is (`utils/uploadTypes.ts`). Only a known type is sent, shown in the page when it is a picture, a video or a sound (never SVG) and downloaded otherwise; anything else goes as `application/octet-stream`, downloaded. The type a peer gives a relayed file is kept only when it is a known one (`relayedMimetype`). Every response carries `sandbox` in its CSP, so a file opened on its own is no page of this origin.
