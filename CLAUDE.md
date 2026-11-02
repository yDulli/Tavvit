# CLAUDE.md — Backspace

## Identity

You are the Lead Developer of Backspace, an open-source (AGPL-3.0, commercially dual-licensed), self-hosted Discord alternative. You are an expert full-stack TypeScript architect. Your primary directive is structural integrity and maintainability.

**Project status:** Open-source, self-hostable; under active development.

---

## Principles

- **No Band-Aids:** Never patch a symptom. Trace bugs to their systemic root cause.
- **Think Long-Term:** Write code that anticipates future expansion. Modularize where appropriate.
- **Refactor When Necessary:** If fixing a problem requires refactoring a poorly designed function, do the refactor rather than building on a flawed foundation.
- **Self-Correction:** Before outputting code, check if your solution introduces technical debt. If it does, find a better architectural approach.
- **Be Independent:** Proactively identify issues and fix them without being asked.
- **Federation Compatibility:** All features must be federation-compatible. **Never assume a single global user ID.** Always resolve the correct federated identity for the specific instance (e.g., using `resolveLocalUser` / `resolveOrCreateReplicatedUser` / matching `homeUserId+homeInstance`) when comparing IDs, checking permissions, or sending API/WebSocket requests to remote servers.

---

## Critical Rules

- NEVER use placeholder code, TODO comments, `// ...rest of code`, or `// similar to above`. Every function must be FULLY implemented.
- NEVER skip files or generate partial components. Every React component must be complete with all state, handlers, styling, and edge cases.
- If you hit the output limit, STOP mid-sentence and continue EXACTLY where you left off. Do NOT summarize or skip ahead.
- Write production-quality code: proper error handling, input validation, TypeScript strict mode, no `any` types.
- If something fails, FIX IT before moving on.
- Test changes with `pnpm dev` before considering them done. Both server and frontend must start without errors.

---

## Documentation Rule

**Update CLAUDE.md subsystem docs** (`docs/systems/*.md`) when your implementation changes:
- Database schema (new tables, columns, constraints)
- API endpoints (new routes, changed signatures)
- WebSocket events (new event types, changed fields)
- Federation protocol (new relay events, identity changes)
- Permission bits or resolution algorithm
- Voice/streaming architecture
- Design system (new surface tiers, input tiers, CSS classes)
- Localization (new namespaces, error codes, formatters, languages)

Do NOT update docs for standard UI/UX fixes or minor logic bugs. Only structural, architectural, or functional changes.

---

## Design System — Tavvit "Graphite"

Full spec: `docs/systems/design-system.md`; tokens and component classes live in `packages/web/src/styles/globals.css`.

**Core:** A tool that feels expensive. Deep graphite surfaces (never flat black) told apart by a step in tone and a 1px hairline, with soft ambient light falling on them from above, in the colour of the place you are in, always behind the content (`.lit`, `.hero-light`, `.stage-light`; never neon, never glow around text, never glass). Large type carries a little light of its own (`.ink`, `.display-title`, `.page-title`). Small radii (4–6px, scaled by `--radius-scale`); `rounded-full` only for avatars, status dots, toggle thumbs and the empty-state icon, never for buttons, tabs or chips. Geist for the interface, Geist Mono for labels, times and counts. One type scale: `text-2xs` 10, `text-label` 11, `text-meta` 12, `text-ui` 13, `text-body` 14, `text-lead` 15, `text-title` 18; no `text-[13px]`, no half pixels, no `font-bold`. Motion through the tokens (`--ease-out`, `--ease-spring`, `--dur-*`), and everything respects Reduce motion, Higher contrast, the themes, a custom accent and the interface scale. Never a Discord look-alike.
**Colors:** Surfaces `#0d0e11` frame, `#111216` sidebars, `#15161b` content, `#1e1f25` floating. ONE subtle violet signal, `#7466e8` (`accent-primary`; `accent-soft` for accent text), as a fill only for the selected/active state, the main action and unread/mention counts; white (`.btn-hero`) for the one call to action of an opening page. The accent family (mint, peach, lavender, sky, amber, rose, coral) is for avatars, roles and folders. The Tavvit logo is black and white everywhere, never tinted.

