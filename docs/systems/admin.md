# Admin & Instance Configuration System

Source files:
- `packages/server/src/routes/admin.ts` -- User management (list, role, password reset, deletion), storage management endpoints
- `packages/server/src/routes/platformAdmin.ts` -- The platform admin area: overview, account detail, suspensions, badge grants, spaces, the review queue and its decisions, the platform audit log
- `packages/server/src/routes/spaceReview.ts` -- A space owner's side of the reviews: verification and Discovery requests, withdrawals, the review state
- `packages/server/src/routes/instance.ts` -- Public instance info endpoint
- `packages/server/src/routes/settings.ts` -- Instance settings and streaming limits endpoints
- `packages/server/src/utils/auth.ts` -- `requireAdmin` middleware; `verifyJwtAndUser` refuses suspended accounts
- `packages/server/src/utils/suspension.ts` -- `activeSuspension()`, `suspendedNow()`, `suspensionDetails()`
- `packages/server/src/utils/spaceReview.ts` -- Review state machine, request parsing, history, `reviewsAfterEdit()`, `reviewsAfterTransfer()`, `recordEditSteps()`
- `packages/server/src/utils/reviewNotify.ts` -- Who hears of a platform decision (WebSocket events, the directory's dirty flag)
- `packages/server/src/utils/discoveryListing.ts` -- `LISTED_IN_DISCOVERY_SQL`, the one "listed in Discovery" predicate
- `packages/server/src/utils/platformAudit.ts` -- `recordPlatformAudit()`, `readPlatformAudit()`, `platformActors()`
- `packages/server/src/utils/badges.ts` -- Reading granted badges; the derived staff and verified badges ([badges.md](badges.md))
- `packages/server/src/utils/adminUser.ts` -- `toAdminUser()`
- `packages/server/src/utils/userDeletion.ts` -- `tombstoneUser()` deletion logic
- `packages/server/src/utils/storageJanitor.ts` -- Storage stats, orphan detection, cleanup
- `packages/server/drizzle/0041_orbit_platform_admin.sql` -- Suspension, badge and review columns, the review and audit tables, listed spaces moved into review
- `packages/shared/src/platform.ts` -- Statuses, decision rules, limits, audit actions and wire types of the platform administration
- `packages/shared/src/badges.ts` -- The badge registry ([badges.md](badges.md))
- `packages/web/src/stores/settingsStore.ts` -- Zustand store for instance/streaming settings
- `packages/web/src/stores/reviewStore.ts` -- Open review requests (admins) and per-space review revisions (owners)
- `packages/web/src/components/admin/AdminConsole.tsx` -- The admin console at `/admin`: its shell, on a window and on a phone
- `packages/web/src/components/admin/AdminDashboard.tsx`, `DayChart.tsx` -- The console's overview and its charts
- `packages/web/src/components/admin/AnnouncementsSection.tsx`, `SignupRulesSection.tsx`, `StarterSpacesSection.tsx`, `SystemSection.tsx`, `AccountSections.tsx`, `AdminSearch.tsx` -- The console's own sections
- `packages/server/src/routes/adminConsole.ts` -- The console's own routes
- `packages/server/src/utils/signupRules.ts`, `packages/server/src/utils/spaceJoin.ts` -- Who may sign up; joining a public space, and the starter spaces
- `packages/shared/src/adminConsole.ts` -- Its limits and wire types
- `packages/server/drizzle/0049_tavvit_admin_console.sql` -- `announcements`, `admin_notes`, `signup_rules`, `starter_spaces`
- `packages/web/src/components/modals/instanceSettingsPanels/ReviewQueuePanel.tsx` -- Open verification and listing requests
- `packages/web/src/components/modals/instanceSettingsPanels/PlatformSpacesPanel.tsx` -- Every space the instance hosts
- `packages/web/src/components/modals/instanceSettingsPanels/AdminSpaceDetailModal.tsx` -- One space: both reviews, decisions, badges, audit entries
- `packages/web/src/components/modals/instanceSettingsPanels/AdminUserDetailModal.tsx` -- One account: facts, suspension, badges, audit entries
- `packages/web/src/components/modals/instanceSettingsPanels/PlatformAuditPanel.tsx`, `PlatformAuditList.tsx` -- The platform audit log
- `packages/web/src/components/modals/instanceSettingsPanels/GeneralPanel.tsx` -- General settings UI
- `packages/web/src/components/modals/instanceSettingsPanels/RegistrationPanel.tsx` -- Registration toggles + invite-link CRUD UI
- `packages/web/src/components/modals/instanceSettingsPanels/FederationPanel.tsx` -- Federation peers panel (peering, approval queue, peer status, rotation, reset)
- `packages/web/src/components/modals/instanceSettingsPanels/StoragePanel.tsx` -- Storage management UI
- `packages/web/src/components/modals/instanceSettingsPanels/StreamingPanel.tsx` -- Streaming config UI
- `packages/web/src/components/modals/instanceSettingsPanels/UsersPanel.tsx` -- User management UI
- `packages/web/src/components/review/ReviewParts.tsx` -- What both sides of a review show: status chip, history, decision dialog, listing preview
- `packages/web/src/components/modals/spaceSettingsPanels/VerificationPanel.tsx` -- The owner's Verification tab in space settings
- `packages/web/src/components/modals/spaceSettingsPanels/DiscoveryListingSection.tsx` -- The owner's listing request in the space's Discovery tab
- `packages/web/src/components/auth/LoginPage.tsx` -- The suspension notice at sign-in
- `packages/server/src/routes/invites.ts` -- Admin invite-link CRUD endpoints
- `packages/server/src/utils/inviteService.ts` -- Token generation, derived status, atomic redemption transaction
- `packages/shared/src/types.ts` -- Shared type interfaces
- `packages/shared/src/constants.ts` -- Streaming constants (resolutions, framerates, bitrate matrix)

---

## Authentication & Authorization

All admin endpoints use two Fastify preHandlers chained in order:

1. **`authenticate`** -- Verifies JWT from `Authorization: Bearer <token>` header, sets `request.userId`
2. **`requireAdmin`** -- Queries `users` table, verifies `isAdmin === 1`. Returns 403 if not admin.

```
auth.ts:requireAdmin()
  → db.select().from(users).where(id = request.userId)
  → if !caller || caller.isAdmin !== 1 → 403 "Only instance admins can perform this action"
```

The instance info endpoint (`GET /api/instance/info`) is fully public with no auth.
The streaming limits read endpoint (`GET /api/settings/streaming`) requires only `authenticate` (any logged-in user).

`authenticate` refuses a suspended account with `401 account_suspended` ([Suspensions](#suspensions)); since it runs first, a suspended account never reaches `requireAdmin`. `requireAdmin` is the only gate to platform decisions: no space role, owner group, permission bit or space ownership opens an `/api/admin/*` route ([Platform administration](#platform-administration)).

---

## Instance Settings Table

Singleton row in `instance_settings` (id=1). See [database.md](database.md) for full schema.

Settings are split into two API surfaces:

| Setting Group | Read Endpoint | Write Endpoint |
|---------------|--------------|----------------|
| General/Admin | `GET /api/settings/instance` (admin) | `PATCH /api/settings/instance` (admin) |
| Streaming | `GET /api/settings/streaming` (auth) | `PATCH /api/settings/streaming` (admin) |
| Public info | `GET /api/instance/info` (public) | N/A (derived from settings) |

### General Settings Schema (InstanceAdminSettings)

| Field | Type | DB Column | Validation | Notes |
|-------|------|-----------|------------|-------|
| instanceName | string | instanceName | 1-32 chars, trimmed | Default: `'Backspace'` |
| registrationOpen | boolean | registrationOpen | boolean | Local-account registration. DB null = use env `REGISTRATION_OPEN` (default true) |
| federatedRegistrationOpen | boolean | federatedRegistrationOpen | boolean | Federated-account creation against this instance. NOT NULL DEFAULT 1. Controls whether remote users can create `username@thisInstance` accounts via Connections (see auth.md + client-federation.md) |
| discoveryEnabled | boolean | discoveryEnabled | boolean | Controls the space Explore page, which lists only spaces an admin approved ([Discovery approval](#discovery-approval)) |
| gifApiKey | string? | gifApiKey | string or empty to clear | Returned masked as `****{last4}` for security |
| gifEnabled | boolean? | (derived) | -- | Read-only; true when gifApiKey is non-null |
| maxUploadSizeMb | number | maxUploadSizeBytes | positive integer (>=1 MB), upper bound is JS safe-integer ceiling (~8 EB) — effectively unlimited | Operator-set; no application cap. Stored as bytes; converted on read/write. DB null = use env `MAX_UPLOAD_SIZE` (default 100MB) |
| federationRelayEnabled | boolean | federationRelayEnabled | boolean | Default: 1 (enabled) |
| federationRelayTtlDays | number | federationRelayTtlDays | integer 1-365 | Default: 30 days |
| autoAcceptPeering | boolean | autoAcceptPeering | boolean | Default: true. When false, `peer/accept` rejects unsolicited requests (403 PEERING_REQUIRES_APPROVAL); only requests where a local `pending` record already exists are accepted |
| directoryEnabled | boolean | directoryEnabled | boolean; `true` needs `discoveryEnabled` on (400 `directory_requires_discovery`) | Default: false. Allows spaces here to be listed in the space directory. Cleared in the same write whenever discovery is switched off, on either PATCH route. See [directory.md](directory.md) |
| directoryBrowseEnabled | boolean | directoryBrowseEnabled | boolean (400 `field_not_boolean`) | Default: true. Allows people here to see spaces from other instances in Explore. The incoming axis, independent of `directoryEnabled`: nothing clears it and it is not part of the discovery invariant. Gates `GET /api/directory` and `directoryAvailable` on the public instance info. Changing it never marks the directory dirty. See [directory.md](directory.md) |
| directoryLastPingAt | number \| null | directoryLastPingAt | read-only, ignored on PATCH | Epoch ms of the last directory ping the hub accepted |
| directoryLastError | DirectoryPingError \| null | directoryLastError | read-only, ignored on PATCH | `{ at, status, reason? }` of the last failed ping, null after a success; feeds the panel's status line |
| directoryListedSpaceCount | number | (counted from `spaces`) | read-only, ignored on PATCH | Spaces here listed in Discovery (public or request to join and approved by an admin, `LISTED_IN_DISCOVERY_SQL`) with `directory_listed = 1`, counted whatever `directoryEnabled` says. Same predicate as the directory document (`countListedSpaces` in `directory/document.ts`). Drives the panel's listing note and its "N spaces listed" line |

### Streaming Settings Schema (InstanceStreamingLimits)

| Field | Type | DB Column | Validation | Default |
|-------|------|-----------|------------|---------|
| maxBitrateKbps | number | maxBitrateKbps | 500-1000000 | 20000 |
| minBitrateKbps | number | minBitrateKbps | 100-1000000, must be < max | 500 |
| bitrateStepKbps | number | bitrateStepKbps | 50-5000 | 500 |
| allowedResolutions | (number\|'native')[] | allowedResolutions | Non-empty, values from STANDARD_RESOLUTIONS or 'native' | [540,720,1080] |
| allowedFramerates | number[] | allowedFramerates | Non-empty, values from STANDARD_FRAMERATES | [30,45,60] |
| maxResolution | number | maxResolution | Must be in STANDARD_RESOLUTIONS | 1080 |
| maxFramerate | number | maxFramerate | Must be in STANDARD_FRAMERATES | 60 |
| discoveryEnabled | boolean | discoveryEnabled | boolean | true |
| directoryEnabled | boolean | directoryEnabled | read-only on this route (set through `PATCH /api/settings/instance`); carried here so a non-admin's space settings can read it | false |
| bitrateMatrixOverrides | Record<string,number>\|null | bitrateMatrixOverrides | Keys: `{res}_{fps}`, values: 1-1000000 | null |
| allowCustomBitrate | boolean | allowCustomBitrate | boolean | true |

**Streaming constants** (`packages/shared/src/constants.ts`):
```
STANDARD_RESOLUTIONS = [540, 720, 1080, 1440, 2160]
STANDARD_FRAMERATES  = [30, 45, 60, 75, 90, 120]
HIGH_END_RESOLUTION_THRESHOLD = 1440
HIGH_END_FRAMERATE_THRESHOLD  = 75
```

**Default bitrate matrix** (kbps, VP9 screen share):
```
      30    45    60    75    90    120
540   1500  2000  2500  2800  3200  4000
720   3000  3500  4000  4500  5000  6000
1080  6000  7000  8000  9000  10000 12000
1440  10000 12000 14000 16000 18000 22000
2160  20000 24000 28000 32000 38000 45000
```

See [voice.md](voice.md) for how clients enforce these limits at the WebRTC encoding boundary. A screen share obeys the limits of the instance that issued the LiveKit token: in a federated space the client reads this document from the space's instance, not from the user's home, and applies it at use time without changing the user's saved settings (voice.md, "Whose limits apply").

---

## Serialization Details

### Resolution/Framerate Storage

Stored as CSV strings in DB, parsed on read:

```
settings.ts:rowToLimits()
  allowedResolutions: row.allowedResolutions.split(',')
    → .map(s => s === 'native' ? 'native' : Number(s))
    → .filter(v => v === 'native' || STANDARD_RESOLUTIONS.includes(v))

  allowedFramerates: row.allowedFramerates.split(',')
    → .map(Number)
    → .filter(n => STANDARD_FRAMERATES.includes(n))
```

On write, numbers sorted ascending with 'native' always last:

```
settings.ts:PATCH /api/settings/streaming
  nums = allowedResolutions.filter(r => r !== 'native').sort(asc)
  updateData.allowedResolutions = [...nums, ...(hasNative ? ['native'] : [])].join(',')
```

### Bitrate Matrix Overrides

Stored as JSON string in DB. Sparse representation: only cells differing from defaults.

```
settings.ts:rowToLimits()
  raw = row.bitrateMatrixOverrides (string|null)
  → JSON.parse → validate is non-null non-array object → return if non-empty, else null
```

Valid keys: `{resolution}_{framerate}` (e.g., `"1080_60"`). Validated against all combinations of STANDARD_RESOLUTIONS x STANDARD_FRAMERATES.

### GIF API Key Masking

The `gifApiKey` is never returned in full. The GET response masks it:

```
settings.ts:GET /api/settings/instance
  gifApiKey: gifKey ? `****${gifKey.slice(-4)}` : undefined
```

On PATCH, if the client sends back a value starting with `****`, it is ignored (prevents overwriting the real key with the mask). Empty string clears the key.

---

## API Endpoints

### Public Instance Info

```
GET /api/instance/info
```

No authentication. Returns:

```typescript
{
  name: string;        // instanceSettings.instanceName ?? 'Backspace'
  version: string;     // config.version, read from packages/server/package.json
  registrationOpen: boolean;  // DB setting overrides env if non-null
  email: boolean;             // A mail transport is configured (email.md)
  emailRequired: boolean;     // New accounts need a confirmed address (email.md, "The gate")
  federatedRegistrationOpen: boolean;  // NOT NULL DEFAULT 1; gates federated-account creation
  sourceCodeUrl: string;      // AGPL § 13; sourceOffer() (legal.md, "Source offer")
  commit: string | null;      // AGPL § 13; config.commit (env BACKSPACE_COMMIT, build-injected)
  instanceId: string;         // Persistent per-instance epoch (incarnation UUID); getInstanceId()
  directoryConfigured: boolean;  // config.directory.endpoint !== '' alone; every surface that promises the directory gates on it
  directoryAvailable: boolean;  // directoryConfigured AND instanceSettings.directoryBrowseEnabled; the Explore page gates its Outer Space section on it
  directoryEnabled: boolean;  // instanceSettings.directoryEnabled; the admin's listing opt-in, independent of the above
}
```

`instanceId` is the persistent per-instance epoch — a UUID minted once by `ensureDefaults` on first boot and stable across restarts (stored in `instance_settings.instance_id`, guaranteed non-null after boot). It changes only when the instance is wiped/re-provisioned. Peers read it to detect that a remote has been re-provisioned (federation epoch self-healing). The server reads it via the cached `getInstanceId()` in `utils/federationEpoch.ts`, which throws if the epoch is unset (invariant: `ensureDefaults` runs before any read).

Registration resolution order: `instance_settings.registrationOpen` (if not null) > `config.registrationOpen` (from `REGISTRATION_OPEN` env, default true).

`federatedRegistrationOpen` is consumed by the Connections UI (client-federation.md) to decide whether to surface the "create federated account on this instance" affordance.

`sourceCodeUrl` / `commit` implement the **AGPL-3.0 § 13 network-use source offer**. `sourceCodeUrl` defaults to the upstream repo and is overridable via `BACKSPACE_SOURCE_URL` — operators running a modified build MUST point it at their fork so network users get the source of the version actually running. `commit` is injected at Docker build time (`deploy.sh` passes `--build-arg BACKSPACE_COMMIT=$(git rev-parse --short HEAD)` → Dockerfile `ARG`/`ENV` → `config.commit`); it is `null` in local dev. These are not admin-editable settings — they are deployment/config values, deliberately exposed on this unauthenticated endpoint for transparency to anonymous users and federated peers.

### General Instance Settings

```
GET  /api/settings/instance    — admin only → InstanceAdminSettings
PATCH /api/settings/instance   — admin only → InstanceAdminSettings
```

See field table above for validation rules. Cross-field: `discoveryEnabled` and `directoryEnabled` changes here are also synced to `streamingLimits` in the frontend store (`settingsStore.ts:updateInstanceSettings`), from the server's answer rather than the request, since turning discovery off clears the directory server-side.

**Discovery off implies directory off.** `applyDiscoveryAndDirectory` in `routes/settings.ts` runs on both PATCH routes against the resulting state: `directoryEnabled: true` with discovery off is `400 directory_requires_discovery`, and a write that leaves discovery off clears `directoryEnabled` in the same write. A change to `directoryEnabled`, `discoveryEnabled`, `instanceName` or `federatedRegistrationOpen` calls `markDirectoryDirty()` so the directory pinger tells the hub; see [directory.md](directory.md) §3.

### Streaming Settings

```
GET   /api/settings/streaming   — any authenticated user → InstanceStreamingLimits
PATCH /api/settings/streaming   — admin only → InstanceStreamingLimits
```

**Cross-field validation** on PATCH:
- `minBitrateKbps` must be strictly less than `maxBitrateKbps` (checked against effective values after merge with current DB row).

### Storage Management

All admin-only.

```
GET  /api/admin/storage/stats         → StorageStats
GET  /api/admin/storage/orphans       → { orphans: OrphanedFile[] }
POST /api/admin/storage/cleanup       { dryRun?: boolean } → CleanupResult
POST /api/admin/storage/cleanup-media { maxAgeDays: number, dryRun?: boolean } → CleanupResult
POST /api/admin/storage/cleanup-tus   { maxAgeHours?: number = 1, dryRun?: boolean = false } → CleanupResult
```

The `cleanup-tus` route walks `.tus/`, deleting (or counting, if `dryRun`) any entry whose mtime is older than `maxAgeHours`. No DB rows are touched — `.tus/` is filesystem-only — so `deletedAttachmentRecords` in the response is always `0`. See `docs/systems/uploads.md` §Janitor for the full lifecycle (immediate-DELETE on cancel/discard, automatic 24 h `cleanupTusUploads`, 48 h defensive `cleanupTusStragglers`, and this admin-driven sweep).

**StorageStats shape:**
```typescript
{
  totalFiles: number;
  totalSize: number;           // bytes
  referencedFiles: number;
  referencedSize: number;      // bytes
  orphanedFiles: number;       // Files on disk not referenced by DB
  orphanedSize: number;
  unlinkedAttachments: number; // Attachment records with no message
  unlinkedSize: number;
  danglingAttachments: number; // Attachment records pointing to missing files
  danglingSize: number;
  staleTusSessions: number;    // .tus/ payload + sidecar files with mtime > 1 h old
  staleTusSize: number;        // Total bytes of those stale tus entries
  breakdown: { type: string; count: number; size: number }[];
}
```

`staleTusSessions` / `staleTusSize` use a **fixed 1 h display threshold** (active uploads write chunks frequently; a 1 h+ gap means the user walked away). This is distinct from the `maxAgeHours` body parameter on `cleanup-tus`, which is configurable per request.

**CleanupResult shape:**
```typescript
{
  dryRun: boolean;
  deletedFiles: number;
  freedBytes: number;
  deletedAttachmentRecords: number;
  errors: string[];
}
```

Storage functions (`getStorageStats`, `getOrphanedFiles`, `cleanupStorage`, `cleanupOldMedia`, `cleanupStaleTusSessions`, `getStaleTusInfo`) are implemented in `utils/storageJanitor.ts`. Tus-specific lifecycle details live in `docs/systems/uploads.md` §Janitor.

A live `cleanup` or `cleanup-media` (not a dry run) writes a `storage_cleanup` entry to the [platform audit log](#platform-audit-log) with `kind` (`orphans` or `media`), `maxAgeDays` for media, `deletedFiles` and `freedBytes`. Dry runs and `cleanup-tus` write none.

**Cleanup flow (UI):**
1. Admin clicks "Preview Cleanup" -- calls `cleanupStorage(dryRun=true)` or `cleanupOldMedia(days, dryRun=true)`
2. Preview result shown with count/size
3. "Clean Up Now" / "Delete Now" button enabled only after preview completes
4. Live cleanup calls same endpoint with `dryRun=false`
5. Stats refreshed after live cleanup

**Media cleanup validation:** `maxAgeDays` must be a positive integer >= 1. Returns 400 otherwise.

### User Management

All admin-only. The first five are in `routes/admin.ts`, the rest in `routes/platformAdmin.ts`.

```
GET    /api/admin/users              → AdminUserListResponse
GET    /api/admin/users/instances    → { instances: string[] }
PATCH  /api/admin/users/:id/role     { isAdmin: boolean } → AdminUser
POST   /api/admin/users/:id/reset-password → AdminResetPasswordResponse
DELETE /api/admin/users/:id          → { success: boolean }
GET    /api/admin/users/:id          → AdminUserDetail
POST   /api/admin/users/:id/suspend  { reason, durationHours } → AdminUser
POST   /api/admin/users/:id/unsuspend { reason? } → AdminUser
PUT    /api/admin/users/:id/badges   { badges, reason? } → AdminUser
```

Role changes, password resets and deletions also write a platform audit entry ([Admin Actions: Safety Rules](#admin-actions-safety-rules)). Suspensions: [Suspensions](#suspensions). Badges: [Badges (grants)](#badges-grants).

`GET /api/admin/users/:id` answers any row, deleted or not (404 `user_not_found` only when there is none):

```typescript
AdminUserDetail = {
  user: AdminUser;
  ownedSpaces: Array<{ id: string; name: string; memberCount: number }>;  // spaces.owner_id = the account
  memberships: number;   // space_members rows
  friends: number;       // friends rows naming the account on either side
  messages: number;      // space and DM messages written on this instance
  audit: PlatformAuditEntry[];  // the 20 newest platform audit entries about the account
}
```

### Platform Admin Endpoints

All admin-only (`authenticate` then `requireAdmin`), in `routes/platformAdmin.ts`. Types in `packages/shared/src/platform.ts`. What these decide and who may ask: [Platform administration](#platform-administration).

```
GET  /api/admin/overview                            → PlatformOverview
GET  /api/admin/spaces                              ?q&filter&page&pageSize → AdminSpaceListResponse
GET  /api/admin/spaces/:id                          → AdminSpaceDetail
PUT  /api/admin/spaces/:id/badges                   { badges, reason? } → AdminSpaceSummary
GET  /api/admin/reviews                             → ReviewQueueResponse
POST /api/admin/spaces/:id/verification/:decision   { note?, requestedAt? } → SpaceReviewState
POST /api/admin/spaces/:id/discovery/:decision      { note?, requestedAt? } → SpaceReviewState
GET  /api/admin/audit                               ?before&limit&targetType&targetId&action → PlatformAuditResponse
```

The owner's side of the reviews is in `routes/spaceReview.ts`, behind `authenticate` only; who may call each route is checked in the route:

```
GET    /api/spaces/:id/review        → SpaceReviewState     (the owner or an instance admin)
PUT    /api/spaces/:id/verification  VerificationRequestBody → SpaceReviewState   (the owner)
DELETE /api/spaces/:id/verification  → SpaceReviewState     (the owner)
PUT    /api/spaces/:id/discovery     { category } → SpaceReviewState              (the owner)
DELETE /api/spaces/:id/discovery     → SpaceReviewState     (the owner)
```

Decisions and requests: [Verification](#verification), [Discovery approval](#discovery-approval). Reading the log: [Platform audit log](#platform-audit-log).

**Overview** (`PlatformOverview`): counted at the moment of asking from the database and the open sockets, nothing estimated.

| Field | What it counts |
|-------|----------------|
| `users.total` | Accounts homed here (`home_instance IS NULL`), not deleted |
| `users.online` | Accounts with a socket open on this instance now (`connectionManager.getAllOnlineUserIds()`, any account) |
| `users.new7d` | Accounts homed here, not deleted, created in the last 7 days |
| `users.active7d` | Distinct authors of space or DM messages stored here in the last 7 days |
| `users.suspended` | Accounts homed here, not deleted, suspended now |
| `users.admins` | Accounts homed here, not deleted, with `is_admin = 1` |
| `activity.messages7d` | Space and DM messages created in the last 7 days |
| `spaces.total` | Every space |
| `spaces.listed` | Spaces matching `LISTED_IN_DISCOVERY_SQL` (approved and open to join) |
| `spaces.verified` | Spaces with `verification_status = 'verified'` |
| `spaces.discoveryEnabled` | The instance-wide switch; while off, approved spaces are not shown |
| `reviews.verificationOpen` / `reviews.discoveryOpen` | `openReviewCounts()`: verification `pending` or `needs_info`; Discovery `pending` or `changes_requested` |

**Spaces list** (`GET /api/admin/spaces`): `q` (trimmed, at most 100 characters) matches the name anywhere (`LIKE`, its wildcards taken literally) or the exact id; `filter` is `all` (default, also for an unknown value), `listed` (`LISTED_IN_DISCOVERY_SQL`), `verified` or `open_review` (either review open); `page` from 1; `pageSize` 1-100, default 50; newest space first. The admin area reads every space this way without being a member of it.

```typescript
AdminSpaceSummary = {
  id: string;
  name: string;
  icon: string | null;
  avatarColor: AvatarColor | null;   // null for a value outside AVATAR_COLORS
  owner: PlatformActor | null;       // { id, username, displayName }; null once the row is gone
  memberCount: number;
  visibility: 'public' | 'request' | 'private';  // anything else reads as private
  directoryListed: boolean;
  verificationStatus: VerificationStatus | null;
  discoveryStatus: DiscoveryStatus | null;
  badges: SpaceBadgeId[];            // every badge the space shows
  grantedBadges: GrantedSpaceBadgeId[];  // the ones an admin gave
  createdAt: number;
}
```

`GET /api/admin/spaces/:id` (404 `space_not_found`) answers `AdminSpaceDetail`: the summary, `description`, `banner`, `review` (`SpaceReviewState`, both reviews with their requests and full history) and `audit` (the 20 newest platform audit entries about the space).

**Review queue** (`GET /api/admin/reviews`): every open request, each list oldest request first. `verification` items carry the space summary, its description, the status and the whole request (`VerificationRequestView`); `discovery` items the summary, description, banner, status and request (`DiscoveryRequestView`), which is what the listing would show.

---

## User List: Filters, Search, Sort, Pagination

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| q | string | '' | Fuzzy search on username and displayName (SQL LIKE `%q%`) |
| page | number | 1 | Page number, min 1 |
| pageSize | number | 50 | Results per page, clamped to 1-100 |
| showDeleted | 'true' | false | Include tombstoned users |
| homeInstance | string | -- | `'local'` for null homeInstance; otherwise exact domain match |
| role | string | -- | `'admin'` or `'non-admin'` |
| status | string | -- | `'suspended'`: accounts suspended now (`suspendedNow()` in `utils/suspension.ts`); a suspension that ran out does not count. Any other value is ignored |
| joinedAfter | date string | -- | Parsed as `new Date(value).getTime()` |
| joinedBefore | date string | -- | Parsed as `new Date(value + 'T23:59:59.999Z').getTime()` (inclusive end-of-day) |
| sort | string | 'newest' | One of: `newest`, `oldest`, `az`, `za` |

### Sort Options

| Value | SQL | Description |
|-------|-----|-------------|
| newest | `desc(users.createdAt)` | Most recently created first |
| oldest | `asc(users.createdAt)` | Oldest first |
| az | `asc(users.username)` | Alphabetical A-Z |
| za | `desc(users.username)` | Reverse alphabetical |

### Filter Composition

Filters are combined with AND. When `showDeleted` is false (default), `isDeleted = 0` is always added. Search `q` creates an OR condition across `username LIKE` and `displayName LIKE`.

### Instances Endpoint

`GET /api/admin/users/instances` returns all distinct non-null `homeInstance` values from the users table. Used by the frontend to populate the instance filter dropdown.

### AdminUser Shape

```typescript
{
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  avatarColor: string | null;
  status: string;         // 'online'|'idle'|'dnd'|'offline', defaults to 'offline' if null
  isAdmin: boolean;
  isDeleted: boolean;
  homeInstance: string | null;
  createdAt: number;      // epoch ms
  suspension: { since: number; until: number | null; reason: string } | null;  // standing now; null when none or run out
  grantedBadges: GrantedUserBadgeId[];  // what admins gave, in registry order; never staff
}
```

Produced by `utils/adminUser.ts:toAdminUser(row, now?)` -- maps integer DB columns to booleans, coalesces null status, reads the suspension standing at `now` (`activeSuspension()`) and the granted badges (`grantedUserBadgesOf()`). Every route that answers an `AdminUser` (`admin.ts` and `platformAdmin.ts`) builds it here.

---

## Two-factor authentication

Not an admin matter, on purpose: nothing in the admin area turns it off, and an admin's password reset leaves it on, so a stolen admin session is no way around it. The way back for someone who lost their phone and their recovery codes is `./tavvit-admin.sh reset-2fa <username>`, from the server's shell (auth.md).

---

## Email

The tab shows how mail is doing and holds no address or credential (`EmailPanel`, `GET /api/admin/email/status`): state, sender, counts, what is waiting, the last error by name, warnings near a limit or a bounce rate that gets accounts paused, and a test mail. The switch that makes new accounts confirm an address before they do anything in a space is here too, and the one that refuses throwaway addresses (`blockThrowawayEmail`, on by default). email.md has all of it. The admin's password reset tells the account's confirmed address.

---

## Admin Actions: Safety Rules

### Promote/Demote Admin (PATCH /api/admin/users/:id/role)

```
Request: { isAdmin: boolean }
```

**Safety checks:**
1. `isAdmin` must be a boolean (400)
2. Target user must exist (404)
3. Target must not be deleted (400)
4. **Promote**: target must NOT have a `homeInstance` (403 "Federated users cannot be promoted to admin")
5. **Demote**: if target is currently admin, count all non-deleted admins. If count <= 1, reject (400 "Cannot demote the last admin")

**Side effects on success:**
- Updates `users.isAdmin` to 1 or 0
- When the flag changed: a `user_role` entry in the [platform audit log](#platform-audit-log) (`details: { isAdmin }`)
- Sends `user_updated` WebSocket event to target user via `connectionManager.sendToUser()` so their UI reflects the change immediately. Only the target is sent it, so others see the `staff` badge ([badges.md](badges.md)) come or go when they next load that person
- When the flag changed: an instance admin holds every permission in every space, so the target is sent `space_access_changed` once for each space they belong to on this instance (`connectionManager.announceUserAccessChange`, with that space's `space_voice_state`), and voice permissions are re-checked in each. Their client refetches each space's detail, which carries role bits only while they hold `MANAGE_ROLES` (permissions.md, "Who receives role and override data"). No other member is sent anything.

### Reset Password (POST /api/admin/users/:id/reset-password)

**Safety checks:**
1. Target must exist (404)
2. Target must not be deleted (400)
3. Target must NOT have a `homeInstance` (400 "Federated users authenticate via their home instance")

**Process:**
1. Generate 12 random bytes, encode as `base64url` -- this is the temporary password
2. Hash with bcrypt via `hashPassword()`
3. Update `users.passwordHash` and `users.passwordChangedAt = Date.now()`
4. Force-disconnect all of target's WebSocket sessions via `connectionManager.forceDisconnectUser(targetId, { reason: 'Password reset', endPresence: true })`, which also takes their presence offline
5. Record `user_password_reset` in the [platform audit log](#platform-audit-log)
6. Return `{ temporaryPassword }` in response

The `passwordChangedAt` update ensures all existing JWTs for the user are invalidated (tokens issued before this timestamp are rejected by the auth middleware).

The temporary password is shown exactly once in the admin UI -- the UsersPanel displays it inline below the user row with a copy button and a "Shown once" warning.

### Delete User (DELETE /api/admin/users/:id)

**Safety checks:**
1. Cannot delete yourself (400 "Use account settings to delete your own account")
2. Target must exist (404)
3. Target must not be already deleted (400)
4. Target must not be an administrator (400 `cannot_delete_admin`): demote first, so a team cannot delete itself
5. Target must not own any spaces, unless the body says `deleteSpaces: true` (400 `user_owns_spaces` otherwise, response includes `ownedSpaces` array with id/name). With it, every space the account owns is deleted first, after the credentials below are checked, the one way a space goes (`deleteSpaceCompletely`, `utils/spaceDeletion.ts`, which `DELETE /api/spaces/:id` takes too), and each is recorded as `space_delete` in the platform audit log with the deletion's reason. The console's dialog offers this once the refusal named the spaces: an account made for spam or a name nobody should carry seldom owns a space anyone wants to keep.
6. For an account of this instance, the body brings `reason` (3 to 500 characters, kept in the audit log), `password` and, where the acting admin has one, `twoFactorCode`: the acting admin's own, checked as deleting one's own account checks them (`current_password_incorrect`, `mfa_code_required`, `mfa_code_invalid`). Deleting cannot be undone, and a stolen session alone must not be able to do it. A replicated row (`homeInstance` set) is a copy of an account homed elsewhere and needs none of this; `FederationPanel` cleans those up in bulk.

**Process:**
1. Call `tombstoneUser(targetId)` -- returns list of files to delete (avatar, banner)
   - Tombstone sets `isDeleted=1`, clears personal data, removes from spaces/friends/DMs/reactions/read-states/folders in a transaction
   - Transfers group DM ownership to next member
2. Delete returned files from disk via `deleteUploadFile()`
3. Force-disconnect all WebSocket sessions
4. Record `user_delete` in the [platform audit log](#platform-audit-log), labelled with the username the account had
5. Return `{ success: true }`

### Peering Approval Requests

All admin-only. Present when `autoAcceptPeering` is `false`. The queue holds **both directions**:
- **Inbound** rows — remote instances asking to peer with us.
- **Outbound** rows — local users who initiated peering (friend-add, etc.) that the local [Outbound Peering Gate](federation.md#outbound-peering-gate) intercepted because no `federation_peers` row exists yet for the target.

```
GET  /api/federation/approval-requests              → { requests: ApprovalRequestSummary[] }
POST /api/federation/approval-requests/:id/approve  → { success, peerStatus?, peer? }
POST /api/federation/approval-requests/:id/deny     → { success }
```

`ApprovalRequestSummary` (see [api.md → Federation Peering Approval Queue](api.md#federation-peering-approval-queue) for the complete TypeScript shape):
```typescript
{
  id: string;
  direction: 'inbound' | 'outbound';
  origin: string;
  instanceName: string | null;
  requestedAt: number;
  expiresAt: number;
  // Outbound rows ONLY — inbound rows omit this field entirely (absent, not null and not []).
  subscribers?: Array<{ id, userId, username, triggerReason, triggerTarget, createdAt }>;
}
```

See [federation.md](federation.md) — Peer Approval Queue and Outbound Peering Gate sections for the full approval/denial/expiry flow (including the direction-branched approve/deny semantics, `onPeerActivated` cleanup invariant, and the inbound-expiry `/peer/denied` notification preserved unchanged).

---

## Platform administration

The instance's own administration of accounts and spaces, apart from anything a space's roles allow: account [suspensions](#suspensions), the [verification](#verification) and [Discovery approval](#discovery-approval) of spaces, the [badges an admin gives](#badges-grants), and the [platform audit log](#platform-audit-log) that records each of these. Statuses, decision rules, limits and wire types are in `packages/shared/src/platform.ts`; the routes are `routes/platformAdmin.ts` (deciding) and `routes/spaceReview.ts` (asking).

### The admin area

A page of its own at `/admin`, under the app's frame: see [The console](#the-console). It is reached by the shield in the top bar and from Settings, Administration, both shown only while the signed-in account's `isAdmin` is true.

### The console

`components/admin/AdminConsole.tsx`, the route `/admin/:section?`. `AppLayout` renders it in place of the channel column, the page and the right column on a window, and in place of `MobileShell` on a phone, so the top bar, the socket, the toasts and every dialog are still there; it is one lazy chunk. Someone who is not an admin is sent to `/channels/@me` before anything is asked of the server. That is a courtesy and not the protection: **every route behind it is refused by the server unless `users.is_admin` says otherwise**.

| Group | Sections |
|-------|----------|
| | Overview |
| Moderation | Reviews, Reports, Users (accounts), Spaces, Audit log |
| Community | Announcements, Sign-up rules, Starter spaces |
| Instance | General, Registration, Email, Legal, Federation (only where the instance federates), Streaming, Storage, System |

The list has the app's sliding mark (`SlidingMark`) and carries the counts of what waits: reviews, reports, peering approvals. On a phone the console opens on that list, and a section is a page with a way back. At the top of a window, and on the phone's list, a **search** (`GET /api/admin/search`) finds an account or a space by name, or an account by its id or its whole confirmed address. Part of an address, or one nobody confirmed, finds nothing, and `%` and `_` are plain characters: it finds, it does not list. What it finds opens in the same detail the lists open.

**The overview** (`GET /api/admin/dashboard`): what waits, four tiles (accounts, online, active today, messages today, with the change against the week before), a month of messages, active accounts, new accounts and mail per day, how many accounts have two-factor sign-in and a confirmed address, and where spaces and accounts stand. All of it is counted from the instance's own database and sockets and it names nobody. The counts of the days are kept for a minute, because they read a month of messages; who is online and what waits are asked each time. Every chart has the same numbers as a table, one click away and always there for assistive technology, and the arrow keys find a day as the pointer does.

**Announcements** (`/api/admin/announcements`): a message to everyone signed in, on a banner above the app (`ui/AnnouncementBar.tsx`), as plain text, in the tone of information or a warning, until an admin ends it or for 1 hour, 24 hours or a week. At most 3 run at once (`announcement_limit`). Whoever is connected hears of it through `announcements_changed` and asks again (`GET /api/announcements`, for anyone signed in). Anyone can put one away on their device (`tavvit-announcements-dismissed`). The audit log has its words.

**Who may sign up** (`/api/admin/signup-rules`, `utils/signupRules.ts`): mail domains and reserved names, at most 2000 of each. A domain catches everything under it (`example.com` also refuses `a@mail.example.com`); a name is matched without regard to case. They are asked in `POST /api/auth/register` for an account of this instance (`username_reserved`, `email_domain_blocked`) and in `PUT /api/users/@me/email`. They touch no account that exists, and they give nothing away about one: a name on the list is refused whether anyone has it or not. A replicated account is not asked, since its home instance answers for it. On a closed instance they answer only after the invite was accepted, so a visitor cannot read them out, and `GET /api/auth/check-username` says `username_reserved` for a reserved name. Someone with a confirmed address at a domain blocked later can still re-enter it to cancel a pending change. Domains are compared in their ASCII spelling, so `bücher.example` and `xn--bcher-kva.example` are one domain. "The usual names" adds a fixed list in one click (`USUAL_RESERVED_USERNAMES`), only when an admin asks.

**Starter spaces** (`/api/admin/starter-spaces`, `joinStarterSpaces` in `utils/spaceJoin.ts`): up to 5 public spaces a new account of this instance starts in. It is the same step as joining one (`addPublicMember`). A new choice must be public; a space that went private since it was chosen stays on the list, marked, and is skipped at sign-up, a replicated account is left out, and nothing that goes wrong here stands in the way of the sign-up. It moves nobody who is already here.

**One account** (`AdminUserDetailModal`, on tabs): Overview (facts, files, owned spaces, badges), Moderation (suspension, warning), Sign-ins (sessions and security activity), Notes, Log.
- *Files*: what the account keeps and the limit that applies (`storage` in `GET /api/admin/users/:id`), and `PUT /api/admin/users/:id/storage-limit` `{ limitGb }` for one of its own: 0 for none, null back to the instance's. In the audit log as `user_storage_limit`.
- *Sessions*: `GET /api/admin/users/:id/sessions`. Ending one or all closes their sockets and records `sessions_ended_by_admin` in the person's own security activity, without the admin's device or address. It signs them out and does not keep them out; a suspension does. An admin's own are ended from their own settings (`cannot_target_self`).
- *Security activity*: `GET /api/admin/users/:id/security`, what the person sees of it themselves; addresses are cut short as everywhere.
- *Notes*: `admin_notes`, 1000 characters, for the admins among themselves. They go with the account (`tombstoneUser`) and are in its data export, which the note field says. The audit log says that a note was written and not what it says, because that log outlives the account.
- *Warning*: `POST /api/admin/users/:id/warn`, a notice of kind `warning` with a reason and a ground ([legal.md](legal.md)). It changes nothing about the account. The notice holds the words; the audit log says that it happened and on what ground, because that log outlives the account.
- **A second factor cannot be turned off from here**, only with `tavvit-admin reset-2fa` on the server's shell ([auth.md](auth.md)).

**The system** (`GET /api/admin/system`): version, uptime, memory, the size of the database, the disk, which services are on (mail, two-factor sign-in, translating, Twitch (linking accounts and the live check) as `off`, `ok` or `failing` when Twitch did not answer the last check, voice, federation), the backups by file name, and "Back up now" (`POST /api/admin/system/backup`, one every 5 minutes, `backup_too_soon`; it is `VACUUM INTO`, so on a large database the server pauses for it). These copies have a reason of their own, `console`, with their own count (`BACKUP_KEEP_CONSOLE`, 5), so that pressing the button cannot rotate away the copies `update.sh` makes; copies made by hand are also gone after `BACKUP_MAX_AGE_DAYS` (90), so deleted data has an end there too. Restoring a backup and fetching the database stay with the server's shell, so that being signed in as an admin is not a way to take everything or to overwrite it.

**Exports** (`GET /api/admin/users.csv`, `GET /api/admin/audit.csv`, 10 per 15 minutes, at most 50,000 rows, both in the audit log). The accounts' file holds no addresses and no sign-in places: a file travels, and an operator needs from it who and in what state. A cell that starts like a formula (`=`, `+`, `-`, `@`) is marked as text and a cell with a separator in it (a semicolon too, the separator of a spreadsheet set to German) is quoted (`csvCell`), because these cells hold what people typed as their names and a spreadsheet would run it.

Every change here is in the platform audit log: `announcement_create`, `announcement_end`, `user_note_add`, `user_note_delete`, `user_warn`, `user_sessions_end`, `signup_rule_add`, `signup_rule_remove`, `starter_spaces_update`, `backup_create`, `accounts_export`, `audit_export`.

### Who may act

- **Only an instance admin decides** (`users.is_admin = 1` on this instance). Every `/api/admin/*` route runs `authenticate` then `requireAdmin`. A federated account cannot be promoted (`403 federated_user_cannot_be_admin`), so the admins of an instance are its own accounts.
- **A space's owner asks.** The owner routes in `routes/spaceReview.ts` compare `spaces.owner_id` with the caller's row id on this instance and answer `403 space_owner_only` otherwise. No space role, owner group, `ADMINISTRATOR` bit or other permission stands in for owning the space, and nothing a space can hand out reaches a platform decision.
- **An admin reads without belonging.** `GET /api/spaces/:id/review` answers the owner or an instance admin; the admin area lists and opens every space hosted here without being a member.
- **Admins are not suspended.** The suspend route refuses an admin (`400 cannot_suspend_admin`: demote first) and the caller's own account (`400 cannot_suspend_self`), so an admin team cannot lock itself out by suspending one another.

### Server-side enforcement

The web client hides what a person may not do (the Instance settings from non-admins, the Verification tab and the listing request from anyone but the owner, the decisions that do not apply to the current status), but that is a convenience: the server checks every rule itself.

- The decision rules are data (`VERIFICATION_DECISIONS`, `DISCOVERY_DECISIONS`): the statuses a decision may be made on, the status it leaves, whether a reason is required, the review action it records. Client and server read the same rules (`verificationDecisionApplies`, `discoveryDecisionApplies`, `canRequestVerification`, `canWithdrawVerification`, `canWithdrawDiscovery`).
- A decision re-reads the status and the request inside the transaction that writes it (`decideVerification`, `decideDiscovery` in `utils/spaceReview.ts`). A decision that no longer applies answers `409 review_status_conflict`, so two admins deciding at once cannot both apply. The admin's client sends the `requestedAt` of the request it showed; a request the owner sent again since is refused the same way rather than decided unseen.
- Texts are trimmed and bounded and refused when they hold control characters; the addresses an owner gives are checked but never fetched.
- Every decision writes a [platform audit](#platform-audit-log) entry.

### Federation

Each instance administers what it holds. A suspension is a fact about a row of this instance and keeps that row out of this instance only. A space's reviews belong to the instance that hosts the space: the owner's client sends its requests to the space's origin (`getApiForOrigin`), and that instance's admins decide. Badges are per instance ([badges.md](badges.md)). The open-request count is the home instance's: the client takes `reviewQueueCount` from the home ready payload and `review_queue_count` from home only, while it takes `space_review_updated` from any origin, since an owner's space may live on a peer.

### Who hears of a decision

`utils/reviewNotify.ts`:

| Event | To | When |
|-------|----|------|
| `space_review_updated` `{ spaceId, spaceName, process, action, status, note }` | the space's owner (`sendToUser(owner_id)`) | every step of either review: the owner's own, an admin's decision, an edit that moved the Discovery status |
| `review_queue_count` `{ verificationOpen, discoveryOpen }` | every connected admin (`sendToAdmins`) | after every review step |
| `space_updated` (the space as `spaceToWire` builds it) | the space's members | a verification step; a change of the space's granted badges |
| `user_updated` | the person (self view) and everyone who sees them: space co-members, DM co-members, friends | a change of the person's granted badges |

The ready payload carries `reviewQueueCount` (`ReviewQueueCountPayload`) for an admin and `null` for anyone else. A Discovery step on a space with `directory_listed = 1` also marks the directory dirty, so the pinger tells the hub ([directory.md](directory.md)). On the client, `space_review_updated` bumps `reviewStore.revisions[spaceId]`, so an open Verification or Discovery panel of that space reloads, and shows a toast ("Verification of {space}: {status}", "Discovery listing of {space}: {status}"); `review_queue_count` updates `reviewStore.queue`, which the Reviews tab count, the Overview and the review queue follow.

---

## Suspensions

An instance admin suspends an account with a reason, for a time or until lifted. While it stands the account cannot sign in, call the API or hold a socket. Nothing of the account is deleted: memberships, owned spaces, messages, friendships and DMs stay, and the account stays in member lists, offline.

**Columns** (`users`, migration 0041): `suspended_at`, `suspended_until`, `suspension_reason`. An account is suspended while `suspended_at` is set and `suspended_until` is null (until lifted) or in the future. A time-limited suspension ends by itself: every check compares its end with the clock (`activeSuspension(row, now)`, and `suspendedNow(now)` as SQL), so nothing has to run when it passes. The columns stay until an admin clears them.

**Suspend** (`POST /api/admin/users/:id/suspend`, `SuspendUserBody { reason, durationHours }`), checked in this order:

| Check | Refusal |
|-------|---------|
| Not the caller's own account | 400 `cannot_suspend_self` |
| The account exists | 404 `user_not_found` |
| Not deleted | 400 `user_already_deleted` |
| Not an admin (demote first) | 400 `cannot_suspend_admin` |
| `reason` trimmed, 3-500 characters, no control characters | 400 `suspension_reason_invalid` `{ min, max }` |
| `durationHours` null (until lifted) or a whole number from 1 to 8760 (`SUSPENSION_LIMITS.MAX_DURATION_HOURS`, a year) | 400 `suspension_duration_invalid` `{ max }` |

Then the three columns are written (`suspended_until` is now plus the hours, or null); a standing suspension is replaced. `connectionManager.forceDisconnectUser(id, { reason: 'Account suspended', endPresence: true })` ends the sessions at once: the account leaves voice and any call, ringing calls it placed end, every socket closes with code 4001 and the reason "Account suspended", and its presence goes offline for everyone who saw it and for peers. A `user_suspend` audit entry records the reason and `{ until, durationHours }`. Answers the `AdminUser`.

The admin area offers 1 hour, 24 hours, 3 days, 7 days, 30 days and until lifted (`SUSPENSION_DURATIONS`); the API takes any whole number of hours within the limit.

**Lift** (`POST /api/admin/users/:id/unsuspend`, `UnsuspendUserBody { reason? }`): 404 `user_not_found`; 409 `user_not_suspended` when `suspended_at` is null, so it also clears a suspension that already ran out. The reason is optional, 1-500 characters when given (else 400 `suspension_reason_invalid`). Clears the three columns and records `user_unsuspend` with `{ expired }`, true when the suspension had already ended by itself. The account can sign in again at once.

**Where it is enforced:**

| Path | Answer to a suspended account |
|------|-------------------------------|
| `verifyJwtAndUser` (`utils/auth.ts`), through the `authenticate` preHandler of every authenticated route | 401 `account_suspended` with `details: { reason, until }` (`until` left out while until lifted). Checked after "deleted" and "token revoked" |
| `verifyJwtAndUser` in the tus upload hook (`routes/files.ts`) | 401 with the message alone |
| `POST /api/auth/login` | 403 `account_suspended` with the same details, and no token, only after the password was right (federated self-heal included): the reason is for the account's owner, not for whoever knows the username |
| WebSocket `auth` (`ws/handler.ts`) | `{ type: 'error', code: 'account_suspended', message, details }`, then close 4001 "Account suspended" |

A suspended account is also left out of the username search ([social.md](social.md)). The overview counts suspended accounts homed here; the Users list's `status=suspended` filter includes federated rows too.

**Client:** a 401 from home drops the token and opens `/login` (`handleUnauthorized` in `api/client.ts`); the socket's coded error makes `useWebSocket` call the same function instead of reconnecting (home only). When the person then signs in with the right password, `LoginPage` shows a rose notice with the end ("until lifted" or the date) and the reason.

**Scope:** a suspension is enforced where the row lives. Suspending a federated account's row here keeps that person out of this instance; their home account is untouched. No federation route reads the suspension columns.

**UI:** [AdminUserDetailModal](#adminuserdetailmodal).

---

## Verification

The platform's statement that this instance's admins checked who runs a space. While `spaces.verification_status = 'verified'`, the space shows the `verified` badge ([badges.md](badges.md)) wherever this instance sends it. The owner asks; an instance admin decides.

**Statuses** (`VERIFICATION_STATUSES`): null (never requested, or withdrawn), `pending`, `needs_info`, `verified`, `rejected`, `revoked`.

| From | Owner | Admin (`VERIFICATION_DECISIONS`) |
|------|-------|----------------------------------|
| null, `rejected`, `revoked` | send → `pending` | -- |
| `pending` | send again → `pending`; withdraw → null | `approve` → `verified`; `reject` → `rejected`; `request_info` → `needs_info` |
| `needs_info` | send again → `pending`; withdraw → null | `approve` → `verified`; `reject` → `rejected` |
| `verified` | -- (409 `review_already_verified`) | `revoke` → `revoked` |

`reject`, `request_info` and `revoke` need a reason (`noteRequired`); `approve` takes one optionally. The owner reads every reason.

**Renames and new owners.** A verification vouches for the space under its name and for who runs it, so both are reviewed again (`reviewsAfterEdit`, `reviewsAfterTransfer` in `utils/spaceReview.ts`):
- `PATCH /api/spaces/:id` that changes the name of a `verified` space sets `pending`: the badge goes at once and comes back only with a new approval. On a `pending` or `needs_info` request the new name is a new version of it. Either way the request takes the space's current name and description and the time of the edit as its `requested_at`, so a decision an admin made on the earlier version is refused with 409 `review_status_conflict`.
- `PATCH /api/spaces/:id/transfer-ownership` does the same for a `verified`, `pending` or `needs_info` verification: the new owner's space is reviewed again.
- Each records a `changed` event (the editor or the former owner as actor) and is announced like any other step.

**The request** (`space_verification_requests`, one row per space, replaced on every send): the space's name and description when it was sent, a `category` (`SPACE_CATEGORIES`: gaming, music, art, technology, education, science, entertainment, sports, community, other), an optional `website`, up to 5 public `profiles`, the `reason` (20-1000 characters) and the `proof` (10-1000: how the requester shows they run the community, something the reviewer can check). A send clears the previous decision (`decided_by`, `decided_at`, `decision_note`). Addresses must be `http` or `https`, without spaces, control characters or credentials, at most 200 characters once normalised; duplicates are dropped. The server never fetches them; the admin area shows them as links that open only on a click (`rel="noopener noreferrer nofollow"`).

**Owner routes:**
- `PUT /api/spaces/:id/verification` (`VerificationRequestBody`): 404 `space_not_found`; 403 `space_owner_only`; 409 `review_already_verified`; 400 `review_category_invalid`, `review_url_invalid { max }`, `review_too_many_profiles { max }`, `review_reason_invalid { min, max }`, `review_proof_invalid { min, max }`; 429 `rate_limited`. Sets `pending` and records a `submit` event.
- `DELETE /api/spaces/:id/verification`: only from `pending` or `needs_info` (else 409 `review_status_conflict`). The status returns to null; the event is `withdraw`, with no status.
- An owner's two send routes (this one and the Discovery request) share one budget: 10 sends per account per hour (`createFixedWindowLimit`), counted only once a request passed validation. Withdrawals are not limited.

**Admin decision** (`POST /api/admin/spaces/:id/verification/:decision`, `ReviewDecisionBody { note?, requestedAt? }`): 400 `review_decision_invalid` for an unknown decision; 404 `space_not_found`. The note is trimmed and null when empty, at most 1000 characters without control characters (400 `review_note_too_long { max }`), required where the rule says (400 `review_note_required`), a string or nothing (400 `validation_failed { field: 'note' }`). The decision is refused with 409 `review_status_conflict` when it does not apply to the status now, or when `requestedAt` is given and differs from the stored request's (the owner sent it again since). One transaction writes the status, the request's decision fields and a review event. The step is then announced ([Who hears of a decision](#who-hears-of-a-decision)); `space_updated` reaches the space's members, so the badge appears or goes at once. Audit: `verification_<decision>` with the note as the reason and `{ status }`. Answers the `SpaceReviewState`.

**History:** every step is a row of `space_review_events` (`process = 'verification'`; actions `submit`, `withdraw`, `approve`, `reject`, `request_info`, `revoke`) with its actor, the status it left and the note. Owner and admins read the same history (`reviewStateOf`), oldest first on the wire; the UI lists it newest first. Each event names its actor, so the owner sees which admin decided.

```typescript
SpaceReviewState = {
  spaceId: string;
  verification: { status: VerificationStatus | null; request: VerificationRequestView | null; history: ReviewEvent[] };
  discovery:    { status: DiscoveryStatus | null;    request: DiscoveryRequestView | null;    history: ReviewEvent[] };
}
ReviewEvent = { id, process, action, status, actor: PlatformActor | null, note, createdAt }
```

**Owner UI:** Space settings → **Verification**, a tab shown only to the owner (`useIsSpaceOwner`: the space's owner id against the person's own row id on the instance that hosts it). `VerificationPanel` shows the status chip with a sentence on what it means, the admin's last note, when the request was sent, Withdraw while it is open, the request form while a request may be sent (seeded from the last request, with counters for reason and proof, and the space's name and description shown as what the request carries), and the history. It talks to the space's own instance and reloads when `reviewStore.revisions[spaceId]` moves.

---

## Discovery approval

Whether a space is listed in Discovery: the Explore page's Inner Space, the directory document, the overview's "Listed" count. One predicate decides it everywhere, `LISTED_IN_DISCOVERY_SQL` in `utils/discoveryListing.ts`:

```sql
s.visibility IN ('public', 'request') AND s.discovery_status = 'approved'
```

Visibility only says how people join; nothing an owner sets alone lists a space. `GET /api/spaces/explore` still answers nothing while the instance's `discoveryEnabled` is off, and the directory document also needs the space's own `directory_listed = 1` ([directory.md](directory.md)). A listed space reaches Explore with its `badges` and the `category` of its request (`ExploreSpace`); directory entries carry neither.

**Statuses** (`DISCOVERY_STATUSES`): null (never submitted), `pending`, `changes_requested`, `approved`, `rejected`, `withdrawn`. Only `approved` lists the space.

| From | Owner | Admin (`DISCOVERY_DECISIONS`) | An edit (`reviewsAfterEdit`) |
|------|-------|-------------------------------|------------------------------|
| null, `rejected`, `withdrawn` | send → `pending` | -- | -- |
| `pending` | send again → `pending`; withdraw → `withdrawn` | `approve` → `approved`; `reject` → `rejected`; `request_changes` → `changes_requested`; `withdraw` → `withdrawn` | made private → `withdrawn`; listing fields changed → a new version |
| `changes_requested` | send again → `pending`; withdraw → `withdrawn` | `approve`; `reject`; `withdraw` | made private → `withdrawn`; listing fields changed → a new version |
| `approved` | send again (a new category, after a confirmation) → `pending`; withdraw ("Take off Explore") → `withdrawn` | `withdraw` → `withdrawn` | made private → `withdrawn`; name, description, icon or banner changed → `pending` |

`reject`, `request_changes` and `withdraw` need a reason; `approve` takes one optionally. The admin's `withdraw` is recorded as the review action `admin_withdraw` and the audit action `discovery_withdraw`. Sending again from `approved` (with another category, say) takes the listing back into review until an admin decides.

**The request** (`space_discovery_requests`, one row per space): the `category` and who sent it when; a send clears the previous decision. An approval also stores `approved_snapshot`, JSON `{ name, description, icon, banner, category }` as approved, kept as the record of what was approved; the re-review below compares the space before and after an edit, not this snapshot.

**Owner routes:**
- `PUT /api/spaces/:id/discovery` (`DiscoveryRequestBody { category }`): 404 `space_not_found`; 403 `space_owner_only`; 409 `discovery_requires_listable_visibility` while the space is private; 409 `discovery_requires_description` while its description is empty; 409 `discovery_requires_uploaded_pictures` while its icon or banner is an address on another site (such a picture could change there unseen); 400 `review_category_invalid`; 429 `rate_limited` (the budget shared with verification). Allowed from any status. Sets `pending` and records `submit`.
- `DELETE /api/spaces/:id/discovery`: from `pending`, `changes_requested` or `approved` (else 409 `review_status_conflict`). Sets `withdrawn` and records `withdraw`.

**Admin decision** (`POST /api/admin/spaces/:id/discovery/:decision`): the same note, `requestedAt` and conflict rules as a verification decision. An approval is also refused with 409 `discovery_requires_listable_visibility` when the space is private at that moment, and with 409 `discovery_requires_uploaded_pictures` when its icon or banner is an address on another site. Audit: `discovery_<decision>` with the note and `{ status }`. A step on a space with `directory_listed = 1` marks the directory dirty.

**Edits of a reviewed space.** `PATCH /api/spaces/:id`, which anyone with `MANAGE_SPACE` may call, runs `reviewsAfterEdit(before, after)` and writes the resulting statuses in the same update as the edit, so no change is listed unseen:
- a space with an approved, pending or changes-requested listing that goes from public or request to private → `withdrawn`, open requests included;
- an approved space whose name, description, icon or banner changes → `pending`, hidden until approved again;
- a pending or changes-requested request whose space changes those fields keeps its status, but the edit is a new version of it: the request's `requested_at` becomes the time of the edit, so an admin who decides on the view loaded before it gets 409 `review_status_conflict` and sees the new version first;
- anything else (a switch between public and request, a colour) leaves the status alone.

Each step is recorded as a `changed` event with the editor as actor (`recordEditSteps`) and announced like any other step, so the owner is told even when someone else made the edit. Deleting a space with an open request updates the admins' queue count.

**Migration 0041** moved every space that was public or request to join into review: `discovery_status = 'pending'`, a request with category `other` sent in the owner's name, and a `migrated` event. Visibility and the directory opt-in were kept; the space is hidden until an admin approves it, and the owner can name its category by sending the request again. The migration also sets `directory_dirty`, so the pinger tells the hub on boot that the served document shrank.

**Owner UI:** Space settings → **Discovery** (for `MANAGE_SPACE`), whose top section is `DiscoveryListingSection`. For the owner: the status chip with a sentence on what it means, the admin's last note, when the request was sent, a `ListingPreview` of the card (banner, icon, name, badges, category, description, member count), what the reviewers look for (public or open to join requests, a description and an icon, checked as the space is now; an honest name and description and the instance's rules, left to the reviewer), the category, Send or Send again (on an approved listing only once another category is chosen, and after a confirmation that the space leaves Explore until it is approved again), Withdraw (Take off Explore while approved, after a confirmation) and the history. Everyone on the tab reads that space discovery is off for the instance while it is. Anyone else with `MANAGE_SPACE` reads that the owner asks for a listing. The visibility, directory and description controls follow below it ([directory.md](directory.md) §10).

---

## Platform audit log

What the instance's administrators did to accounts, spaces and the instance. Written by `recordPlatformAudit()` in `utils/platformAudit.ts`; read by `GET /api/admin/audit` and by the account and space detail routes (their 20 newest entries).

**Table** `platform_audit_log` (migration 0041):

| Column | Notes |
|--------|-------|
| `id` | Snowflake, so ids sort by time. Paged through the index `idx_platform_audit_log_page` on `CAST(id AS INTEGER)` |
| `actor_id` | The admin who acted |
| `action` | A `PLATFORM_AUDIT_ACTIONS` value |
| `target_type`, `target_id` | `'user'`, `'space'` or `'instance'`, and the target's id; indexed together (`idx_platform_audit_log_target`) |
| `target_label` | The target's name when the action was taken |
| `reason` | The reason the admin gave, or null |
| `details` | JSON object of what the action set; null when empty |
| `created_at` | Epoch ms |

No foreign keys: an entry outlives its actor and its target. No retention: unlike a space's audit log nothing prunes it; these are the records an admin team answers for, and there are few of them. `recordPlatformAudit` never throws: the action it records has already been taken, so a failed insert is logged (`[platform-audit] could not record ...`) and the request goes on.

**Actions:**

| Action | Written by | Target | Reason | Details |
|--------|-----------|--------|--------|---------|
| `user_suspend` | `POST /api/admin/users/:id/suspend` | user | the suspension's reason | `{ until, durationHours }` (both null until lifted) |
| `user_unsuspend` | `POST /api/admin/users/:id/unsuspend` | user | optional | `{ expired }` |
| `user_role` | `PATCH /api/admin/users/:id/role`, when the flag changed | user | -- | `{ isAdmin }` |
| `user_password_reset` | `POST /api/admin/users/:id/reset-password` | user | -- | -- |
| `user_delete` | `DELETE /api/admin/users/:id` | user | -- | -- |
| `space_delete` | `DELETE /api/admin/users/:id` with `deleteSpaces` | space | -- | -- |
| `user_badges` | `PUT /api/admin/users/:id/badges`, when the list changed | user | optional | `{ added, removed }` |
| `space_badges` | `PUT /api/admin/spaces/:id/badges`, when the list changed | space | optional | `{ added, removed }` |
| `verification_approve`, `verification_reject`, `verification_request_info`, `verification_revoke` | `POST /api/admin/spaces/:id/verification/:decision` | space | the decision's note | `{ status }` |
| `discovery_approve`, `discovery_reject`, `discovery_request_changes`, `discovery_withdraw` | `POST /api/admin/spaces/:id/discovery/:decision` | space | the decision's note | `{ status }` |
| `settings_update` | `PATCH /api/settings/instance` and `PATCH /api/settings/streaming`, when a value changed | instance, id `settings` | -- | `{ fields }`: the names of the changed columns, never their values |
| `invite_create`, `invite_update`, `invite_revoke`, `invite_reinstate`, `invite_delete` | `routes/invites.ts` | instance, the invite's id (labelled with its name, except on delete) | -- | reinstate: `{ tokenRotated }` |
| `storage_cleanup` | `POST /api/admin/storage/cleanup` and `/cleanup-media`, not on a dry run | instance, id `storage` | -- | `{ kind, maxAgeDays?, deletedFiles, freedBytes }` |
| `decoration_remove` | `POST /api/admin/decorations/:id/remove`, an administrator taking a decoration someone made away from its tile in the gallery ([decorations.md](decorations.md), "Made by people") | user, its maker (labelled with the design's name) | the reason its maker is told | `{ decoration, kind, ground }` |

The owner's requests and withdrawals and the instance's own steps (an edit that moved a Discovery status, the migration) are not in this log; they are in the space's review history.

**Reading** (`GET /api/admin/audit`), newest first:

| Param | Rule |
|-------|------|
| `before` | An entry id (digits, at most 20); answers older entries. Else 400 `validation_failed { field: 'before' }` |
| `limit` | 1-100, default 50 (`PLATFORM_AUDIT_PAGE_SIZE`) |
| `targetType` | `user`, `space` or `instance`; else 400 `validation_failed { field: 'targetType' }` |
| `targetId` | Exact match on the first 64 characters given |
| `action` | A known action; else 400 `validation_failed { field: 'action' }` |

```typescript
PlatformAuditResponse = { entries: PlatformAuditEntry[]; hasMore: boolean }
PlatformAuditEntry = {
  id: string;
  action: string;                 // a PlatformAuditAction; a newer instance may send one this client does not know
  actor: PlatformActor | null;    // { id, username, displayName } read now; null once the row is gone
  targetType: 'user' | 'space' | 'instance';
  targetId: string;
  targetLabel: string | null;
  reason: string | null;
  details: Record<string, string | number | boolean | null | string[]> | null;
  createdAt: number;
}
```

**UI:** [PlatformAuditPanel](#platformauditpanel), and the audit section of each detail modal.

---

## Badges (grants)

What an instance admin gives. The badge registry, the derived badges (staff, verified, the member badges, the owner's crown), the security rules and where badges show are in [badges.md](badges.md).

| Scope | Badges an admin can give (`GRANTED_USER_BADGES`, `GRANTED_SPACE_BADGES`) | Stored in |
|-------|---------------------------------------------------------------------------|-----------|
| A person | `helper`, `founder`, `early_supporter`, `bug_hunter`, `developer`, `creator`, `event_participant`, `community_contributor`, `beta_tester` | `users.badges` |
| A space | `partner` | `spaces.badges` |

Each column holds a JSON array of badge ids, null when empty. `staff` and `verified` are never stored: they follow `users.is_admin` and `spaces.verification_status`.

**`PUT /api/admin/users/:id/badges`** (`BadgeGrantBody { badges, reason? }`): 404 `user_not_found`; 400 `user_already_deleted`; `badges` must be an array of at most 32 entries, each a badge that can be given to a person (`isGrantedUserBadge`), else 400 `badge_invalid`, so staff, a space badge or an unknown id is refused. The list replaces the stored one, de-duplicated and in registry order (`orderedBadges`). When it changed: a `user_badges` audit entry with `{ added, removed }` and the reason (1-500 characters; anything else is recorded as no reason), and `user_updated` to the person and everyone who sees them (`announceUserUpdate`). Answers the `AdminUser`.

**`PUT /api/admin/spaces/:id/badges`**: the same rules for the space scope (`isGrantedSpaceBadge`); 404 `space_not_found`. When it changed: a `space_badges` audit entry and `space_updated` to the space's members (`announceSpaceUpdate`). Answers the `AdminSpaceSummary`.

Neither route looks at `home_instance`: an admin can give badges to a federated account's row here, and they show wherever this instance sends that row.

**UI:** a Badges section in [AdminUserDetailModal](#adminuserdetailmodal) (not for a deleted account) and in [AdminSpaceDetailModal](#adminspacedetailmodal): one checkbox per badge that can be given, with its glyph and name, and Save once the selection differs from what is stored. Neither form sends a reason.

---

## Frontend Architecture

### Settings Store (settingsStore.ts)

Zustand store managing two data objects:

| State | Type | Fetched Via | Updated Via |
|-------|------|-------------|-------------|
| streamingLimits | InstanceStreamingLimits \| null | `fetchStreamingLimits()` | `updateStreamingLimits()` |
| instanceSettings | InstanceAdminSettings \| null | `fetchInstanceSettings()` | `updateInstanceSettings()` |
| isAdmin | boolean | Set externally via `setIsAdmin()` | `resetSessionState()` clears it on logout |
| gifEnabled | boolean | `fetchGifEnabled()` | -- |

**A failed fetch leaves `streamingLimits` null.** `fetchStreamingLimits()` logs and keeps the field unknown rather than substituting `DEFAULT_LIMITS`. The document carries `discoveryEnabled` and `directoryEnabled`, and those defaults assert a pair (`discoveryEnabled: true`, `directoryEnabled: false`) that would be shown to the user as fact: the Explore page's `InstanceDiscoveryHint` would tell an admin on a listed instance that their spaces are not listed, next to a button that writes the setting, and `StreamingPanel` could save invented limits over the instance's real configuration. Every reader handles null without inventing a value; what each one does with an unknown document is described where that surface is, in [directory.md](directory.md) §10 for the Explore hint and the space settings switch, and under StreamingPanel below for the rest.

`DEFAULT_LIMITS` still exists, as the read-time fallback inside `getStreamingLimits()`:
```typescript
{
  maxBitrateKbps: 20000,
  minBitrateKbps: 500,
  bitrateStepKbps: 500,
  allowedResolutions: [540, 720, 1080],
  allowedFramerates: [30, 45, 60],
  maxResolution: 1080,
  maxFramerate: 60,
  discoveryEnabled: true,
  directoryEnabled: false,
  bitrateMatrixOverrides: null,
  allowCustomBitrate: true,
}
```

**Cross-field sync:** After every `updateInstanceSettings()` the store mirrors `discoveryEnabled` and `directoryEnabled` from the server's answer into `streamingLimits`, which is where the space settings `DiscoveryPanel` reads both flags for a home space (the warning banner and the directory switch's disabled reason; a remote space asks its own instance instead, see [directory.md](directory.md) §10). The answer is used rather than the request because switching discovery off clears the directory server-side.

**Exported helper:** `getStreamingLimits()` returns current limits or defaults -- used by voice/streaming code outside React. It is the one place a default may stand in: a screen share has to pick a bitrate whatever the server said. Anything that states a fact to the user, or offers to change one, reads `streamingLimits` and treats null as unknown.

**Who fetches it:** the WS ready handler for every session (`useWebSocket.ts`), and `StreamingPanel` for itself when it opens. The console does not pre-fetch it: the panel is the only reader of this document inside the instance-settings tree, and a parent's fetch cannot report its outcome to the panel that needs it.

### Review Store (reviewStore.ts)

| State | Type | Set by |
|-------|------|--------|
| queue | `ReviewQueueCountPayload \| null` | the home ready payload's `reviewQueueCount` (null for anyone but an admin), then every `review_queue_count` from home |
| revisions | `Record<spaceId, number>` | `noteUpdate(spaceId)` on every `space_review_updated`, from any origin |

`openReviewTotal(queue)` is the number the console's Reviews row and the shield in the top bar show. `ReviewQueuePanel` reloads whenever the queue's two counts change; `VerificationPanel` and `DiscoveryListingSection` reload their space's review state whenever its revision moves.

### Admin UI Panels

All panels live under `packages/web/src/components/modals/instanceSettingsPanels/`. The settings panels (General, Registration, Federation, Streaming, Storage) each operate as a controlled form with a local `draft` state, detecting changes against the store's server-synced values. Unsaved changes show a sticky glass-bubble save/reset bar at the bottom. The platform panels (Overview, Reviews, Users, Spaces, Audit log) are lists that load from the API on their own, with the detail of an account or a space in a modal (`AdminUserDetailModal`, `AdminSpaceDetailModal`, both `mobileStyle="fullscreen"`); their tab order and the phone's screens are under [The admin area](#the-admin-area).

#### ReviewQueuePanel

Every open request from `GET /api/admin/reviews`, in two sections, verification requests and listing requests, each headed with its count and oldest first, with an empty state when nothing waits. A row shows the space's icon, name and badges, `@owner`, the category and the request date, and the status chip (`ReviewStatusChip`: mint for verified or approved, amber while waiting, rose for rejected or revoked, grey otherwise); a listing row adds the description and the space's verification status. Opening a row opens `AdminSpaceDetailModal`, whose owner link opens `AdminUserDetailModal`. Reloads whenever the open-request count changes, and after a decision.

#### PlatformSpacesPanel

Every space this instance hosts (`GET /api/admin/spaces`): search by name or id (debounced 300 ms), a filter (all spaces, listed in Explore, verified, open review), pages of 50. A row shows the icon, name and badges, `@owner`, member count and creation date, and on desktop the Discovery and verification chips. Opening a row opens `AdminSpaceDetailModal`.

#### AdminSpaceDetailModal

One space (`GET /api/admin/spaces/:id`), in sections:
- **Header:** icon, name, badges, member count, visibility, creation date, a directory opt-in mark while `directory_listed = 1`, and the owner, which opens their account.
- **Verification:** the status chip and every field of the request as the owner sent it (name and description then, category, website, profiles, reason, proof, who sent it when), then the decisions that apply to the status now (`verificationDecisionApplies`): approve, request information, reject, revoke.
- **Discovery:** the status chip, a `ListingPreview` of the space as it is now with the requested category, the category, who sent it when and the last decision's note, then the decisions that apply: approve, request changes, reject, withdraw.
- **Badges:** a checkbox per space badge an admin can give ([Badges (grants)](#badges-grants)).
- **History** of both reviews (`ReviewHistory`) and the 20 newest platform audit entries about the space.

Every decision opens `ReviewDecisionDialog`: what the decision does, a reason (required where the rule says, at most 1000 characters; the owner reads it), and a confirm button, the danger variant for reject, revoke and withdraw. The decision is sent with the `requestedAt` of the request shown, so a request sent again meanwhile comes back as `review_status_conflict`, shown in the dialog. After a decision or a badge change the modal reloads and tells the list behind it.

#### AdminUserDetailModal

One account (`GET /api/admin/users/:id`): avatar, name, `@username` and chips (Admin, the home instance of a federated account, Deleted, Suspended); facts (joined, spaces, friends, messages); the spaces it owns; **Suspension**; **Badges** (not for a deleted account); the 20 newest platform audit entries about it.

The Suspension section shows either the standing suspension (since when, until when or until lifted, the reason) with **Lift suspension**, which asks for an optional reason in `ReviewDecisionDialog`; or, for an account that may be suspended (not deleted, not an admin, not the viewer's own), the form: a duration select (`SUSPENSION_DURATIONS`, 24 hours preselected), a reason of 3-500 characters that the person reads when they try to sign in, and **Suspend**, which confirms in a danger `ConfirmDialog` naming the account and the duration; or a sentence saying why not (deleted, own account, demote first).

#### PlatformAuditPanel

The platform audit log, newest first, 50 at a time (`GET /api/admin/audit`), with a filter by target (everything, accounts, spaces, instance) and "Show older entries" while `hasMore`, which asks for entries before the last id shown. `PlatformAuditList` renders each entry: the action's name, the target's label (not for instance entries, nor in the detail modals' compact list), who did it, when, a sentence for what it set where there is one (the suspension's end, admin role given or taken, badges added and removed by name, the settings fields changed, files deleted and space freed) and the reason. An action this client does not know (from a newer instance) reads as a neutral line rather than failing.

#### GeneralPanel

Manages: instance name, the space-discovery ladder, the global browsing switch, GIF API key.

- Instance name input: max 32 chars, enforced client-side via `slice(0, 32)`
- Space discovery ladder: one radio group ("Space discovery", "How far spaces on this instance can be found.") replacing what used to be a discovery toggle and a directory toggle. Three mutually exclusive rungs, each a superset of the one above, and each writing both stored flags at once:

  | Rung | Label | `discoveryEnabled` | `directoryEnabled` |
  |------|-------|--------------------|--------------------|
  | `invite` | Invite only | false | false |
  | `local` | Local space discovery | true | false |
  | `global` | Allow global listing | true | true |

  The selected rung is derived from the draft by `levelOf()`, never stored as a third piece of state, and picking a rung applies that row through `LEVEL_FLAGS`. The pair the server refuses (`directory_requires_discovery`) has no rung, so the old "switching discovery off clears the directory in the draft" special case is gone; the server-side invariant is unchanged and still guards the API.
- Under the `global` rung only, indented beneath it and rendered as a sibling of the radiogroup (which may own only radios): (1) while `federatedRegistrationOpen` is off, the amber note that listed spaces will show as closed to new accounts, with an "Open federated accounts" button that calls `updateInstanceSettings({ federatedRegistrationOpen: true })` immediately, outside the draft, disabled while in flight and reporting failure through the panel's `saveError` line. The flag is never flipped automatically by picking the rung: opening sign-ups to strangers stays an explicit click. The note appears as soon as the rung is picked in the draft, before any save. (2) a status line fed by `directoryLastPingAt` and `directoryLastError` ("Never reported" / "Last reported <date>", then "Last attempt failed (<reason>)" with the hub's reason for a `fetch` status, a sentence of its own for `origin`, `network` and `timeout`, or the bare HTTP status). (3) the one-sentence disclosure of what listing makes public. Before (1), while `directoryListedSpaceCount` is 0 and the instance has an endpoint, a second amber note says the rung lists nothing by itself and each space has to switch on its own listing, with a "Show me where" button into a space's Discovery tab ("Save and show me where" while the panel has unsaved changes, which saves first); once a space is listed the note gives way to an "N spaces listed" line in the status box. Which space the button opens and when it is offered: [directory.md](directory.md) §10. The status line reads the store's `instanceSettings`, not the draft, and the panel calls `fetchInstanceSettings()` every 10 seconds while mounted (`INSTANCE_SETTINGS_REFRESH_MS`) so it follows the pinger, whatever rung is selected; the draft holds only the five editable fields and a refresh reseeds it only while it has no unsaved edit. Strings under `admin:general.discovery.*` and `admin:general.directory.*`. See [directory.md](directory.md) §10.
- Global browsing switch, directly under the ladder in the same section, separated by a rule and outside the radiogroup: "Show global spaces in Explore" with "People here see spaces from other instances in Outer Space. Their browsers load those spaces' icons and banners from the instances that own them." It writes `directoryBrowseEnabled`, the incoming axis, and is a draft field saved by the same save bar as the rungs, not an immediate write. On an instance with no `DIRECTORY_ENDPOINT` the switch renders **off** and disabled, with "This instance is not configured to reach a directory, so there is nothing to show." beneath it: off is the effective state whatever the column says, and the column is deliberately not written to match, so browsing resumes at the admin's last choice if an endpoint is ever configured. The panel reads `directoryConfigured` from `GET /api/instance/info`, once. The same fact also takes the global rung out of the ladder, since listing needs the endpoint too; both are described once in [directory.md](directory.md) §10. Strings under `admin:general.browse.*` and `admin:general.discovery.unconfigured`.
- GIF key: password input, separate dirty tracking (`gifKeyDirty`). Only sent on save if modified. "Clear key" button sets empty string.

The registration toggles (`registrationOpen` / `federatedRegistrationOpen`) and the invite-link manager live in [RegistrationPanel](#registrationpanel).

#### RegistrationPanel

Owns the two independent registration gates and the admin invite-link CRUD surface. Mounted in the instance settings sidebar between **General** and **Users**.

**Toggles** (top of panel) — bound to `settingsStore.instanceSettings.registrationOpen` and `.federatedRegistrationOpen`. Save bar appears at the bottom of the panel when either toggle differs from the synced value (existing pattern from `GeneralPanel`):

- **Public registration** (`registrationOpen`) — "Allow anyone to create a local account from `/register`. When off, only invite links work for new local accounts."
- **Federated registration** (`federatedRegistrationOpen`) — "Allow users from other instances to create a federated account here via their Connections settings. Existing federated accounts log in normally."

**Invite Links** (below the toggles) — segmented `[Active] [Archived]` tabs (local component state, default `active`). Tab switch refetches via `GET /api/admin/invites?status=...`. A `tabRef` discards stale in-flight fetches when the admin switches tabs mid-load. `[+ Create link]` button opens the Create modal.

**Invite row** — name (left, primary text), usage indicator (`usedCount / maxUses` or `usedCount uses · unlimited`, color-coded amber at >=80%), status pill on archived tab (`Expired` rose / `Exhausted` amber / `Revoked` txt-tertiary), expiry summary subline (active: `Expires in 4 days` / `No expiration`; archived: `Expired Apr 25` / `Exhausted Apr 27` / `Revoked Apr 28`), creator + relative-time created.

**Row actions** branch on derived status:
- **Active rows:** `Copy link`, `Edit`, `Revoke`, kebab → `Delete permanently`, `View redemptions`.
- **Archived rows:** `Reinstate`, kebab → `Delete permanently`, `View redemptions`.

**Modals:** Create / Edit / Reinstate / Redemptions all use the shared [`Modal`](../../packages/web/src/components/ui/Modal.tsx) component with `mobileStyle="fullscreen"`, portaled to `document.body` (the parent settings dialog uses `glass-modal`'s `backdrop-filter`, which establishes a containing block — portaling escapes it so the child modal renders viewport-relative). On desktop they appear as the standard centered dialog with `max-w-md` (Redemptions: `max-w-lg`); on mobile they slide in fullscreen with the Modal's standard close button + safe-area padding. The decorative lavender/sky icon chip and helper paragraph live inside `children` (Modal's `title` prop renders the heading + close X).

- **Create Invite** — Name (1-64 chars), Max uses (radio: Unlimited / `[N >= 1]`), Expires (preset: `1 hour` / `24 hours` / `7 days` / `30 days` / `Never` / `Custom…`). Defaults: `maxUses: null`, `expiresAt: now + 7 days`. On success the URL is auto-copied to clipboard and the new row animates in at the top of the active list.
- **Edit Invite** — same shape as Create, pre-filled. Hidden for `revoked` rows (Reinstate is the only path back).
- **Reinstate — Variant A** (was `revoked`): rotates the token (`tokenRotated: true`). Modal copy: "This will generate a new link. The previously revoked URL stays inactive." Required to bump `maxUses` and/or `expiresAt` so the resulting row derives status `active` (server returns 400 otherwise).
- **Reinstate — Variant B** (was `expired` or `exhausted`): preserves the same token (`tokenRotated: false`). Modal copy: "The same link will start working again. Anyone who saved the URL will be able to use it." Same bump-to-active validation.
- **Delete confirmation** — uses the existing `ConfirmDialog` with `variant="danger"`, copy: "Delete `<name>` permanently? This cannot be undone. Redemption history for this link will also be removed. If you only want to stop the link from working, use Revoke instead — that preserves the redemption record." (Spec §4.2 originally proposed type-to-confirm, but the codebase uses the existing `ConfirmDialog` precedent for high-blast-radius admin actions; type-to-confirm was not introduced as a one-off pattern.)

**Redemption viewer** — opens via `View redemptions` action. Shows `usedCount of maxUses` header (or `usedCount uses · unlimited`), then one row per redemption: `registrantUsername` (left) + `redeemedAt` formatted (right). When `currentUsername !== registrantUsername` (post-rename) or `isDeleted === true`, the registrant name is annotated `alice (now Anastasia)` / `alice (now Deleted User)` — snapshot stable, live state visible. Clicking a non-deleted row opens the user's profile (`UserPopover`). If the invite is revoked, a banner at the top notes "The redemptions above represent users who registered before revocation."

**Invites outlive their creator's account.** `invite_links.createdBy` has no CASCADE — when an admin is tombstoned, their invites stay live and any current admin can manage them. The list joins `users` to surface `createdByUsername`, which resolves to `'Deleted User'` when the creator has `isDeleted = 1` (matching the `sanitizeUser` convention).

**State ownership.** Invite CRUD is **not** in `settingsStore` — it's transient panel state owned by `RegistrationPanel` (`useState` for `tab`, `invites`, `invitesLoading`, modal flags). Pattern matches `UsersPanel`. Reasoning: invites are page-scoped, not session-scoped — caching them globally would just create staleness bugs when the panel reopens.

**Type shapes** (from `packages/shared/src/types.ts`):

```typescript
type InviteLinkSummary = {
  id: string;
  token: string;
  name: string;
  status: 'active' | 'expired' | 'exhausted' | 'revoked';  // derived; never stored
  maxUses: number | null;
  usedCount: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdBy: string;
  createdByUsername: string | null;  // 'Deleted User' when creator's isDeleted = 1
  createdAt: number;
  lastRedeemedAt: number | null;  // epoch ms of most recent redemption; null when usedCount = 0
  url: string;  // server-built `https://<host>/register?invite=<token>` — clients MUST NOT assemble
};

type InviteRedemption = {
  id: string;
  userId: string | null;       // null only on hard-delete (defensive — tombstone keeps row populated)
  registrantUsername: string;  // snapshot at registration moment
  currentUsername: string | null;
  isDeleted: boolean;
  redeemedAt: number;
};
```

See [api.md → Admin: Invite Management](api.md#admin-invite-management-routesinvitests) for full endpoint signatures and the [auth.md → Invite Tokens](auth.md#invite-tokens) section for the redemption transaction + audit trail.

#### FederationPanel

Manages: the relay settings (`federationRelayEnabled`, `autoAcceptPeering`, `federationRelayTtlDays`, `defaultAutoRotateIntervalDays`), federation peers list, pending approval requests (inbound + outbound), manual peering initiation, secret rotation, peer reset.

- Relay group (`federation:admin.relay.*`): two toggles, relay enabled and auto-accept peering, and two number inputs clamped to 1-365 days, the relay TTL and the default auto-rotation interval. All four are draft fields saved together through `updateInstanceSettings`.

- **Pending Approvals section:** Visible only when `pendingApprovalCount > 0` (from ready payload — the count sums inbound + outbound rows). Positioned above the peer list. Both directions render as rows in the same unified queue, branched on `direction`:
  - **Inbound rows** — "{instanceName} ({origin}) — wants to peer with us." Approve / Deny buttons.
  - **Outbound rows** — "{instanceName} ({origin}) — N user(s) want us to peer with them. Triggered by: friend-add (etc.)." Inline expansion reveals the subscriber list (`username — friend_add → alice@orbit`, ...). Approve / Deny buttons same as inbound; backend branches on direction.
  - Approve calls `api.federation.approveApprovalRequest(id)` and Deny calls `api.federation.denyApprovalRequest(id)`. Both remove the row from the local list on success and refresh on `federation_approval_request_received` (which now also fires for outbound queue creation) and `federation_peers_changed`.
  - **ConfirmDialog copy variants:** the dialog branches on direction. Outbound approve confirms "send `/peer/accept` to {origin} on behalf of N user(s)"; outbound deny confirms "fan out denied notifications to N user(s) and discard the queued request" (no remote network call).
- Federation peers: fetched via `api.federation.peers()`, displayed as a list with status badges (active/pending/unreachable/awaiting_approval/rejected/needs_attention), last-seen/synced times, and per-peer actions.
- Peers with status `'revoked'` are filtered out of the visible list.
- Peers in `unreachable` status render a "Check now" button that calls `api.federation.recheckPeer(peerId)` (`POST /api/federation/peers/:id/recheck`) to run an immediate reachability probe. On `recovered: true` the row flips to `active` locally and a success toast fires; otherwise a "still unreachable" toast shows. This is the manual counterpart to the demand-driven `processRecoveryTick` worker (see [federation.md → PEER_UNREACHABLE_THRESHOLD](federation.md#peer_unreachable_threshold)).
- Revoke calls `api.federation.revokePeer(peerId)` and removes from local list.
- **Why a peer is rejected or needs attention.** A `rejected` or `needs_attention` row shows its `statusReason` in place of the last-seen line (`federation:admin.peer.reason.*`, rose), and the opened row explains it with the peer's host and what the admin can do (`federation:admin.peer.reasonDetail.*`). The badge is the short status name. A `rejected` row keeps the Re-initiate and Delete actions (`DELETE /peers/:id/permanent` accepts `rejected` as well as `revoked`) but is not struck through: only the Revoked view reads as gone. A legacy `rejected` row without a reason shows the last-seen line. The reasons and their meaning: [federation.md → Peer state](federation.md#peer-state). Workbench: `packages/web/dev-peer-states.html` (`?scene=list|expanded|toasts`, `&peer=<id>`, `&lang=`).
- Peers in `needs_attention` status render with a rose "Needs Attention" pill and a single "Reset Peering" action. The action opens a danger-variant ConfirmDialog explaining that reset deletes the local peer record (cascade-removes outbox entries) and requires out-of-band re-peering with the remote admin.

- **Reset cleanup section** (`ResetCleanup`, instance-epoch self-healing §6.4) — the highest-priority attention surface, rendered above the peer list; returns `null` when there is nothing to clean up. Fetches `api.federation.peers()` + `api.federation.resetEvents()` and subscribes to `onFederationPeerResetDetected` (the `federation_peer_reset_detected` WS event) to refetch live. Two stacked surfaces:
  - **Reset-detected banner** — one persistent accent-rose banner per peer with `status === 'needs_attention' && statusReason === 'peer_reset_detected'`, distinguishing a wiped-and-reinstalled peer from a generic auth-failure peer. Its **Re-peer** button runs the existing one-click flow in order: `api.federation.resetPeer(id)` **then** `api.federation.initiatePeering({ remoteOrigin })` — resetting the stale local record *before* the fresh handshake so activation heals stale friendships/DMs against the new incarnation (warning-variant ConfirmDialog). **The outcome is now surfaced honestly, not always as success:** if `initiatePeering` resolves with `verified === false` (or the returned peer is `needs_attention`), the toast is a **warning** — "Re-peer incomplete — {peer} still holds stale peering for you. Its admin must reset their side, then Re-peer again." — because the handshake could not be cryptographically verified (the remote still holds a conflicting row; see `federation.md` "Trust re-establishment contract"). If it rejects with `409 PEER_EXISTS_RESET_REQUIRED`, the same "ask the remote admin to reset their side" warning is shown. Only a verified activation shows the green "Re-peering initiated" success toast. This means the common one-side reset recovers in one click, while a bidirectional-stale peering tells the admin exactly that the **other** side must reset once.
  - **Detached-accounts card** (from `GET /reset-events`, per origin with `orphanedAccounts.length > 0 && acknowledgedAt === null` — acknowledged events are filtered client-side, the endpoint keeps returning them for audit) — neutral-tier (`bg-white/[0.02]`, no rose/urgency styling; the rose banner is reserved for the actionable reset-detected surface). Copy is informational, not urgent-cleanup: "{origin} was reset — N replicated identities auto-cleaned, N accounts with local content detached. Detached accounts keep working locally — owners keep access with their existing password." Each detached real account is shown with its owned-spaces / membership / message counts. Actions: a per-account **Remove** (danger ConfirmDialog → `api.admin.deleteUser(id)`, i.e. the existing `DELETE /api/admin/users/:id` full purge, for accounts that truly are abandoned; a Remove on a space-owning account returns the existing `409 { ownedSpaces }` → "transfer ownership first" toast rather than deleting) and a per-event **Dismiss — keep all detached accounts** footer button that calls `api.federation.acknowledgeResetEvent(origin)` (`POST /api/federation/reset-events/acknowledge`) then re-fetches — a real, server-side acknowledgement (not the old client-only "Keep") that hides the card and drops the event from the badge count without touching any account. The badge counts unacknowledged events-with-orphans plus reset-detected peers.

#### StoragePanel

Manages: storage overview, file type breakdown, upload limit, orphan cleanup, media retention cleanup.

- **Stats grid:** 5 cards (total files, referenced, orphaned, unlinked uploads, dangling records) with byte formatting
- **File type breakdown:** List of categories (image/video/audio/document/other) with file counts and sizes
- **Upload limit:** Number input (1-5120 MB) with save button, persisted via `updateInstanceSettings({ maxUploadSizeMb })`
- **Limits per account:** Files per account in GB and spaces per account, persisted via `updateInstanceSettings({ storagePerAccountGb, spacesPerAccount })`. 0 means no limit ([uploads.md](uploads.md), "Limits per account")
- **Orphan cleanup:** Two-step (preview dry-run, then live). "Clean Up Now" disabled until preview completes
- **Media retention:** Age-based cleanup with configurable days input. Same two-step preview/execute pattern.
- "Refresh Stats" link at bottom re-fetches all stats

#### StreamingPanel

Manages: bitrate range (min/max/step), custom bitrate toggle, resolution/framerate allowlists, bitrate matrix.

- **Its own load:** the panel calls `fetchStreamingLimits()` on mount and reads the outcome from the store afterwards (the action swallows its error, so "the document arrived" is the signal). Until it does, the panel shows the loading line; a load that leaves the document null shows the panel's rose failure block, the same treatment its save errors use, with a Retry that stays in place and is disabled while the request is in flight.

- **Bandwidth section:** Range sliders + number inputs for min/max bitrate. Step size via preset pills (100, 250, 500, 1000, 2500, 5000 kbps) + custom number input.
- **Custom Bitrate toggle:** Controls whether users can set their own bitrate vs using matrix defaults
- **Quality section:** Toggle pills for each resolution (540p, 720p, 1080p, 1440p, 4K, Native) and framerate (30, 45, 60, 75, 90, 120 fps). At least one of each must remain enabled.
- **High-end warning:** Shown when resolutions >= 1440 or framerates >= 75 are enabled. Warns about CPU/GPU/bandwidth requirements.
- **Bitrate matrix:** Interactive grid of resolution x framerate cells. Displays in Mbps (stored as kbps). Click to edit. Overridden cells highlighted in accent-primary. Cells exceeding maxBitrateKbps highlighted in amber.
- **Scale slider:** Multiplies all matrix values by 0.5x-2.0x. Captures snapshot on drag start, applies factor during drag, releases on pointer up.
- **Save payload:** Only cells differing from defaults are sent as `bitrateMatrixOverrides`; identical-to-default cells are omitted (sparse representation). If no overrides, `null` is sent.

#### UsersPanel

Manages: user list with search/filter/sort/pagination, admin promotion/demotion, password reset, account deletion; each account's detail, suspension and badges open in `AdminUserDetailModal`.

- **Search:** Debounced (300ms) text input, resets to page 1 on change
- **Filters:** Instance dropdown (local/specific domain), role (admin/non-admin), status (all accounts / suspended, sent as `status=suspended`), joined-after/joined-before date pickers, sort dropdown
- **"Clear filters" link:** Visible when any filter/sort/search is active. Resets all to defaults.
- **Page size:** Fixed at 50 (not user-configurable)
- **Pagination:** Previous/Next buttons, "Page X of Y (N users)" label
- **User rows:** Avatar, username, display name, chips (Admin amber, federated instance sky, Deleted rose, Suspended rose while a suspension stands), join date. The username and a **Manage** button open `AdminUserDetailModal`
- **Action buttons** (per user, hidden if deleted):
  - Shield icon: promote/demote admin. Disabled for federated users. Demotion requires ConfirmDialog.
  - Key icon: reset password. Disabled for federated users. Requires ConfirmDialog. Shows temporary password inline.
  - Trash icon: delete user. Disabled for self. Requires ConfirmDialog (danger variant).
- **Temp password display:** Appears inline below the user row after successful reset. Includes copy-to-clipboard button and "Shown once" notice.

---

## Data Flow: Settings Update Lifecycle

```
[Admin UI Panel]
  → local draft state (useState)
  → user clicks Save
  → settingsStore.updateStreamingLimits() / updateInstanceSettings()
    → api.settings.updateStreaming() / updateInstance()
      → PATCH /api/settings/streaming or /api/settings/instance
        → Server validates each field
        → Cross-field validation (min < max for bitrates)
        → db.update(instanceSettings).set(updateData).where(id=1)
        → db.select fresh row → serialize → return
    → store.set({ streamingLimits: updated }) / set({ instanceSettings: updated })
  → UI re-renders from store, draft resets to match
```

---

## Data Flow: A Review Decision

```
[AdminSpaceDetailModal]
  → decision button (only those that apply to the status shown)
  → ReviewDecisionDialog: reason, required where the rule says
  → api.admin.decideVerification | decideDiscovery (spaceId, decision, { note, requestedAt })
    → POST /api/admin/spaces/:id/{verification|discovery}/:decision   (authenticate → requireAdmin)
      → parseReviewNote()
      → decideVerification | decideDiscovery (utils/spaceReview.ts): one transaction
          re-read status + request → rule applies? requestedAt unchanged? (else 409 review_status_conflict)
          → spaces.{verification|discovery}_status, request decision fields, space_review_events row
      → announceReviewStep()
          → space_review_updated → owner
          → review_queue_count → admins
          → space_updated → members (verification)
          → markDirectoryDirty (discovery, directory_listed = 1)
      → recordPlatformAudit(verification_<decision> | discovery_<decision>)
      → 200 SpaceReviewState
  → onChanged() (the list behind reloads) → detail reloads

[Owner's client]  space_review_updated → reviewStore.noteUpdate(spaceId) → open Verification / Discovery panel reloads; toast
[Admins' clients] review_queue_count → reviewStore.queue → Reviews tab count; Overview and Reviews reload
```

---

## Emoji

`instance_settings.emoji_policy` (Instance → General, default `admins`): who may add to the library. `POST /api/emojis` checks it first, before reading the picture, and answers `emoji_admins_only`; a server with no settings row counts as `admins`. The Emoji tab hides its form accordingly and shows the library to everyone. `GET /api/instance/info` carries the policy, so nothing has to be asked twice.

## Cross-References

- **Database schema:** [database.md](database.md) -- `instance_settings`, `users`, `spaces`, `space_verification_requests`, `space_discovery_requests`, `space_review_events`, `platform_audit_log` tables
- **API endpoints:** [api.md](api.md) -- Full endpoint listing for admin, settings, instance routes
- **WebSocket:** [websocket.md](websocket.md) -- `space_review_updated`, `review_queue_count`, the ready payload's `reviewQueueCount`, the `account_suspended` socket error
- **Badges:** [badges.md](badges.md) -- The registry, derived and granted badges, the security rules, where badges show
- **Federation relay:** [federation.md](federation.md) -- Relay toggle/TTL mechanics, peer management, outbox delivery
- **Voice/streaming:** [voice.md](voice.md) -- Client-side enforcement of streaming limits
- **Permissions:** [permissions.md](permissions.md) -- Admin flag is separate from RBAC; `isAdmin` is a user-level column, not a permission bit; owning a space is `owner_id`, never a role
- **Spaces:** [spaces.md](spaces.md) -- Visibility, the space settings tabs where an owner asks for verification and a listing
- **Social:** [social.md](social.md) -- The username search, which leaves suspended accounts out
- **Auth:** [auth.md](auth.md) -- Sign-in and token checks, where a suspension is refused
- **Space directory:** [directory.md](directory.md) -- The opt-in public directory: the admin toggle and status line, the per-space switch, the pinger, the hub; it carries only spaces listed in Discovery

## Legal and reports

Two sections of the admin area: **Reports** (`ReportsPanel`, with the open count on its tab) decides what people reported, and **Legal** (`LegalPanel`) holds the operator's details and publishes the terms and the privacy policy. The audit log records `legal_operator_update`, `legal_publish` and `report_decide`; `user_suspend` also comes from a report. Full description: [legal.md](legal.md).

**Sign-up rules, automatic sign-ups.** The console's sign-up page also sets the level of the task a browser solves before an account is created (off, normal, high; auth.md, "Automatic sign-ups"). Changes are in the platform audit log.

## Accounts that are not people

A webhook's account (`users.account_kind`) is not in the user list, the search, the counts or the CSV, and it is no active person on the overview, though its messages count as messages. The role, password and delete routes answer 404 for one. It is managed where it belongs, in its channel's settings ([webhooks.md](webhooks.md)).

## Bots

The admin console's "Bots" section holds the switch (off by default) and the list of bots with who runs them. Turning the switch off stops every bot at its next request, and open sockets within 30 seconds. Deleting one is in the platform audit log. A bot's account is not in the user list, the search, the counts or the CSV: see [bots.md](bots.md).

## Warnings and the system page

`GET /api/admin/system` also holds `alerts`, the event loop's delay and the open sockets, and the dashboard's `open.alerts` counts what the System page lists (operations.md, "Warnings"). An announcement can be marked for the public status page (`onStatusPage`, operations.md).

## Own invite addresses

The space's detail in the console shows its own address, if it has one ([spaces.md](spaces.md), "Own invite address"), with "Take away". `POST /api/admin/spaces/:id/vanity/revoke` asks for a reason, sends the owner the notice `address_withdrawn` with it, writes `space_vanity_revoke` in the platform audit log, and blocks the name for good. The space's other links go on working. A name can only be unblocked in the database.

## What else is in the audit log

`peer_trust`, with `details.change` (`initiated`, `approved`, `denied`, `revoked`, `reset`, `removed`, `rotated`), for every change an administrator makes to what this instance trusts of another one; `targetLabel` is its address. `storage_cleanup` also covers a live sweep of upload sessions (`POST /api/admin/storage/cleanup-tus`, `targetId` `upload-sessions`); a dry run is not recorded.
