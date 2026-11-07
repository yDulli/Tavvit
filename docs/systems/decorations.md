# Profile decorations

A frame round the picture, an effect across the profile card, a nameplate behind the name in
lists, and a style for the name itself: a typeface and an effect in or on the letters. Free for
everyone. Every design is Tavvit's own, drawn by the client from a name the profile stores; nothing
is uploaded, and nothing loads from another server.

## Files

- `packages/shared/src/decorations.ts`: the names (`AVATAR_FRAMES`, `PROFILE_EFFECTS`,
  `NAMEPLATES`, `NAME_FONTS`, `NAME_EFFECTS`), the retired names and their successors
  (`RETIRED_*`), the guards and resolvers, `decorationsOf` (what a profile shows),
  `decorationUpdateOf` (what an update asks), `DECORATION_FIELDS`
- `packages/server/src/routes/users.ts`: `PATCH /api/users/@me` takes and checks them
- `packages/server/src/utils/sanitize.ts`: every `User` carries them; `utils/userDeletion.ts`
  clears them
- `packages/server/drizzle/0073_tavvit_profile_decorations.sql`: the five columns
- `packages/web/src/components/ui/decorationArt.tsx`: the drawings (frames in two layers, the
  effects' and nameplates' scenes, the sprites of what moves in them)
- `packages/web/src/styles/decorations.css`: placing, motion, the accessibility rules, the name styles
- `packages/web/src/styles/nameFonts.css`, `packages/web/public/fonts/names/`: the name typefaces
- `packages/web/src/utils/decorations.ts`: `personDecorations`, `decorationColors`, the particles
- `packages/web/src/components/ui/Decorations.tsx`: `ProfileEffectLayer`, `NameplateLayer`,
  `DecoratedName`
- `packages/web/src/components/ui/Avatar.tsx`: the `frame` and `frameMotion` props, `FrameArt`
- `packages/web/src/components/modals/settingsPanels/DecorationsPanel.tsx`: Settings → Decorations

## The designs

