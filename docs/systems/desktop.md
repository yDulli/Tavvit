# Desktop & Electron System

Source files:
- `packages/desktop/src/main.ts` — Main process: window management, tray, IPC handlers, auto-update, deep links, app lifecycle
- `packages/desktop/src/preload.ts` — Context bridge: exposes `window.backspace` API to renderer
- `packages/desktop/src/updateCapability.ts` — Signature probe: can this build install its own updates
- `packages/desktop/src/updateInstall.ts` — When a downloaded update installs (`shouldInstallNow`), the restart-hidden marker, the updater's log file
- `packages/desktop/src/updateStatus.ts` — Update status union, store, and the shared prompt predicate
- `packages/desktop/src/updateDismissal.ts` — Per-version dismissal persisted to userData
- `packages/desktop/src/updaterCache.ts` — Reclaims the updater download cache on manual-mode builds
- `packages/desktop/src/notificationRetention.ts` — Holds each shown native notification until it is clicked, closed or fails (see Notifications)
- `packages/desktop/src/activityDetector.ts` — Polling, game list loading/sync, activity change detection
- `packages/desktop/src/gameMatching.ts` — What is pure in game detection: reading the answers and the list, choosing a game
- `packages/desktop/src/gameLibraries.ts` — What Steam, Epic Games and GOG leave on this computer
- `packages/desktop/src/gameDetectionSettings.ts` — Game detection on/off and programs added by hand in earlier versions, persisted to userData
- `packages/web/src/platform/callStateBridge.ts` — Tells main whether a voice session is open (`setCallActive`), so an update never installs during a call
- `packages/desktop/src/keybindManager.ts` — Global keybinds via uIOhook, native keycode mapping, press/release tracking
- `packages/web/src/stores/keybindStore.ts` — Client-side keybind persistence (Zustand + localStorage)
- `packages/web/src/hooks/useKeybinds.ts` — Keybind dispatch: Electron IPC bridge + web capture-phase fallback
- `packages/web/src/platform/electron.d.ts` — TypeScript declarations for `window.backspace`
- `packages/web/src/platform/platform.ts` — `isElectron()` / `isElectronMac()` / `getElectronAPI()` helpers
- `packages/desktop/electron-builder.yml` — Build config, protocol registration, afterPack hook
- `packages/desktop/scripts/afterPack.js` — Cross-platform native module cleanup (critical for builds), then macOS signing
- `packages/desktop/scripts/macSign.js` — Ad-hoc macOS code signing fallback (critical: without it the app will not launch)
- `io.github.TheZwiss.backspace.yml` — Flatpak manifest (offline x86_64/aarch64 source build)
- `flatpak/` — Flatpak launcher, desktop entry, AppStream metadata, and build instructions
- `packages/desktop/resources/games.json` — Bundled game list (versioned), published beside the installers with every release

---

## Architecture Overview

The desktop app wraps the Backspace web client in Electron with:
- **Main process** (`main.ts`): Window lifecycle, tray icon, IPC handler registry, auto-update, deep linking, activity detection, keybind manager
- **Preload bridge** (`preload.ts`): Exposes `window.backspace` API via `contextBridge` with full sandbox isolation (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`)
- **Renderer**: The standard web client, detecting Electron via `typeof window.backspace !== 'undefined'`

The desktop package compiles to CommonJS (`module: "commonjs"`) targeting ES2022. Electron version: 43.4+ to honor `restrictOwnAudio` in the custom screen-share handler (see [voice.md](voice.md#system-audio-loopback-shareaudio)).

---

## Window Management

The window's own buttons sit on the page's frame, whose colour a surface theme changes.
`applyAppearance` sends the colour through `setFrameColor` (`set-frame-color` over IPC) and main
passes it to `setTitleBarOverlay` after checking it is a plain `#rrggbb`. An older app has no
such method, and its buttons keep the colour it was built with until it updates.

### Creation (`main.ts:createWindow()`)

```
Default size: 1280 x 800
Minimum size: 940 x 500
Title bar: hiddenInset (macOS), hidden with titleBarOverlay (Windows/Linux)
Title bar overlay: bg #0d0e11, symbol #edeef2, height 32px
Background color: #0d0e11
```

### State Persistence

Window state is saved to `{userData}/window-state.json`:

```typescript
interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}
```

| Event | Behavior |
|-------|----------|
| resize / move | Debounced save (300ms) via `saveWindowState()` |
| close | Immediate save before hide |
| maximize | Saves `isMaximized: true`; position/size stored from `getNormalBounds()` (pre-maximize geometry) |
| restore | Validates saved bounds against current displays; strips position if window would be off-screen |

Bounds validation (`validateWindowBounds`): Uses `screen.getDisplayMatching()` to find the nearest display, then checks if the window rectangle overlaps the display's work area. If not visible, position is stripped and Electron auto-centers.

### Close Behavior

Close does **not** quit the app. The `close` event is intercepted; the window is hidden instead. The `isQuitting` flag gates actual destruction. True quit only happens via:
- Tray menu "Quit"
- `app.quit()` (Cmd+Q on macOS)
- `before-quit` lifecycle event

### The address the window opens (`appUrl.ts`)

Tavvit Desktop opens one server, the production one, and nothing else:
`PRODUCTION_URL = 'https://tavvit.com'`. There is no instance picker, no saved
server address and no setup step; `createWindow()` calls
`mainWindow.loadURL(APP_URL)` and the server's own login page is the first
thing a new user sees. Sign-in and the session live in the default Electron
session's cookies and local storage, so they persist across restarts.

| Input | Result |
|-------|--------|
| Packaged build (`app.isPackaged`) | always `PRODUCTION_URL`; no environment variable can change it |
| Unpacked build with `TAVVIT_DEV_URL=http://localhost:5173` | that address (http/https only), for development |
| Unpacked build without it, or with an unusable value | `PRODUCTION_URL` |

`resolveAppUrl()` is the one implementation, used by `createWindow()` and by
the recovery page's Reload. `DOWNLOAD_PAGE_URL` (`/download` on the same
origin) is where every "download the update" action leads (`RELEASES_URL` in
`updateStatus.ts`), and the update feed is on the same origin too (Auto-Update
Publishing below), so the three can never point at different servers.

Builds before this one saved a picked address in `{userData}/instance-url.json`.
`removeLegacyInstanceFile()` deletes it at module load, so an old address can
never stand between the app and the server.

### Interface Scale

The Appearance settings' interface-scale control is shared with the web client
(50–250%, saved locally). It uses root CSS zoom; the native title bar is not
scaled. `--titlebar-inset` is the single 33 px reservation (32 px drag region
plus 1 px divider), divided by interface scale. `App`, `SpaceSidebar` and
`ImagePreview` share it so fixed overlays and normal layout continue matching
the native controls at every scale. See `design-system.md` → Interface scale.

### Focus Tracking

Window `focus`/`blur` events send `window-focus-changed` (boolean) to the renderer via IPC. The web client uses this for notification suppression (no desktop notifications when the window is focused).

### External Links

`setWindowOpenHandler` intercepts all `window.open()` calls. HTTP/HTTPS URLs are opened in the default browser via `shell.openExternal()`. All popup windows are denied (`action: 'deny'`).

### In-Instance `/join/` Interception

Click-handlers on `https://...` URLs use `setWindowOpenHandler` (`packages/desktop/src/main.ts:391`). The handler intercepts URLs whose origin matches a connected instance and whose pathname starts with `/join/`, routing them in-app via the `open-internal-route` IPC channel instead of `shell.openExternal`.

State plumbing:
- Main process maintains `knownInstanceOrigins: Set<string>` populated via `set-connected-origins` IPC pushes from the renderer. Synchronously readable from inside `setWindowOpenHandler` (which must return its result synchronously).
- Renderer's `instanceStore` subscribes its own `instances` selector and forwards the connected-origin list (home + connected remotes) to main on every change, including initial mount.
- `packages/web/src/platform/deepLink.ts` (`useDeepLinkHandler`) subscribes to `onOpenInternalRoute` and calls `navigate(path)`.

Predicate scope: only intercept URLs whose host matches a **currently connected** instance. Invites for unknown instances or disconnected federated peers still open externally — that's the entry point for `JoinPage`'s federation-redirect flow and must not be hijacked.

Dev-mode caveat: if a developer runs Electron pointed at the Vite dev server (`http://localhost:5173`) while the API runs on `http://localhost:3005`, `window.location.origin` won't match the API origin and interception will not trigger. Production and standard-Electron-pointed-at-server dev are unaffected.

---

## Auto-Launch (Start with OS)

Settings stored in `{userData}/auto-launch.json`:

```typescript
interface AutoLaunchSettings {
  openAtLogin: boolean;   // default: false; disk cache, NOT source of truth
  startMinimized: boolean; // default: true; disk cache; OS-authoritative on Windows
}
```

### Source of Truth