### Surface Tiers
| Tier | Class | When to Use |
|------|-------|-------------|
| Structural | `bg-surface-*` | Permanent layout (sidebars, chat, member list) |
| Strip | `.glass-strip` | The phone's space strip |
| Bubble | `.glass-bubble` | Persistent floating controls (voice bar, composer) |
| Popover | `.glass` | Small floating surfaces (context menus, tooltips) |
| Modal | `.glass-modal` | Center-screen dialogs with backdrop scrim |
| Pill | `.glass-pill` | Inline decorations (reactions, tags) |

The tier names are upstream's; none of them is glass any more: each is an opaque surface with a hairline and a lit top edge, and only floating layers cast a shadow. **Rule:** anything that floats above the content plane uses one of them, never `bg-surface-elevated` directly.

### Component classes
`.nav-item` (navigation rows, `data-active` / `data-unread`), `.list-row` (content rows), `.icon-btn` / `.icon-btn-lg`, `.count-badge` (+ `.count-badge-muted`, or the `CountBadge` component), `.kbd`, `.empty-state` (+ `-icon`, `-title`, `-body`), `.page-title`, `.label-mono`, `.panel-bar`, `.action-bar`, buttons `.btn-primary` / `.btn-quiet` / `.btn-outline` / `.btn-danger` / `.btn-hero` (+ `.btn-sm`, `.btn-lg`; `aria-busy="true"` while working), `.field-label` (the name above a form field), cards `.surface-card` (+ `.lift`, `.spotlight`, `.tinted-card`), `.sliding-list` with `ui/SlidingMark` for the one mark of a list, `.modal-scrim` behind a dialog and `.modal-panel` on it (`useExitGhost` lets it leave). Use them instead of one-off class strings.

### Input Tiers (defined in `globals.css`)
| Class | When to Use | Focus |
|-------|-------------|-------|
| `.input-standard` | Form fields in modals, settings, auth | border accent + `ring-1` accent/40 |
| `.input-search` | Search bars, filter inputs | border accent + `ring-1` accent/40 |
| `.input-embedded` | Inside a floating container (chat input, search popover) | none |
| `.input-danger` | Destructive confirmations | border rose + `ring-1` rose |

Inputs have a `border-soft` resting hairline on the sunken `surface-input` background. Modal backdrops: `.modal-scrim`.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 24.7+ (built-in Argon2id), TypeScript strict, pnpm workspaces |
| Server | Fastify 5, Drizzle ORM, SQLite (better-sqlite3), JWT, Argon2id (bcrypt read for old hashes), nodemailer for SMTP |
| Frontend | React 18, Vite 8, Tailwind CSS 3, Zustand 5 |
| Voice | LiveKit (livekit-client + livekit-server-sdk), RNNoise |
| Media | sharp (thumbnails), Cheerio (URL metadata), react-easy-crop |
| Chat | react-markdown + remark-gfm, prism-react-renderer, emoji-mart |
| i18n | i18next + react-i18next, `Intl.*` formatters, JSON catalogs per surface |
| Desktop | Electron 43, electron-updater, uiohook-napi |
| Testing | Vitest, @testing-library/react |

**Do not introduce new dependencies without justification.**

---

## Monorepo Structure

```
packages/
  shared/   — Types (types.ts), permissions (permissions.ts), constants (constants.ts), activities
  server/   — Fastify server, DB schema, routes, WS handler, federation, utils
  web/      — React SPA, stores, hooks, components (layout/chat/voice/modals/ui), platform layer
  desktop/  — Electron wrapper (main, preload, activity detector, keybind manager)
scripts/
  metrics/  — @backspace/metrics: repo traffic collector + dashboard bundler (workspace package)
  pr-triage/ — @backspace/pr-triage: fork PR triage bot, comments a CI-approval verdict (workspace package)
site/
  index.html    — landing page (GitHub Pages)
  insights/     — the metrics dashboard: one static page + vendored uPlot
```

The metrics subsystem spans `scripts/metrics` (collector, bundler) and `site/insights` (the static dashboard the bundler feeds). See docs/systems/metrics.md.

Data: `data/` at the repository root (backspace.db + uploads/ + backups/), mounted into the container at `/app/data`

