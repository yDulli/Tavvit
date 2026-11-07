# Design System — Tavvit "Graphite"

Styles: `packages/web/src/styles/globals.css` (the tokens on `:root`, the component classes in `@layer components`)
Theme: `packages/web/tailwind.config.js` (maps the tokens to utilities; the layout variants `desktop:` and `compact:`)
Fonts: Geist for the interface, Geist Mono for labels, times and counts, all served from `public/fonts` and split by `unicode-range`. IBM Plex Sans, Inter, Space Grotesk, a mono face and the system stack are choices in Settings → Appearance; Simplified Chinese takes the platform stack (see `globals.css`).
Brand masters: `assets/brand/` (see its README)

---

## Principles

- A tool that feels expensive: precise, calm and deep. Tavvit is not a Discord clone. The places a person can be (Home, each space, Explore) are named tabs in the top bar, not a column of icons, so where you are reads as words.
- Deep graphite surfaces, a little cool. Two surfaces are told apart by a step in tone and a 1px hairline. Light falls on them from above: soft, ambient, in the colour of the place you are in, and behind the content, so text is never tinted (see Light). Light is the one effect and it is used sparingly: no neon, no glow around text, no glass.
- One signal colour, a subtle violet (`#7466e8`). It marks only what is selected or active, the one main action of a form, the count of what is unread, the keyboard focus ring and selected text. It is never a heading colour and never the logo. As light it may fill a room; as a fill it stays on those few things.
- Small, controlled corners (see Shape). No pill-shaped buttons, tabs or chips; `rounded-full` is for avatars, status dots and toggle thumbs only.
- Only what floats above the page (menus, popovers, dialogs, toasts) casts a shadow, a deep one, and has a lit top edge. Nothing is glass: the upstream class names `.glass*` survive, but each is an opaque surface edged by a hairline.
- Every state reads without the colour alone: selected is a lighter step plus a violet edge, unread is the primary colour in a heavier weight, hover is a faint veil, focus is an outline for the keyboard only, disabled is half opacity.
- Real data only. An empty list says so with `.empty-state`; nothing is filled with sample people, invented numbers or decoration without a purpose.

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
| `--bg-base` | 13 14 17 | `#0d0e11` | The frame: the top bar, the window, the browser and OS chrome (`theme-color` in `index.html`, the PWA manifest in `vite.config.ts`, the Electron window, whose buttons follow it through `setFrameColor`), and the ground of the pages outside the app |
| `--bg-channel` | 17 18 22 | `#111216` | The left column (channels, Home navigation) and the settings navigation |
| `--bg-members` | 18 19 23 | `#121317` | The right column (members, activity, a group's people): a step between the sidebars and the content |
| `--bg-chat` | 21 22 27 | `#15161b` | The page itself: the conversation, Home, Explore, the inbox, settings content |
| `--bg-elevated` | 30 31 37 | `#1e1f25` | What floats (menus, popovers, dialogs, toasts), always through the floating-layer classes |
| `--bg-input` | 12 13 16 | `#0c0d10` | Sunken fields |
| `--bg-overlay` | `rgba(0, 0, 0, 0.62)` | | Scrims behind sheets |

The order is the layout's: the frame darkest, the columns a step up, the page a step more, what floats lightest.

### Hairlines and control tones
| Token | Value | Role |
|-------|-------|------|
| `--border-hard` | 35 36 43 | The line between two surfaces: column edges, the bottom of a bar, dividers, card edges |
| `--border-soft` | 50 51 60 | The edge of a control or a floating layer: fields, outlined buttons, menus, dialogs |
| `--interactive-muted` | 78 80 92 | A hovered edge, a switch that is off, the scrollbar thumb under the pointer |
| `--interactive-hover` | `rgba(255, 255, 255, 0.05)` | The veil of a hovered row or button |
| `--interactive-selected` | `rgba(255, 255, 255, 0.075)` | The fill of a selected row or tab |
| `--interactive-active` | `rgba(255, 255, 255, 0.1)` | The fill while something is pressed |
| `--interactive-row` | `rgba(255, 255, 255, 0.025)` | The hover of a message row, quieter than a control's |

### Text
| Token | Channels | Contrast | Use |
|-------|----------|----------|-----|
| `--text-primary` | 237 238 242 | 13.2:1 on `--bg-elevated` | Titles, names, the selected and the unread row |
| `--text-message` | 225 227 233 | 11.9:1 | Message bodies |
| `--text-secondary` | 172 175 186 | 7.0:1 | Idle navigation rows, secondary lines |
| `--text-tertiary` | 141 144 156 | 4.8:1 | Quiet meta: times, hints, placeholders |
| `--text-category` | 150 153 166 | 5.4:1 (over 6:1 on the sidebars) | `.label-mono` section labels |
| `--text-link` | 158 148 255 | 6.5:1 on `--bg-chat` | Links |
| `--text-positive`, `--text-warning`, `--text-danger` | 92 196 128, 232 176 64, 240 98 84 | | Outcomes and errors |

### The signal
| Token | Channels | Use |
|-------|----------|-----|
| `--accent-primary` | 116 102 232 (`#7466e8`) | Fills under white text (4.4:1): the primary button, count badges, the active edge, a switch that is on. It is the shared `DEFAULT_ACCENT_COLOR` (`packages/shared/src/constants.ts`). |
| `--accent-primary-hover`, `--accent-primary-active` | 102 90 204, 88 78 176 | The primary button under the pointer and pressed |
| `--accent-primary-soft` | 150 140 245 | Violet text and icons on the panels (5.4:1 on `--bg-elevated`) and the focus outline. Utility: `text-accent-soft`. |
| `--notification` | 116 102 232 | `bg-notification`, kept for older call sites; counts use `.count-badge` |

The instance accent (Admin console → General) and a person's own (Settings → Appearance → Accent colour) replace the four `--accent-primary*` variables at runtime (`utils/instanceBranding.ts`, `components/ui/AppearanceController.tsx`). Either is accepted only when `accentColorProblem` (`packages/shared/src/color.ts`) passes it: white button text at 3.5:1 or more, and 2.5:1 or more against the dark panels. The ready-made choices (`ACCENT_CHOICES` in `utils/appTheme.ts`, `ACCENT_PRESETS` in `instanceSettingsPanels/AccentColorField.tsx`) start with the violet, and a test keeps every one of them acceptable.

### Accent family and status
`--accent-mint`, `--accent-peach`, `--accent-lavender`, `--accent-sky`, `--accent-amber`, `--accent-rose`, `--accent-coral` colour avatars, folders, reactions and the tone of an informational mark (amber: an update or an approval waiting; rose: a destructive action or a mute). They are not a second signal. `--status-online`, `--status-idle`, `--status-dnd` and `--status-offline` colour presence; `html[data-status-palette='accessible']` swaps them for a palette that does not depend on telling red from green.

### Variants
- `html[data-contrast='high']` (Settings → Appearance → Higher contrast) lifts the quiet text, the hairlines and the muted control tone.
- Surface themes (Settings → Appearance → Theme, `utils/appTheme.ts`). Carbon is the stylesheet as shipped and sets nothing; `CARBON_SETTINGS` (hue 226, strength 11) is the point that reproduces it, for its swatch and as the start of a person's own theme. Every other theme is a point (hue, strength, depth from −3 to 4) from which each surface is derived at the luminance its depth asks for, and the quiet text is lifted to keep the contrast it has on Carbon's floating panel. Depth stops at 4 because the floating panel is then as light as the old near-black palette's lightest, the most that keeps the primary text at 9:1 on it; `appTheme.test.ts` checks every corner of the ranges.

### Light

What separates the app from a flat dark interface. There are three strengths, all gradients with a fine grain (`--grain`) that keeps them from banding, all switched off under `html[data-light='off']` (Settings, Appearance, Ambient light; `LookSettings.light`), `html[data-contrast='high']` and forced colours.

| Class | Where | What it is |
|-------|-------|------------|
| `.lit` | The panels of the frame: top bar, left column, the page (`main`), right column, the loading overlay of a message list; on the phone the screens themselves | One field of light anchored to the window (`background-attachment: fixed`), so it runs across the panels unbroken while each keeps its tone. It is a background, so it lies behind their content. `.lit-phone` is the same on the phone only, for the pages that stand on `main`'s light on the desktop. |
| `.hero-light` | First child of what scrolls, on a page with an opening of its own (Home, Explore, the sign-in, an invite, the legal pages) | Rings and a glow in them. The parent is `relative isolate`; it clips itself, so it never makes the page wider. |
| `.stage-light` | The pages outside the app (sign-in, an invite, the download, not found) | A bloom, much stronger, as the ground of the whole page. |
| `.panel-light` | The content column of a settings dialog | A faint light from the far corner of the room the dialog is. |

**The colour of the place.** `.lit` reads `--place-target`, which is `rgb(var(--accent-primary))` until `layout/AmbientLight.tsx` sets something else on `<html>`: in a space its picture's dominant colour (read once, cached, `utils/colorExtractor.ts`) or its tile's colour, in a conversation with one person their profile colour or their tile's. Home, the pages around it and a group keep the accent. `utils/placeLight.ts` keeps the hue and brings saturation and lightness into a range that lights a dark room; a grey stays grey. `--place-color`, registered with `@property` and not inherited, is what fades over 520ms on each `.lit`, so a change of place repaints only those panels and recalculates nothing under them.

Light may be drawn in the accent or the place's colour. It stays behind things: never on text, never as a fill on a control, never a glow around a word.

### Where the violet may appear
- The selected or active place: the edge under the tab of the place you are in, the edge of a selected `.nav-item`, a chosen option card or theme.
- The one main action of a form or dialog: `.btn-primary`.
- Counts of unread messages and mentions: `.count-badge`.
- Controls that are on: a switch, the filled part of a slider, a checked box, a call control that is on and going out (camera, screen share, noise suppression; `VoiceControlBar`, `VoiceControls`).
- A state of the app's own that is on: streamer mode's badge in the top bar (`layout/StreamerModeBadge.tsx`: a 28px chip, 30% violet edge, 10% violet fill, `--accent-soft` label with the `eye-off` icon).
- Keyboard focus (`--accent-primary-soft`) and selected text.

Never: headings, icons that are only decoration, the logo, a whole row's solid fill (a selected row is neutral with a violet edge and a faint violet wash from it), an unread dot with no count (that dot is neutral, `bg-txt-primary`), empty states. The light of a room (see Light) is not a use of the signal: it may be violet anywhere the room is.

---

## Native controls

`input[type='checkbox']` and `input[type='radio']` are drawn by the base layer (a 16px sunken box edged like a field, violet while on), so every form gets them without a class; size and margin utilities beside them still win. A `select.input-*` gets the app's own arrow in place of the system's.

## Brand

The mark is a slanted T inside a thin ring. It is black and white everywhere: white on graphite, never tinted violet, never on a coloured tile. Up to 32 px it is the T alone (`/icons/logo-mark.svg`, the top bar's left end, the favicons), because the ring disappears at that size; larger it carries the ring (`/icons/mark.svg`). The masters live in `assets/brand/` and every favicon, PWA icon, tray icon and desktop build icon is generated from them with `pnpm gen-icons`; outputs are never hand-edited. The app-icon family (`app-icon.svg`, `app-icon-small.svg`) puts the white mark on a near-black rounded square; that ground belongs to the icon artwork, not to the interface palette above.

The product name "Tavvit" is fixed; the instance name (the browser tab, the sign-in page) is the administrator's.

---

## Shape

Every radius utility is multiplied by `--radius-scale` (Settings → Appearance → Corners: sharp, standard, round), so one number sharpens or softens the whole app. The component classes below use the same scaled values.

| Corner | Utility | Use |
|--------|---------|-----|
| 2px | `rounded-sm` | Hairline marks: drop indicators, the active edge's own corner |
| 3px | (`.kbd`) | Keyboard keys, small amber counts in the settings navigation |
| 4px | `rounded` | Count badges, a 20px space glyph, swatches, the buttons inside a tri-state control |
| 5px | `rounded-md` | Buttons, icon buttons, fields, navigation rows, tabs, segmented controls, the switch track |
| 6px | `rounded-lg` | Cards, tiles, list rows, menus, popovers, dialogs, toasts, the composer, the top corners of a phone sheet |
| 8px | `rounded-xl` | Larger picture tiles only |
| round | `rounded-full` | Avatars (their own roundness setting), status dots, switch thumbs, the empty-state icon and its rings. Nothing else. |

## Type

| Role | How |
|------|-----|
| The opening of a page of its own | `.display-title` (`clamp(2rem, 3.2vw, 3.25rem)`, 680, −0.045em) with `.ink`; `.display-hero` adds size (up to 5.25rem) where there is next to nothing else, as on the sign-in |
| Page and settings-panel titles | `.page-title`: 20px, 650, −0.025em, painted like `.ink` |
| Large type's own light | `.ink`: from `--text-primary` at the top to a little of the surface at the bottom, clipped to the text; plain text under higher contrast and forced colours |
| Dialog titles | 15px semibold (the `Modal` header) |
| Section labels | `.label-mono`: 11px Geist Mono, 500, capitals, 0.05em, `--text-category` |
| Form field names | `.field-label`: 12px, 500, sentence case, `--text-secondary`, 6px above the field |
| Row titles | `text-ui` (13px) medium, `text-txt-primary` |
| Secondary lines | `text-meta` (12px), `text-txt-tertiary` or `text-txt-secondary` |
| Times, counts, sizes | `font-mono`, `.tabular` (tabular figures; `<time>` gets them by default). Geist's default "1" is far narrower than its "8", so any number that lines up with others needs them |
| Message text | `.message-text`: 15px × the chat text size (Settings → Appearance → Reading) |
| Markdown in a message | `.md-h1` to `.md-h3`, `.md-code`, `.md-code-block`, `.md-jumbo` (a message of nothing but a few emoji): sizes in `em` against the message text, so they follow the chat text size. Inline code is neutral, not a second link colour; a quote's edge is `--interactive-muted`, not the signal |

### The type scale

Tailwind's `fontSize` in `tailwind.config.js`, a size each with no line height of its own (a `leading-*` utility sets one where it matters): `text-2xs` 10px, `text-label` 11px, `text-meta` 12px, `text-ui` 13px, `text-body` 14px, `text-lead` 15px, `text-title` 18px, and Tailwind's own `text-base` 16px, `text-xl` 20px, `text-2xl` 24px from there up. Write these, not `text-[13px]`; half pixels are gone. Weights: 400, 500 and 600, `font-bold` is not used.

## States

| State | Look |
|-------|------|
| Hover | `--interactive-hover` veil; text steps up to `--text-primary`; a hairline steps up to `--interactive-muted` |
| Pressed | `--interactive-active` fill (`.nav-item`, `.list-row`, `.icon-btn`, `.btn-quiet`, `.btn-outline`, tabs); the filled buttons step to their `-active` shade |
| Selected / active | `--interactive-selected` fill and `--text-primary`, plus the violet edge: a 2px bar on the left of a `.nav-item`, under a tab, under a section tab; option cards take a violet border |
| Unread | `--text-primary` and weight 600 (`data-unread="true"` on a `.nav-item`); a count when the server sent one (`.count-badge`), otherwise a 6px neutral dot |
| Muted | The count in `.count-badge-muted` |
| Focus | A 2px `--accent-primary-soft` outline, 2px out, for the keyboard only (`:focus-visible`, globals.css base layer); fields show their own violet border and ring instead |
| Disabled | 45–50% opacity (40% on icon buttons) and `cursor: not-allowed`; `disabled` or `aria-disabled="true"` |
| Loading | `aria-busy="true"` on a `.btn-*`: the label stays, a 12px ring turns beside it, the button stops answering |
| Error | `aria-invalid="true"` on `.input-standard` or `.input-search`: a rose edge |
| Mentioned | A message that reaches you (`data-mentioned` on `.msg-row`): a violet veil and a 2px violet edge, the same signal as the count that led there |
| Destructive | `.btn-danger` (a deeper rose so white text reads at 4.7:1); destructive menu items in `--text-danger` with a rose hover |

---

## Component classes

Defined in `@layer components` of `globals.css`, so a utility on the same element (`h-11`, `text-txt-danger`, `hover:bg-accent-rose/10`) always wins. The hover rules guard `:disabled` inside `:where()`, which adds no specificity, so a `hover:` utility wins there too.

| Class | What it is | States |
|-------|-----------|--------|
| `.nav-item` | A row of any navigation list (sidebars, Home links, the settings navigation, the folder flyout): 32px tall, 10px side padding, 10px gap, 5px corner, 13px medium `--text-secondary` | hover: veil + primary text; `data-active="true"` or `aria-current="page"`: selected fill + primary text + a 2px × 16px violet bar on the left edge; `data-unread="true"`: primary text, 600 |
| `.list-row` | An interactive row of a list in the page (Home, the inbox, panels): flex, 12px gap, 8px × 10px padding, 6px corner | hover: veil; `data-active="true"`: selected fill |
| `.icon-btn`, `.icon-btn-lg` | A square button that is only an icon: 28px (32px for `-lg`), 5px corner, `--text-tertiary`. Its name is its `aria-label`, which "Tooltips" shows; never a `title` | hover: 6% white + primary icon; `data-active="true"` (what it toggles is on, its menu is open): selected fill + primary icon; disabled: 40% |
| `.count-badge`, `.count-badge-muted` | An unread or mention count: 16px tall, at least 16px wide, 4px side padding, 4px corner, white 10px Geist Mono 600 tabular figures on `--accent-primary`; `-muted` is the neutral one (white 10% fill, `--text-secondary`), alone or added to `.count-badge` | Rendered by `ui/CountBadge.tsx`, which also says the count to a screen reader |
| `.kbd` | A keyboard key: 18px, 5px side padding, 3px corner, 1px `--border-soft`, 10px Geist Mono `--text-tertiary` | |
| `.empty-state` + `-icon`, `-title`, `-body` | What a list says when it is empty: a centred column (6px gap, 28px × 16px padding); the icon in a 36px outlined square (8px corner, `--border-hard`, `--text-tertiary`); a 14px semibold title; a 13px `--text-secondary` body at most 320px wide | No illustration and no colour |
| `.page-title` | See Type | |
| `.label-mono` | See Type | |
| `.btn-primary`, `.btn-quiet`, `.btn-outline`, `.btn-danger` | One button geometry (32px, 12px side padding, 5px corner, 13px medium, never a capsule) in four weights: the accent fill for the one thing a form is for, a quiet text button beside it, an outlined secondary action, the rose fill for destroying something | hover and pressed steps; disabled 50%; focus outline |
| `.btn-sm` | Added to a button: 28px, 10px side padding, 12px, for rows and toolbars | |
| `.btn-lg` | Added to a button: 40px, 16px side padding, 14px, for the opening of a page | |
| `.btn-hero` | White with dark text, a glow in the accent under it: the one call to action on an opening page (Home's New message, the sign-in, an invite, not found). Never more than one on a page, never inside the app's forms. | hover: rises 1px, the glow grows; pressed: scale .98; `aria-busy` as the others |
| `.stat-value` | The number of a stat tile: 28px, 620, proportional figures, which read better large | |
| `.chart-column`, `.chart-dot` | The marks of a chart (`admin/DayChart.tsx`): columns at most 24px wide, rounded at their free end, 2px apart; a dot with a 2px ring of the surface. A chart is one measure per card in the accent, with a hairline grid, a crosshair and tooltip on the pointer and the arrow keys, and its numbers as a table | |
| `.announcement`, `.announcement-warning` | What the operator says to everyone (`ui/AnnouncementBar.tsx`): a band in the accent or amber, with text in the text colour | |
| `.field-label` | See Type | |
| `.range-slider` | A slider (`ui/RangeSlider.tsx`): a 4px track in a 20px box, violet up to a 14px white thumb (`--range-fill`), or all painted by the caller (`--range-track`), as the hue slider is | hover and pressed: a faint halo round the thumb; keyboard focus: the ring on the thumb; disabled: 50% |
| `.tab-strip` | The top bar's tabs when they do not fit, and the phone's space strip: scrolls sideways, its last 16px fade out so a cut-off tab reads as more to scroll to, and with `data-scrolled="true"` its first 16px do too | |
| `.typing-dot` | One of the three dots of the typing line; they brighten in turn | |
| `.panel-bar` | The header of a column: at least `--topbar-height` (48px) with a `--border-hard` line under it | |
| `.panel-bar-over` | A column's bar laid over a space's banner (`layout/SpaceBannerHeader.tsx`): sticky at the top of what scrolls, the picture starting under it, no surface or hairline while it lies over the picture, the column's own (with `.lit`) once the picture has scrolled away | `data-over-banner="true"` while over the picture; under higher contrast and forced colours it never lies over it |
| `.space-banner` | A space's banner at the head of its channel column, 16:9 as the owner framed it, no corner: a 58% shade under the bar (the bar's words are all primary over it, which keeps 4.5:1 even on white) and a fade into `--bg-channel` at its foot | without a banner, one that may not be fetched yet or one that fails, the column's plain bar stands as before |
| `.surface-card` | A card: a little white over what it sits on, more at the top, a `--border-hard` edge and a lit top edge; the caller adds `rounded-lg` | |
| `.lift` | Added to a card you can act on | hover: rises 2px with a deep shadow and a glow in its own colour (`--tile`, a CSS colour, or the accent); pressed: settles back |
| `.spotlight` | Added to a card: a soft light follows the pointer (`utils/pointerLight.ts`, one listener for the document) | hover |
| `.tinted-card` | A place as a tile: lit from a corner in its own colour (`--tile`) | |
| `.banner-depth` | A band painted by the app rather than a picture (`bannerFill` in `utils/placeLight.ts`): grain over it and a shade toward what follows | |
| `.sliding-list` + `ui/SlidingMark.tsx` | The one mark of a list, sliding from the place you left to the place you chose: `variant="row"` (a lit row with its violet edge; the left column, the settings navigation), `line` (under the tab; the top bar, the tabs of an account's detail, the phone's tab bar, with `selector` naming the anchor, `[data-active-mark]` or `[data-active-line]`), `pill` (the fill of `SegmentedControl`). The mark goes first inside the list, which reads which element is active from the DOM, so rows keep saying `data-active`. `data-marked` on the list turns the row's own highlight off once the mark has a place. | |
| `.active-line` | The line of a tab with no mark to slide (the action tiles of the top bar), or the anchor a mark measures | |
| `.action-bar` | The strip that carries a form's actions (Cancel / Save): elevated, a hairline, 6px corner, a plain shadow | |
| `.input-standard`, `.input-search`, `.input-embedded`, `.input-danger` | See Input Tiers | |
| `.glass`, `.glass-modal`, `.glass-bubble`, `.glass-pill`, `.glass-pill-mine`, `.glass-strip` | See Floating Layers | |
| `.card-grid` | See Layout | |

Shared components built on these: `ui/CountBadge.tsx` (counts), `ui/Toggle.tsx` (a 36 × 20 switch: 5px track, round thumb, violet when on), `ui/TriStateToggle.tsx` (deny / neutral / allow in one sunken strip), `ui/Tooltip.tsx` (12px on `.glass`, 5px corner, the look of `ui/TooltipBubble.tsx`; for a mark that is not a control, whose words are not its name: a federation globe, a status, a badge), `ui/TooltipLayer.tsx` (see "Tooltips"), `ui/SpaceBand.tsx` (a space's banner across a card, or its colour painted with depth), `ui/ContextMenuRenderer.tsx` (6px menus, 32px rows, hairline separators; when any row of a menu has an icon every row keeps the 16px column, so its labels start at one x, and a destructive row's icon takes the danger colour), `ui/Modal.tsx` (a 48px header with a hairline and a 15px title; the close control is `.icon-btn-lg`, 40px in a phone's sheet and full-screen dialog), `ui/ConfirmDialog.tsx` (title and text over a hairline footer of `.btn-quiet` and `.btn-danger`, or an amber confirm with dark text for a warning), `voice/LiveBadge.tsx` (a live stream's mark: a small red dot and white Geist Mono capitals on a dark chip, the same on a sidebar row and over a picture), `ui/Sensitive.tsx` (what streamer mode hides, streamer-mode.md: `Sensitive` puts eight dots in `--text-tertiary` in a value's place, read out as hidden; `SensitiveBlock` replaces a whole part with a dashed-edged note on the sunken input surface with `eye-off` and a quiet "Turn off streamer mode"; nothing is blurred), the camera background picker (`modals/settingsPanels/CameraBackgroundPicker.tsx`: 16:9 tiles in three columns with the option cards' edge, dot and label, each a small figure in front of what would be behind it, so a blur reads as the room soft and the person sharp), and the settings controls in `modals/settingsPanels/_shared/SettingsControls.tsx` (`SettingsPage`, `SettingsSection`, `SettingBlock`, `SettingsField`, `FormError`, `OptionCards`, `SegmentedControl`, `ToggleRow`, `SliderRow`, `SwatchButton`), which every panel of the user settings is built from: one title, one section heading and card, one label treatment.

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
| Structural | `bg-surface-*` | Permanent layout (the bars, the columns, the page) |
| Strip | `.glass-strip` | The phone's space strip (in `@layer utilities`, so it wins over `bg-surface-*`) |
| Bubble | `.glass-bubble` | Persistent controls above the content: the voice bar, the chat composer (floating on desktop and mobile; see `docs/systems/mobile-ui.md` "Floating Composer"), the voice mini-bar |
| Popover | `.glass` | Menus, popovers, tooltips, the folder flyout, the device menus of the top bar, toasts |
| Modal | `.glass-modal` | Dialogs, the quick switcher, the profile card |
| Pill | `.glass-pill` | Inline decorations (reactions, tags); `.glass-pill-mine` is the viewer's own reaction, in the signal colour |

Each is the opaque `--bg-elevated` surface with a `--border-soft` edge, a little lighter at the top (`--float-sheen`) with a lit top edge (`--float-edge`), and all but the pill cast a deep shadow (`--shadow-popover`, `--shadow-modal`; a dialog adds a wide, faint glow in the accent). **Rule:** anything that floats above the content plane uses one of them, never `bg-surface-elevated` directly, so the edge and the shadow stay consistent.

**Modal backdrops:** `.modal-scrim`: 50% black and a 10px blur of what is behind, so the dialog is the one sharp thing on the screen (dimming alone on a phone, where the blur costs frames). It fades by itself: a parent's fading opacity would cut the blur off, so a dialog's outer element carries no animation.

**Dialogs arrive and leave:** the panel has `.modal-panel` (or `.sheet-panel` on a phone) in place of `animate-slide-up`. `hooks/useExitGhost.ts`, used by `Modal` and `ConfirmDialog`, lets a dialog leave the way it came however it is closed: as it unmounts, an inert copy (no ids, nothing that would load again, hidden from assistive technology) plays `.modal-leaving` for 150ms. The real dialog is gone at once, so nothing has to stay mounted without its state, and no test or screen reader ever meets the copy. Elements that open and close constantly (menus, tooltips) have an entrance only: leaving at once is what makes them feel quick.

**Portal target — `usePortalContainer()`:** Every overlay (context menu, tooltip, popover, modal, screen-share picker) MUST portal through `usePortalContainer()` (`packages/web/src/hooks/usePortalContainer.ts`) instead of hard-coding `document.body`. The hook returns `document.fullscreenElement ?? document.body` and re-renders subscribers on `fullscreenchange`. Without this, anything portaled while an element (e.g. the voice container in fullscreen mode) is in the browser's Fullscreen API top-layer is rendered outside that layer and is invisible. Components mounted at App root that render with `fixed inset-0` (not just portals) must also portal through this hook for the same reason.

The shared `Modal` (`components/ui/Modal.tsx`) portals itself through this hook, so a caller mounts it wherever its state lives and never wraps it in another portal. Rendering in place is not safe: an ancestor with `transform`, `filter` or `backdrop-filter` becomes the containing block of a `fixed` element, and a dialog mounted inside the `.glass-strip` space strip rendered 72px wide. Overlays stack by portal order: a dialog or card opened from inside an open `Modal` is appended after it, so it draws above at the same `z-index`.

`.modal-scrim` is the one use of `backdrop-filter`. Write `-webkit-backdrop-filter` first and the unprefixed property last: Vite 8 minifies CSS with Lightning CSS, which folds the two into one and keeps whichever came last, and Firefox implements only the unprefixed form.

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

All defined in `globals.css`. A field is sunken (`--bg-input`) with a resting `--border-soft` edge that steps up to `--interactive-muted` under the pointer; with focus it turns `--accent-primary` with a 1px ring of the same at 40%. Its corner is the buttons' (5px), so a field and the button beside it line up.

| Tier | Class | When to use | Focus |
|------|-------|-------------|-------|
| Standard | `.input-standard` | Form fields in dialogs, settings, sign-in | violet edge + `ring-1` violet/40 |
| Search | `.input-search` | Search bars, filter inputs (`py-1.5`) | violet edge + `ring-1` violet/40 |
| Embedded | `.input-embedded` | Inside a container that already draws the field (the composer, the quick switcher) | none |
| Danger | `.input-danger` | Destructive confirmations | rose edge + `ring-1` rose/40 |

Override padding and size with utilities: `input-standard w-full py-2.5`.

The top bar's search trigger is not a field but looks like one: a 32px button on `--bg-input` with a `--border-soft` edge, the search icon, the word and the shortcut in a `.kbd`; in a compact window it folds to the icon.

### iOS Auto-Zoom Suppression

iOS Safari auto-zooms (and shifts the viewport right) on input focus when the computed `font-size` is below 16px. The `html[data-viewport="mobile"]` rule in `globals.css` bumps every input tier — and bare `<input>`/`<textarea>`/`<select>` plus `[contenteditable]` — to `font-size: 16px !important`.

`!important` is required because Tailwind utilities like `text-lead` (used on the chat composer textarea) and `text-sm` (used on form fields) are emitted in the `@layer utilities` block, which comes after `@layer components` in the cascade and would otherwise override the input-tier rules. There is no legitimate reason to use a `<16px` font-size on a mobile input, so the override is universally correct.

When introducing a new input or contenteditable surface, no extra work is needed — the global rule covers it.

---

## Unread and attention indicators

| Mark | Meaning | Used by |
|------|---------|---------|
| `.count-badge` (violet) | Someone is waiting on you: unread messages, mentions, the inbox | the tabs of the top bar (a space's count, Home's direct-message count), the inbox bell, the folder flyout, Home's lists (`ui/CountBadge.tsx`, `layout/SpaceUnreadBadge.tsx`) |
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

The desktop shell (`components/layout/AppLayout.tsx`):

- **Top bar** (`TopBar.tsx`, `--bg-base`, 48px, a hairline under it): the white mark and the wordmark; the places as named tabs (`SpaceSidebar.tsx`: Home, a hairline, the spaces and folders in the person's order, a hairline, then create, join and Explore as `.icon-btn-lg` tiles); the search trigger with its `.kbd`; the inbox bell with its count; a hairline; the microphone and headphones switches (each joined to its device menu) and the settings button; a hairline; the person's own picture, name and handle. The tab you are on is a step lighter with a 2px violet edge under it, on the bar's own hairline. In a compact window the wordmark and the search text fold away and the tab names shorten.
- **Left column** (`--bg-channel`, `--sidebar-width`, a hairline on its right): a space's channels (under its banner when it has one, and one Create row with a menu for whoever may make channels), or Home's navigation (Home, Inbox, Friends, and More, which holds Explore and About and stays as this device left it) and direct messages.
- **The page** (`--bg-chat`): the conversation, Home, Explore, the inbox, About.
- **Right column** (`SidePanel.tsx`, `--bg-members`, `--sidebar-width`, a hairline on its left): the members of a space, the friends' activity on Home, a group's people. In a compact window it floats over the page's right edge with the popover shadow and a press in the page puts it away.

`--sidebar-width` is 248px (216px narrow, 296px wide: Settings → Appearance → Shape). The phone has its own shell (`docs/systems/mobile-ui.md`).

User settings (`modals/UserSettings.tsx`) repeat the shell inside the settings dialog: a flat navigation column on `--bg-channel` with a hairline on its right (who is signed in on a `.panel-bar`, `.label-mono` group headings, `.nav-item` rows, Log out in the danger colour at the foot), and the panel on `--bg-chat` at most 640px wide.

Card lists (Explore's Inner and Outer Space sections, the Friends page's
discover list) share one class, `.card-grid` in `globals.css`: one full-width
column below the desktop breakpoint, and above it
`repeat(auto-fill, minmax(min(100%, 280px), 1fr))` with a 1rem gap. It is
`auto-fill` and not `auto-fit` on purpose, because `auto-fit` collapses the
empty tracks and stretches a list holding a single card over the whole row.
Any new card list uses this class rather than its own template.

---

## Shadows

| Name | Use |
|------|-----|
| `--shadow-popover` (`shadow-elevation-high`, `shadow-glass`) | Menus, popovers, toasts, the compact right column: `0 18px 44px -14px`, 80% black, over a small close shadow |
| `--shadow-modal` | Dialogs: `0 50px 110px -30px`, 90% black, over a closer one |
| `elevation-low` | A 1px lift for a tile that sits on another surface (the connection card) |
| `header`, `input` | `none`: bars and fields never cast one |

---

## Animations

### Tokens
`--ease-out` (`cubic-bezier(.16, 1, .3, 1)`, for anything arriving), `--ease-spring` (a sampled spring through `linear()` where the browser has it, a bezier otherwise, for small things that may overshoot), `--dur-fast` 120ms, `--dur-base` 200ms, `--dur-slow` 320ms, `--dur-slower` 520ms. Fill with `backwards`, never `both`, on anything that can hold a `fixed` child or a dialog: a filled transform leaves a containing block behind.

### What moves
| Class or hook | What it does |
|---------------|--------------|
| `usePlaceEntrance` (`layout/PlaceStage.tsx`) | The middle of the window comes up 6px when the place changes. The element stays mounted (a key would throw away a message list and its scroll position) and nothing is left behind when it ends. |
| `.rise-in`, `.stagger` | What opens a page rises 10px and fades in; `.stagger` delays its children by 40ms each, up to 320ms |
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

Settings → Appearance → Reduce motion (`html[data-motion='reduce']`) cuts every animation and transition down whatever the system asks for, and `prefers-reduced-motion` does the same for what the stylesheet and `utils/motion.ts` start. While the app's script loads, `.boot-mark` in `index.html` shows the logo after a moment's wait; React replaces it with the first render.

---

## Utility Classes

- `.no-scrollbar` — Hides scrollbars
- The product page has its own stylesheet and classes (`landing/landing.css`, `.lp-*`). It is the one place where this design's rules do not hold: pills, large radii and cards of colour, in a composition the owner asked for; see [landing.md](landing.md), "Design".
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

Frames, profile effects and nameplates are drawings of things (`components/ui/decorationArt.tsx`, decorations.md), placed and moved by `styles/decorations.css`: flat shapes in two or three tones with a darker outline of the same hue, lit from the upper left like the rest of the app. They are the one place the interface draws pictures rather than surfaces, and they keep the rule against light: no glow, no blur, no neon, nothing generated-looking; a sparkle or a star is a drawn shape with an outline. Name styles are a typeface and colour, a printed look or motion in the letters, never a glow round them.

- `.deco-art` is a frame's drawing round an `Avatar` (`frame`, `frameMotion`), a view a fifth larger than the picture, in a layer behind it (`data-layer="back"`, `z-index: -1` in the avatar, which is `isolate` while it wears one) and one in front.
- `.deco-effect` lies over the whole profile card, last in it (`ProfileEffectLayer` with `z-20`), taking no pointer; it measures itself (`container-type: size`) and a picker's tile halves it (`--deco-scale`). What moves in it wears a sprite (`--sprite-a/b/c`).
- `.deco-nameplate` lies at `z-index: -1` in a row that is `relative isolate`: over the row's background, hover and selection, under its content (`NameplateLayer`); its scene stands at the far end (`.deco-art-scene`, `.deco-plate-field`).
- `.deco-name` carries `data-name-font` and `data-name-effect` (`DecoratedName`); `.deco-name-letter` is one letter of a `wave`. A role's colour wins over the effect; the typeface stays.
- `data-motion`: `on` (a profile, a preview), `hover` (inside a `.deco-hover` row or message, moving only while it is pointed at or focused), `off`.

Reduce motion stills all of them and leaves out what only passes by. Higher contrast and forced colours leave out effects and nameplates and show a name in its plain colour; forced colours leave out frames too. Nothing here takes the violet: "Your colours" are the person's own.

## Space tags and the voice overlay (1.37.0)

`.space-tag` is a space's tag beside a name (space-tags.md): 16px tall, Geist Mono 10px, the tag's colour (`data-color`, the accent family or silver) as text on a 10% ground with a 32% hairline, a 4px radius scaled like the rest, no glow. It is a control (`role="button"`) that opens the space's card; `data-static="true"` draws the same mark where it is not one. It never takes the violet signal.

The voice overlay (voice-overlay.md, `overlay/overlay.css`) draws over a stream, not over Graphite: dark opaque labels for names, the status green as the ring of who speaks, the rose for a muted mark, and a transparent page. Its preview in the dialog stands on a checked ground for "transparent".
