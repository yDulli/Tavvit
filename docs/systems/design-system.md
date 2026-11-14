# Design System — Tavvit "Schwarzlicht", Evolve structure

Styles: `packages/web/src/styles/globals.css` (the tokens on `:root`, the component classes in `@layer components`)
Theme: `packages/web/tailwind.config.js` (maps the tokens to utilities; the layout variants `desktop:` and `compact:`)
Fonts: Outfit for the interface and every title, JetBrains Mono for labels, times and counts, both served from `public/fonts` and split by `unicode-range`. Outfit has Latin only, so Cyrillic falls to Geist, which stands behind it in the stack (the app ships Russian); JetBrains Mono carries Cyrillic itself. Geist, IBM Plex Sans, Inter, Space Grotesk, a mono face and the system stack are choices in Settings → Appearance; Simplified Chinese takes the platform stack (see `globals.css`).
Brand masters: `assets/brand/` (see its README)

---

## Principles

Since 1.42 the app keeps the structure of Evolve (a sidebar on ink with the dock of places, a topbar with a breadcrumb, pages that open with a header and hold panels) and wears the look of Showomat, the owner's other product, where it is called "Schwarzlicht": pure black, white ink, chrome, pills, frames, mono labels and light.

- Black and white. The canvas is `#000`, the type is off-white, and the one signal is that same white: what is selected, on or waiting for you is white with black words on it. Colour is left to what is a person's or a place's own (avatars, a space's tint, a profile's theme) and to status.
- Four tones do the work: the **canvas** (`--bg-chat`, pure black), **ink** (`--bg-channel`, a breath above it: the sidebar, the people column, fields), the **panel** (`--bg-panel`, a frame on the canvas) and **raised** (`--bg-raised`, a control on a panel). Two surfaces are told apart by a hairline before anything else.
- A frame is the structural unit (`.surface-card`): a hairline-edged surface with a 24px corner, lit faintly from its top left corner (`--frame-light`), which catches a little of the pointer's light.
- Pills: every button, field, chip and count is fully round. A button's fill rises from its foot when it is pointed at; the main one is white and glows (`--shadow-glow`).
- Type is Outfit at 600, set very tight (−0.045em) with a line height near 1 for anything large. Every label is JetBrains Mono capitals at 0.14em (`.label-mono`); the one that opens a section stands behind a turning spark (`.eyebrow`).
- Light is part of the look: film grain over everything, a field of fine light threads behind the opening of a page (`ui/LightField.tsx`), a ring of light that trails the pointer (`ui/PointerAura.tsx`), the product's name in polished chrome (`ui/ChromeWord.tsx`), figures in metal (`.stat-value`). All of it is decoration: off with Settings → Appearance → Light, under higher contrast and in forced colours, and still with Reduce motion.
- Not a Discord look-alike: the places are tiles in a dock and a breadcrumb in a topbar, never a column of round icons.
- Every state reads without colour alone: selected is a lighter step plus a white edge, unread is primary text in a heavier weight, hover is a faint veil, focus is an outline for the keyboard only, disabled is under half opacity.
- Real data only. An empty list says so with `.empty-state`; nothing is filled with sample people, invented numbers or decoration that pretends to be content.

## Settings organization

Settings tabs split on ownership. **Appearance** holds preferences that belong
to this browser or app: language and interface scale today, themes and display
density later. They are stored locally and they work on the login screen, before
there is an account. **Account** holds what lives on the server and follows the
user to any device or instance: profile, credentials, deletion. Avatar and
banner colours look like appearance and are not, because other people see them.
A new presentation preference goes in Appearance, not in Account or in Desktop
(the browser shows the Desktop tab only as a download offer, so a preference
placed there would be unreachable outside the app).

Within Appearance, what makes a look (see Looks) and what helps a person read
are kept apart: a look's parts (theme, accent, light, corners, typeface, the
shape of pictures, message style and density) are also shaped in the theme
studio at `/studio`, and putting on a look changes only them. Contrast, text
size, motion, the status palette, underlined links, the clock and the sidebar's
width stay with the person whatever look they wear. Each setting is one
component in `settingsPanels/LookSections.tsx` (`CornersSetting`,
`FontSetting`, `LightSetting`, `SpaceLooksSetting` …), so the Appearance tab
and the studio show the same control, never two copies of it.

## Interface scale

Appearance settings include a device-local interface scale: 50–250% in 25% steps,
default/reset 100%. `interfaceScaleStore` persists the percentage under
`backspace-interface-scale`; unsupported stored values fall back to 100%.
`appBoot.tsx` applies it before mounting React, including auth pages and portals. The product page (`landing/`) does not use it.
English, German, and Russian labels live in the `settings` namespace.

50% is an opt-in density setting, not a recommended reading size: common 10–11px
labels render at only 5–5.5px. The former 75% floor kept those labels at
7.5–8.25px; the lower floor accommodates users who want more content on screen,
but going lower would further compromise legibility. Default/reset remains 100%.

The web and Electron clients share root CSS `zoom`. This is independent of the
browser's own zoom controls. CSS viewport units do **not** compensate for CSS
zoom, so viewport-constrained surfaces use `--app-vh`, `--app-dvh`, and `--app-vw`
(one viewport unit divided by `--interface-scale`). Tailwind's `h-screen` and
`min-h-screen` use the same units. Keep Electron's title-bar reservation in
physical pixels using the shared `--titlebar-inset` (33px divided by the scale
under Electron, zero in the browser). `App` and `ImagePreview` must both use
this property rather than separate fixed offsets.

Safe-area and keyboard offsets use `--safe-top`, `--safe-bottom`, and
`--keyboard-inset`, which divide the corresponding environment lengths by the
scale. The viewport-token test rejects raw viewport units and environment
functions outside these definitions in production source.

`initializeInterfaceScale` updates `html[data-viewport="mobile|desktop"]` on
resize and scale changes using the same predicate as AppLayout: mobile below
768 layout pixels **or** below 600 unscaled viewport pixels (`window.innerWidth`).
The narrow-viewport guard keeps 390–430px phones in MobileShell even at 50%,
when their effective layout width is 780–860px. Wider windows retain the scaled
768px breakpoint; 600px is the first width eligible for desktop at 50%.

The guard also decides the outcome at 75%, not only at the new floor: it applies
at any scale at or below 78.125%, so a 576–599px window renders MobileShell where
the scaled breakpoint alone would have kept the desktop grid. That is intended.
A physically narrow viewport is mobile regardless of scale; gating the guard on
scale would reintroduce the scale-driven shell flip it exists to prevent.

Use the `desktop:` Tailwind variant for app-shell responsiveness; raw media
queries ignore root zoom. Auth pages without a JS layout branch may keep `md:`.
When scale moves the appearance panel into MobileShell, route reconstruction
places the current channel below settings and remains idempotent in StrictMode.

`ImageCropModal` cancels root zoom only on the cropper container with
`zoom: calc(1 / var(--interface-scale, 1))`. react-easy-crop mixes visual DOM
measurements and pointer deltas with CSS pixels, so this subtree must operate
at effective 100%. The surrounding dialog controls retain the interface scale.
Validate both dragging and the exported crop pixels when changing this boundary.

DOM rectangles and pointer coordinates are visual pixels. Convert them with
`layoutPixels` / `layoutRect` before assigning CSS positions, sizes, or drag
offsets. `computeFloatingPosition` accepts visual rectangles and dimensions and
returns layout coordinates; its callers must not pre-convert them. Pure hit
tests comparing two visual coordinates do not need conversion.
For anchors created from layout constants, convert with `visualPixels` before
calling `pointAnchor` so floating-position conversion does not shrink them twice.

Changing scale dispatches `resize` to update floating surfaces and the effective
mobile breakpoint. The account settings stay accessible when crossing that
breakpoint. Native browser zoom and pinch gestures retain their normal behavior.

---

## Color Palette

Every colour token is an RGB channel triple, so Tailwind can add opacity (`bg-accent-rose/10`). The names are the upstream design system's (`surface-*`, `border-*`, `txt-*`, `accent-*`, `interactive-*`, `status-*`), which is why every component and the colour-token test (`styles/colorTokens.test.ts`: a colour class Tailwind cannot generate fails) keep working.