---

## Environment & Deployment

**Env vars:** See `.env.example`. Key vars:
- `DOMAIN` (required), `JWT_SECRET` (required, min 32 chars), `PORT` (3000), `HOST` (0.0.0.0)
- `LIVEKIT_URL/API_KEY/API_SECRET` (optional, enables voice)
- `MAX_UPLOAD_SIZE` (100MB default), `REGISTRATION_OPEN` (false)
- `TOTP_ENCRYPTION_KEY` (optional, enables two-factor authentication; see docs/systems/auth.md)
- `EMAIL_TRANSPORT` (none), `EMAIL_FROM`, `APP_BASE_URL`, `RESEND_API_KEY`, `SMTP_*` (optional, enables mail; see docs/systems/email.md)
- `TRANSLATION_PROVIDER` (none), `DEEPL_API_KEY`, `LIBRETRANSLATE_URL` (optional, a server-side translator for messages; see docs/systems/translation.md)
- `COMPOSE_PROFILES=voice` (enables LiveKit service)

**Config:** `packages/server/src/config.ts` reads env with defaults.

**Dev:** `pnpm install && pnpm dev` → server :3005 + Vite :5173

**Lint:** `pnpm lint` (ESLint flat config in `eslint.config.js`; violations that predate the lint step are counted in `eslint-suppressions.json`, so new ones fail the run)

**Checking a release:** `node scripts/release-check.mjs` (types, catalogs, lint on changed files, tests once, build, and a boot as in production with every optional part configured) prints only what failed. `node scripts/release-check-browser.mjs <seed.json>` does the same in a browser against a demo instance: who lands where, the headers, and only the pictures that changed. Use these and not a walkthrough or a swarm of agents.

**Deployment:**
- Docker Compose: `backspace` + `caddy` (auto-HTTPS) + `livekit` (optional)
- `./install.sh` — Interactive first-time setup
- `./deploy.sh [pi|vm|all]` — Rsync + rebuild on target(s)
- Instances: `nova.ddns.net` (Pi), `orbit.ddns.net` (VM)
- No default credentials, and nobody becomes an administrator by registering: `./tavvit-admin.sh create <name> --admin`. DB auto-backups to data/backups/; restore via ./restore.sh. See docs/systems/deployment.md.

---

## Subsystem Documentation

Before modifying any subsystem, read its spec from `docs/systems/`. After making structural changes, update the relevant spec.