The OS is the source of truth for `openAtLogin` on all platforms. Disk is used only to recover values Electron does not expose:
- **Windows:** OS-authoritative for `openAtLogin` (via `executableWillLaunchAtLogin`, which honours Task Manager's `StartupApproved\Run` disable). For `startMinimized`: derived from `launchItems[].args` when an entry exists; falls back to the disk cache when no entry exists, so the user's preference survives an off/on cycle.
- **macOS:** OS-authoritative for `openAtLogin`. Disk-cached for `startMinimized` (no introspection available).
- **Linux:** OS-authoritative for `openAtLogin`. Disk-cached for `startMinimized` (we deliberately do not parse `Exec=` lines from `.desktop` files; out-of-band edits are rare and parsing shell-quoted strings is fragile).

Flatpak is the exception: Electron cannot register a host login item across the
sandbox boundary, so both auto-launch IPC handlers return disabled settings and
the renderer hides the controls. This is decided by the dedicated
`isSandboxed()` predicate and `is-sandboxed` IPC query, not by
`UpdateCapability`; sandbox restrictions and update ownership are independent
capabilities even though `FLATPAK_ID` currently affects both.

### Platform-Specific Implementation (`applyLoginItemSettings()`)

| Platform | Method | Key parameters | Rationale |
|----------|--------|----------------|-----------|
| macOS    | `app.setLoginItemSettings({ openAtLogin, openAsHidden, args })` | `openAsHidden: startMinimized`; `args: ['--hidden']` when `startMinimized` | Both detection paths covered (legacy `wasOpenedAsHidden` for macOS < 13 and `--hidden` argv for macOS 13+) |
| Windows  | `app.setLoginItemSettings({ openAtLogin, enabled, path, args, name })` | `enabled: openAtLogin`; `path: process.execPath`; `args: ['--hidden']` when `startMinimized`; `name: 'Backspace'` | `enabled` is required to clear Task Manager's `StartupApproved\Run` disable when re-enabling. `path`/`args` enable correct matching in subsequent `getLoginItemSettings`. |
| Linux    | `app.setLoginItemSettings({ openAtLogin, name, path?, args? })` | `name: 'backspace'` (deterministic `.desktop` filename); `path: $APPIMAGE` when running as AppImage; `args: ['--hidden']` when `startMinimized` | `name` ensures stable `~/.config/autostart/backspace.desktop` path. AppImage path tracks updates. |

### Startup Re-Apply

The unconditional startup re-apply was removed (it was overwriting user changes made via Task Manager / System Settings). Today the only re-apply happens on Linux/AppImage and only when needed:

```
if linux AND $APPIMAGE is set:
  read ~/.config/autostart/backspace.desktop → recordedExecPath (null if file missing)
  if saved.openAtLogin AND recordedExecPath != null AND $APPIMAGE != recordedExecPath:
    re-apply to refresh the autostart entry's Exec= path
  (a missing .desktop file is treated as user-disabled — never recreated here)
```

This keeps AppImage updates working (the AppImage moved to a new path → autostart entry needs the new path) without overriding any user-level OS state on Windows or macOS.

### Hidden-Launch Detection

At `ready-to-show`:
- `process.argv.includes('--hidden')` — primary signal on all platforms (we pass `args: ['--hidden']` everywhere when `startMinimized`).
- `app.getLoginItemSettings().wasOpenedAsHidden` — macOS-only fallback for the legacy `openAsHidden` path (macOS < 13).

If either is true, the window is created but not shown (stays in tray).

### Pure Helpers

Pure logic lives in `packages/desktop/src/autoLaunch.ts` with vitest coverage in `autoLaunch.test.ts`:
- `deriveStartMinimizedFromArgs(args)` — used by both IPC handlers on Windows.
- `parseExecPathFromDesktopFile(content)` — used by the Linux/AppImage path-refresh.
- `shouldReapplyAppImage(currentAppImagePath, recordedExecPath)` — used by the Linux/AppImage path-refresh.

---

## Tray Icon

### Icon Loading (`loadTrayIcon()`)

| Platform | Source | Notes |
|----------|--------|-------|
| macOS | `resources/tray-iconTemplate.png` (+ `@2x`) | Template image: solid black + alpha at 22×22 / 44×44; OS recolours for light/dark/active |
| Windows | `resources/tray-icon.ico` | Multi-size `.ico` (16/20/24/32/40/48); Windows + Electron auto-pick best size for current DPI |
| Linux | `resources/tray-icon.png` | Single 22×22 colored PNG (AppIndicator / StatusNotifier convention); no runtime resize |
| Fallback | Programmatic 16×16 BGRA buffer | Lavender circle (#7c6cf6); should not trigger now that templates ship populated |

All four assets are produced by `scripts/gen-icons.mjs` from `assets/brand/{mark-tray.svg, mark-small.svg}`, see `scripts/gen-icons.README.md` for the full output matrix and regeneration workflow. The template tray icons render from `assets/brand/mark-tray.svg`; the colour tray files render from `mark-small.svg`. Details are in `scripts/gen-icons.README.md`.

### Context Menu

| Item | Action |
|------|--------|
| Show Tavvit | `window.show()` + `focus()` |
| Hide | `window.hide()` |
| Check for Updates… / update action | See Auto-Update |
| Reload | `handleRecoveryAction('reload')`: loads the app address again and shows the window (also leaves recovery) |
| Quit | Set `isQuitting = true`, `app.quit()` |

Tray click toggles window visibility (show/hide).

---

## Deep Linking

Protocol: `tavvit://`

Registered via `app.setAsDefaultProtocolClient('tavvit')` and in `electron-builder.yml` under `protocols`. `orbit://` stays registered too, for links from before the rename.
`packages/web/src/platform/deepLink.ts` parses the same scheme.

### Platform Handling

| Platform | Mechanism |
|----------|-----------|
| macOS | `app.on('open-url')` event |
| Windows/Linux | `second-instance` event (via single-instance lock); deep link extracted from `commandLine` args |
| Cold launch | Deep link arg stored in `pendingDeepLink`, delivered after `ready-to-show` |

### Flow

1. `handleDeepLink(url)` receives an `tavvit://` URL
2. If window exists: sends `deep-link` IPC to renderer, shows + focuses window
3. If app not ready: stores in `pendingDeepLink` for delivery after `ready-to-show`

### Single Instance Lock

`app.requestSingleInstanceLock()` ensures only one instance runs. Second launch:
- Deep link arg is forwarded to the existing instance
- Existing window is restored/shown/focused
- Second instance quits immediately

---

## Auto-Update

Powered by `electron-updater`. Loaded via `require()` (not import) for graceful
degradation when not available.

On a build that can install its own updates (`auto`, which every packaged
Windows build is) nobody has to do anything: an update downloads by itself,
then installs silently and starts the app again at a moment that interrupts
nobody (see Install policy). Restart now in the toast, a click on the update
notification and the tray's update item only make that moment now.

Source files:
- `updateCapability.ts` — measures whether this build can install its own updates
- `updateInstall.ts` — `shouldInstallNow`, the restart-hidden marker, and the
  logger that writes the updater's log file
- `updateStatus.ts` — the `UpdateStatus` union, the `UpdateStatusStore`, and the
  shared "should we interrupt the user" predicate
- `updateDismissal.ts` — per-version dismissal persisted to userData
- `updaterCache.ts` — reclaims the download cache on builds that cannot install
- `packages/web/src/platform/callStateBridge.ts` — reports an open voice session to main
- `packages/web/src/stores/updateStore.ts` — the renderer mirror
- `packages/web/src/components/ui/UpdateToast.tsx` — the prompt

### Update capability, and why it is measured rather than assumed

```
type UpdateCapability = 'auto' | 'manual';
```

`getUpdateCapability()` (memoised, `updateCapability.ts`) decides in this order:

1. `!app.isPackaged` → `manual`. A dev build has no feed and must never offer to install.
2. Not darwin → `auto`. NSIS and AppImage apply unsigned updates without complaint.
3. darwin → run `codesign -d -r- <bundle>` and classify the designated requirement:
   - a bare `cdhash H"…"` → `adhoc` → `manual`
   - anything mentioning `anchor` or `certificate` → `identified` → `auto`
   - unreadable → `unknown` → `manual`
4. Any failure → `manual`.

Every uncertain path resolves to `manual` deliberately. A download link always
works, so guessing "manual" wrongly costs one extra click, while guessing "auto"
wrongly produces a button that silently does nothing.

**Nothing here hardcodes "macOS cannot update".** It measures the property that
actually decides the outcome, so the day CI signs with a Developer ID this
returns `auto` with no code change. See [desktop-security.md](desktop-security.md)
for why the ad-hoc signature makes it impossible today.

### Configuration (`initAutoUpdater()`)

```
autoDownload                = capability === 'auto'
autoInstallOnAppQuit        = capability === 'auto'
disableDifferentialDownload = true
disableWebInstaller         = true
logger                      = createUpdaterLogger(userData)   // {userData}/logs/updater.log
Publish: generic, https://tavvit.com/downloads/desktop (electron-builder.yml)
```

**Every update downloads whole.** The update server answers one byte range per
request, so electron-updater's differential download (the one that reads the
`.blockmap`) could only fail and start over with the whole file.
`disableDifferentialDownload` goes to the whole installer straight away.

**The updater's log.** `createUpdaterLogger` (`updateInstall.ts`) writes every
line electron-updater logs (info, warn, error, debug) with an ISO time and its
level to `{userData}/logs/updater.log`, because nothing reads the console on a
packaged Windows build, so a failed update can be explained afterwards. The
file starts over when a line would take it past 1 MB, and a write that fails
is ignored: logging must never be what breaks an update.

In `manual` mode nothing is downloaded, so no proxy server is created, Squirrel
is never invoked, and the spurious install error never fires. `purgeUpdaterCache`
also runs once at startup to reclaim archives stranded by earlier versions
(measured at 228 MB on a real macOS install, because the archive is stored
twice). The directory to delete is read from the packaged `app-update.yml`'s
`updaterCacheDirName` rather than reconstructed, and must pass
`isSafeUpdaterCacheDirName` (no separators, no traversal, mandatory `-updater`
suffix) before anything is removed.

### The `update-downloaded` trap

`MacUpdater.doDownloadUpdate()` fires `dispatchUpdateDownloaded()` **inside the
`server.listen` callback**, the moment its local proxy server is up, and *before*
Squirrel has been asked to do anything:

```js
this.server.listen(0, "127.0.0.1", () => {
    this.nativeUpdater.setFeedURL({ ... });
    this.dispatchUpdateDownloaded(event);      // fires here
    if (this.autoInstallOnAppQuit) {
        this.nativeUpdater.checkForUpdates();   // Squirrel fails later
    }
});
```

So on macOS `update-downloaded` means "the archive is on disk", **not** "the
update can be installed". Treating it as the latter is what produced a Restart
button that did nothing. `MacUpdater.quitAndInstall()` then takes a branch that
registers a listener for an event that never fires and returns, with no error and
no exception.

### Status model

One value, replaced wholesale by every event, so a stale `ready` can never
outrank a fresh `failed`:

```typescript
type UpdateStatus =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number; bytesPerSecond: number }
  | { phase: 'ready'; version: string }
  | { phase: 'failed'; version: string | null; message: string }
  | { phase: 'up-to-date'; checkedAt: number };

interface UpdateSnapshot {
  capability: UpdateCapability;
  dismissedVersion: string | null;
  status: UpdateStatus;
}
```

`capability` and `dismissedVersion` are ambient facts about the install; `status`
is the event-driven part. They travel together so a dismissed update stays
*visible* in Settings while being *silent* in the toast. Suppressing it in main
would make it unreachable, turning "Later" into "never".

`shouldPromptForUpdate(snapshot)` is the single definition of "interrupt the
user". Both the toast and the native notification call it, so they cannot
disagree about whether the user already said later. It returns false for
`checking`, `downloading` and `up-to-date` (progress, not news), for a dismissed
version, and for a `failed` that never learned a version.

### Dismissal

Persisted to `{userData}/update-state.json` as `{ dismissedVersion }`.

It lives in the **main process, not localStorage**, because an available update
is a property of the installed app, not of whichever instance the user happens to
be connected to. Per-origin storage would re-nag anyone who switches instances
and would lose the dismissal when site data is cleared.

Exactly one version is remembered, compared by equality. Dismissing 1.0.4
silences 1.0.4 and nothing else, so 1.0.5 surfaces normally. A corrupt or
truncated file yields "nothing dismissed" rather than throwing at startup.

Dismissing silences the toast and the notification, nothing else: in `auto`
mode a dismissed update still installs at its moment (the toast's Later says
so on the `ready` card: "It installs by itself the next time Tavvit is in the
tray or you are away."). A `manual` build installs nothing by itself. After a
`failed` install another attempt can still come (the half-hourly check runs
again, and a moment timer already started keeps looking), but it may fail the
same way, so the toast promises nothing. On both cards Later names the place
the update stays instead: "You can install this later from Settings, Desktop".

### Check schedule

| Trigger | Delay |
|---------|-------|
| Initial check | 10 seconds after `initAutoUpdater()` |
| Periodic check | Every 30 minutes, so a new version is picked up within the half hour |
| While an update waits | The two checks above are skipped while a downloaded update waits for its moment (`phase: 'ready'`) |
| Manual check | `check-for-updates` IPC from renderer, and the tray's and recovery page's Check for Updates (recovery `check-update`) |

### Event flow (main -> renderer)

| Event | IPC Channel | Payload | Condition |
|-------|------------|---------|-----------|
| Snapshot changed | `update-status-changed` | `UpdateSnapshot` | Every status or dismissal change |
| Update found | `update-available` | `{ version }` | Always (legacy) |
| Download complete | `update-downloaded` | `{ version }` | Always (legacy) |
| Error | `update-error` | `{ message, releaseUrl }` | Only if `updateConfirmed` (legacy) |

The three legacy per-event channels are **kept even though the current client no
longer reads them**. The desktop app and the instance it connects to version
independently: a newer app can be pointed at an older instance still serving a
client that calls `onUpdateDownloaded`, and removing them would throw inside that
client's `useEffect` and take the renderer down. The reverse case is handled on
the web side, where `updateStore.ts` feature-detects `getUpdateStatus` and falls
back to reconstructing a snapshot from the legacy channels.

`download-progress` is wired and drives the `downloading` phase. Pushes are
throttled to whole-percent changes, so at most 101 IPC messages per download.

Check-phase errors are recorded as `{ phase: 'failed', version: null }`, which
keeps them out of the toast while leaving them visible in Settings. Interrupting
someone because a background poll hit a flaky network is noise.

### Install policy (`updateInstall.ts`)

On `update-downloaded` in `auto` mode, `scheduleAutoInstall` looks for its
moment at once and then every 30 seconds (`INSTALL_CHECK_INTERVAL_MS`), and
installs as soon as `shouldInstallNow` agrees:

| Moment | Installs |
|---|---|
| A voice session is open (`callActive`) | never, however long it lasts |
| The window is hidden in the tray, minimised, or gone | at once |
| The window is shown | once nobody has used the keyboard or mouse anywhere on the computer for 5 minutes (`powerMonitor.getSystemIdleTime()` against `IDLE_BEFORE_INSTALL_SECONDS`) |

**Only the renderer knows about calls.** `initCallStateBridge`
(`packages/web/src/platform/callStateBridge.ts`, started once from `AppLayout`)
sends `set-call-active` with `hasVoiceSession(voiceStore)` when it starts and
again whenever the answer changes: true while a voice channel is connected,
connecting or reconnecting, while a DM call is being placed or is ringing in,
and while a DM call is active without a connection error. Main keeps the last
value it was sent (`callActive`, false until told). A shell whose preload has
no `setCallActive`, or a browser, is left alone by the bridge, and a web client
that predates the bridge never reports a call, so it holds no install back.

**Installing is one call, made the same silent way everywhere.**
`installUpdateNow` stops the moment timer, writes the restart-hidden marker
when the window is hidden or gone (below), and calls
`autoUpdater.quitAndInstall(true, true)`: `isSilent` runs the NSIS installer
with `/S`, so no installer window appears, and `isForceRunAfter` adds
`--force-run`, so the app starts again when it is done. The moment timer, the
toast's Restart now (`install-update`) and the native notification's click go
through `installUpdateNow`. The recovery page's Restart to Install and the
tray's and macOS app menu's update item (`handleRecoveryAction('install-update')`
in `recovery.ts`) call `quitAndInstall(true, true)` directly, without the
marker. `autoInstallOnAppQuit` still installs a downloaded update when the app
quits normally.

**Starting hidden after an update.** `markRestartHidden` writes
`{userData}/restart-hidden.json` (`{ at }`) when the install starts while the
window is not visible, so the restarted app goes back to the tray instead of
opening in front of someone who had put it away. On the next start
`consumeRestartHidden` reads and deletes the marker before the window is
created; when it is at most 10 minutes old the window stays hidden on
`ready-to-show`, as for a `--hidden` login launch. A marker that cannot be
read, is older, or lies in the future is ignored, so an install that never
restarted cannot hide a later launch.

### Install

`install-update` IPC:

- `manual` → opens the download page because there is no in-place install.
- `external` → does nothing because the package manager owns the entire update
  lifecycle and no in-app action is presented for this capability.
- otherwise → `installUpdateNow(autoUpdater)` (the silent
  `quitAndInstall(true, true)` above), then a **4-second watchdog**. If the
  app is still alive and still `ready` after it, the status flips to `failed`.
  A successful install takes the app down before the timer fires. This is defence
  in depth against the silent no-op recurring on a platform we did not anticipate.

### Notification

Fires on `update-available` in manual mode and `update-downloaded` in auto mode,
suppressed when the window is focused (the in-app toast covers that) and when
`shouldPromptForUpdate` says no.

| Capability | Title | Body | Click |
|---|---|---|---|
| `auto` | Tavvit update ready | Click to restart and install version X. | `installUpdateNow()` |
| `manual` | Tavvit X is available | Click to open the download page. | `shell.openExternal(RELEASES_URL)` |
| `external` | — | No in-app notification; the package manager notifies the user. | — |

Win32 only: `app.setAppUserModelId('de.hashhive.orbit')` is set early in
startup so notifications attribute to "Tavvit" in Windows Action Center.

### Recovery integration

All `autoUpdater` events update the `RecoveryStateStore`. `UpdateState` gained
**`available-manual`**: an update exists but this build cannot install it. The
recovery surface then offers a versioned "Download Backspace X" button
(`open-releases` action) instead of "Restart to Install Update", and the tray and
macOS app menus do the same via `updateActionItem`. Without this the recovery
screen, which is the escape hatch for a user whose app will not start, would
present the one button guaranteed not to help them.

`extractErrorCode(err)` in `recovery.ts` extracts the `code` field from
`electron-updater` errors when present (string only); used to populate
`RecoveryState.lastUpdateError.code`.

### Desktop tab in the browser

The Desktop tab is no longer Electron-only. In a browser it renders
`DesktopDownloadPanel` instead of the settings panel: a line on what the desktop
app adds, one primary download for the platform the visitor is on, every other
build of the same release below it, and a link to the releases listing last.

The links are built from the instance version reported by `GET
/api/instance/info`, so a visitor is offered the desktop build that matches the
server they are signed in to. A version that is not a plain `major.minor.patch`
points every link at the releases listing instead, because there is no tag to
download from. The server reads its version verbatim from
`packages/server/package.json`, so a development checkout reports a plain triple
like any other instance and gets real asset links; the case that actually
reaches the fallback is the panel having no version yet, while the instance info
request is in flight or after it failed.

The hazard the fallback does not cover is the window between a version bump
landing and its tag being published. The links then name assets that do not
exist and GitHub answers 404. The "All releases" link at the bottom of the panel
is the recovery, and it is present whatever the version says.

Platform detection reads the user agent client hints first and the user agent
string second (`packages/web/src/platform/desktopDownload.ts`). A client hint
platform the module does not recognise, `Unknown` included, decides nothing and
leaves the answer to the user agent string. Every build is architecture
specific, so when the browser will not report one the panel falls back to the
platform default (x64 on Windows and Linux, Apple Silicon on macOS) and says
so; the tile's picker offers the other one.

Windows is the one platform where the user agent string is not consulted for
the architecture: every browser on Windows on ARM freezes it at `Win64; x64`,
so the token proves nothing there. Only a client hint counts, and anything
else is x64 marked as a guess. The x64 default is load-bearing rather than
merely likely. The x64 installer runs under emulation on Windows on ARM, while
the arm64 installer on an x64 machine has no package to extract, so a wrong
guess has to land on x64.

The secondary list leads with the rest of the detected platform's own builds
(the other installer on Windows; the other-architecture disk image on macOS;
the matching deb, then the other architecture's AppImage and deb, on Linux),
then runs windows, linux, mac over what is left, each platform with the
detected architecture first. A visitor on an unsupported platform gets no
primary offer and the plain windows, linux, mac order. That order is the one
used everywhere a visitor sees a download list: this tab, the README table,
and the Downloads table in every release's notes.

The same wiring is mirrored in the mobile settings hub
(`packages/web/src/components/layout/MobileSettingsScreen.tsx`), which is where
a phone reaches settings: the desktop settings modal is never mounted on a
mobile viewport. See `docs/systems/mobile-ui.md`.

### Release publishing

Flatpak is represented by the standard update-capability abstraction: when the
runtime exposes `FLATPAK_ID`, `getUpdateCapability()` returns `external`.
Updater initialization, checks, prompts, install actions, recovery controls,
and update settings all consume that capability. Flatpak owns application
updates because `/app` is immutable; the manifest also removes `app-update.yml`.
The manifest checks out a pinned source commit, installs dependencies from a
generated offline pnpm store, compiles TypeScript, and has electron-builder
produce an unpacked Linux application inside the SDK. It then installs that
output on the Electron BaseApp and uses `zypak-wrapper` for Chromium sandbox
integration.

The published manifest remains pinned to a released commit. Pull-request CI
generates `flatpak/node-sources.ci.json` from the checked-out `pnpm-lock.yaml`
on each architecture, then uses `flatpak/prepare-ci-manifest.mjs` to generate
an ignored manifest that swaps both the pinned application source for `type:
dir` and the committed offline source list for that generated one, so both
x86_64 and aarch64 jobs compile the actual checkout against its own
dependencies, and a contributor changing dependencies needs no Flatpak
installation on any platform. How the committed `flatpak/node-sources.json`
relates to the pinned release, and the pull-request check that enforces it, is
in `flatpak/README.md` under "Release-paired offline sources".

**Flatpak release metadata.** Publishing a GitHub release starts
`.github/workflows/flatpak-release-metadata.yml` (`release: released`, which
fires for a full release and for a prerelease promoted to one, never for a
prerelease). A tag outside `vX.Y.Z`, a prerelease, or a release that has
already landed makes the run a successful no-op that logs why. A release has
landed when main's manifest pins the Backspace source to the tag's commit
(read with `flatpak/manifest-pin.mjs`), which only its merged metadata pull
request does. An AppStream entry for the version on main does not count as
landed: see step 2. Otherwise, checked out at the tag, it:

1. Reads the release notes and takes the paragraph under the
   `# Backspace X.Y.Z` title as the AppStream release description, which is
   the "What's New" text in GNOME Software, KDE Discover and Flathub
   (`flatpak/release-summary.mjs`: wrapped lines are joined, links and images
   become their text, emphasis and code markers are dropped, backslash escapes
   become the literal character). Notes that do not open with that title
   followed by a prose paragraph (a heading, table, list, quote, code block or
   HTML in its place, or nothing) fail the job with the reason, so a
   placeholder never ships. Fix the notes on the release page and dispatch a
   new run.
2. Runs `flatpak/update-release.mjs`, which updates the source pin, the
   screenshot tag and the AppStream entry. The script reads the metainfo as it
   is at the tag. To write the entry by hand instead of taking the notes'
   paragraph, commit it to main before cutting the tag: the script then keeps
   it and never replaces it, while the pin, the screenshot tag and
   `node-sources.json` still move and the pull request still opens. The notes
   still need their summary paragraph, because step 1 runs either way. An entry
   written by hand on the metadata pull request's branch is not kept: a re-run
   while that pull request is open force-pushes a fresh branch from the tag
   over it.
3. Regenerates `node-sources.json`, lints the manifest and AppStream file,
   uploads those exact files, and builds their published manifest natively on
   x86_64 and aarch64. The metadata pull request also runs `flatpak.yml`, but
   that builds the working tree; this is the only build of the manifest as it
   will be published.
4. Only after both builds pass, pushes `automation/flatpak-<tag>` and opens (or
   reuses) the metadata pull request as the release bot GitHub App. The app's
   token, unlike `GITHUB_TOKEN`, starts CI on the pull request. The job updates
   the branch when main has moved past the tag, because the ruleset requires
   it to be up to date, and turns on squash auto-merge, so the pull request
   merges itself once `Build & test` passes.

To re-run a release, dispatch the workflow with its tag (`workflow_dispatch`,
input `tag`); a malformed tag fails the dispatch. A re-run replaces the open
pull request's branch, as described in step 2. A tag cut before this workflow
existed cannot be re-run, and a release that has already landed opens nothing.
Use a fresh dispatch rather than "Re-run failed jobs" on
the pull request job after the first day: the builds hand their files to that
job as an artifact kept for one day, so a re-run after that fails to find it.

When the pull request job goes red at the update-branch step, click "Update
branch" on the pull request. Auto-merge is already on and finishes once CI
passes on the updated branch.

The app and its two secrets are described in
[security-scanning.md](security-scanning.md#done).

`create-release` writes the `# Backspace X.Y.Z` heading at the top of the
draft, above the Downloads table. The one human step for Flatpak is to write
the summary paragraph directly under that heading before publishing. Flathub
shows that paragraph, so write it as the store-facing summary of the release.

CI publishes via `.github/workflows/release.yml` (tag `v*` on the public repo).
A `create-release` job runs first and creates the draft for the tag, then four
native build jobs fan out (mac arm64+x64, win x64+arm64, linux x64, linux
arm64), each uploading its installers, `.blockmap`s, and platform `latest*.yml`
manifest into that one draft. The draft must be published manually, because
drafts are invisible to electron-updater. Publishing it also starts the Flatpak
metadata workflow above.

A release carries 16 assets, named
`Backspace-<version>-<os>-<arch>.<ext>` (`artifactName` in
`electron-builder.yml`, `${os}` being `win`, `mac` or `linux`):

| Asset | Reader |
|-------|--------|
| `-win-x64.exe`, `-win-arm64.exe` (+ `.blockmap`) | Windows users; electron-updater picks by `process.arch` |
| `-linux-x86_64.AppImage`, `-linux-arm64.AppImage` | Linux users; AppImage auto-update, one feed file per architecture |
| `-linux-amd64.deb`, `-linux-arm64.deb` | Linux users |
| `-mac-arm64.dmg`, `-mac-x64.dmg` (+ `.blockmap`) | Mac users; the blockmaps are unused while mac updates are `manual` |
| `latest.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`, `latest-mac.yml` | electron-updater; a `manual` mac still reads `latest-mac.yml` to raise its notice |

The architecture spelling follows electron-builder's per-format convention
(`x86_64` for an AppImage, `amd64` for a deb, `x64` elsewhere). There is no
combined Windows installer (`nsis.buildUniversalInstaller: false`) and no mac
zip: the zip only serves Squirrel.Mac auto-update, which ad-hoc signed builds
cannot use.

GitHub sorts the asset list by name and offers no other order, which puts
Linux first and Windows last. So `create-release` writes a Downloads table
into the draft body, in Windows, Linux, macOS order with plain labels, from
the names electron-builder will produce; the "What's new" notes are written
by hand above it before publishing. The web client's Desktop tab
(`packages/web/src/platform/desktopDownload.ts`) and the README table spell
the same names out and have to move with `artifactName`.

The `create-release` job exists because electron-builder creates the release
itself when it cannot find one for the tag, and four jobs doing that lookup
concurrently can all miss. On v1.0.3 two of them created a draft and the assets
split across the pair, which needed manual consolidation before the release
could be published. Creating the draft once, ahead of the matrix, leaves the
build jobs with nothing to create.


## Recovery Mode

When the renderer fails to load or boot, the main process surfaces a native recovery UI (`resources/recovery.html`) loaded into the existing main window. Recovery is the escape hatch for failure modes that the in-app `ErrorBoundary` cannot catch — pre-render module-init throws, JS bundle/Electron incompatibility, network failures, renderer process crashes, and unrecoverable hangs.

Source files:
- `packages/desktop/src/recovery.ts` — state store, event handlers, action funnel, menu builders
- `packages/desktop/src/appUrl.ts` — the address the window opens (`resolveAppUrl`, used by main.ts and recovery.ts)
- `packages/desktop/resources/recovery.html` — UI page, vanilla HTML/CSS/JS

### State Model

`RecoveryStateStore` (singleton in `recovery.ts`) owns:

```typescript
interface RecoveryState {
  mode: 'normal' | 'recovery';
  reason: { code: 'load-failed' | 'render-gone' | 'unresponsive' | 'renderer-stalled'; detail: string } | null;
  // 'available-manual': an update exists but this build cannot install it in
  // place, so the surface offers a download rather than a dead Restart button.
  updateState: 'idle' | 'checking' | 'downloading' | 'available-manual' | 'downloaded' | 'error';
  updateVersion: string | null;
  lastUpdateError: { message: string; code: string | null; at: number } | null;
  lastCheckResult: 'up-to-date' | 'failed' | null;  // transient, 5s decay
}
```

Two flags not in the public state: `inRecoveryMode` (private to the store, guards `loadFile(recovery.html)` re-entry / loop prevention) and `updateConfirmed` (local to `main.ts:initAutoUpdater`, controls whether updater errors get pushed to the renderer).

### Detection Paths

| Mechanism | Catches | Notes |
|-----------|---------|-------|
| `did-fail-load` | Network/HTTP transport failures (DNS, refused, TLS, transport-level) | Filtered by `isMainFrame`; ignores `errorCode === -3` (ERR_ABORTED). 5xx with body does NOT fire — falls through to boot timer. |
| `render-process-gone` | Renderer process termination | Filtered by reason; `clean-exit` ignored. Triggers on `crashed`, `killed`, `oom`, `launch-failed`, `integrity-failure`. |
| `unresponsive` | Main thread blocked >10s | 10s grace period; cancelled by `responsive` event. Matches Chrome's "page not responding" pattern. |
| Boot-completion ping | JS exceptions during boot, module-init throws, broken preload calls — failures the other events don't catch | `window.backspace.rendererReady()` from web side; main-side timer (20s, packaged builds only, http(s):// URLs only) |

The boot ping is **not a heartbeat** — it is a one-shot per-navigation signal. Web-side call sites:

- `packages/web/src/App.tsx` — `useEffect` with `[]` deps, fires on first commit (semantic: "renderer survived render," not "data loaded")
- `packages/web/src/appBoot.tsx` — `ErrorBoundary.componentDidCatch`, fires when in-app error UI mounts (so the boot timer doesn't override the ErrorBoundary fallback 20s later)

Main-side gating uses a per-navigation `pingReceivedThisNav` flag (reset on `did-navigate`, set in `handleRendererReady`). If the ping arrives BEFORE the timer is armed — the typical SPA case, because `useEffect` runs in a microtask after bundle execution + React render, which is before `window.onload` that `did-finish-load` waits on — `armBootTimer` checks the flag and short-circuits. If the ping arrives AFTER the timer is armed (less-common ordering), it clears the existing timer via `clearBootTimer`. Either path means a healthy renderer never trips false recovery. The `bootArmed` flag retains its role: it ensures a `clearBootTimer` call inside the timeout callback is a no-op if the timer was already disarmed by the ping.

Navigation-aware arming: `did-navigate` (top-level non-same-document) clears any pending timer, resets `pingReceivedThisNav`, and queues a fresh arm for `did-finish-load`. `did-navigate-in-page` (SPA routing) is ignored, so React Router channel switches don't trip the timer.

### Recovery UI

`recovery.html` is loaded into the existing `mainWindow` via `loadFile()`. It has a 32px titlebar with `-webkit-app-region: drag` and a content container with `no-drag`.

Page reads initial state via `getRecoveryState()` IPC and subscribes to `recovery-state-changed` events for live updates. All button clicks dispatch through a single `recovery-action` IPC channel with strict allowlist validation in main.

| Button | Visible | Enabled |
|--------|---------|---------|
| Reload | always | always |
| Restart to Install Update | `updateState === 'downloaded'` | always when visible |
| Check for Updates | always | not in `'checking'` / `'downloading'` / `'downloaded'` / `'available-manual'` |
| Open Download Page | `updateState === 'error'` or `'available-manual'` | always when visible |
| Quit Tavvit | always | always |

In `'available-manual'` the Open Download Page button relabels to "Download Tavvit
X". Restart to Install is never shown in that state, because the build cannot
install in place. There is no server switcher: Reload is the way back to the app.

Hint text is computed as a function of `(reason.code, updateState)` — see code in `recovery.html`. The `renderer-stalled` text intentionally avoids claiming an update is the cause (slow Pi/cold cache could also trigger it).

`lastCheckResult` provides transient inline feedback ("You're up to date" / "Update check failed") with 5s auto-decay. Without this, the user has no signal that a Check for Updates click ran when the result is no-update.

Cmd/Ctrl+R is wired as a keyboard shortcut for Reload.

### Observability Logging

`recovery.ts` emits structured `console.log` lines on entry and exit so smoke-test scripts can grep stderr without UI introspection:

| Event | Log line |
|-------|----------|
| Recovery entered | `[recovery] entered: <code> — <detail>` |
| Exited via Reload | `[recovery] exited (reload)` |

The enter log fires after the state update but before the re-entry guard, so repeated entry (reason update with no re-navigation) also logs — useful for diagnostics.

### Loop Prevention / Contained Failure

If `recovery.html` itself fails to load (corrupt resources, packaging bug), `did-fail-load` re-fires inside the recovery context. The `isInRecoveryMode` guard prevents infinite reload loops — `state.reason` updates for display purposes but no second `loadFile()` is issued. User-visible outcome is a blank window with tray-only escape (Quit). This is **contained failure**, not graceful failure: a corrupt `recovery.html` means a corrupt build that requires a fresh install.

### Hidden-Launch Override

When the app is launched with `--hidden` (autostart), `enterRecoveryMode()` always force-shows + focuses the main window. Without this, a silent boot failure during autostart would never surface to the user.

### Force-Kill Fix

The recovery surface's "Restart to Install Update" button calls `autoUpdater.quitAndInstall(true, true)` and the native notification's click handler `installUpdateNow()`, which makes the same call: both install **directly**, silently, and start the app again (see Install policy). They do not rely on `autoInstallOnAppQuit`'s on-quit hook.

Why this matters: a user who Task-Manager-kills a broken app never triggers the on-quit hook; the downloaded update sits on disk. On next launch, the app loads the same broken old version. With recovery active, the user lands in recovery → clicks Restart → install applies cleanly via the direct call. The on-quit hook bypass is no longer fatal.

### Inter-Module Wiring

`recovery.ts` cannot import from `main.ts` (would create a cycle). Wiring is contract-based:

| Concern | Mechanism |
|---------|-----------|
| The app's address | Both files import `resolveAppUrl` and `DEV_URL_ENV` from `appUrl.ts` |
| `mainWindow` reference | `recovery.ts` holds its own ref via `setMainWindow(win)` setter; `main.ts` calls on `createWindow()` and `closed` |
| `autoUpdater` reference | `setAutoUpdater(au)` setter on `recovery.ts`; main calls inside `initAutoUpdater()` success path |
| Quit invariant | `main.ts` exports `requestQuit()` (sets `isQuitting + app.quit()`); recovery uses callback registered via `setOnQuitRequested(cb)` |
| Tray + macOS menu | `recovery.ts` exports pure `buildTrayMenuTemplate` / `buildAppMenuTemplate`; subscriber in `main.ts` calls them and applies via `Menu.buildFromTemplate` |
| Boot-stall callback | `setOnBootStall(cb)` on `recovery.ts`; `main.ts` does not need to wire this (recovery.ts wires it to its own `enterRecoveryMode` at module load) |

### Manual Smoke Checklist

Executed before each release. See `docs/superpowers/specs/2026-05-03-electron-recovery-mode-design.md` §9 for the 14-scenario checklist (plus scenario 15 added during implementation).

---

## Notifications

`main.ts:showNotification(title, body, onClick?)` — uses Electron's `Notification` API.

- Checks `Notification.isSupported()` before showing
- `silent: false` (plays system sound)
- Click handler: defaults to show + focus the main window; an optional `onClick` parameter overrides this (used by the update-ready notification to call `installUpdateNow()`, the silent install, directly)
- **Kept referenced until done** (`notificationRetention.ts`, `NotificationRetainer`): each `Notification` is held in a module-level set from just before `show()` until its first `click`, `close` or `failed`. Without the reference the object can be garbage-collected while the toast is still on screen, and on Windows its click handler then never runs, so clicking a chat toast did nothing (#394). Windows does not promise a `close` (a toast that times out into the Action Center may never send one), so the set is capped at 100: past it the oldest is released. A `failed` event is logged (`[notifications]`).

Chat notifications carry optional `{ channelId, spaceId, userId }` context through
`showNotification(title, body, options?)`. Clicking restores a minimized window,
shows it, and sends `notification-click` back to the originating renderer only
while its home origin still matches. `onNotificationClick` returns an unsubscribe
function; the web client feature-detects it for compatibility with older shells.
`NotificationController` validates the signed-in home user and current channel
membership before navigating to `/channels/<spaceId or @me>/<channelId>`.
The space comes from `channelToSpaceMap`, including remote spaces; existing
channel-origin routing selects the API instance. Browser notifications use the
same navigation handler and close on click. Mobile navigation also brings the
chat screen to the top when the URL already points at that chat.

Do Not Disturb and the badge: see sounds.md ("Do Not Disturb").

Badge count: `set-badge-count` IPC calls `app.setBadgeCount()` (macOS dock badge, Windows taskbar overlay).

**Win32 attribution:** `app.setAppUserModelId('de.hashhive.orbit')` set early in startup so notifications attribute to "Tavvit" in Windows Action Center.

---

## Application Menu

### macOS

Full menu bar with:
- App menu: About, update items, Reload, Hide/Unhide, Quit
- Edit: Undo, Redo, Cut, Copy, Paste, Select All
- Window: Minimize, Zoom, Front

### Windows/Linux

Hidden menu bar (frameless window), but an Edit menu is still registered so keyboard accelerators (Ctrl+C/V/X/Z/A) work.

---

## Screen Share Integration

The main process intercepts `getDisplayMedia()` via `session.defaultSession.setDisplayMediaRequestHandler()`. Two IPC flows answer it; the renderer's `ScreenShareSetup` (see `voice.md`, "Start flow") decides which by feature-detecting the preload API.

### Preselected flow (current web client)

1. Setup screen opens → renderer calls `getScreenSources()` (`ipcMain.handle('get-screen-sources')`) → main enumerates via `desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })`, caches the result in `lastScreenSources`, returns the serialized list (id, name, thumbnail data URL, app icon data URL, isScreen flag). Enumeration is gated — see "Who may enumerate" below
2. User clicks a tile → renderer sends `screen-share-preselect` with `sourceId` + `shareAudio` → main stores `pendingScreenSelection` (30 s TTL)
3. Renderer calls `getDisplayMedia()` → handler takes the pending selection (one-shot), resolves the id against the cache (re-enumerating if missing) and calls `callback({ video: source, audio: 'loopback' })` (audio only when `shareAudio`). No prompt round-trip.
4. The stream is previewed in the setup screen and published on "Start stream".
5. Turning System Audio on during a share that has no audio runs steps 2 and 3 again for the same `sourceId` with `shareAudio = true`; the renderer keeps only the new capture's loopback audio track and stops its video (`syncScreenShareAudio`, voice.md "Changing the toggle mid-stream"). The handler re-enumerates to resolve the id, since the caches were dropped after the first request. No main-process or preload change was needed for this.

### Who may enumerate

`get-screen-sources` hands the renderer a thumbnail of every open window, and the renderer runs the instance's web client — remote code. Before the setup screen existed, that pixel data only ever arrived as the *result* of a `getDisplayMedia()` call, which Chromium gates behind transient activation; an IPC handler has no such gate, so the decision is spelled out in `screenSharePolicy.ts` (`screenEnumerationDecision`) and applied in `main.ts`:

| Condition | Answer |
|-----------|--------|
| Sender is not `mainWindow.webContents` | `[]` |
| The app window is not focused | the last serialized list (no fresh capture) |
| Less than `SCREEN_SOURCES_CACHE_MS` (1 s) since the last enumeration | the last serialized list |
| Otherwise | a fresh `desktopCapturer` scan, cached with its timestamp |

The setup screen enumerates once per open, so no legitimate flow meets the cache window. Both caches (`lastScreenSources`, the NativeImage list used to resolve a preselected id, and `lastServedScreenSources`, the serialized one) are dropped in the display-media handler's `finally`, so thumbnails are not pinned for the life of the process. `get-screen-share-picker-mode` carries the same sender guard and answers `'app'` to anything else.

None of this substitutes for trusting the instance you connect to; it bounds what a hostile or compromised web client can collect silently. See `desktop-security.md`.

### System-picker flow (Wayland)

`get-screen-share-picker-mode` returns `'system'` on Linux when `XDG_SESSION_TYPE=wayland` (or `WAYLAND_DISPLAY` is set and the session is not X11), `'app'` everywhere else (`screenSharePickerMode()` in `screenSharePolicy.ts`, unit-tested there alongside the preselection TTL and the enumeration gate). This reads the session type, which is a guess: under XWayland the capture stack behaves like X11 while the session still reports `wayland`. A wrong guess costs one extra click — the click falls through to the prompted flow, which both sides already support. Under Wayland, `desktopCapturer.getSources()` itself opens the compositor's screencast portal and returns only what the user chose there, so:

1. The renderer never enumerates up front (that would prompt on every open); it shows a "Choose" card and sends `screen-share-audio-preference` with the loopback choice
2. The card's click calls `getDisplayMedia()` → handler enumerates → portal dialog → one source back
3. Handler sees `'system'` mode and exactly one source and calls `callback({ video: source, audio: 'loopback'? })` directly, no `screen-share-sources` round trip
4. Zero sources means the portal was cancelled → request denied → renderer shows "No screen was chosen"

There is no persistent grant: the portal asks per share by design, and one screen or window per share is inherent. The AppImage packaging is unrelated.

### Prompted flow (older web clients, or nothing preselected)

1. Handler invoked with no pending selection → main enumerates sources and sends them via `screen-share-sources` IPC
2. Renderer shows the grid, user selects a source
3. Renderer sends `screen-share-selected` with `sourceId` (or `null` to cancel) and `shareAudio`
4. Main calls `callback({ video: selectedSource, audio: 'loopback' })`

### System audio and Backspace's own playback

Whether a System Audio share also carries Backspace's own playback (the voice chat, so viewers hear themselves) is decided by the OS build, and only main can read it. `systemAudioCapability.ts` answers from `process.platform` and `process.getSystemVersion()`; the rule and its Chromium sources are stated once in `voice.md` ("System Audio Loopback"). The renderer asks through `getSystemAudioCapability()` (IPC `get-system-audio-capability`) and words the note under the System Audio switch from the answer. The method is optional: a renderer on an older desktop build gets no answer and keeps the generic per-platform note, so no existing `window.backspace` method changed.

The prompted flow stays because the desktop app loads whatever web client its instance serves: an older instance still calls `getDisplayMedia()` first, and a newer instance on an older desktop build lacks `getScreenSources` and falls back to this path (`preselectScreenSource` / `getScreenSources` are optional in `electron.d.ts` for that reason).

On Linux with PipeWire the main process builds the system-audio capture itself so that Backspace is not in it (`systemAudio.ts`, `startSystemAudio()` / `stopSystemAudio()`; mechanism in `voice.md`, "Linux system-audio source"). `get-system-audio-capability` returns `excluded` while that source is available, but only to a web client that passes `true` (`getSystemAudioCapability(true)`, sent by a client that has the `startSystemAudio` / `stopSystemAudio` bridge and opens the source itself). A web client from before the source passes nothing, keeps Chromium's loopback, and gets the OS answer (`included` on Linux); main does not load the module for it. A new web client on a desktop build without the argument gets the OS answer as well, which is right because that build has no source. `@vencord/venmic` is an `optionalDependency` of this package (Linux only; its prebuilt `.node` files are covered by `asarUnpack: **/*.node`; its build tool `cmake-js` is removed by a `pnpm.overrides` entry, see `security-scanning.md`).

No sources (0 results) typically means Screen Recording permission not granted on macOS.

For full screen share configuration (resolution, bitrate, codec), see `voice.md`.

---

## Cache Clearing

On every app launch (`app.whenReady`), the main process purges stale caches:

```typescript
await session.defaultSession.clearStorageData({ storages: ['serviceworkers'] });
await session.defaultSession.clearCache();
```

This ensures the renderer always loads fresh code after updates.

---

## GTK Version Override

On Linux, Electron 36+ defaults to GTK 4 on GNOME, which crashes if GTK 2/3 libraries are loaded in the same process (common with uiohook-napi). The app forces GTK 3:

```typescript
app.commandLine.appendSwitch('gtk-version', '3');
```

---

## IPC Handler Registry

All handlers registered in `main.ts:registerIpcHandlers()`.

### Fire-and-Forget (`ipcMain.on`)

| Channel | Direction | Payload | Action |
|---------|-----------|---------|--------|
| `show-notification` | R->M | `{ title, body, options?: { channelId?, spaceId?, userId? } }` | Show native notification with optional chat target |
| `notification-click` | M->R | `{ channelId?, spaceId?, userId? }` | Open the notification's chat in the originating session |
| `set-badge-count` | R->M | `number` | Set dock/taskbar badge |
| `minimize-window` | R->M | — | Minimize window |
| `maximize-window` | R->M | — | Toggle maximize/unmaximize |
| `close-window` | R->M | — | Close (hides to tray) |
| `edit-context-menu` | M->R | `{ misspelledWord, suggestions (≤ 5), canCut, canCopy, canPaste, canSelectAll }` | Sent from the window's `context-menu` event for a right click in a text field only (`editMenu.ts`); the page draws the menu, main draws none. The page cancels every other right click, so main never hears of it |
| `edit-command` | R->M | `'cut' \| 'copy' \| 'paste' \| 'selectAll'` | Runs that `webContents` method in the field the page refocused; anything else is ignored |
| `replace-misspelling` | R->M | `string` | `webContents.replaceMisspelling(word)` for a chosen suggestion (one line, ≤ 100 characters) |
| `add-to-dictionary` | R->M | `string` | `session.addWordToSpellCheckerDictionary(word)`, same checks |
| `install-update` | R->M | — | `installUpdateNow()` (silent `quitAndInstall(true, true)`, the app starts again) on auto-capable builds, otherwise opens the download page. 4s watchdog flips the status to `failed` if the app is still running |
| `set-call-active` | R->M | `boolean` | Whether a voice session is open (`callActive`); a downloaded update never installs while it is true. Anything but `true` reads as false |
| `check-for-updates` | R->M | — | `autoUpdater.checkForUpdates()` |
| `dismiss-update` | R->M | `{ version }` | Persists the dismissal and re-pushes the snapshot |
| `open-release-page` | R->M | — | `shell.openExternal(RELEASES_URL)` |
| `screen-share-selected` | R->M | `sourceId, shareAudio?` | Safety net (actual handler is `ipcMain.once` in display media flow) |
| `keybinds-sync` | R->M | `KeybindConfig[]` | `keybindManager.updateKeybinds()` |
| `set-connected-origins` | R->M | `string[]` | Update `knownInstanceOrigins` set (used by in-instance `/join/` interception) |
| `renderer-ready` | R->M | — | Boot-completion ping; disarms boot timer |
| `recovery-action` | R->M | `RecoveryAction` enum | Recovery page button dispatcher (allowlist-validated) |

### Request/Response (`ipcMain.handle`)

| Channel | Direction | Returns | Action |
|---------|-----------|---------|--------|
| `get-app-version` | R->M | `string` | `app.getVersion()` |
| `get-auto-launch-settings` | R->M | `{ openAtLogin, startMinimized }` | Merge OS state with saved prefs |
| `set-auto-launch-settings` | R->M | `{ openAtLogin, startMinimized }` | Save + apply to OS |
| `get-current-activity` | R->M | `Activity \| null` | Current detected game activity |
| `check-accessibility` | R->M | `boolean` | macOS accessibility permission check |
| `get-recovery-state` | R->M | `RecoveryState` | Recovery page reads initial state on mount |
| `get-update-status` | R->M | `UpdateSnapshot` | Renderer reads the current snapshot on mount |
| `is-sandboxed` | R->M | `boolean` | Detect package sandbox restrictions independently of update capability |
| `get-system-audio-capability` | R->M | `'excluded' \| 'included' \| 'unavailable' \| 'unknown'` | Whether a System Audio share on this OS build carries Backspace's own playback: `ownAudioInSystemAudio(process.platform, process.getSystemVersion())` (`systemAudioCapability.ts`), or `excluded` when the argument is exactly `true` and the Linux system-audio source is available (`withSystemAudioSource()` in `systemAudio.ts`). Same sender guard as the screen-share handlers; anything else gets `'unknown'` |

### Main -> Renderer Events

| Channel | Payload | Trigger |
|---------|---------|---------|
| `window-focus-changed` | `boolean` | Window focus/blur |
| `deep-link` | `string` (URL) | `backspace://` protocol activation |
| `update-available` | `{ version }` | electron-updater |
| `update-downloaded` | `{ version }` | electron-updater |
| `update-error` | `{ message, releaseUrl }` | electron-updater (only after confirmed update) |
| `screen-share-sources` | `ElectronScreenSource[]` | Display media handler |
| `activity-detected` | `Activity \| null` | Activity detector poll |
| `keybind-action` | `{ actionId, pressed }` | KeybindManager match |
| `accessibility-status` | `{ trusted }` | macOS accessibility check result |
| `keybind-hook-error` | `{ message }` | uIOhook start failure |
| `open-internal-route` | `string` (path) | In-instance `/join/` interception: renderer navigates to `path` instead of opening externally |
| `recovery-state-changed` | `RecoveryState` | Store subscriber, mode-gated to `mode === 'recovery'` |
| `update-status-changed` | `UpdateSnapshot` | Every status or dismissal change |

---

## Preload Bridge (`window.backspace`)

The preload script exposes the `window.backspace` API via `contextBridge.exposeInMainWorld`. TypeScript declarations are in `packages/web/src/platform/electron.d.ts`.

Detection: `typeof window.backspace !== 'undefined'` (see `platform.ts:isElectron()`).

### API Surface

| Method / Property | Type | Direction | Notes |
|-------------------|------|-----------|-------|
| `platform` | `NodeJS.Platform` | read | `process.platform` value |
| `minimize()` | fire | R->M | |
| `maximize()` | fire | R->M | Toggles maximize |
| `close()` | fire | R->M | Hides to tray |
| `showNotification(title, body)` | fire | R->M | |
| `setBadgeCount(count)` | fire | R->M | |
| `onUpdateAvailable(cb)` | listen | M->R | |
| `onUpdateDownloaded(cb)` | listen | M->R | |
| `onUpdateError(cb)` | listen | M->R | |
| `installUpdate()` | fire | R->M | |
| `checkForUpdates()` | fire | R->M | |
| `getVersion()` | invoke | R->M | Returns `Promise<string>` |
| `onWindowFocusChange(cb)` | listen | M->R | |
| `onDeepLink(cb)` | listen | M->R | |
| `onScreenShareSources(cb)` | listen | M->R | |
| `selectScreenSource(id, audio?)` | fire | R->M | |
| `getSystemAudioCapability(usesAppSource?)` | invoke | R->M | Optional (older builds lack it, and builds before the Linux source ignore the argument). `usesAppSource` is `true` from a web client that opens the Linux system-audio source itself. Returns `Promise<'excluded' \| 'included' \| 'unavailable' \| 'unknown'>`; see "System audio and Backspace's own playback" |
| `startSystemAudio()` | invoke | R->M | Optional. Linux: routes every other app's playback into a virtual source. Returns `Promise<{ ok: true, label } \| { ok: false, reason }>`; the renderer opens the device named `label` as a microphone |
| `stopSystemAudio()` | invoke | R->M | Optional. Unlinks the virtual source; idempotent |
| `getAutoLaunchSettings()` | invoke | R->M | |
| `setAutoLaunchSettings(s)` | invoke | R->M | |
| `onActivityDetected(cb)` | listen | M->R | Returns cleanup function `() => void` |
| `getCurrentActivity()` | invoke | R->M | Returns `Promise<Activity \| null>` |
| `setCallActive(active)` | fire | R->M | Optional (shells before automatic installs lack it). Sends `set-call-active`; called by `callStateBridge.ts` |
| `getGameDetection()`, `setGameDetectionEnabled(enabled)`, `removeDetectedGame(process)` | invoke | R->M | Optional (shells before game-detection settings lack them). The `game-detection-*` channels in Activity Detection; Settings → Games tells a shell without `getGameDetection` to update |
| `syncKeybinds(keybinds)` | fire | R->M | |
| `onKeybindAction(cb)` | listen | M->R | Returns cleanup function |
| `onAccessibilityStatus(cb)` | listen | M->R | Returns cleanup function |
| `onKeybindHookError(cb)` | listen | M->R | Returns cleanup function |
| `checkAccessibility()` | invoke | R->M | Returns `Promise<boolean>` |
| `setConnectedOrigins(origins)` | fire | R->M | Push connected-instance origin list to main (in-instance `/join/` interception) |
| `onOpenInternalRoute(cb)` | listen | M->R | Returns cleanup function; `cb` receives a path string to navigate in-app |
| `rendererReady()` | fire | R->M | Boot-completion ping; semantic: "renderer survived render" |
| `getRecoveryState()` | invoke | R->M | Returns `Promise<RecoveryState>` |
| `onRecoveryStateChanged(cb)` | listen | M->R | Returns cleanup function; recovery.html subscribes |
| `recoveryAction(action)` | fire | R->M | Single channel for all recovery button clicks |
| `getUpdateStatus()` | invoke | R->M | Returns `Promise<UpdateSnapshot>`. Optional: absent on pre-1.0.5 apps |
| `onUpdateStatusChanged(cb)` | listen | M->R | Returns cleanup function. Optional |
| `dismissUpdate(version)` | fire | R->M | Optional |
| `openReleasePage()` | fire | R->M | Optional |

The four update-snapshot methods are declared **optional** in
`electron.d.ts`. A client served by a newer instance can be running inside an
older desktop app that does not expose them, so every call site feature-detects.
`updateStore.ts` falls back to the legacy per-event channels when they are absent.

Direction legend: **fire** = `ipcRenderer.send` (no response), **invoke** = `ipcRenderer.invoke` (returns Promise), **listen** = `ipcRenderer.on` (event subscription).

---

## Activity Detection

### Overview

Finds out which game the person is playing, every 15 seconds, in four ways, without asking them to name or pick anything:

1. **Steam** says itself which of its games runs, under the name it has in the person's library. This covers every Steam game; no list is involved.
2. **Epic Games and GOG** say which games are installed and which program starts each. A running program of that name is that game.
3. **The game list** (`resources/games.json`) knows well-known games from everywhere else by their process names: Battle.net, Riot, Rockstar, Ubisoft, EA, HoYoverse, Roblox, and games without a launcher.
4. **Window titles** tell the few games that run inside a program plenty of other things use: Minecraft Java Edition is `javaw.exe`.

`gameMatching.ts` holds what is pure (reading the answers, the list, choosing a game), `gameLibraries.ts` what the launchers leave on this computer, `activityDetector.ts` the polling and the sync. All of it is read on the person's computer and nothing leaves it except the name of the game being shown.

There is no picker. The app does not list the programs on someone's computer, not to them and not to anyone. **What it cannot find:** a game outside all four ways, for instance one from the Xbox app or one without a launcher that is not on the list. The way to fix that is a new entry in the list, which reaches every installed app (below). Steam, Epic, GOG and window titles are Windows only; on Mac and Linux, where no build is shipped yet, only process names count, and Minecraft Java Edition is not found.

**On by default.** Detection runs unless the person turned it off in Settings → Games (`GamesPanel` in the web client). The setting lives in `{userData}/game-detection.json` (`gameDetectionSettings.ts`: `{ enabled, userGames: [{ name, process }] }`). A missing or unreadable file, or one that does not say, is on (`DEFAULT_SETTINGS`); an `enabled` the person saved stands, whichever way it went. While it is off nothing is read: `startActivityDetection` is not called at launch and `get-current-activity` answers null. Turning it off stops the loop, clears the current game and sends `activity-detected` null so the activity disappears at once. What it detects reaches anyone else only while the Privacy sharing switch is on (below).

**Programs added by hand.** Up to 1.26.0 a person could pick a running program from a list of all of them and name it. That is gone, since a list of everything on someone's computer is not what this page is for. What people added then still counts, wins over everything else (`setUserGames`, ids `user:<process>`) and stays listed in Settings → Games until they remove it; the section does not appear for anyone else.

**Older shells.** Settings → Games feature-detects the bridge: in a desktop shell whose preload has no `getGameDetection` it says that this version cannot detect games yet and links the download page (`/download`), since after one manual install the app keeps itself up to date; in a browser it says that detection needs the desktop app. A shell older than 1.27.0 still offers `listRunningPrograms` and `addDetectedGame` in its preload; nothing calls them any more.

| IPC (invoke) | Answer | Does |
|---|---|---|
| `game-detection-get` | `{ enabled, userGames, current }` | Read the state |
| `game-detection-set-enabled` (boolean) | state | Start or stop detection and save |
| `game-detection-remove` (process) | state | Forget a program added by hand |

### Steam

Asked only while `steam.exe` runs, because after a crash the registry can go on naming a game that ended long ago:

`reg query HKCU\Software\Valve\Steam /s` (about 60 ms) gives `RunningAppID`, the game started last; `Apps\<id>\Running`, every game running, since a tool like Wallpaper Engine can hold `RunningAppID` beside a game; `SteamPath`; and `Apps\<id>\Name`, which not every game has.

The name comes from `steamapps/appmanifest_<id>.acf` in `SteamPath` or in one of the other libraries `steamapps/libraryfolders.vdf` names (games are often on another drive), and only then from the registry, whose output is in the console's code page. A name once found is kept for the session. An app without a name counts as nothing. Apps in `ignoredSteamApps` of the game list are tools rather than games and count as nothing either. Ids are `steam:<appId>`.

### Epic Games and GOG

Read at the start and then every 10 minutes (`INSTALLED_REFRESH_MS`), so a game installed meanwhile is found without a restart.

| Launcher | Where | Fields |
|---|---|---|
| Epic Games | `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item` (JSON) | `DisplayName`, `LaunchExecutable`, `AppCategories` must hold `games` when present (the launcher keeps the same file for the Unreal Engine), `bIsIncompleteInstall` |
| GOG | `reg query HKLM\SOFTWARE\WOW6432Node\GOG.com\Games /s` | `gameName`, `exeFile` or else `exe` |

A launch file with a name too common to say anything (`launcher.exe`, `game.exe`; `GENERIC_EXECUTABLES`) is left out rather than read as this game. `cleanGameName` removes trademark signs and what the console could not spell, and cuts to the server's 128 characters.

### Game List

```typescript
interface GameDictionary {
  version: number;
  games: GameEntry[];
  ignoredSteamApps?: number[]; // Steam apps that are tools, not games
}

interface GameEntry {
  id: string;        // unique identifier, e.g. "cs2"
  name: string;      // display name, e.g. "Counter-Strike 2"
  processes: string[]; // executable names, e.g. ["cs2.exe", "cs2"]
  windows?: { process: string; titleStartsWith: string }[]; // a game inside a shared program
  type?: string;     // "playing" | "listening" | "watching" | "streaming" (default: "playing")
}
```

A bare array of entries, the old format, still reads as version 0.

**What belongs on it** (`gameMatching.test.ts` checks the bundled list against this):

- Games only. Spotify, VLC, OBS and mpv were on it and showed "Listening to Spotify" for whoever left it in the tray.
- Names that say which game this is. `start_protected_game.exe` is Easy Anti-Cheat's starter in hundreds of games and read as Elden Ring in all of them. Launchers (`MinecraftLauncher.exe`), Unreal's generic names (`ShooterGame.exe`, `Client-Win64-Shipping.exe`) and dedicated servers stay off too. A game sold on PC only through Steam, Epic or GOG does not need an entry at all, and shouldn't have one when its process name is a common word.
- Each name once. Of two entries with the same name only the first could ever show.
- At least one `.exe` spelling per entry: shells before 1.27.0 compare exactly, and they read this list too.

**Raising `version`** is what publishes a change. An entry older shells should use may not rely on `windows` alone, since they skip that field.

### Which List Is Used

1. **Startup** (`loadLocalDictionary`): the newer of the saved copy (`{userData}/games-cache.json`) and the bundled list (`resources/games.json`), by `version`, so a copy saved by an older version of the app cannot outlive a better list an update brought. When neither loads, detection still runs without a list: Steam, the launchers and programs added by hand work anyway.
2. **Background sync** (`syncDictionary`): Fire-and-forget async fetch from the app's own server after startup (below).

### Remote Sync (`syncDictionary()`)

**Remote URL:** `https://tavvit.com/downloads/desktop/games.json` (`PRODUCTION_URL` + the downloads path): the app's own server, never a third party. `scripts/package-desktop.mjs` puts the list into every desktop archive, so each release publishes it (see Releases). To publish a list without a release, copy `packages/desktop/resources/games.json` to `data/downloads/desktop/games.json` on the server; no restart is needed, and every app takes it at its next start. Without a file the request is a 404 and the local list stands.

```
Step 1: Fetch with a conditional request (ETag)
Step 2: If remote version > the version in use → atomic write to the saved copy, save the ETag, replace the list in memory
```

**ETag-based conditional fetching:**
- ETag stored at `{userData}/games-cache-etag.txt`
- Sent as `If-None-Match` only while a saved copy exists; 304 response = no update needed
- Follows redirects (301/302)
- 10-second timeout

**Atomic file writes** (`atomicWrite()`): Writes to `{path}.tmp` then `fs.renameSync()` into place. Prevents corrupt cache on crash.

**Taking over a list** (`applyDictionary()`): Replaces the list in memory without touching `currentGameId` or `currentActivity`. A game being shown stays shown.

### Process Polling

**Interval:** 15 seconds (`POLL_INTERVAL_MS`). First poll runs immediately on start.

**Guard:** `isPolling` flag prevents overlapping polls if a previous poll hasn't finished. `generation` moves on every start and stop, so a poll still running then writes nothing.

**Error handling:** A listing that fails (an error, or no answer within `SCAN_TIMEOUT_MS`, 10 seconds, on a busy machine) is tried again at the next poll; detection never stops by itself. Of failures in a row, only the first is logged. After `FAILURES_BEFORE_CLEAR` (3) failures in a row the game shown last is no longer known to be running, so it is cleared and `activity-detected` null is sent. A listing that succeeds resets the count. A launcher that cannot be asked counts as having nothing running.

### Platform Commands

| Platform | Command | Output Format |
|----------|---------|---------------|
| macOS | `ps -c -A -o comm` | One process name per line (header: `COMM`) |
| Linux | `ps -A -o comm` | One process name per line (header: `COMM` or `COMMAND`), cut at 15 characters by the system |
| Windows | `%SystemRoot%\System32\tasklist.exe /fo csv /nh` | CSV: `"ImageName","PID","SessionName","Session#","MemUsage"` |
| Windows, window titles | `tasklist.exe /v /fi "imagename eq <program>" /fo csv /nh` | Nine columns, the last is the title. Only while that program runs: about 50 ms with the filter, seconds without |

Every command runs with `SCAN_OPTIONS`: `windowsHide: true`, so a packaged app does not flash a console window on every poll on Windows; `timeout: SCAN_TIMEOUT_MS` (10 seconds); and a 4 MB `maxBuffer` for a long answer. The Windows tools are called by their full path (`windowsTool`), never by a name that a file in the folder the app was started from could answer to.

**Names** are compared as `processKey` gives them: lower case, without `.exe`, and on Linux cut to 15 characters on both sides. So `RuneLite` in the list finds `RuneLite.exe`, and a Proton game on Linux finds its cut-off name.

**Whose programs:** on Windows only the session this app runs in counts, told by the app's own row in the listing. Services and what another account on the computer has running are not what this person is playing.

### Matching Algorithm (`poll()`)

1. Read the process list into a set of `processKey` names.
2. Collect everything being played, in order of priority (`findRunningGames`): programs added by hand, then Steam's running games, then Epic and GOG games whose program runs, then entries of the list whose program runs or whose window rule holds.
3. **Choose one** (`chooseGame`): a game not seen at the last poll wins, since that is what the person just turned to; while nothing new starts, the one showing stays, so the status does not jump; when it ends, the highest priority of what still runs takes over.
4. **Another name than the one showing:** build the `Activity` with `timestamps.start` set to when that game was first seen, which survives another game coming and going in between (`runningSince`), and fire `onChangeCallback`.
5. **Same name, even from another source** (the list and Steam both know Counter-Strike 2): no-op, no IPC sent.
6. **Nothing running:** Clear `currentGameId` and `currentActivity`, fire the callback with `null` if a game was showing.

### Activity Object

```typescript
interface Activity {
  type: string;       // from GameEntry.type, default "playing"
  name: string;       // from GameEntry.name
  details?: string;   // unused currently
  state?: string;     // unused currently
  timestamps?: { start?: number; end?: number };
}
```

### Lifecycle

- **Start:** `startActivityDetection(callback)` — called from `app.whenReady()` unless the person turned detection off, and from `game-detection-set-enabled`
- **Stop:** `stopActivityDetection()` — called from `before-quit` and when detection is turned off; it also forgets the current game
- **Programs added by hand:** `setUserGames(games)` — called at startup and after a remove; a removed program that was being shown is cleared at once, and while detection runs the next poll runs at once
- **Query:** `getCurrentActivity()` — exposed via `get-current-activity` IPC handle (null while detection is off)

---

## Global Keybind Manager

### Overview

Windows, macOS and Linux X11 capture global keyboard and mouse events via
`uiohook-napi`. Linux Wayland sessions (including an XWayland app window inside
Wayland) instead use the desktop's `org.freedesktop.portal.GlobalShortcuts`
interface. An X11 hook cannot observe input to other native Wayland clients.

### Wayland portal

`globalShortcutsPortal.ts` uses a dedicated session-bus connection, registers the
desktop-file identity `io.github.TheZwiss.backspace` through the host Registry
when outside Flatpak, and creates a GlobalShortcuts session. Older portals
without the optional Registry remain supported. Flatpak supplies its own identity;
no additional bus permissions or unrestricted input-device access are requested.

The desktop is the sole source of truth for Wayland assignments. The application
registers a stable catalogue of all six voice actions, without preferred triggers
or dependence on browser/X11 keybind storage. After successful registration, every startup creates a session and
calls BindShortcuts so the desktop can restore its saved assignments. Registration
is not gated on ListShortcuts: some backends return an empty list before binding
the new session. First launch stays idle until Settings → Keybinds requests registration.
Successful registration is remembered in `userData/global-shortcuts.json`; only
the registration flag is stored, never shortcut assignments. Existing installs
without this flag need to open Keybinds once to save it.
After cancellation or failure, the explicit retry button can register a new session.

On Wayland the settings panel has no local recorder, edit or delete controls.
It directs users to the system's Backspace shortcut settings and shows a read-only
list of actual assignments. Closing a session unregisters its runtime listeners;
it does **not** delete the desktop's persistent shortcut configuration. Change or
remove those assignments in the desktop settings instead.

Bindings require system consent and a portal backend implementing GlobalShortcuts.
`Activated` and `Deactivated` both reach the renderer so push-to-talk works while
unfocused. Electron's press-only `globalShortcut` callback is insufficient here.
Only signals from the resolved portal owner and current session are accepted.
Repeated activations are suppressed; stop, revoked bindings, session closure,
portal restart and transport errors release held actions. Portal failure exposes
a manual retry in settings (no prompt loop). Local bindings are disabled on
Wayland even when the portal is unavailable, so a removed system assignment cannot
unexpectedly continue to work through a stale local binding.

One portal session lasts for the app run; local edits, empty configuration and
renderer unmount do not recreate it. BindShortcuts is called at most once per
session. Request responses are subscribed before method calls to handle early
replies; method and consent waits are bounded and cancelled on shutdown.

Optional preload methods `getKeybindPortalStatus`, `onKeybindPortalStatus` and
`retryKeybindPortal` report idle/pending/ready/unavailable plus actual assignments.
ShortcutsChanged triggers a full ListShortcuts refresh instead of treating the
possibly partial signal as the whole configuration. Window focus and reading
status also refresh the list, covering changes made in system settings. Removed
or reassigned held actions are released. PTT mode follows the system's active PTT
assignment, not local storage; unchanged status refreshes do not re-mute a held PTT.
Portal events bypass the legacy 100 ms duplicate filter. The browser/non-Wayland
fallback releases its own held actions on window blur and cleanup.

The MIT-licensed `dbus-next` dependency provides D-Bus message transport without a
helper executable. Its optional obsolete `usocket` native addon is excluded (no
file-descriptor transfer is needed), and `xml2js` is overridden to a patched
version. The normal filesystem session socket works through Node's built-in net
transport; legacy abstract sockets requiring the optional addon report the portal
as unavailable. Regenerate Flatpak's offline sources after lockfile changes.

### Native Keycode to DOM Code Mapping

uIOhook reports hardware scan codes. The web UI stores keybinds as djb2 hashes of DOM `KeyboardEvent.code` strings. The `UIOHOOK_TO_DOM_CODE` lookup table bridges the two.

**Mapped key ranges:**

| Category | Examples |
|----------|---------|
| Letters | A-Z (keycodes 16-50) |
| Digits | 0-9 (keycodes 2-11) |
| Function keys | F1-F24 (keycodes 59-107) |
| Modifiers | ControlLeft/Right, AltLeft/Right, ShiftLeft/Right, MetaLeft/Right |
| Special | Backspace, Tab, Enter, CapsLock, Escape, Space |
| Navigation | PageUp/Down, Home, End, Arrows, Insert, Delete |
| Punctuation | Semicolon, Equal, Comma, Minus, Period, Slash, Backquote, Brackets, Backslash, Quote |
| Numpad | Numpad0-9, NumpadMultiply/Add/Subtract/Decimal/Divide |
| Locks | NumLock, ScrollLock, PrintScreen |

### djb2 Hash Function

```typescript
function djb2(code: string): number {
  let hash = 5381;
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) + hash + code.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}
```

This hash is used identically in:
- `keybindManager.ts:djb2()` — main process, matching against native events
- `useKeybinds.ts:browserCodeToUiohook()` — renderer, web fallback path
- `KeybindsPanel.tsx:codeToNumeric()` — renderer, recording keybinds in settings UI

The pre-computed `UIOHOOK_TO_HASH` map converts uIOhook keycodes directly to djb2 hashes at module load time.

### KeybindConfig

```typescript
interface KeybindConfig {
  actionId: string;      // e.g. "toggleMute", "pushToTalk"
  keys: number[];        // djb2 hashes of DOM code strings
  mouseButton?: number;  // uIOhook mouse button index (3=middle, 4=back, 5=forward)
}
```

### KeybindManager Class

**State:**
- `keybinds: KeybindConfig[]` — current bindings synced from renderer
- `pressedKeys: Set<number>` — currently held keys (djb2 hashes)
- `activeActions: Set<string>` — actions whose keybind is currently satisfied
- `window: BrowserWindow | null` — target for IPC sends
- `started: boolean` — whether uIOhook is running

### Lifecycle

1. **`updateKeybinds(keybinds)`** — called when renderer syncs new bindings via `keybinds-sync` IPC
   - Replaces stored keybinds
   - Releases any active actions whose binding was removed
   - Auto-starts uIOhook if keybinds exist and hook not running
   - Auto-stops uIOhook if keybinds list becomes empty

2. **`start()`** — registers uIOhook event listeners and calls `uIOhook.start()`
   - On macOS: checks `systemPreferences.isTrustedAccessibilityClient(true)` first (the `true` parameter triggers the OS permission prompt)
   - If not trusted: sends `accessibility-status` event to renderer and returns without starting
   - On start failure: sends `keybind-hook-error` to renderer

3. **`stop()`** — releases all active actions, clears state, removes listeners, calls `uIOhook.stop()`
   - Called from `app.on('before-quit')`

### Event Processing

**Key down (`onKeyDown`):**
1. Convert uIOhook keycode to djb2 hash via `UIOHOOK_TO_HASH`
2. Add hash to `pressedKeys`
3. `evaluateKeybinds()`: for each keybind (no mouseButton, not already active), check if all `keys` are in `pressedKeys` → if yes, activate and send `pressed: true`

**Key up (`onKeyUp`):**
1. Convert keycode to hash, remove from `pressedKeys`
2. `checkReleases()`: for each active action (no mouseButton), check if any required key is no longer pressed → if so, deactivate and send `pressed: false`

**Mouse down (`onMouseDown`):**
1. Ignore buttons 1 (left) and 2 (right) — only extra buttons (3+) are bindable
2. `evaluateKeybindsWithMouse(button)`: for keybinds matching this mouseButton that aren't already active, check modifier keys → activate

**Mouse up (`onMouseUp`):**
1. Ignore buttons 1 and 2
2. `checkMouseReleases(button)`: deactivate actions bound to this mouse button

### IPC Output

All matched actions sent to renderer as: `keybind-action { actionId: string, pressed: boolean }`

This is critical for **push-to-talk**: the `pressed: true` unmutes, `pressed: false` re-mutes. Toggle actions (mute, deafen, camera, etc.) only trigger on `pressed: true`.

### macOS Accessibility Permission

uIOhook requires Accessibility permission on macOS to capture global input events.

| Method | `prompt` param | Effect |
|--------|---------------|--------|
| `start()` → `isTrustedAccessibilityClient(true)` | true | Checks + shows OS permission dialog if not trusted |
| `checkAccessibility()` → `isTrustedAccessibilityClient(false)` | false | Checks without prompting |

On non-macOS platforms, `checkAccessibility()` always returns `true`.

---

## Keybind System (Web Side)

### Keybind Store (`keybindStore.ts`)

Persisted via Zustand `persist` middleware to `localStorage` key `backspace-keybinds` (version 1).

```typescript
interface Keybind {
  actionId: string;
  keys: number[];          // djb2 hashes, sorted ascending
  mouseButton?: number;    // 3=middle, 4=back, 5=forward
  displayLabel: string;    // human-readable, captured at record time
}
```

**Blacklisted mouse buttons:** 1 (left), 2 (right) — `setKeybind()` silently ignores these.

**Conflict detection:** `findConflict(keys, mouseButton?, excludeActionId?)` checks for exact key+mouse match against existing bindings.

### Bindable Actions

| Action ID | Label | Type |
|-----------|-------|------|
| `toggleMute` | Toggle Mute | toggle |
| `toggleDeafen` | Toggle Deafen | toggle |
| `pushToTalk` | Push to Talk | hold |
| `toggleCamera` | Toggle Camera | toggle |
| `toggleScreenShare` | Toggle Screen Share | toggle |
| `disconnect` | Disconnect | toggle |

### useKeybinds Hook

Three parallel systems:

**1. PTT Lifecycle** — When `pushToTalk` keybind exists and user is in voice: activates PTT mode (`pttActive: true`), force-mutes the user. Deactivates when keybind removed or user leaves voice.

**2. Electron IPC Bridge** — Active when `isElectron()` and keybinds exist:
- Syncs keybind config to main process via `syncKeybinds()`
- Subscribes to `onKeybindAction()` for matched events from uIOhook
- Cleanup on unmount

**3. Web Fallback** — Always active (both web and Electron):
- Capture-phase `keydown`/`keyup`/`mousedown`/`mouseup` listeners on `window`
- Converts `KeyboardEvent.code` to djb2 hash via inline `browserCodeToUiohook()`
- Same evaluation logic as KeybindManager (track pressed keys, match keybinds, detect releases)
- **Input suppression:** Skips single character keys (no modifiers) when an input/textarea/contentEditable is focused
- **Mouse button mapping:** Browser button index -> uIOhook: `{ 1: 3, 3: 4, 4: 5 }` (middle, back, forward)

**Deduplication:** `dispatchKeybindAction()` uses a 100ms cooldown per `actionId:pressed` pair to prevent double-firing when both the native hook and web fallback trigger simultaneously (common when the Electron window is focused).

### Action Dispatch (`dispatchKeybindAction()`)

Only dispatches when user is in a voice channel (`currentVoiceChannelId` exists).

Checks space mute/deafen enforcement state before dispatching mute/deafen actions (see `voice.md` for voice moderation details).

| Action | Trigger | Behavior |
|--------|---------|----------|
| `toggleMute` | `pressed: true` | `handleMuteAction()` (respects space enforcement) |
| `toggleDeafen` | `pressed: true` | `handleDeafenAction()` |
| `toggleCamera` | `pressed: true` | `handleCameraAction()` |
| `toggleScreenShare` | `pressed: true` | `handleScreenShareAction()` |
| `disconnect` | `pressed: true` | `handleDisconnectAction()` |
| `pushToTalk` | `pressed: true/false` | `setMuted(!pressed)` + `broadcastVoiceStatus()` |

Toggle actions only fire on `pressed: true`. Push-to-talk fires on both press (unmute) and release (mute).

---

## Build System

### electron-builder Configuration (`electron-builder.yml`)

```yaml
appId: de.hashhive.orbit          # also the Windows AppUserModelId in main.ts
productName: Tavvit
artifactName: "${productName}-${version}-${os}-${arch}.${ext}"   # Tavvit-1.12.0-win-x64.exe
output: dist-electron
```

### Build Targets

| Platform | Formats |
|----------|---------|
| Windows | nsis, one installer per architecture (allows custom install dir). The only platform Tavvit builds and offers today |
| macOS | dmg (configured, not built: needs a Mac to build on) |
| Linux | AppImage, deb (configured, not built) |

### Build Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | TypeScript compile + `electron-builder --win --x64` |
| `pnpm dev` | Compile TypeScript + launch Electron (with icon setup) |

### Native Module Handling

**Dependency:** `uiohook-napi` (native N-API addon for global input hooks)

**Rebuild:** `electron-rebuild -f -w uiohook-napi` runs on `postinstall` to compile for the build machine's Electron ABI. `uiohook-napi` is the only native module this rebuild touches, and it is the only one in the desktop dependency tree. `better-sqlite3` belongs to `packages/server` and never enters the packaged app, so an Electron ABI mismatch cannot reach it.

`@electron/rebuild` 4 is ESM-only and declares `engines.node: >=22.12.0`, which the repository's own floor now matches (`engines.node: >=22.12.0`, CI legs on 22 and 24). While one `ci.yml` leg still ran Node 20 the CLI was measured on 20.19.5 and completed the rebuild anyway: it uses `parseArgs`, `styleText` and `import.meta.dirname`, all of which exist in 20.19. The `postinstall` also ends in `|| node -e "console.warn(...)"`, so a future failure degrades to a warning rather than breaking `pnpm install`. That fallback is what makes the engines mismatch tolerable, not the measurement: if the rebuild ever does stop running on Node 20, `pnpm dev` breaks locally while release builds keep working, because packaging uses `prebuilds/` and `npmRebuild: false`.

**ASAR unpacking:** All `.node` files are unpacked from the ASAR archive (`asarUnpack: "**/*.node"`). Native modules cannot load from inside ASAR.

**Build exclusions:** Host-compiled artifacts are excluded from the ASAR to prevent them from shadowing platform-correct prebuilts:
```yaml
- "!**/node_modules/uiohook-napi/build/**"
- "!**/node_modules/uiohook-napi/build.bak/**"
- "!**/node_modules/uiohook-napi/bin/**"
```

`npmRebuild: false` — electron-builder's built-in rebuild is disabled; the `postinstall` script handles it.

### afterPack Hook (CRITICAL)

**File:** `scripts/afterPack.js`

**Problem:** `electron-rebuild` (postinstall) compiles `uiohook-napi` for the BUILD machine (e.g., macOS arm64), placing the binary in `build/Release/`. The `node-gyp-build` loader checks `build/Release/` BEFORE `prebuilds/{platform}/`. Without cleanup, cross-platform builds (e.g., building Windows packages on macOS) would ship the macOS binary, causing immediate crashes on the target platform.

**Solution (two steps):**

1. **Remove host-compiled artifacts:** Deletes `build/`, `build.bak/`, and `bin/` directories from the unpacked `uiohook-napi` in the output.

2. **Strip foreign prebuilts:** Removes `prebuilds/{platform}-{arch}/` directories for platforms other than the build target. Saves ~1-2MB per build.

**Path resolution:** On macOS, resources live inside `{productName}.app/Contents/Resources/`; on Windows/Linux, under `resources/`. The hook resolves the correct path via `context.electronPlatformName`.

**WARNING:** Removing or disabling this hook will cause Windows and Linux builds to crash on launch. This is documented in project memory as a critical constraint.

3. **Ad-hoc sign (macOS only):** Delegates to `scripts/macSign.js`. Must run last — signing seals the bundle, so it has to follow every file mutation, including the deletions above.

### macOS Ad-hoc Signing (CRITICAL)

**File:** `scripts/macSign.js`

**Problem:** electron-builder only signs when it can resolve a signing identity. With no Developer ID available, `MacPackager.sign()` bails out before signing at all (`findIdentity()` → `null` → `reportError()` → `return false`), leaving the bundle with only the linker-generated ad-hoc signatures baked into the prebuilt Electron binaries. Packaging then invalidates those: it renames the executable, rewrites `Info.plist`, injects `app.asar`, and deletes files from `Contents/Resources`.

The result is not merely unsigned, it is **invalid** — `codesign --verify` reports `code has no resources but signature indicates they must be present`, and there is no `Contents/_CodeSignature` at all. macOS reports an invalid signature as *"Backspace.app is damaged and can't be opened. You should move it to the Trash."* That is a dead end: unlike the unnotarized-app warning, it offers no "Open Anyway" path. Every macOS user of v1.0.0 hit this (issue #38).

**Solution:** Re-seal the bundle with an ad-hoc signature in `afterPack`:

1. Sign every Mach-O under `Contents/Resources` (`.node`, `.dylib`). `codesign --deep` only reaches the standard nested-code locations, so native modules unpacked to `app.asar.unpacked` are otherwise sealed as plain resources and never signed.
2. `codesign --force --deep --sign -` the bundle. `--deep` is discouraged for distribution signing because it applies one entitlement set to every nested binary; ad-hoc signatures carry no entitlements, so that does not apply here.
3. `codesign --verify --deep --strict` immediately, so a bad bundle fails the build **before** electron-builder packages and publishes it. `.github/workflows/release.yml` re-checks the final bundle as a backstop.

**Why `afterPack` and not `afterSign`:** electron-builder skips the `afterSign` hook entirely when no signing occurred (`didSign === false`), which is precisely this build's situation.

**No-op conditions:** skips when `CSC_LINK` or `CSC_NAME` is set, so a real Developer ID identity takes over cleanly, and warns (rather than failing) on non-macOS hosts, which cannot run `codesign`.

**WARNING:** Removing this hook makes macOS builds refuse to launch entirely.

### Icon Generation

All desktop and web brand assets are generated by `scripts/gen-icons.mjs` from sources in `assets/brand/`. Run via `pnpm gen-icons` after artwork changes; commit the diff. The generator uses `sharp` (SVG → PNG via librsvg), `png-to-ico` (multi-size `.ico`), and `png2icons` (`.icns`). Output is byte-stable for a given lockfile.

The split is by surface, not file type: UI surfaces (favicons, tray icons, the in-app sidebar tile) stay a flat two-colour mark; the app-icon family (every output where the OS shows this app as one launchable icon: dock, taskbar, Start menu, Alt-Tab, PWA install, iOS home screen, the maskable Android icon) is a dimensional squircle badge on a `#2a2740`-to-`#12101d` plum gradient, with drop shadow, inner shadow and a soft-light stroke overlay, and a white-to-`#7c6cf6` gradient glyph.

**Sources:**
- `app-icon.svg`: the white mark (T and ring) on a graphite rounded square with a hairline, at a 256 viewBox. Every app-icon output above 32 px renders straight from this vector.
- `app-icon-small.svg`: the same tile with the T alone. Drives the app-icon outputs at 16 and 32 px, the web favicons and the colour tray icons (Windows `.ico`, Linux PNG), so they read on a light and on a dark background.
- `mark-icon.svg`: the bare white mark on transparent. Drives the PWA maskable icon and the apple-touch icon, each composited on the flat graphite ground (`#121316`) at 60% of the canvas height, with no transparent pixel left.
- `mark-mono-light.svg`: the white T in a square box. Drives `packages/web/public/icons/logo-mark.svg` (byte copy), the logo in the top bar and on the sign-in pages.
- `mark.svg`: the mark with its ring, for large uses. Byte copy at `packages/web/public/icons/mark.svg`.
- `mark-tray.svg`: template artwork for the macOS menu bar (alpha + black; the OS recolours). `mark-mono-dark.svg` has no pipeline output today.

The `dev` script copies the committed `build/icon.icns` into Electron's bundled `Resources/electron.icns` so the macOS dev dock shows the Backspace mark instead of the default Electron logo. This dev-only patch is independent of how `.icns` is generated.

See `scripts/gen-icons.README.md` for the regeneration workflow and version-bump caveat (sharp / png-to-ico / png2icons upgrades change encoder output, requiring a follow-up regen+commit).

### Auto-Update Publishing

```yaml
publish:
  - provider: generic
    url: https://tavvit.com/downloads/desktop
```

The production server is the update source. `electron-builder` writes this
address into the packaged `app-update.yml`; `electron-updater` fetches
`latest.yml` from it, compares versions, and downloads the installer named
there, whole (`disableDifferentialDownload`, see Auto-Update, Configuration).

## Releases

A release is three files from `packages/desktop/dist-electron/` and the game
list on the server, in `data/downloads/desktop/` (`DOWNLOADS_DIR`, default
`downloads/` beside the database):

| File | Read by |
|------|---------|
| `Tavvit-<version>-win-x64.exe` | the browser (download page) and the updater |
| `Tavvit-<version>-win-x64.exe.blockmap` | an updater older than 1.12.0, for its differential download attempt; 1.12.0 and later never read it |
| `latest.yml` | the updater (version check) and `GET /api/desktop/release` (download page) |
| `games.json` | every starting app, even one too old to have updated (see Activity Detection, Remote Sync) |

**The current release is 1.12.0** (`version` in `packages/desktop/package.json`),
the first with the install policy under Auto-Update. An installed 1.11.0 takes
this first update with the updater it already has. That updater checks every
four hours, tries a differential download with the `.blockmap` first (which
fails against this server, so it falls back to the whole installer), and
installs the old way: when the person clicks Restart now, or when Tavvit quits.
Nothing installs 1.12.0 by itself at a quiet moment. From 1.12.0 on, every
update follows the install policy.

Steps, on the Windows build machine and then the server:

1. Raise `version` in `packages/desktop/package.json`.
2. `pnpm --filter @backspace/desktop build`.
3. `node scripts/package-desktop.mjs` writes `dist/release/tavvit-desktop-<version>.tar.gz`.
   It hashes the installer and refuses to pack when the SHA-512 or size differs
   from `latest.yml`, so an archive can never pair a description with another build.
   `latest.yml` is the archive's last member.
4. Upload the archive; on the server run `tar -xzf tavvit-desktop-<version>.tar.gz -C <tavvit folder>/data`.
   No restart: the release endpoint reads the directory per request.

The server side is `packages/server/src/routes/desktopDownloads.ts` and
`utils/desktopRelease.ts`: `/downloads/desktop/*` is served by `@fastify/static`
(Range, ETag; `latest.yml` and `games.json` with `Cache-Control: no-cache`,
installers as attachments) and a missing file there is a JSON 404, never the app's page, so
the updater cannot mistake HTML for `latest.yml`. The service worker's
navigation fallback excludes `/downloads/` for the same reason. The web
client's `/download` page, the sign-in page's aside and the About page render
`DesktopDownload`, which offers only files `GET /api/desktop/release` lists
(files `latest.yml` names and the disk has) and says so plainly when there is no
release.

The installers are not code-signed: Windows SmartScreen shows "unknown
publisher" on first run until a signing certificate is configured
(`win.certificateFile` / `CSC_LINK` in electron-builder).

---

## Persisted Files (userData)

### userData Folder Location

The runtime userData folder is named `Tavvit` on every platform:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Tavvit/` |
| Linux | `~/.config/Tavvit/` |
| Windows | `%APPDATA%\Tavvit\` |

Electron's default `app.getName()` reads `package.json`'s `name`, which in this monorepo is `@backspace/desktop` — that would land userData under a nested `@backspace/desktop/` folder. To prevent the monorepo's internal package name from leaking into a user-facing filesystem path, `main.ts` calls `app.setName('Tavvit')` at module load, before any `app.getPath('userData')` consumer runs. electron-builder's `productName: Tavvit` only renames the bundle metadata (executable, installer, app menu) — it does not affect runtime userData.

### Files

| File | Content | Purpose |
|------|---------|---------|
| `window-state.json` | `WindowState` | Window position, size, maximize state |
| `auto-launch.json` | `AutoLaunchSettings` | Open at login + start minimized prefs |
| `update-state.json` | `{ dismissedVersion }` | The update version the user waved away. Belongs to the app, not to an instance |
| `restart-hidden.json` | `{ at }` | Written when an update starts installing while the window is hidden; read and deleted on the next start, which then stays in the tray (Auto-Update, Install policy) |
| `logs/updater.log` | text | What electron-updater did, one timestamped line each; starts over past 1 MB |
| `game-detection.json` | `{ enabled, userGames }` | Game detection on or off, and the programs the person added |
| `games-cache.json` | `VersionedDictionary` | Cached remote game dictionary |
| `games-cache-etag.txt` | ETag string | For conditional HTTP requests |

---

## App Lifecycle Summary

### Startup Sequence (`app.whenReady()`)

1. Set application menu (platform-specific)
2. Clear service worker cache + HTTP cache
3. Register `setDisplayMediaRequestHandler` for screen share
4. Register all IPC handlers
5. Create main window (with state restoration)
   - Just before, `consumeRestartHidden` decides whether this start follows an update installed while the window was hidden; the window then stays hidden on `ready-to-show`.
   - After the BrowserWindow is constructed, `setMainWindow(mainWindow)` and `attachRecoveryHandlers(mainWindow)` are called. The `closed` event handler calls `setMainWindow(null)`.
6. Create tray icon
7. Resolve the update capability, then initialize the auto-updater (first
   check 10 s later, then every 30 minutes). An `external` capability,
   including Flatpak, records that state without loading `electron-updater`.
8. Wire recovery store subscriber (rebuilds tray + macOS menu on every state change; pushes `recovery-state-changed` to renderer when in recovery mode)
9. `setOnQuitRequested(requestQuit)` so recovery's Quit button uses the same `isQuitting + app.quit()` pattern as the tray
10. Start activity detection unless the person turned it off (immediate first
    poll, 15s interval, background remote sync). Flatpak uses the same
    platform-dependent behavior as global keybinds instead of applying a
    contradictory package-wide disable.
11. Linux/AppImage path-refresh: re-apply autostart entry if `$APPIMAGE` path changed (conditional; no-op on Windows/macOS)
12. Check for deep link in launch args

### Shutdown Sequence (`before-quit`)

1. Set `isQuitting = true` (allows window close to proceed)
2. Stop activity detection (clear interval, null callback)
3. Stop keybind manager (release active actions, stop uIOhook)

## The rename from Orbit (1.13.0)

The product was called Orbit until 1.12. An installed app updates in place, because everything that identifies an install stayed:

- **`appId: de.hashhive.orbit`** is unchanged, and so is the AppUserModelId: the NSIS installer derives its registry key from it, so a new `productName` replaces the old install instead of adding a second app. The install folder keeps its old name; electron-builder renames the shortcut.
- **userData:** `app.setName('Tavvit')` would move it to `<appData>/Tavvit`, so `main.ts` keeps using `<appData>/Orbit` where that folder exists. The sign-in, settings and window state are in there. A fresh install gets `<appData>/Tavvit`.
- **Autostart:** the old Run entry is named "Orbit" and starts `Orbit.exe`, which the update replaced. `migrateLegacyLoginItem()` swaps it for the current one once, keeping the choice of starting hidden.
- **Deep links:** `tavvit://` is the scheme; `orbit://` stays registered and handled, because invite links from before are in people's chats.
