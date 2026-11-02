# Tavvit — audit, decisions and work plan

> **Renamed on 2026-10-30.** This product was called Orbit until 1.12. The name could not be claimed safely for a public release, so it is **Tavvit** from 1.13.0 on. Internal keys that people's installs depend on keep the old spelling: `de.hashhive.orbit` (desktop app id), the `orbit-*` keys in browser storage, the `data-theme="orbit"` theme id, the `0032`-`0042` migration tags. `orbit://` links and `ORBIT_SOURCE_URL` keep working.

Tavvit is a private, self-hosted communication app for a small group of friends.
It is a **modified fork of [Backspace](https://github.com/TheZwiss/backspace)**
(AGPL-3.0, © Jannis Braun). This file records what the audit found, what was
decided, and the status of each work item. It is a working document: update the
status column as work lands.

- Upstream baseline: `main` @ `2885a7d3` (Backspace 1.11.0 + 3 commits)
- Working branch: `orbit`
- Licence record: see [LICENSING.md](LICENSING.md)

## 1. Architecture (verified in the checked-out code)

| Layer | What it is |
|---|---|
| Monorepo | pnpm workspaces: `packages/{shared,server,web,desktop}` + `scripts/*` tooling packages |
| Server | Node 22+/24, Fastify 4, Drizzle ORM over SQLite (`better-sqlite3`, WAL), JWT (HS256) + bcrypt(12), `@fastify/rate-limit`, WebSocket (`/ws`) for real time, tus for uploads, sharp/ffmpeg for media |
| Web | React 18, Vite 8, Tailwind 3 (token-driven via CSS variables), Zustand 5, react-router 7, i18next (en/de/pt/ru/zh), PWA via vite-plugin-pwa |
| Voice/video | LiveKit (`livekit-client` + `livekit-server-sdk`); optional `livekit` compose profile (host networking) |
| Desktop | Electron 43 wrapper (activity detection, global shortcuts, tray) |
| Deploy | Docker Compose: `backspace` (app) + `caddy` (auto-HTTPS) + optional `livekit`; `install.sh`, `update.sh` (snapshot → pull → health-gate → rollback), `backup.sh`, `restore.sh` |
| DB | SQLite file `data/backspace.db`, Drizzle SQL migrations in `packages/server/drizzle/`, automatic pre-migration snapshot (fail-closed), scheduled snapshots |

Per-subsystem specs live in `docs/systems/*.md` (database, api, websocket,
permissions, voice, auth, spaces, social, …). They remain authoritative for the
code that has not changed.

## 2. Baseline (before any Tavvit change)

Run on Windows 10 / Node 24.19 / pnpm 10.34.3 (auto-selected from `packageManager`).

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | OK |
| `pnpm typecheck` (+ i18n consistency check) | **pass** |
| `pnpm lint` (`--max-warnings 0`) | **pass** |
| `pnpm build` (shared + server + web, PWA precache) | **pass** |
| `pnpm test` — web | **321 files / 3329 tests pass** |
| `pnpm test` — desktop, pr-triage, telemetry-receiver, directory-hub | all pass |
| `pnpm test` — scripts/metrics | 411/412 (1 Windows file-permission test) |
| `pnpm test` — server | 2812 pass, 201 skipped, 8 fail (see below) |

Server/metrics baseline failures were all **environmental, not code defects**:

1. **CRLF checkout.** Git for Windows (`core.autocrlf=true`) converted the tree
   to CRLF; `scripts/pr-triage`'s lockfile parser then failed. Fixed by
   normalising to LF and adding `* text=auto eol=lf` to `.gitattributes` (this
   also protects `docker-entrypoint.sh` / `install.sh` from `bad interpreter`
   on Linux when a Windows checkout is copied to a server).
2. **Two-instance e2e harness** (`test/helpers/twoInstanceHarness.ts`) spawned
   `pnpm` without a shell, which cannot start on Windows (`pnpm.cmd`). ~25
   federation/e2e files timed out. Fixed by spawning
   `node --import tsx/esm src/index.ts` directly (what production runs).
3. `federationSync.test.ts` and `events.dmMessageRules.test.ts` failed only
   under full-suite CPU contention (pass 81/81 in isolation).
4. `version-consistency.test.ts` compared Windows `\` paths against `/`.
5. `scripts/metrics` `store.test.ts` relies on POSIX `chmod` semantics.

## 3. What already exists (do not rebuild)

Registration gate + `REGISTRATION_OPEN`; admin invite links (expiry, max uses,
revoke, reinstate, redemption audit); per-IP rate limits on register/login;
first-registered-user-becomes-admin; admin user management (promote, reset
password, delete/tombstone); friends (requests, search, mutuals); DMs 1-on-1 and
group (replies, reactions, edit/delete, typing, read state, search, embeds,
uploads); spaces, categories, channels, RBAC with overrides; LiveKit voice,
video, screen share, DM calls; presence (online/idle/dnd, `chosen_status`),
rich-presence activities (Electron-detected), custom text status; per-channel
notification settings, browser/desktop notifications; mobile shell + PWA;
snapshot backups with pre-migration safety; AGPL §13 source link
(`/api/instance/info`, `LegalLinks`).

## 4. Gaps found → decisions

| # | Finding | Decision |
|---|---|---|
| G1 | `REGISTRATION_OPEN` defaults to **true** | Default **closed**. Open mode stays available as an explicit admin choice. |
| G2 | Closed registration + zero users = no way to create the first admin (invite needs an admin) | First admin is created **from the server** with a CLI (`tavvit-admin`), never through an open web window. Login page shows a setup hint while no account exists. |
| G3 | No master federation switch; `autoAcceptPeering`, `federatedRegistrationOpen` default **on**; CSP `connect-src` allows any `https:/wss:` because of federation | New `FEDERATION_ENABLED` (default **false**): federation routes not registered, workers not started, outbound self-heal skipped, client "Connections" UI hidden, CSP `connect-src` narrowed to self + LiveKit. Existing federation code is untouched when enabled. |
| G4 | Telemetry endpoint, space-directory hub and update-check default to **upstream's servers** | Defaults changed to **off**/empty. Nothing contacts upstream unless an operator opts in. |
| G5 | Compose defaults to upstream's prebuilt GHCR image → `docker compose pull` would deploy upstream Backspace, not Tavvit | Default image is a **local build tag**; installer/updater build from source. |
| G6 | Login: per-IP limit only; unknown-user path skips bcrypt (timing oracle) | Add per-account failure throttle + constant-time dummy compare. |
| G7 | AGPL source URL defaults to upstream (inaccurate for a modified build) | Keep upstream credit, add explicit operator-configured source URL, warn in admin UI/logs when unset. |
| G8 | No user blocking | Implement (server table + routes + enforcement in friends/DMs + UI). |
| G9 | No quick switcher | Implement (Ctrl/Cmd+K) over spaces, channels, friends, DMs. |
| G10 | Custom status has no expiry | Add optional expiry. |
| G11 | Activities only come from the Electron app; browser users cannot set one | Add a manual activity picker + "games I play" profile list (consent-based, no external accounts). |
| G12 | "Backspace" identity: name, logo, icons, mascot, project-hub page (Ko-fi, upstream community, telemetry ask), landing site | Tavvit identity; upstream promotional surfaces replaced by an About page. |
| G13 | UI: warm pastel "Aether Drift", frosted glass blur, Discord-like rail + DM list | Tavvit design system: graphite surfaces, thin borders, restrained radii, solid panels (no backdrop blur), Inter, slim primary rail (Home / Friends / Messages / Spaces). |
| G14 | Backups cover the DB only; uploads are not in snapshots | Document full backup (DB snapshot + `data/uploads`) and add a helper. |

## 5. Naming policy

The product name is **Tavvit** (`common.appName`). The *instance* name (shown on
the login page, rail tooltip, `<title>`, PWA name) and the *accent colour* are
admin-configurable at runtime. Internal identifiers (`@backspace/*` package
names, `backspace.db`, `backspace_token` localStorage key, `window.backspace`
bridge, docker service name) are **kept** so that existing databases, sessions
and upstream merges keep working; renaming them has no user benefit.

## 6. Work breakdown and status

Legend: ☐ todo · ◐ in progress · ☑ done

### Phase A — audit & baseline
- ☑ Inventory, baseline, root causes of baseline failures, plan (this file)
- ☑ LF normalisation + `.gitattributes`

### Phase C-core — private by default (pulled forward: everything else needs it to run)
- ☐ Config defaults (registration closed, federation off, telemetry/directory/update-check off)
- ☐ Federation master switch (server + client + CSP)
- ☐ `tavvit-admin` CLI (create admin, reset password, list) + login-page setup hint
- ☐ Login hardening (per-account throttle, timing equalisation) + tests
- ☐ Fresh-install defaults in `ensureDefaults` (instance name, discovery off, …)
- ☐ Harness fix (spawn node directly) + `FEDERATION_ENABLED=true` for e2e
- ☐ Compose/installer default to local build; `.env.example` for Tavvit

### Phase B — identity & visual redesign
- ☐ Logo + icon masters, regenerate icons, favicon, PWA manifest, `index.html`
- ☐ Design tokens (palette, radii, shadows, flat panels, Inter)
- ☐ Runtime instance name + accent colour; dynamic manifest/title
- ☐ Shell: slim primary rail (Home/Friends/Messages/Spaces), sidebars, user dock
- ☐ Login / register / invite screens, empty states (replace mascot), About page
- ☐ Remove upstream promotion (project hub, telemetry ask, support card)
- ☐ Locale sweep (en/de/pt/ru/zh)

### Phase C — friend-group experience
- ☐ Admin UX for members/invites verified end-to-end
- ☑ Blocking: server enforcement and routes, client store, profile actions, privacy list, collapsed messages, no alerts from blocked people
- ☑ Custom status with an end (server sweeper, "Clear after" in Account)
- ☑ Badges: admin-defined, admin-awarded, shown on profiles (`docs/systems/api.md`, "Badges")
- ◐ Games list: kept on the device only (Activity settings); not shown on profiles yet

### Phase D — voice & quality of life
- ◐ Connection-state feedback and reconnect banner done; voice verification needs a server with LiveKit
- ☑ Quick switcher · manual activity (Activity settings, "Playing / Listening to / Watching") · friend activity on Home
- ☐ Notification review (DM/friend request/mention/voice), keyboard/mobile pass

### Phase E — stabilise & document
- ☐ typecheck / lint / unit / build; Windows-runnable e2e
- ☐ Browser verification (desktop + mobile screenshots), console/server logs
- ☐ Deployment docs: install, update, backup/restore, voice ports, first admin, resources
- ☐ Licensing record, NOTICE additions

### Phase F — Nitro-style features for everyone (requested after the first deployment)
Discord's paid perks, free for every member. Already present: 4000-character messages,
uploads up to `MAX_UPLOAD_SIZE` (admin-set), HD screen share (admin-set limits), personal
stickers usable everywhere, profile banner and accent colour.
- ☐ Animated avatars and banners (GIF / animated WebP; the crop step currently flattens them)
- ☑ Profile themes (two-colour gradient)
- ☑ App themes and custom colours in Appearance (Carbon design system, theme presets, accent, message styles)
- ☑ Custom emoji (upload, use in any space, in reactions)
- ☐ Per-space profile (avatar, banner, bio)
- ☐ Super reactions
- ☐ Soundboard in voice
- ☐ Video backgrounds and effects in calls

### Phase G — product, not project (requested 2026-10-23)
- ☑ Desktop app opens https://tavvit.com directly: no instance picker, no saved address, Tavvit branding, update feed on the same server
- ☑ Desktop downloads: `/download` page, sign-in aside, About page; real Windows installer from `latest.yml`; `scripts/package-desktop.mjs`
- ☑ Upstream project surfaces removed: usage reporting, GitHub release lookup and its admin panel/badge/toast, the Support card, the licence essay on About, the source link on the sign-in page, the desktop source menu items (one AGPL source line stays in the settings footer and on About)
- ☐ User settings expansion (account security, sessions, privacy, notifications, chat, accessibility)
- ◐ Server settings expansion (2026-10-27, migration 0039): ☑ moderation (blocked words with wildcards, link and invite filter, mention limit, minimum account and membership age), ☑ member timeouts (`MODERATE_MEMBERS`, bit 8; survive leave and rejoin), ☑ slow mode per channel, ☑ audit log (`VIEW_AUDIT_LOG`, bit 9; 25 actions, 180-day retention), ☑ space default notification level; ☐ invite management beyond the one code (no reset/expiry yet), ☐ integrations and community features (need infrastructure that does not exist)
- ☑ Badges removed again at the user's request (2026-10-24, migration 0038)
- ☑ Manual activity replaced by opt-in desktop game detection (Settings → Games)

### Phase H — premium UI pass (requested 2026-10-27)
- ☑ Palette "Graphite": graphite/anthracite surfaces instead of near-black, one subtle violet accent `#7466e8` (default instance and personal accent), the logo stays black and white
- ☑ Shared component classes (`.nav-item`, `.list-row`, `.icon-btn`, `.count-badge`, `.kbd`, `.empty-state`, `.page-title`, `.btn-sm`, `.btn-danger`), no pill buttons, one count badge everywhere
- ☑ Home: command field for the switcher, attention/recent/spaces in the main column, online/voice/requests in a secondary column, designed empty and first-run states; the people column is hidden on Home so nobody is listed twice
- ☑ Left navigation: home rows and DM list on `.nav-item`, DM filter All/Unread, previews and times, consistent channel and voice rows
- ☑ "Active now" lists only online friends, with an empty state
- ☑ Inbox reachable on phones; mentions open at the message on phones too
- ☐ Verification (tests, typecheck, i18n check, build) not run in this pass at the user's request; run before the next deploy