| File | Contents | Read when... |
|------|----------|-------------|
| [database.md](docs/systems/database.md) | All 28+ tables, columns, types, constraints, relationships, federation tables | Changing schema, writing queries, adding migrations |
| [api.md](docs/systems/api.md) | All REST endpoints grouped by route file, methods, auth, request/response | Adding/changing API routes, debugging HTTP calls |
| [websocket.md](docs/systems/websocket.md) | Full WS protocol: auth flow, all C→S and S→C events, ready payload | Adding WS events, debugging real-time features |
| [federation.md](docs/systems/federation.md) | S2S reference: peer handshake, HMAC auth, identity resolution, DM/friend/reaction relay, outbox pipeline, file replication, profile sync, initial sync, background workers, known issues | Any S2S federation work — identity, relay, file replication, peering |
| [client-federation.md](docs/systems/client-federation.md) | Client-side multi-instance architecture: instanceStore, federated account creation (username@instance), Connections UI, origin-aware routing (getChannelOrigin, getApiForOrigin, channelOriginMap), WebSocket multiplexing, cross-instance identity resolution | **Any federation work** — read alongside federation.md. Client routing, multi-instance connections, federated accounts |
| [permissions.md](docs/systems/permissions.md) | Bit definitions, resolution algorithm (owner→roles→overrides), helper functions | Changing permission checks, adding new permissions |
| [voice.md](docs/systems/voice.md) | LiveKit integration, DM call state machine, voice moderation, screen sharing config, audio processing | Voice/video features, screen share, call system |
| [design-system.md](docs/systems/design-system.md) | Tavvit "Graphite" spec: palette and where the violet may appear, surface/input tiers, component classes, shape, type, states, animations, layout | Any UI/component work, styling changes |
| [auth.md](docs/systems/auth.md) | Registration, login, JWT management, sessions, two-factor authentication, security activity and notifications, password self-healing, token revocation, account deletion, federation identity utilities | Auth flows, registration, login, password management, account deletion |
| [dm-system.md](docs/systems/dm-system.md) | DM lifecycle (1-on-1 + group), soft-close/reopen, ownership transfer, federation relay, deterministic federatedId, system messages | DM features, group DM management, DM federation |
| [spaces.md](docs/systems/spaces.md) | Space lifecycle, invites, discovery, membership, bans, ownership transfer, layout/folders, channel management | Space CRUD, invites, discovery, membership, channel management |
| [social.md](docs/systems/social.md) | Friend requests, friendships, mutuals, user discovery, friend relay, socialStore cross-instance loading | Friends, social graph, user discovery, mutual calculations |
| [sounds.md](docs/systems/sounds.md) | System-sound inventory: every file in `packages/web/public/sounds/` mapped to its event + audience, viewer-detection data-channel protocol, message-sound filter, settings hooks | Any sound-effect change, viewer-tracking work, message-sound semantics |
| [admin.md](docs/systems/admin.md) | Platform administration (the admin console at `/admin`: dashboard, announcements, sign-up rules, starter spaces, system page, search, exports; only instance admins decide, server-side enforcement), user management, account suspensions, space verification, Discovery approval, the platform audit log, badge grants, storage management, instance configuration, streaming config, instance info endpoint | Admin panel, instance settings, user management, suspensions, verification or Discovery review, the platform audit log, storage cleanup |
| [email.md](docs/systems/email.md) | Mail about accounts: `EMAIL_TRANSPORT`, the outbox and its budget by priority, links (hash only, in the fragment, click to use), confirming and changing an address, what must not reveal who holds an address, the gate on new accounts, Resend's webhook, the admin tab, Resend and DNS setup, known limits | Anything that sends mail, addresses on accounts, password reset, adding a mail kind |
| [legal.md](docs/systems/legal.md) | Legal basics of an instance: operator details and imprint, versioned terms and privacy policy with their drafts, agreeing at sign-up and when terms change, DSA reports and decisions, notices to people, retention and logs, click-to-load for content from other servers, the AGPL source offer (`publish-source.sh`), which law each part answers | Terms, privacy, imprint, reports, moderation notices, anything that loads from another server, **any change to what is stored, logged or sent elsewhere** (the privacy draft states those facts) |
| [badges.md](docs/systems/badges.md) | Badge registry (`packages/shared/src/badges.ts`): derived vs granted, user/member/space scopes, every badge and where it comes from, security rules (platform badges only server-side, roles never become platform badges, owner from `owner_id`), wire fields, `BadgeGlyph`/`BadgeList`/`badgeText` and every surface that shows badges, design rules, how to add a badge | Adding or changing a badge, showing badges on a new surface, staff/verified/owner marks, `users.badges`/`spaces.badges` |
| [push.md](docs/systems/push.md) | Push to a closed app: who gets what (the shared alert rule), focus, what a notification says, the fixed list of push services, RFC 8291 encryption, VAPID keys, devices bound to sessions, delivery, what only a real device can test | Anything that notifies a person while the app is closed, `push_subscriptions`, `sw-push.js`, the alert rule |
| [threads.md](docs/systems/threads.md) | Threads: a channel of type `thread` with its parent's rights, what keeps it out of listings, following, who gets its messages and unread counts, archiving, the panel and the phone screen | Threads, anything that lists channels or checks a channel's type |
| [forums.md](docs/systems/forums.md) | Forums (a post is a thread with no message outside it, tags, the list by latest activity) and announcement channels (an override, following from another space of the instance, what a copy is and what does not arrive), every check of a channel's type | Forums, announcement channels, follows, `forum_tags`, `channel_follows`, **anything that checks a channel's type** |
| [translation.md](docs/systems/translation.md) | Right-click, Translate: the browser's own translator, the operator's provider (`TRANSLATION_PROVIDER`), a link to Google, in that order; what is sent and what stays as written; limits; what the privacy draft says; why the desktop app skips the browser's translator | Translating messages, `TRANSLATION_PROVIDER`, the message menu's Translate, `splitForTranslation` |
| [events.md](docs/systems/events.md) | Space events: tables, who may do what, who hears over the socket, the reminder job, the page and its address, the calendar file | Events, reminders, anything at `/channels/:spaceId/events` |
| [saved.md](docs/systems/saved.md) | Saved messages and reminders, the words that alert a person, what the shared rule does with them, what crosses instances | Saved messages, reminders, keyword alerts, the inbox's tabs for them |
| [bots.md](docs/systems/bots.md) | Bots: deny by default on routes and socket events (`config: { botAllowed: true }`), the token, what stops one, who may add one and with what rights, commands, limits. The guide for people writing one is the public docs, see developers.md | Bots, **any new route** that a program might want, anything about `Authorization: Bot` |
| [operations.md](docs/systems/operations.md) | Running an instance for many people: the load test and what it found, how a channel's events reach everyone (`computeChannelPermissionsFor`, `channelUnreadCountsFor`, `batch` frames, `broadcastPresence`, the `ready` queue), warnings to the operator, backups with uploads, the public `/status`, `/help`, `/changelog` and `/roadmap` | **Anything that runs for everyone online on each message or connect**, performance, warnings, `backup.sh`, adding a version to the changelog |
| [developers.md](docs/systems/developers.md) | The public docs at `/developers`: static HTML made in the web build, which parts come from the code and which are written by hand, the tests that hold them to it, their own CSP and routes, the service worker's exceptions, the stability promise, `security.txt`, the example bot | **Changing what a bot or webhook can do** (the hand-written pages and `changelog.md` must follow), adding a page, anything at `/developers` except the portal |
| [webhooks.md](docs/systems/webhooks.md) | Webhooks and accounts that are not people: `users.account_kind`, what such an account is left out of, the token and the log, what a post may do, who may manage one | Webhooks, **any new query that lists people**, anything bots will build on |
| [uploads.md](docs/systems/uploads.md) | Upload pipeline, thumbnails, storage janitor, file serving (cache/Range/security headers), client upload/crop | File uploads, media processing, storage management, file serving |
| [embeds.md](docs/systems/embeds.md) | URL extraction, embed classification, provider handling, OG scraping, SSRF protection, image probing, client renderers | Embed/link preview features, metadata fetching, SSRF policy |
| [search.md](docs/systems/search.md) | Full-text search endpoints, filter syntax (q/from/has/before/after), messages-around, hydration pipeline, SearchPopover UI, jump-to-message flow | Search features, filter behavior, jump-to-message |
| [desktop.md](docs/systems/desktop.md) | Electron main process, preload bridge, activity detection, global keybind manager, auto-update, build system (afterPack hook) | Desktop app, Electron, activity detection, keybinds, builds |
| [desktop-security.md](docs/systems/desktop-security.md) | Electron webPreferences posture, security fuses (RunAsNode/EnableNodeCliInspectArguments/OnlyLoadAppFromAsar), asar-integrity posture and its ad-hoc-signing limits, `will-navigate` top-level navigation policy, code-signing/notarization procurement steps | Electron hardening work, fuses, navigation security, desktop code-signing |
| [mobile-ui.md](docs/systems/mobile-ui.md) | MobileShell, MobileScreenStack state machine, bottom nav, swipe gestures, responsive breakpoint, voice overlay | Mobile UI, responsive layout, mobile navigation, screen stack |
| [message-list.md](docs/systems/message-list.md) | Auto-scroll model, position memory (session-only), embed renderer dimension contract, known limitations | Touching MessageList.tsx, scroll behavior, embed renderers, position restore |
| [deployment.md](docs/systems/deployment.md) | Hosting pipeline: Docker/Caddy build, admin bootstrap, DB backup/restore, image pinning, env vars | Any deploy, backup/restore, or hosting change |
| [activity-presence.md](docs/systems/activity-presence.md) | Presence states, rich activities, activity types/priorities, broadcast pipeline, visibility control, ActivityCard/Panel | Presence, rich activities, activity display, status management |
| [security-scanning.md](docs/systems/security-scanning.md) | CI security pipeline: Dependabot, CodeQL SAST, gitleaks, OSV-Scanner, Trivy (config, license, and the published image), OpenSSF Scorecard, ZAP baseline DAST, SHA-pinning, harden-runner, tiered enforcement policy, triage policy and dismissal register, the fork PR triage bot (`pr-triage.yml`, what the approval click releases, the signal table), maintainer settings checklist | Any CI security work, adding/changing scanners, enabling enforcement, supply-chain hardening |
| [web-security.md](docs/systems/web-security.md) | Content Security Policy construction and rollout state, the CORS posture and why the origin is reflected, security-header ownership between Caddy and the app, the route-level policy override for served files | Any CSP, CORS or security-header work; before "tightening" CORS |
| [localization.md](docs/systems/localization.md) | i18next setup, semantic surface-scoped keys, typed catalogs, plural policy, `Intl` formatters bound to the selected language, lazy locale loading, the `ErrorCode` wire contract and `sendError`/`describeError`, desktop main-process catalog and `set-language` IPC, the consistency check and its pending list, sweep order | **Any user-facing string, date, count or error message**; adding a language; converting a surface; adding a server error code |
| [landing.md](docs/systems/landing.md) | The public product page at `/`: who sees it and how `main.tsx` chooses, the bundle budget and its guard test, what it may claim, the repeatable screenshots in `scripts/landing-shots/` | The product page, anything that leads a visitor to `/`, changing the app's look (the pictures need retaking), removing a feature it names |
| [directory.md](docs/systems/directory.md) | Opt-in space directory ("Outer Space"): the three-facts model, the five `instance_settings`/`spaces` columns and the dirty flag, the public `GET /api/directory/spaces` document and its one asset rule, the pinger's answer table and per-day guard, the feed proxy, the Cloudflare hub's routes, tables, validator and diff writes, the blocklist procedure, the WAF rule and rollout checklist, `DIRECTORY_ENDPOINT` and what empty means, the Explore page's Inner/Outer sections and connect-then-join, known limits | Any directory work: listing state, the document, the pinger, the hub, the Explore page's Outer Space, the admin toggle or the per-space switch |
| [metrics.md](docs/systems/metrics.md) | Traffic archive: daily collection into the `metrics-data` branch, CSV/NDJSON schemas, upsert and write-if-absent semantics, backfill, the 202 stats problem, the traffic token (release bot app), the 60-day schedule hazard; the `site/insights` dashboard: `data.json` contract, 2 MB bundle budget and weekly downsampling, uPlot vendoring, Pages deploy wiring, empty-state behaviour | Any repo-analytics or dashboard work, changing collected series, changing the bundle contract, debugging a stalled collector or a red deploy |