### Surfaces
| Token | Channels | Hex | Role |
|-------|----------|-----|------|
| `--bg-base` | 0 0 0 | `#000000` | The canvas behind everything: the topbar, the window, the browser and OS chrome (`theme-color`, the PWA manifest, the Electron window), the ground of the pages outside the app |
| `--bg-chat` | 0 0 0 | `#000000` | The page itself: the conversation, Home, Explore, the inbox, settings content |
| `--bg-channel` | 5 5 5 | `#050505` | Ink: the sidebar and the settings navigation |
| `--bg-members` | 5 5 5 | `#050505` | Ink: the people column (members, activity, a group's people) |
| `--bg-input` | 5 5 5 | `#050505` | Ink: fields, the well of a segmented control |
| `--bg-panel` | 11 11 11 | `#0b0b0b` | The frame (`.surface-card`, `ui/PageHeader` `Panel`), the composer, a dialog |
| `--bg-raised` | 20 20 20 | `#141414` | A control on a panel: secondary buttons, keys, the chosen part of a segmented control |
| `--bg-elevated` | 29 29 29 | `#1d1d1d` | What floats (menus, popovers, tooltips, toasts), always through the floating-layer classes |
| `--bg-overlay` | `rgba(0, 0, 0, 0.8)` | | Scrims behind sheets |

### Hairlines and control tones
| Token | Value | Role |
|-------|-------|------|
| `--border-faint` | 23 23 23 | The line between rows inside a panel (`divide-border-faint`) |
| `--border-hard` | 41 41 41 | The hairline between two surfaces: column edges, the bottom of a bar, a frame's edge |
| `--border-soft` | 64 64 64 | The strong edge of a control or a floating layer: fields, keys, menus, dialogs |
| `--interactive-muted` | 110 110 110 | A hovered edge, the scrollbar thumb under the pointer |
| `--interactive-hover` | `rgba(255, 255, 255, 0.05)` | The veil of a hovered row or button |
| `--interactive-selected` | `rgba(255, 255, 255, 0.08)` | The fill of a selected row or tab |
| `--interactive-active` | `rgba(255, 255, 255, 0.11)` | The fill while something is pressed |
| `--interactive-row` | `rgba(255, 255, 255, 0.03)` | The hover of a message row, quieter than a control's |

### Text
| Token | Channels | Use |
|-------|----------|-----|
| `--text-primary` | 242 242 242 | Titles, names, the selected and the unread row, the primary button's fill |
| `--text-message` | 228 228 228 | Message bodies |
| `--text-secondary` | 168 168 168 | Idle navigation rows, secondary lines |
| `--text-tertiary` | 140 140 140 | Quiet meta: times, hints, placeholders (5:1 on the floating tone) |
| `--text-category` | 140 140 140 | `.label-mono` (6:1 on ink) |
| `--text-link` | 255 255 255 | Links |
| `--text-positive`, `--text-warning`, `--text-danger` | 69 214 160, 247 184 79, 242 122 122 | Outcomes and errors, functional only |
| `--danger-fill`, `--danger-fill-hover` | 207 48 48, 185 41 41 | The fill of a destructive button, under white words (`bg-danger-fill`) |

### The signal
| Token | Channels | Use |
|-------|----------|-----|
| `--accent-primary` | 242 242 242 (`#f2f2f2`) | Fills under `--on-accent`: count badges of what waits for you, a switch or box that is on |
| `--accent-primary-hover`, `--accent-primary-active` | 255 255 255, 214 214 214 | The fill under the pointer and pressed |
| `--accent-primary-soft` | 242 242 242 | The signal as a line, a mark or text: the edge of a selected row, the ring of the place you are in, a mention's edge, the focus outline. Utility: `text-accent-soft` |
| `--on-accent` | 0 0 0 | What stands on the signal: black on the white default, white once an accent colour is chosen (see below). Utilities: `text-on-accent`, `bg-on-accent` |
| `--notification` | 242 242 242 | `bg-notification`, kept for older call sites; counts use `.count-badge` |

The instance accent (Admin console → General), a person's own (Settings → Appearance → Accent colour) and a space's replace the four `--accent-primary*` variables at runtime (`utils/instanceBranding.ts`, `components/ui/AppearanceController.tsx`), and set `--on-accent` to white with them: an accent is accepted only when `accentColorProblem` (`packages/shared/src/color.ts`) passes it, which asks that white text reads on it. So anything drawn on the signal (a count's figures, a switch's thumb, a check mark) takes `--on-accent`, never a fixed white or black. The shared `DEFAULT_ACCENT_COLOR` (`#7466e8`) is what the server and the settings offer as the first choice of a colour; the stylesheet's own default is the white signal.

### Accent family and status
`--accent-mint`, `--accent-peach`, `--accent-lavender`, `--accent-sky`, `--accent-amber`, `--accent-rose`, `--accent-coral` colour avatars, folders, reactions and the tone of an informational mark (amber: an update or an approval waiting; rose: a destructive action or a mute). They are not a second signal. `--status-online`, `--status-idle`, `--status-dnd` and `--status-offline` colour presence, and `--status-streaming`, a purple of its own, the dot of someone streaming now (activity-presence.md, "Streaming on the dot"); `html[data-status-palette='accessible']` swaps them for a palette that does not depend on telling red from green.

### Variants
- `html[data-contrast='high']` (Settings → Appearance → Higher contrast) lifts the quiet text, the hairlines and the muted control tone, and takes the grain, the light and the metal away.
- Surface themes (Settings → Appearance → Theme, `utils/appTheme.ts`). Carbon is the stylesheet as shipped and sets nothing; `CARBON_SETTINGS` (hue 0, strength 0, depth 0: grey at no strength) is the point that reproduces it, for its swatch and as the start of a person's own theme. Every other theme is a point (hue, strength, depth from −3 to 4) from which each surface is derived at the luminance its depth asks for, and the quiet text is lifted to keep the contrast it has on Carbon's floating panel. The canvas is pure black, which has no luminance to scale, so it stays black in every theme: a theme colours what stands on it (the wells, the frames, the lines, what floats). `appTheme.test.ts` checks every corner of the ranges and `carbonSync.test.ts` holds `CARBON_SURFACES` to the stylesheet. The ranges are `SURFACE_RANGES` in `packages/shared/src/looks.ts`, shared with the server, which checks a space's look against the same ones.
- A space's colours (see Looks): in a space that chose them, its surfaces and accent take the place of the person's own while they are in it, unless they switched that off.

### Light

Light is what the look is made of, and all of it is paint over real content, never content:

| What | Where | How |
|------|-------|-----|
| Film grain | Over the whole window (`html body::after`, `--grain-film`, 7% in `overlay`) | Keeps pure black from reading as a switched-off screen |
| The frame's light | `.surface-card` | `--frame-light`, a faint white glow from the top left corner, and under the pointer a soft spot where the pointer is (`--pointer-x`, `--pointer-y` from `utils/pointerLight.ts`) |
| `ui/LightField.tsx` | Behind the opening of a page | A canvas of fine light threads that flow like fabric, thirty frames a second, resting while off screen or in a hidden tab. `intensity="quiet"` (one dim band along the far side) in `ui/PageHeader`; `"hero"` (three bands) on Home's opening and on the pages outside the app (`light-field-window` fixes it to the window); `light-field-top` lays it across the top of a page with no header (a legal text, the bot portal) |
| `ui/PointerAura.tsx` | Once, in `App.tsx` | A ring of light that trails a mouse a breath behind it and opens over what can be pressed. The cursor stays. It rests when the pointer does, and is not there on a touch screen |
| `ui/ChromeWord.tsx` | The sign-in's aside | The product's name in extruded, polished chrome, each letter at its own angle, a few edges catching the light. One per view. The metal face is painted from the letter itself (`data-letter`), so the word stands in the page's text once |
| `.chrome-text`, `.stat-value` | The name in Home's greeting, the figure of a stat tile | A sheen of polished metal on the largest words and numbers |
| `.go-chip` + `.go-host` | A way onward: Home's stat tiles and space cards, the main action | The arrow in its round chip turns up and fills with the signal when what it stands in is pointed at |
| `--shadow-glow` | `.btn-primary`, `.btn-hero` under the pointer | The white button's glow |

`.lit` stays on the panels as the hook through which `--place-target` (the colour of the place, set by `layout/AmbientLight.tsx`) is read. `.stage-light` (the pages outside the app) and `.panel-light` (a settings dialog's content column) remain; `.hero-light` is hidden. Everything in this section is off under `html[data-light='off']` (Settings → Appearance → Light), `html[data-contrast='high']` and forced colours, and stands still under Reduce motion and `prefers-reduced-motion` (the light field then draws one frame, the ring is not there).

### Where the signal may appear
- The selected or active place: the ring round the tile of the place you are in (the dock), the 2px edge of a selected `.nav-item` (on the column's own edge in the sidebar), a chosen option card or theme.
- Counts of what waits for you: unread direct messages (Home's tile), mentions (the inbox bell, a space's card on Home). Counts of activity are neutral figures (`.count-badge-muted`).
- Controls that are on: a switch, the filled part of a slider, a checked box, a call control that is on and going out.
- The one thing a form or a page is for: the white button (`.btn-primary`, `.btn-hero`).
- A state of the app's own that is on: streamer mode's badge.
- A message that mentions you (its edge and tint), your own reaction (`.glass-pill-mine`).
- Keyboard focus and selected text.

Never: a whole row's solid fill, an unread dot with no count (that dot is neutral, `bg-txt-primary`), two white buttons side by side (the second is `.btn-outline`), decoration that could be taken for a state.

---

## Native controls

`input[type='checkbox']` and `input[type='radio']` are drawn by the base layer (a 16px sunken box edged like a field, the signal while on with its mark in `--on-accent`), so every form gets them without a class; size and margin utilities beside them still win. A `select.input-*` gets the app's own arrow in place of the system's.

## Brand

The mark is a slanted T inside a thin ring. It is black and white everywhere: white on black, never tinted, never on a coloured tile. Up to 32 px it is the T alone (`/icons/logo-mark.svg`, the top bar's left end, the favicons), because the ring disappears at that size; larger it carries the ring (`/icons/mark.svg`). The masters live in `assets/brand/` and every favicon, PWA icon, tray icon and desktop build icon is generated from them with `pnpm gen-icons`; outputs are never hand-edited. The app-icon family (`app-icon.svg`, `app-icon-small.svg`) puts the white mark on a near-black rounded square; that ground belongs to the icon artwork, not to the interface palette above.

The product name "Tavvit" is fixed; the instance name (the browser tab, the sign-in page) is the administrator's.

---

## Shape

Every radius utility is multiplied by `--radius-scale` (Settings → Appearance → Corners: sharp 0, standard 1, round 1.5), so one number sharpens or softens the whole app; `--radius-pill` (`rounded-pill`) is scaled with it, so "sharp" squares the pills too.

| Corner | Utility | Use |
|--------|---------|-----|
| 6px | `rounded-sm` | Keys, small glyphs, swatches, hairline marks |
| 8px | `rounded` | Small pictures and marks inside a row |
| 16px | `rounded-md` | Navigation rows, list rows, menu rows, a multi-line field, code blocks |
| 24px | `rounded-lg` | Frames: panels, cards, menus, popovers, dialogs, toasts (`--panel-radius`) |
| 28px, 32px, 40px | `rounded-xl`, `rounded-2xl`, `rounded-3xl` | Larger frames and picture tiles |
| pill | `rounded-pill` | Buttons, icon buttons, fields, tags, counts, the composer, the segmented control, the action bar |
| round | `rounded-full` | Avatars (their own roundness setting), status dots, the switch, the chip of an arrow |

A dock tile is 44px with a 14px corner (its ring 17px), a stat tile 20px.

## Type

| Role | How |
|------|-----|
| The opening of a page | `.display-title` (36px, 600, −0.045em, line height 1) in `ui/PageHeader`, rising out of a clip once (`.kinetic`); `.display-hero` adds size (up to 5.75rem) where there is next to nothing else, as on the sign-in; `.home-greeting` (up to 4.5rem) on Home |
| Settings-panel and dialog-section titles | `.page-title`: 22px, 600, −0.035em |
| Dialog titles | 18px, 600 (the `Modal` header, `ConfirmDialog`) |
| Panel heads | `.panel-head-title`: 15px, 600, −0.03em; beside it `.panel-head-meta`, 12px tertiary |
| The label that opens a section | `.eyebrow`: 11px JetBrains Mono, 500, capitals, 0.14em, behind the turning spark |
| Group names, column heads, the name of a figure | `.label-mono`: 11px JetBrains Mono, 500, capitals, 0.14em (`--tracking-label`), `--text-category` |
| A figure | `.stat-value`: 34px, 600, −0.045em, in metal; proportional figures |
| Form field names | `.field-label`: 12px, 500, sentence case, `--text-secondary`, 6px above the field |
| Row titles | `text-ui` (13px) medium, `text-txt-primary` |
| Secondary lines | `text-meta` (12px), `text-txt-tertiary` or `text-txt-secondary` |
| Times, counts, sizes, hosts | `font-mono`, `.tabular` (tabular figures; `<time>` gets them by default) |
| Message text | `.message-text`: 15px × the chat text size (Settings → Appearance → Reading) |
| Markdown in a message | `.md-h1` to `.md-h3`, `.md-code`, `.md-code-block` (a frame with a head strip naming the language and copying the code, `.md-code-head`, `.md-code-copy`, over `.md-code-body`), `.md-jumbo` |

The display face has no glyphs for Chinese: `:root:lang(zh)` sets titles in the platform's own face without the tight tracking.

### The type scale

Tailwind's `fontSize` in `tailwind.config.js`, a size each with no line height of its own (a `leading-*` utility sets one where it matters): `text-2xs` 10px, `text-label` 11px, `text-meta` 12px, `text-ui` 13px, `text-body` 14px, `text-lead` 15px, `text-title` 18px, and Tailwind's own `text-base` 16px, `text-xl` 20px, `text-2xl` 24px from there up. Write these, not `text-[13px]`; half pixels are gone. Weights: 400, 500 and 600, `font-bold` is not used.

## States

| State | Look |
|-------|------|
| Hover | `--interactive-hover` veil; text steps up to `--text-primary`; a hairline steps up to `--interactive-muted`; a button's fill rises from its foot; a frame catches the pointer's light |
| Pressed | `--interactive-active` fill (`.nav-item`, `.list-row`, `.icon-btn`, `.btn-quiet`, tabs); a button settles a pixel |
| Selected / active | `--interactive-selected` fill and `--text-primary`, plus the white edge: a 2px bar on the left of a `.nav-item`, a 2px line under a tab; option cards take a white border |
| Unread | `--text-primary` and weight 600 (`data-unread="true"` on a `.nav-item`); a count when the server sent one (`.count-badge`), otherwise a 6px neutral dot |
| Muted | The count in `.count-badge-muted` |
| Focus | A 2px `--accent-primary-soft` outline, 2px out, for the keyboard only (`:focus-visible`, globals.css base layer); fields show their own white edge and ring instead |
| Disabled | 45–55% opacity (40% on icon buttons) and `cursor: not-allowed`; `disabled` or `aria-disabled="true"` |
| Loading | `aria-busy="true"` on a `.btn-*`: the label stays, a 12px ring turns beside it, the button stops answering |
| Error | `aria-invalid="true"` on `.input-standard` or `.input-search`: a rose edge |
| Mentioned | A message that reaches you (`data-mentioned` on `.msg-row`): a white veil and a 2px white edge, the same signal as the count that led there |
| Destructive | `.btn-danger` (solid red, `--danger-fill`, under white words); destructive menu items in `--text-danger` with a rose hover |

---

## Component classes

Defined in `@layer components` of `globals.css`, so a utility on the same element always wins. The hover rules guard `:disabled` inside `:where()`, which adds no specificity, so a `hover:` utility wins there too.

| Class | What it is | States |
|-------|-----------|--------|
| `.nav-item` | A row of any navigation list: 32px tall, 10px side padding, 10px gap, 16px corner, 13px regular `--text-secondary` | hover: veil + primary text; `data-active="true"` or `aria-current="page"`: selected fill + primary text + a 2px white edge, standing on the column's own edge inside `.sidebar-nav` (`--nav-edge`); `data-unread="true"`: primary text, 500 |
| `.list-row` | An interactive row of a list in the page: flex, 12px gap, 8px × 10px padding, 16px corner | hover: veil; `data-active="true"`: selected fill |
| `.icon-btn`, `.icon-btn-lg` | A round ghost button that is only an icon: 28px (32px), `--text-tertiary`. Its name is its `aria-label`, which "Tooltips" shows | hover: 9% white + primary icon; pressed: a pixel down; `data-active="true"`: selected fill |
| `.count-badge` | A count of what waits for you: a 16px pill, 10px JetBrains Mono in `--on-accent` on `--accent-primary` | springs in |
| `.count-badge-muted` | A count of activity: the figures alone, mono, tertiary; on a corner (`ring-2`) a small raised plate. `.count-badge-quiet` (via `CountBadge quiet`) for a muted place | |
| `.kbd` | A key: 20px, 6px corner, the strong edge on raised, 10px mono | |
| `.empty-state` + `-icon`, `-title`, `-body` | An empty list: the icon in a dashed 44px ink well (14px corner) with one white point at its corner, a 15px title, a 13px body | |
| `.page-title`, `.display-title`, `.display-hero`, `.label-mono`, `.eyebrow`, `.field-label` | See Type | |
| `.kinetic`, `.rise` (+ `.rise-2` to `.rise-4`), `.rise-in`, `.stagger` | What opens a page: a title rising out of a clip, one thing coming up by itself (each a beat after the one before), a group's children, a grid's cards one after another | once, `backwards` |
| `.chrome-word` + parts, `.chrome-text`, `.light-field` (+ `-window`, `-top`), `.pointer-aura`, `.go-chip`, `.go-host` | See Light | |
| `.btn-primary`, `.btn-outline`, `.btn-quiet`, `.btn-danger`, `.btn-hero` | One geometry (a 32px pill, 15px side padding, 13px medium) and one motion: a fill (`--pill-fill`) that rises from the foot under the pointer. The primary is white with black words and glows (the one thing a form or page is for), `.btn-outline` is edged by the hairline and fills white, turning its words black, `.btn-quiet` is words alone on a faint veil, `.btn-danger` solid red; `.btn-hero` is the primary of an opening page, with a `GoChip` where it leads somewhere | hover: the fill rises; pressed a pixel down; disabled 45–55%; `aria-busy` ring |
| `.btn-sm`, `.btn-lg` | 28px / 40px | |
| `.tag`, `.tag-uv`, `.tag-dashed` | A small label as a pill: 20px, mono 10px capitals; `-uv` the signal tint, `-dashed` for what is not live or not measured | |
| `.surface-card` | A frame: `--bg-panel`, the hairline, a 24px corner of its own (a `rounded-*` utility still wins), the light from its corner and, under the pointer, the pointer's. A frame that is a button or link answers the pointer with its edge; `.tinted-card` lights it in a place's own colour (`--tile`) | |
| `.panel-head`, `.panel-head-title`, `.panel-head-meta` | The head row of a panel: at least 52px, 20px side padding, the faint hairline under it | |
| `.page-tabs`, `.page-tab` | The tabs under a page's title: 40px, the type's colour when chosen with a 2px white line on the header's hairline | |
| `.side-panel-head` | The head row of the people column: what it holds and how many | |
| `.sidebar-search` | "Search or jump to…", a field-shaped button that opens the quick switcher | |
| `.space-dock`, `.dock-tile` (+ `-home`, `-action`, `-folder`, `-active`, `-merge`), `.dock-mark` | The dock of places in the sidebar (`layout/SpaceSidebar.tsx`): 44px tiles with a 14px corner that wrap, four to a row (three in the narrow sidebar, five in the wide one); Home on a raised tile, the ways to more (create, join, explore) dashed; the ring of the current place slides between tiles (`SlidingMark variant="tile"`) and glows a little | hover lifts two pixels; a drop's middle quarter merges into a folder (`-merge`) |
| `.space-head`, `.space-head-banner` | A space's card at the head of its channels: its banner as a 16:7 band, the row with its name, badges and invite under it | |
| `.home-hero`, `.home-greeting`, `.home-stats`, `.stat-tile` | Home's opening (`home/HomeHero.tsx`): the greeting at the size of a title page over the light field, and the page's figures as glass tiles (a mono name, the number in metal, the way to what it counts), two by two beside it and four in a row in a narrower window | a tile that leads somewhere lifts and its chip turns |
| `.home-spaces`, `.home-space` (+ `-name`, `-foot`, `-new`) | The spaces on Home (`home/HomeSpaceCard.tsx`): frames in a grid, each lit from its corner in the space's own colour, with its picture and what waits there, its name and what it is about, who is in its voice channels; `-new` is the dashed tile that offers to make or join one | lifts; its chip turns |
| `.forum-row`, `.forum-row-open` | A forum post as a row of the forum's one panel; the open one carries the white edge | |
| `.sliding-list` + `ui/SlidingMark.tsx` | The one mark of a list, sliding from the place you left to the place you chose: `row` (a lit row with its edge), `line` (under a tab, in the type's colour), `pill` (the raised part of a segmented control), `tile` (the dock's ring) | |
| `.action-bar` | The strip that carries a form's actions (Cancel / Save): the floating tone, the strong edge, a pill | |
| `.input-standard`, `.input-search`, `.input-embedded`, `.input-danger` | See Input Tiers | |
| `.glass`, `.glass-modal`, `.glass-bubble`, `.glass-pill`, `.glass-pill-mine`, `.glass-strip` | See Floating Layers | |
| `.card-grid` | See Layout | |
| `.badge-strip`, `.badge-mark`, `.badge-card`, `.space-tag`, `.thread-chip`, `.poll-option`, `.spoiler`, `.range-slider`, `.tab-strip`, `.typing-dot`, `.panel-bar`, `.banner-depth`, `.space-banner`, `.lift`, `.spotlight`, `.tinted-card`, `.stat-value`, `.chart-column`, `.chart-dot`, `.announcement` | As before (the sections below), in the new tones | |

Shared components built on these: `ui/PageHeader.tsx` (`PageHeader`: the eyebrow behind its spark, the title rising out of a clip, a line about it and the page's actions over a quiet light field, then tabs or filters; `PageBody`; `Panel`: a `<section>` named by its title with its head row), `ui/LightField.tsx`, `ui/PointerAura.tsx`, `ui/ChromeWord.tsx`, `home/HomeHero.tsx` (`HomeHero`, `GoChip`), `ui/CountBadge.tsx`, `ui/Toggle.tsx` (the switch: an 18 × 32 capsule on ink with the strong edge, the signal when on, a thumb in `--on-accent` that springs across), `ui/TriStateToggle.tsx`, `ui/Tooltip.tsx`, `ui/TooltipLayer.tsx`, `ui/SpaceBand.tsx`, `ui/ContextMenuRenderer.tsx` (menus as frames on the floating tone, 32px rows in regular weight), `ui/Modal.tsx` (a 56px head with the hairline and an 18px title, a 20px body), `ui/ConfirmDialog.tsx` (title and text over a footer on a strip of ink), `voice/VoiceRoomPreview.tsx` (a voice channel before joining: the space as eyebrow, the room's name as the title, who is in it with their pictures and how long it has been going, the one Join button, which says why it does nothing without the right to connect), and the settings controls in `modals/settingsPanels/_shared/SettingsControls.tsx` (`SettingsSection` is a panel with its head row; the settings navigation shows each tab with its icon).

---

## Tooltips

Every control that shows only an icon names itself in `aria-label`, and one layer for the whole app (`ui/TooltipLayer.tsx`, mounted once in `App.tsx`) shows that name on the app's own bubble when a mouse rests on it (300ms, at once when another closed a moment ago) or the keyboard reaches it (`:focus-visible`). The words are the name a screen reader already reads, so nothing is written or translated twice.

- **Who takes part:** an `.icon-btn`, or a control that carries `data-tooltip` (an icon-only control of another shape: a composer button, an emoji, a swatch, a voice control). `data-tooltip="off"` keeps one out, and so does anything inside a `Tooltip` of its own (`data-tooltip-owner`). A mark that is not a control (the gear inside a channel's row) gives its words as `data-tooltip="…"`.
- **What it says:** the name; `aria-describedby` adds a quieter second line (the inbox's count, why a watch control does nothing for this viewer, how a role's handle moves it); `data-tooltip-keys` a shortcut in `.kbd`; `data-tooltip-side` (on the control or around it) a side, "bottom" for the top bar.
- **When not:** a control that shows words of its own, one whose menu stands open (`aria-expanded="true"`), a touch, a device without hover, a phone. A press, Escape (until the pointer leaves and comes back), a scroll or the control leaving the page hides it.
- **Never a `title`** on such a control: the browser would add a second, late tooltip in the system's look. `TooltipLayer.test.tsx` reads every component and fails on a title on, or a missing name for, an icon-only control.

## Floating Layers

| Tier | Class | When to use |
|------|-------|-------------|
| Structural | `bg-surface-*` | Permanent layout (the topbar, the sidebar, the page, the people column) |
| Strip | `.glass-strip` | The phone's space strip (in `@layer utilities`, so it wins over `bg-surface-*`) |
| Bubble | `.glass-bubble` | Persistent controls above the content: the voice bar, the composer (on the panel tone), the voice mini-bar |
| Popover | `.glass` | Menus, popovers, tooltips, the folder flyout, the device menus, toasts |
| Modal | `.glass-modal` | Dialogs (on the panel tone), the quick switcher, the profile card |
| Pill | `.glass-pill` | Inline decorations (reactions, tags); `.glass-pill-mine` is the viewer's own reaction, in the signal |

Each is opaque: the floating tone (`--bg-elevated`) or, for a dialog and the composer, the panel tone, edged by the strong line (`--glass-border`, `--border-soft`), with a faint lit top edge (a dialog carries the frame's light from its corner too), and all but the pill cast `--shadow-popover` or `--shadow-modal`. The surface is drawn on a `::before` layer behind the content, so a `transform` or `filter` never makes the element the frame of a fixed child. What floats arrives with `floatIn` (3px and 1.5% smaller, under a fifth of a second), through the separate `translate` and `scale` properties, so a layer centred with a transform utility keeps its place. **Rule:** anything that floats above the content plane uses one of them, never `bg-surface-elevated` directly.

**Modal backdrops:** `.modal-scrim`: 80% black, no blur. It fades by itself, so a dialog's outer element carries no animation.

**Dialogs arrive and leave:** the panel has `.modal-panel` (or `.sheet-panel` on a phone) in place of `animate-slide-up`. `hooks/useExitGhost.ts`, used by `Modal` and `ConfirmDialog`, lets a dialog leave the way it came however it is closed: as it unmounts, an inert copy (no ids, nothing that would load again, hidden from assistive technology) plays `.modal-leaving` for 150ms. The real dialog is gone at once, so nothing has to stay mounted without its state, and no test or screen reader ever meets the copy. Elements that open and close constantly (menus, tooltips) have an entrance only: leaving at once is what makes them feel quick.

**Portal target — `usePortalContainer()`:** Every overlay (context menu, tooltip, popover, modal, screen-share picker) MUST portal through `usePortalContainer()` (`packages/web/src/hooks/usePortalContainer.ts`) instead of hard-coding `document.body`. The hook returns `document.fullscreenElement ?? document.body` and re-renders subscribers on `fullscreenchange`. Without this, anything portaled while an element (e.g. the voice container in fullscreen mode) is in the browser's Fullscreen API top-layer is rendered outside that layer and is invisible. Components mounted at App root that render with `fixed inset-0` (not just portals) must also portal through this hook for the same reason.

The shared `Modal` (`components/ui/Modal.tsx`) portals itself through this hook, so a caller mounts it wherever its state lives and never wraps it in another portal. Rendering in place is not safe: an ancestor with `transform`, `filter` or `backdrop-filter` becomes the containing block of a `fixed` element, and a dialog mounted inside the `.glass-strip` space strip rendered 72px wide. Overlays stack by portal order: a dialog or card opened from inside an open `Modal` is appended after it, so it draws above at the same `z-index`.

The floating layers use no `backdrop-filter`; Home's stat tiles do (`.stat-tile`, so the light behind them shows through softly). Wherever one is written, `-webkit-backdrop-filter` comes first and the unprefixed property last: Vite 8 minifies CSS with Lightning CSS, which folds the two into one and keeps whichever came last, and Firefox implements only the unprefixed form.

---

## Context menus

A right click never opens the browser's own menu, anywhere in the app, signed in or not. There is one menu: `ContextMenuRenderer`, mounted once in `App.tsx`, fed by `stores/contextMenuStore.ts`.

- **Things with a menu of their own** open it from their `onContextMenu` (calling `preventDefault` and `stopPropagation`). The shared builders, each a hook returning `{ open, dialogs }` (the caller renders `dialogs` once):
  - `layout/userMenu/useUserContextMenu` — a person: profile, message, the friendship action that fits (`memberMenu/memberSocialActions.ts`), copy username, block (confirmed) or unblock. Friends on Home, "Active now", the Friends page.
  - `layout/memberMenu/useMemberContextMenu` — a member of the open space: the above plus nickname, roles, timeout, kick, ban.
  - `layout/conversationMenu/useConversationContextMenu` — `openDm` (mark read, profile, call, copy username, close the DM or leave the group), `openChannel` (mark read, notification settings, copy link, edit channel), `openMention` (jump to the message, mark read, copy a message link). Sidebar rows, Home, the inbox, the channel and DM headers.
  - `layout/spaceMenu/useSpaceContextMenu` — a space: mark read, invite, notification settings, transfer ownership or leave. The space tabs and Home's space cards.
  - Messages, images, reactions, voice members, streams and the categories keep their own builders (`chat/messageMenuItems.tsx`, `chat/imageMenuItems.tsx`, `voice/voiceMenuItems.tsx`, …). A mention badge offers profile, a mention in the composer and the username.
- **Everything else** goes through `ui/globalContextMenu.ts`: a capture-phase listener cancels the browser's menu before any element sees the event, and a document-level one opens the fallback only when no element opened a menu for that click:
  - a text field: Cut, Copy, Paste, Select All. In the desktop app the page lets the click through for a text field only, and the app reports the spelling suggestions (`edit-context-menu`, desktop.md) for the same menu in Tavvit's look, with the commands run by the app (`edit-command`, `replace-misspelling`, `add-to-dictionary`). A shell without that bridge gets the browser version.
  - selected text: Copy. A link: Open Link, Copy Link.
  - a plain surface: nothing at all.
- Phones keep their long press: the fallback is off in the mobile layout, and `useGlobalLongPress` turns a long press into the same `contextmenu` event for the elements that have a menu.
- Items are Title Case in English, sentence case in the other languages; the strings are in `common:contextMenu`.

---

## Input Tiers

All defined in `globals.css`. A field is a pill on ink (`--bg-input`) with a resting hairline edge that steps up to `--interactive-muted` under the pointer; with focus the edge turns white with a soft ring of the same. A one-line field is fully round, as the button beside it; a `textarea` takes a 14px corner.

| Tier | Class | When to use | Focus |
|------|-------|-------------|-------|
| Standard | `.input-standard` | Form fields in dialogs, settings, sign-in | white edge + a soft white ring |
| Search | `.input-search` | Search bars, filter inputs (`py-1.5`) | white edge + a soft white ring |
| Embedded | `.input-embedded` | Inside a container that already draws the field (the composer, the quick switcher) | none |
| Danger | `.input-danger` | Destructive confirmations | rose edge + `ring-1` rose/40 |

Override padding and size with utilities: `input-standard w-full py-2.5`.

The sidebar's search trigger (`.sidebar-search`) is not a field but looks like one: a 32px pill on the panel tone with the hairline edge, the search icon, the words and the shortcut in a `.kbd`.

### iOS Auto-Zoom Suppression

iOS Safari auto-zooms (and shifts the viewport right) on input focus when the computed `font-size` is below 16px. The `html[data-viewport="mobile"]` rule in `globals.css` bumps every input tier — and bare `<input>`/`<textarea>`/`<select>` plus `[contenteditable]` — to `font-size: 16px !important`.

`!important` is required because Tailwind utilities like `text-lead` (used on the chat composer textarea) and `text-sm` (used on form fields) are emitted in the `@layer utilities` block, which comes after `@layer components` in the cascade and would otherwise override the input-tier rules. There is no legitimate reason to use a `<16px` font-size on a mobile input, so the override is universally correct.

When introducing a new input or contenteditable surface, no extra work is needed — the global rule covers it.

---

## Unread and attention indicators

| Mark | Meaning | Used by |
|------|---------|---------|
| `.count-badge` (the signal) | Someone is waiting on you: unread messages, mentions, the inbox | the tabs of the top bar (a space's count, Home's direct-message count), the inbox bell, the folder flyout, Home's lists (`ui/CountBadge.tsx`, `layout/SpaceUnreadBadge.tsx`) |
| `.count-badge-muted` (neutral) | The same count in a place you muted | a muted space's tab and rows |
| A 6px neutral dot | Something new where the server sent no count | a tab or a folder with unread channels, the quick switcher's rows |
| Primary text, weight 600 | This row or tab has something you have not seen | `.nav-item[data-unread="true"]`, the tabs |
| `accent-amber` | Informational, nobody is blocked: a transfer under way, a connection that is out | `TransferIndicator`, `ConnectionChips`, a remote space's tab |

Exception: the mobile bottom-nav "You" tab (`MobileBottomNav.tsx`) ORs the
update dot into its existing dot rather than showing a separate amber
one. That tab already means "something of yours needs attention" for incoming
friend/DM activity, and splitting one dot into two colours by cause would read
worse than a single dot with mixed causes — this is a deliberate exception to
the amber-means-update rule above, not a bug.

---

## Layout

The desktop shell (`components/layout/AppLayout.tsx`, Evolve's frame), on the canvas:

- **The sidebar** (`ChannelSidebar.tsx`, ink, `--sidebar-width`, full height, a hairline on its right), top to bottom:
  - `InstanceSwitcher.tsx`: the server this app speaks for (the mark in a raised square, its name, its host in mono), a 56px row whose hairline continues the topbar's; its menu holds Explore, Create a space, Join a space, About, the admin console, Settings and Log out.
  - The dock (`SpaceSidebar.tsx`): Home and the spaces and folders as 44px tiles, in the person's order, wrapping four to a row; then Create, Join and Explore as dashed tiles. A tile's corner carries its count: Home's direct messages in the signal, a space's activity as neutral figures (a muted space quieter still), a dot where there is news without a count. Dragging reorders: the left or right quarter of a tile puts the dragged one before or after, the middle merges into a folder. A folder opens its flyout under its tile.
  - `SidebarSearch`: "Search or jump to…" with the shortcut; it opens the quick switcher.
  - What the place holds, scrolling (`.sidebar-nav`): in a space its card (`.space-head`: banner band, name, badges, settings, invite), Events and the channels by category; on Home the Home rows (Home, Inbox, Friends, More) and the direct messages with their search and filter.
  - The call you are in (`VoiceControls`), then `UserControls.tsx`: your picture, name and handle (your profile card), the microphone and headphones each with its device menu (opening upward), the settings.
- **The page column**: `AppTopbar.tsx` (56px, the canvas, a hairline under it) over the page and, on the right, the people column.
  - The topbar holds where you are as a breadcrumb (the instance's host in mono, the space with its glyph, the channel with its icon and topic) and the page's actions (pins, threads, search, notifications, the people toggle), then the inbox bell with its count, the review queue of an administrator and streamer mode's badge. A page hands its breadcrumb and actions to the bar through `TopbarLead` and `TopbarActions` (`layout/TopbarSlots.tsx`, portals, so the buttons keep their state and the popovers anchored to them); a page that hands none shows the route's name. `PageBar` draws a bar of the page's own where there is no topbar (a test, a page shown alone); `Crumb`, `CrumbSep` and `layout/PlaceCrumbs.tsx` (`SpaceCrumbs`, `DmCrumbs`) build the trail.
  - The page: a conversation directly under the bar; a page of its own (the inbox, Friends, Explore, a space's events) opens with `PageHeader` and holds panels (`PageBody`, `Panel`). Home opens larger, with `HomeHero` (the greeting, the page's figures), then its spaces as cards and its panels. The admin console's navigation is a list inside its page beside its panels.
  - **The people column** (`SidePanel.tsx`, ink, `--sidebar-width`, a hairline on its left): the members of a space under a head with their count, the friends' activity on Home, a group's people. In a compact window it floats over the page's right edge with the popover shadow.

`--sidebar-width` is 256px (216px narrow, 296px wide: Settings → Appearance → Shape); `--topbar-height` is 56px. The phone has its own shell (`docs/systems/mobile-ui.md`).

User settings and space settings (`modals/UserSettings.tsx`, `modals/SpaceSettings.tsx`) keep their dialog: a navigation column on ink (each tab with its icon, mono group names, Log out in the danger colour at the foot) and the panel at most 640px wide, its sections as panels with head rows.

Card lists (Explore's Inner and Outer Space sections, the Friends page's discover list) share `.card-grid`: one full-width column below the desktop breakpoint, and above it `repeat(auto-fill, minmax(min(100%, 280px), 1fr))` with a 1rem gap (`auto-fill`, not `auto-fit`, so a lone card keeps a card's width).

---

## Shadows

| Name | Use |
|------|-----|
| `--shadow-popover` (`shadow-elevation-high`, `shadow-glass`) | Menus, popovers, toasts, the compact right column: `0 12px 32px` at 50% black, a closer one under it, a lit top edge |
| `--shadow-modal` | Dialogs: `0 40px 90px -30px` at 95% black and a lit top edge |
| `--shadow-glow` (`shadow-glow`) | The white button under the pointer: a 1px ring of 50% white and `0 12px 44px -10px` of white light |
| `--shadow-raised` (`shadow-raised`) | A raised control on a panel: a lit top edge and a short shadow |
| `elevation-low` | A 1px lift for a tile on another surface |
| `header`, `input` | `none`: bars and fields never cast one |

---

## Animations

### Tokens
`--ease-out` (`cubic-bezier(.16, 1, .3, 1)`, for anything arriving), `--ease-expo` (`cubic-bezier(.19, 1, .22, 1)`, the long curve of the look: a title rising, a button's fill, a chip turning), `--ease-standard` (`cubic-bezier(.2, 0, 0, 1)`, for state changes: hovers, edges), `--ease-spring` (a sampled spring through `linear()` where the browser has it, a bezier otherwise, for small things that may overshoot), `--dur-fast` 120ms, `--dur-base` 200ms, `--dur-slow` 320ms, `--dur-slower` 520ms. Fill with `backwards`, never `both`, on anything that can hold a `fixed` child or a dialog: a filled transform leaves a containing block behind.

### What moves
| Class or hook | What it does |
|---------------|--------------|
| `usePlaceEntrance` (`layout/PlaceStage.tsx`) | The middle of the window comes up 6px when the place changes. The element stays mounted (a key would throw away a message list and its scroll position) and nothing is left behind when it ends. |
| `.kinetic` | The title that opens a page rises out of a clip, once (900ms on `--ease-expo`) |
| `.rise`, `.rise-in`, `.stagger` | What opens a page rises 22–24px and fades in: `.rise` the element itself (`.rise-2` to `.rise-4` each a beat later), `.rise-in` its children, `.stagger` its children 40ms apart, up to 320ms |
| `ui/LightField`, `ui/PointerAura`, `.chrome-letter`, `.chrome-text`, `.eyebrow::before` | The light: threads that flow, the ring that trails the pointer, metal that shifts, the spark that turns. See Light |
| `.btn-*`, `.go-chip` | A button's fill rising from its foot, the arrow's chip turning up |
| `.modal-panel`, `.sheet-panel`, `.modal-leaving`, `.modal-scrim` | See Floating Layers |
| `.animate-pop` | A small card springing out of what opened it: the profile card, a badge's card |
| `.animate-toast` | A toast, up from the bottom edge with a small spring |
| `.bump` + `useBump` | A number that just changed (a count, a reaction's), or a reaction just added, gives a small jump. `useBump` used as a `key` restarts it on each change and leaves out the first render. |
| `.msg-new` | A message that just arrived rises 8px. Decided once when its row mounts (`JUST_ARRIVED_MS`). My own rises when I send it and not again when the server's copy replaces it. |
| `.scroll-away` | The words of a page's opening recede as the page scrolls, where the browser can tie an animation to scrolling (`animation-timeline: scroll()`) |
| `.lift`, `.toggle-thumb`, `.btn-*:active`, `SlidingMark` | Under the pointer; see Component classes |

### Core
`fadeIn`, `slideUp` (small things that float settle into place), `slideDown`, `typingFadeIn`, `gradientPulse`, `shimmer` (skeleton loading)

### Search and jump
`message-jump-flash` (class `.message-jump-highlight`: the row a search result or reply preview jumped to), `stepForward`, `stepBack`

### Call and empty states
`callRing` (`.call-ring-dot`), `orbitArtSpin` and `orbitArtTwinkle` (`OrbitArt`); all stop under `prefers-reduced-motion`

### Mobile
`mobile-screen-enter`, `mobile-screen-enter-active`, `mobile-screen-exit-active`, `slide-up-sheet`

### Skeleton Loading
`.skeleton`, `.skeleton-circle`, `.skeleton-bar`, `.skeleton-block`

Settings → Appearance → Reduce motion (`html[data-motion='reduce']`) cuts every animation and transition down whatever the system asks for, and `prefers-reduced-motion` does the same for what the stylesheet and `utils/motion.ts` start; the light field then draws one still frame and the pointer's ring is not there. While the app's script loads, `.boot-mark` in `index.html` shows the logo after a moment's wait; React replaces it with the first render.

---

## Utility Classes

- `.no-scrollbar` — Hides scrollbars
- The product page has its own stylesheet and classes (`landing/landing.css`, `.lp-*`), because its bundle carries none of the app's. It wears the same look at the size of a page; see [landing.md](landing.md), "Design". The developer docs do the same in `developers/assets/docs.css` ([developers.md](developers.md)).
- `.scrollbar-thin` — 4px thin scrollbars (the default bar is 8px with a 2px inset thumb in `--border-soft`, `--interactive-muted` under the pointer)
- `.divider-fade` — A 1px `--border-hard` line
- `.rounded-inherit` — Inherits border radius
- `.tabular` — Tabular figures
- `.titlebar-drag` / `.titlebar-no-drag` — Electron window drag

---

## Primitives

### Radial Progress Ring

Used in `AttachmentProgress` overlays inside the optimistic bubble and the staged-files row. Implementation:

```css
background: conic-gradient(rgb(var(--text-primary)) <pct>%, rgb(255 255 255 / 0.15) <pct>%);
```

The ring is neutral, `--text-tertiary` while paused. The inner disk is the opaque `bg-surface-input`, so the ring reads as a ring over any thumbnail, on a `bg-black/70` veil over the tile. The failed ring is `bg-accent-rose/30` around the alert icon, and the tile says why (`transferStore`'s `uploadFailure` keeps the words for a person; the protocol's message goes to the console).

### CountBadge

`ui/CountBadge.tsx` draws a count as `.count-badge` (or `.count-badge-muted` with `muted`): the figures up to 99, then "99+" (`countDigits`). With `label` the figures are hidden from assistive technology and the label ("12 unread messages") is read instead; leave `label` out where the control around the badge already says the count in its own name (the inbox bell). `placement="inline"` runs in a line; `placement="corner"` sits on the top-right corner of a `relative` icon button or tile, cut out by a 2px ring of `--bg-base`.

### AvatarStack

Reusable group-DM identity widget at `packages/web/src/components/ui/AvatarStack.tsx`. Replaces the bespoke inline avatar logic that previously lived in `DmListItem`. Single source of truth for any rendered group-DM identity slot — sidebar rows, chat header, welcome header, settings modal hero, and mobile equivalents all consume it.

```ts
interface AvatarStackProps {
  members: User[];                        // already filtered to "other" members
  size: number;                           // outer box edge length in px (24, 32, 40, 56, 80)
  border: 'channel' | 'chat' | 'modal';   // surface tier the stack sits on; controls tile border color
  iconUrl?: string | null;                // when set, renders the icon as a single image and ignores the stack
}
```

**Layout rules** (chosen by `members.length`, ignored entirely when `iconUrl` is set):

| Member count | Layout | `data-avatar-stack-layout` |
|---|---|---|
| 0 | Empty placeholder + small 12×12 group badge bottom-right | — |
| 1 | Single avatar centered in the box + 12×12 group badge bottom-right (distinguishes a 1-other-member group from a 1-on-1 DM) | — |
| 2 | Two avatars at 70% size with a 30% offset overlap (z-stacked) | `overlap` |
| 3 | Equilateral-triangle huddle: three 62%-size tiles arranged radially (top, bottom-right, bottom-left), neighbors overlap | `triangle` |
| 4 | Diamond huddle: four 58%-size tiles at the four cardinal points (top, right, bottom, left), neighbors overlap | `diamond` |
| 5-10 | Diamond huddle: three 58%-size tiles at the top/right/left points + a `+N` overflow tile occupying the bottom point, where `N = members.length - 3` | `diamond` |

**3+ member geometry.** Tiles are positioned radially around the box center on a circle of radius `R = (S − T) / 2`, where `S` is the box edge length and `T` is the tile size (`0.62·S` for 3 members, `0.58·S` for 4+). The first slot starts at `−90°` (top) and remaining slots are evenly spaced clockwise (`360° / slotCount` apart). This makes the farthest edges of each tile graze the box's bounding rect — no clipping, no wasted whitespace — and produces the same "huddle of overlapping faces" aesthetic as the 2-member overlap pattern at every member count. Z-index descends clockwise from the top slot so each tile tucks slightly under its clockwise neighbor (mirrors the 2-member case where the first tile sits on top of the second). The `+N` overflow tile always occupies the bottom diamond slot — reads as "more members behind these three" rather than "+N is one of the people".

`iconUrl` accepts a bare filename (resolved to `/api/uploads/<filename>`) or an absolute URL (`http`, `blob:`, `data:`, or `/`-prefixed) — passed through unchanged. When set, the entire box renders as a single rounded `<img>` filling the box.

**Status dots are deliberately omitted** regardless of member count — a group is a group. The 1-on-1 path keeps its presence dot via the direct `Avatar` component.

**Hooks-in-loop safety:** each rendered slot is its own `<AvatarTile>` component so `useCanonicalUserView` is called exactly once per slot, never inside a variable-length `.map()`.

### Avatar vs ProfileAvatar

Two components, one deliberate split:

| Component | Role |
|---|---|
| `Avatar` (`ui/Avatar.tsx`) | Purely presentational. Takes `user` for the gradient, avatar colour, `homeUserId` and status dot. Clicking it does nothing unless the caller passes `onClick`. |
| `ProfileAvatar` (`ui/ProfileAvatar.tsx`) | `Avatar` plus the profile card. Opens `UserProfilePopout` anchored to its own box, stops propagation so it wins over an enclosing row handler, and stays inert while `user` is undefined. |

**Rule:** an avatar is only a profile trigger when it is a `ProfileAvatar`. Never re-add an implicit "open the profile if a `user` prop is present" branch to `Avatar` — passing `user` is how *every* avatar gets its colour, so that branch silently turns the picture inside the profile card, the settings preview, the avatar-upload button and every row in a modal into a trigger. It also made the card re-anchor to its own picture and walk across the screen on repeated clicks (issue #37).

Use `ProfileAvatar` when the avatar is the primary way to reach that person's profile and nothing else owns the click. Use `Avatar` when an enclosing row, button or list item already handles clicks, or when the avatar depicts the surface it already sits on.

**Spaces through `Avatar`.** A space drawn with `Avatar` (the space settings header, the join page, the invite card in chat) passes `palette="space"`, the space id as `userId` and the space's `avatarColor`. The initials fallback then comes from `getSpaceGradient`, the function the space sidebar and every other space icon use, so a space has one colour everywhere. The default `palette="user"` uses `getAvatarGradient`, whose presets and hash order differ (`rose` and `coral` are other gradients, and a space with no stored colour hashes to a different preset).

**Escalation chain.** Clicking a face always moves one step deeper, never sideways and never nowhere:

| Surface | Picture click |
|---|---|
| Member tile / row / message author | Opens the preview card (`UserProfilePopout`) |
| Preview card | Opens the full profile modal (`UserProfileModal`) and closes the card |
| Full profile modal | Nothing — this is the terminus |

The middle step matters: an inert picture on the preview card is a dead end that forces the user down to the *View Full Profile* link. What it must never do is reopen the card itself — that is the drift bug from issue #37.

### Floating placement

Every floating surface places itself with `computeFloatingPosition` (`hooks/useFloatingPosition.ts`): preferred side → flip when it would overflow → clamp into the viewport, with an 8px viewport padding.

- Components with a live anchor element use the `useFloatingPosition` hook (tooltips, mention/search popovers, voice popovers).
- Components opened from a store keep the anchor's **rect** instead of an element — `uiStore.openUserProfile(user, anchor, placement)` stores `AnchorRect` + `Placement`, and `UserProfilePopout` measures itself and places off that. `pointAnchor(x, y)` builds a zero-size rect for the rare caller with no anchor element.
- `align: 'start'` lines the surface's leading edge up with the anchor; the default centres it on the anchor.

**Callers never compute coordinates.** A surface that is handed a finished `{ top, left }` cannot account for its own measured size, and any caller-side constant (an assumed card height, a hardcoded sidebar width) drifts the moment the content or the layout changes.

**Tile geometry contract.** Each `AvatarTile` renders at `size × size` with a 2px border (`box-sizing: border-box` from Tailwind preflight), so its content area is `(size − 4) × (size − 4)`. The inner `Avatar` is sized to that content area (`size − 2 · TILE_BORDER_WIDTH`) and centered geometrically on the tile via `flex items-center justify-center`, **not** by inline-flow placement. Both corrections are required: sizing the Avatar to the outer dimensions overflows the padding box and gets clipped off-center (visible disc remains centered, but the avatar's contents — image crop, initials gradient + letter — anchor at the padding-edge top-left and visibly drift toward the lower-right of the visible disc); relying on `Avatar`'s `inline-flex` placement makes the Avatar drift vertically by whatever the inherited `line-height` adds, independent of border. `TILE_BORDER_WIDTH` is exported from `AvatarStack.tsx` as the single source of truth for the `border-2` width and must be updated in lockstep with any future change to that class.

**Border tiers:** the surface tier the stack sits on determines the tile border color (so the tiles cleanly separate from the panel they overlap). `channel` → `border-surface-channel` (sidebar, the phone's DM list and group info hero); `chat` → `border-surface-chat` (chat area / welcome header / chat header); `modal` → `border-surface-elevated` (modal hero — there is no `surface-modal` token in `tailwind.config.js`).

**Usage sites:**

| Site | Size | Border | Notes |
|---|---|---|---|
| `DmListItem.tsx` (sidebar row) | 32 | `channel` | Pinned to the DM sidebar; `iconUrl={dm.icon}` |
| `DmSearchBar.tsx` (search result row) | 24 | `modal` | On the dropdown's floating surface; `iconUrl={dm.icon}` |
| `MessageList.tsx` `WelcomeHeader` (group-DM branch) | 80 | `chat` | Large hero on the empty-state header |
| `MainContent.tsx` chat header (group-DM branch) | 32 | `chat` | Replaces the people-icon for group DMs |
| `GroupDmSettings.tsx` (modal hero + member-row previews) | varies | `modal` | Modal Overview tab |
| `MobileGroupDmInfo.tsx` (pushed-screen hero) | 80 | `channel` | Mobile info screen hero |
| `MobileDmsScreen.tsx` (DM list rows) | 40 | `channel` | Mobile sidebar parity with desktop `DmListItem` |

## Legal text

`.legal-text` sets a legal document's Markdown for reading: 14px, 1.6 line height, headings in the primary text colour. Used by the public legal pages and the terms dialog.

## Message tools (1.23.0)

`.spoiler` is text covered until a reader asks (`data-revealed` once they did), `.spoiler-cover` and `.spoiler-cover-label` the same for a picture or video, in the box the real one will take so nothing moves. `.poll-option` is one answer of a poll: `--poll-share` draws its share behind it once the count may be seen, `data-mine` marks the reader's own in the accent. `.msg-pick` is a row's box while messages are being picked (`data-selecting`, `data-picked` on `.msg-row`). The icons `pin`, `forward`, `poll` and `eye-off` are in `ui/Icon`.

`.thread-chip` is the way into a thread, under the message it grew from: its name, how much was said and when. A count of upcoming events uses `CountBadge muted`: it is no unread state, so it does not take the signal colour.

## Profile decorations (1.36.0, drawn since 1.37.1)

Frames, profile effects and nameplates are drawings of things (`components/ui/decorationArt.tsx`, decorations.md), placed and moved by `styles/decorations.css`: flat shapes in two or three tones with a darker outline of the same hue, lit from the upper left like the rest of the app. They are the one place the interface draws pictures rather than surfaces, and they keep a rule of their own: no glow, no blur, no neon, nothing generated-looking; a sparkle or a star is a drawn shape with an outline. Name styles are a typeface and colour, a printed look or motion in the letters, never a glow round them.

- `.deco-art` is a frame's drawing round an `Avatar` (`frame`, `frameMotion`), a view a fifth larger than the picture, in a layer behind it (`data-layer="back"`, `z-index: -1` in the avatar, which is `isolate` while it wears one) and one in front.
- `.deco-effect` lies over the whole profile card, last in it (`ProfileEffectLayer` with `z-20`), taking no pointer; it measures itself (`container-type: size`) and a picker's tile halves it (`--deco-scale`). What moves in it wears a sprite (`--sprite-a/b/c`).
- `.deco-nameplate` lies at `z-index: -1` in a row that is `relative isolate`: over the row's background, hover and selection, under its content (`NameplateLayer`); its scene stands at the far end (`.deco-art-scene`, `.deco-plate-field`).
- `.deco-name` carries `data-name-font` and `data-name-effect` (`DecoratedName`); `.deco-name-letter` is one letter of a `wave`. A role's colour wins over the effect; the typeface stays.
- `data-motion`: `on` (a profile, a preview), `hover` (inside a `.deco-hover` row or message, moving only while it is pointed at or focused), `off`.

Reduce motion stills all of them and leaves out what only passes by. Higher contrast and forced colours leave out effects and nameplates and show a name in its plain colour; forced colours leave out frames too. Nothing here takes the signal: "Your colours" are the person's own.

## Space tags and the voice overlay (1.37.0)

`.space-tag` is a space's tag beside a name (space-tags.md): 16px tall, mono 10px, the tag's colour (`data-color`, the accent family or silver) as text on a 10% ground with a 32% hairline, a 4px radius scaled like the rest, no glow. It is a control (`role="button"`) that opens the space's card; `data-static="true"` draws the same mark where it is not one. It never takes the signal.

The voice overlay (voice-overlay.md, `overlay/overlay.css`) draws over a stream, not over the app's black: dark opaque labels for names, the status green as the ring of who speaks, the rose for a muted mark, and a transparent page. Its preview in the dialog stands on a checked ground for "transparent".

## Looks and the theme studio (1.41.0)

A **look** (`Look` in `utils/looks.ts`) is how the app is coloured and shaped, as one thing that can be named, kept, shared and offered by a space: the surfaces (hue, strength, depth), the accent (or none, for the instance's), the light, the corners, the typeface, the shape of pictures, the message style and the density. What helps a person read (contrast, text size, motion, the status palette, underlined links, the clock, the sidebar's width) is never part of one; putting a look on (`appearanceStore.putLook`) leaves all of it as it was. A look whose surfaces are exactly a ready-made theme's is that theme (`themeChoiceOf`), so wearing one keeps the person's own theme where it was.

**The studio** (`components/studio/LookStudio.tsx`, at `/studio`, signed in; Settings → Appearance opens it) is the Appearance controls for a look beside a sample conversation (`LookPreview`) drawn with the real classes (`.msg-row`, `.count-badge`, `.glass`, `.btn-primary`), so what is shown is what the app will be. At the top a look is kept under a name (`KeepLook`), or, when it already is, its link is copied. On the desktop the preview stands in its own column (`w-[min(440px,40%)]`); on the phone it comes under that row, above the kept looks and the controls. While it is open, a space's colours stand aside, so the person sees their own.

**Kept looks** (`stores/looksStore.ts`, persisted as `tavvit-looks` in this browser, at most `SAVED_LOOKS_MAX` = 30, never on a server) are named (`lookNameOf`: one line, control characters out, at most 40 characters). A card puts its look on with one click; its menu copies the link, renames it in place or deletes it with an undo.

**A look in a link** is `/look#1.<base64url JSON>` (`encodeLook`/`decodeLook`, the version before the dot, 2048 characters at most). The whole look is in the fragment, which a browser never sends to a server, so a link works on any instance and nothing is kept until someone puts it on. `decodeLook` reads a link as any look is read (`lookOf`): every part brought into its range or options, an accent dropped when white text cannot be read on it. The public page `components/studio/LookPage.tsx` shows the name, a `SurfaceSwatch` and what the look sets, offers "Use this look" (put on and kept) and says what stays the person's; it stands in `ui/PublicPageFrame` like the invite page, and works signed out.

**A space's colours** (spaces.md, "A space's look"): a space may choose a surface and an accent (`SpaceLook`, never the shape: that stays the reader's). `AppearanceController` shows them through `withSpaceLook` while the space is the current one, unless the person turned off Settings → Appearance → Spaces in their own colours (`spaceLooks`) or is in the studio. The accent a space chose replaces the person's and the instance's on its controls; a space that chose none leaves the person's.

`ui/SurfaceSwatch` is the one way to draw a surface as a small picture (frame, sidebar, content, floating panel, a stroke of the accent): the theme cards, the studio, the look page and the space's tab use it.

## Profile themes (1.41.2)

A person's profile theme is two colours (`accentColor`, `accentColorSecondary`) and how strongly they colour the profile card (`profileThemeStyle`, Settings → Account, under the colours; `utils/profileTheme.ts`). They are the person's own colours, not the signal, so they may be anywhere on their card.

| Strength | The card | Text stands on |
|----------|----------|----------------|
| `soft` (default, and what a theme always was) | A faint tint at its top and an edge in the first colour (`cardTint`, `cardEdge`) | The card |
| `strong` | The whole card a gradient of the two colours, each deepened (`deepened`: scaled in linear light, hue kept) until its luminance is at most 0.022 | The card: at that light the quietest text (`--text-tertiary`) reads at 4.5:1, as on a plain card |
| `full` | The whole card in the colours, far brighter (up to 0.1 and 0.05), the picture's ring in the first | `.profile-panel`, black at 55% (75% under Higher contrast, `Canvas` under forced colours), which brings any of them back to that light |

`profileCardLook(theme, style)` gives the card's style, the ring colour and whether the text needs the panel; the popout, the full profile, the phone's own card and the editor's preview all use it, and a test holds every preset to 4.5:1 for the quietest text in `strong` and on the panel in `full`. Without a banner picture the banner is the theme's gradient in every strength.