| Kind | Field | Names |
|------|-------|-------|
| Frame | `avatarFrame` | `headphones`, `catears`, `crown`, `halo` (an angel: halo and wings), `horns`, `laurel`, `blossom` (a crown of cherry blossoms), `kindling` (flames), `frost` (snow on the head), `stardust` (stars), `hearts`, `fizz` (bubbles), `theme` (a loop drawn in the person's colours) |
| Effect | `profileEffect` | `butterflies`, `notes`, `stars` (a night sky), `snow`, `petals` (cherry blossoms), `leaves`, `hearts`, `confetti`, `bubbles`, `lanterns` |
| Nameplate | `nameplate` | `vinyl`, `skyline`, `sakura`, `snow` (snowy pines), `rain` (a rain cloud), `embers` (a campfire), `starlit` (hills under the moon), `waves` (a boat at sea), `sunset` (mountains), `moss` (a forest), `theme` (bunting in the person's colours) |
| Name typeface | `nameFont` | `classic` (the interface's own, stored as none), `mono`, `serif`, `round`, `hand`, `pixel`, `engraved`, `wide` |
| Name effect | `nameEffect` | `wave`, `glitch`, `sticker`, `comic`, `retro`, `candycane`, `galaxy`, `toxic`, `lagoon`, `berry`, `shimmer`, `gold`, `silver`, `frost`, `aurora`, `sunset`, `ocean`, `candy`, `ember`, `prism`, `theme` |

The lists' order is the picker's. `theme` ("Your colours") takes the person's profile theme, or
without one the colour of their picture's tile (`decorationColors`), so it is theirs either way;
the `wave` and `sticker` name effects take them too.

**Retired designs.** The first set (1.36.0) was light, gradients and particles; 1.37.1 replaced it
with drawings. A design that went keeps working as the drawing nearest in theme (`RETIRED_FRAMES`,
`RETIRED_EFFECTS`, `RETIRED_NAMEPLATES`, and the empty maps for typefaces and name effects):
`gilded` shows as `crown`, `obsidian` as `horns`, `sunbeams` as `butterflies`, `circuit` as
`skyline`, and so on. Where the theme stayed, the name stayed and only the drawing changed (`snow`,
`hearts`, `stardust`, `frost`, `kindling`, `blossom`, `fizz`, `theme`, `sakura`, `waves`, ...). A
test holds that no retired name is a current one and that every successor is.

## Stored, checked, sent

Five text columns on `users` (`avatar_frame`, `profile_effect`, `nameplate`, `name_font`,
`name_effect`, migration 0073), NULL for none. Only the account itself writes them, with
`PATCH /api/users/@me` (api.md, "Decorations"): a name of a design, or null to clear it; the classic
typeface is stored as NULL, and a retired name (from a client older than the change) is stored as
its successor. Anything else, a name the server does not know, a number, an empty string, is
refused with `400 profile_decoration_invalid` and `details.field`, and nothing of that update is
stored. The server checks; the picker only offers what the server takes.

Every `User` the server sends carries the five fields, null for none, read through
`decorationsOf`: a retired name stored before the change shows as its successor (the row itself is
not rewritten), and a name nobody knows shows as none. They are sent even when null because clients
merge an update over the copy they hold (`{ ...current, ...event.user }`); a field left out would
keep a decoration that was taken off. A change goes out as `user_updated` to everyone who sees the
profile (`announceProfileChange`). Deleting the account clears them, and the personal export has
them in `account.json`.

Like pronouns, links and the layout (auth.md, "Profile fields"), they are kept on the instance that
stores the profile and **not relayed to federation peers**: a profile shows them wherever this
instance shows it, and another instance's copy of the person carries none.

## Where they show

| Surface | Frame | Effect | Nameplate | Name style | Moves |
|---------|-------|--------|-----------|------------|-------|
| Profile card, full profile (`UserProfilePopout`, `UserProfileModal`) | yes | over the whole card | | yes | always |
| The account panel's preview, the decorations panel's preview | yes | over the whole card | the list row | yes | always |
| Member list (`MemberSidebar`, `MobileMembersScreen`) | yes | | yes | yes | while the row is pointed at |
| DM list, a conversation with one person (`DmListItem`, `MobileDmsScreen`) | yes | | yes | yes | while the row is pointed at |
| A message's author (`Message`) | yes | | | yes | while the message is pointed at |

Reply previews, mentions, voice tiles, reactions and the like stay plain. A phone has no pointer, so
its lists show the decorations still. An offline member's row dims them with the rest of the row.

**A role's colour wins over the name's effect.** In a space where a role (or the owner's colour)
gives the name its colour, the name shows that colour and its typeface, without the effect
(`DecoratedName`'s `roleColored`). The colour says something about the person in that space; the
effect is only decoration.

## How they are drawn

Every frame, effect and nameplate is a drawing of a thing, never light or glow: flat shapes in two
or three tones with a darker outline of the same hue, lit from the upper left, written by hand as
SVG in `decorationArt.tsx`. Shapes several designs share (a star, a sparkle, a heart, a snowflake, a
cherry blossom, a leaf, a cloud, the moon) are drawn once there.

- **Frame:** drawn in the picture's own box (0 to 100) in a view a fifth larger on every side
  (`FRAME_VIEW`), in one or two layers (`FRAME_LAYERS`): what sits behind the head (ears, the
  headphones' band, wings, horns, flames, the wreath) under the picture, what sits in front (the
  cups, the crown, the halo, the blossoms, the snow, the bow, stars, hearts, bubbles, the loop) over
  it. The avatar is its own stacking context (`isolate`) while it wears a frame, so the back layer
  stays above whatever the avatar sits on. Both layers share the status dot's cutout. The drawings
  are made for every `--avatar-roundness`: what is behind the head reaches far enough in that its
  edge is hidden on a circle and a square alike.
- **Effect:** a layer over the whole card, last in it (`className="z-20"`), over its content and
  never taking a pointer. It measures itself (`container-type: size`), so what falls (`--fall`,
  `100cqh` and a margin) crosses a card or a picker's tile alike; a tile draws its things at half
  size (`--deco-scale`). Some effects have a scene as well (the night sky's moon and a falling star,
  the cherry branch in the corner).
- **Particles** (effects, some nameplates) are `<i>` elements placed by a small seeded generator
  (`utils/decorations.ts`), the same on every screen, each already under way when first seen. Each
  wears a small drawing (`--sprite-a`, every second `--sprite-b`, every third `--sprite-c`): SVG as
  a `data:` picture (`img-src` allows it, web-security.md), set once on the layer.
- **Nameplate:** a small scene at the far end of the row, as tall as the row, masked away from the
  picture and the name; what falls or rises in it stays in a box the scene's size at the end of the
  row (`.deco-plate-field`), so rain falls under its cloud and sparks rise from the fire on a narrow
  list and a wide one. It lies at `z-index: -1` in a row that is its own stacking context
  (`isolate`): over the row's background, hover and selection, under its content.
- **Name:** `data-name-font` sets the typeface; `data-name-effect` paints colour into the letters
  (`background-clip: text`: `galaxy`, `candycane`, the flowing gradients), gives them a printed look
  with hard shadows (`sticker`, `comic`, `retro`, `glitch`), or moves each letter (`wave`: the name
  is drawn letter by letter, aria-hidden, with the whole name beside it for a screen reader). No glow
  round the text (design-system.md).

**Motion** (`data-motion`): `on` moves always, `hover` only while the surrounding `.deco-hover`
(the row, the message) is pointed at or focused, `off` never. A frame's things that pass by (a note,
a falling petal or flake, a rising heart or bubble) appear in `hover` mode only then, so a list is
not full of them. Under Reduce motion everything is still: particles rest where they are scattered,
and what only passes by (notes, a falling star) is not shown. Under Higher contrast and in forced
colours, effects and nameplates are not drawn and a name shows in its plain colour; in forced
colours a frame is not drawn either.

**Typefaces:** Fraunces, Comfortaa, Caveat, Pixelify Sans, Cinzel and Unbounded, under the SIL Open
Font License (the licence beside each in `public/fonts/names/`, and in NOTICE), served by the app
itself in Latin, Latin Extended and, where the typeface has them, Cyrillic subsets. A browser
fetches a file only when a name on screen uses that typeface and that range of characters; they
are never precached (`PRECACHE_FILE_EXTENSIONS`). Characters a typeface lacks, Chinese for one,
fall back to the interface's typeface.

## Settings → Decorations

A preview at the top that stays in view (the profile card with its effect, a member row, a chat
line), four categories (frame, effect, nameplate, name), and a grid of every design, each tried on
in the preview before anything is saved. The save bar sends only what changed; Reset goes back to
what is stored. A change saved on another device resets the choices to it. A retired design stored
before shows as its successor, chosen, with nothing to save.

## Adding a design

1. Add the name to its list in `shared/src/decorations.ts`, where the picker should offer it.
2. Draw it in `decorationArt.tsx` in the set's style (flat tones, a darker outline, light from the
   upper left, no glow), and add it to `frameArt` and `FRAME_LAYERS`, `effectArt`/`effectSprites`
   or `nameplateArt`/`nameplateSprites`; give its particles a shape in `utils/decorations.ts` and
   its placing and motion in `styles/decorations.css`. It must stand still under Reduce motion, and
   a nameplate or effect must go under Higher contrast.
3. Give it a label in `settings:decorations.*` in every language.

Retiring a design needs no migration: add its name to the `RETIRED_*` map of its kind with the
design that takes its place.

## Known limits

- Not relayed between instances (above).
- No hover on a phone: lists there show the decorations still.
- An effect lies over the card's content; its things are few and small enough to read through, but
  they do pass over the text.
- In a narrow member list a long name, its tag or its badges can reach the nameplate's scene.
- The name typefaces have no Chinese, Japanese or Korean glyphs.