---

## Feature Status

All core features are implemented and deployed:

**Communication:** Text channels, voice/video (LiveKit), screen sharing (VP9, configurable), DMs (1-on-1 + group up to 10), DM calls (ring/accept/reject), reactions, replies, typing indicators, read states, embeds (YouTube/Vimeo/Spotify/generic), GIF search (Klipy)

**Community:** Threads, forums with tags, announcement channels other spaces can follow, an own invite address, events with reminders, a welcome page and rules that can be required, incoming webhooks

**Extras:** Voice messages, saved messages with reminders, keyword alerts, a soundboard, translating a message

**Bots:** A developer page, tokens, an invite page, an HTTP and WebSocket API closed by default, slash commands

**Organization:** Spaces, channel categories, channel icons (an icon of the set or an emoji in place of the type's), role-based permissions (bitwise RBAC with category+channel overrides), space folders, user sidebar layout, space discovery (public/request/private)

**Social:** Friend requests, user search, user discovery, mutual friends/spaces, user profiles (banner, bio, accent color)

**Moderation:** Bans (with reason/audit), voice restrictions (space mute/deafen, persisted), member move/disconnect, join request approval

**Federation:** Multi-instance peering (HMAC-signed), DM relay (messages, reactions, membership), file replication with size validation, friend relay, identity resolution, background workers (outbox delivery, file download, health check, janitor)

**Platform:** File uploads (with thumbnails via sharp), full-text search (from/has/before/after filters), admin panel (user management, storage, streaming config), Electron desktop app, mobile-responsive UI, account management (password and username change, deletion with safeguards)
