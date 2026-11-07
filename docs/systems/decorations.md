# Profile decorations

A frame round the picture, an effect across the profile card, a nameplate behind the name in
lists, and a style for the name itself: a typeface and an effect in or on the letters. Free for
everyone. Tavvit's own designs are drawn by the client from a name the profile stores. People can
also make their own, from a picture or a name style, and share them with everyone on their
instance ("Made by people" below).

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

Made by people:

- `packages/shared/src/customDecorations.ts`: the kinds and the field each is worn in, the
  reference (`custom:<id>`), the limits, the picture boxes and templates, the effect motions
  (`EFFECT_MOTIONS`), the name style looks and their colours, `normalizeNameStyle`,
  `normalizeDecorationName`, the client's guard (`customDecorationViewOf`,
  `wornCustomDecorationsFrom`, `PICTURE_PATH`)
- `packages/server/drizzle/0075_tavvit_custom_decorations.sql`: the `custom_decorations` table
- `packages/server/src/routes/customDecorations.ts`: the gallery, one's own, making, changing,
  deleting, an administrator's removal, the pictures
- `packages/server/src/utils/customDecorations.ts`: what a profile wears (`wornCustomDecorationsOf`),
  who may wear what (`mayWearCustomDecoration`), the wearer counts, the gallery, taking a design
  away (`removeCustomDecoration`, `removeDecorationsOfUser`)
- `packages/server/src/utils/decorationImage.ts`: the picture, decoded and encoded again
- `packages/web/src/components/ui/MadeDecorationArt.tsx`: `MadePicture`, `MadeFrame`, `MadeEffect`
- `packages/web/src/components/modals/settingsPanels/decorations/`: `DesignPreview` and
  `DesignTile`, `CommunityGallery` and `MyDesigns` (`MadeDesigns.tsx`), `CreateDecorationDialog`
- `packages/web/src/utils/assetUrls.ts`: `normalizeUserAssets` makes a made design's picture
  absolute for a person read from another instance

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
its successor. A design someone made is stored as its reference, `custom:<id>`, in the same
column (frame, effect, nameplate and name effect; never the typeface), when the server finds it and
the person may wear it ("Made by people"). Anything else, a name the server does not know, a
number, an empty string, is refused with `400 profile_decoration_invalid` and `details.field`, and
nothing of that update is stored. The server checks; the picker only offers what the server takes.

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
not full of them. At rest (`hover` while nothing points at it, and `off`) a frame, a nameplate or a
name has **no animation at all**, rather than a paused one (1.38.1): a paused animation still holds a
compositing layer of its own, and so does everything it overlaps, so a channel with its member list
was 375 layers and scrolling went into arranging them; it is 21 now. Every animated part names its
animation through `--deco-move` (`animation-name: var(--deco-move, decoSpin)` after its
`animation`), which is `none` where the decoration rests and unset where it moves;
`styles/decorationMotion.test.ts` holds every animation of a frame, a nameplate or a name to it.
Effects are never in lists: in a picker's tile (`ProfileEffectLayer`'s `motion="hover"`) they pause,
caught mid-way, so the tile still shows what they are. Every tile of the decorations panel rests
until it is pointed at (the tiles and `OptionCards` are `.deco-hover`), and only the preview at the
top moves. Under Reduce motion everything is still: particles rest where they are scattered,
and what only passes by (notes, a falling star) is not shown. Under Higher contrast and in forced
colours, effects and nameplates are not drawn and a name shows in its plain colour; in forced
colours a frame is not drawn either.

**Pictures that move** (1.38.1). An animated picture of a person or a space (a GIF or a WebP) moves
as its frame does (`Avatar`'s `pictureMotion`, by default its `frameMotion`): on a profile always, in
a list or a message while the row is pointed at, elsewhere never. Where it may not move it stands on
its first frame, taken once per address and drawn on a canvas (`components/ui/StillPicture.tsx`),
because an `<img>` of an animated picture decodes and paints frames for as long as it is on screen;
the moving `<img>` is in the row only for `hover`, hidden until then (`.avatar-picture`). Reduce
motion keeps the still one. A browser without `createImageBitmap` shows the picture moving.

**Typefaces:** Fraunces, Comfortaa, Caveat, Pixelify Sans, Cinzel and Unbounded, under the SIL Open
Font License (the licence beside each in `public/fonts/names/`, and in NOTICE), served by the app
itself in Latin, Latin Extended and, where the typeface has them, Cyrillic subsets. A browser
fetches a file only when a name on screen uses that typeface and that range of characters; they
are never precached (`PRECACHE_FILE_EXTENSIONS`). Characters a typeface lacks, Chinese for one,
fall back to the interface's typeface.

## Settings → Decorations

A preview at the top that stays in view (the profile card with its effect, a member row, a chat
line), four categories (frame, effect, nameplate, name), and in each, three sources: **Tavvit** (a
grid of every design), **Community** (the instance's gallery) and **Mine** (what the person made,
and making one). Every design is tried on in the preview before anything is saved. The save bar
sends only what changed (a made design by its reference); Reset goes back to what is stored. A
change saved on another device resets the choices to it. A retired design stored before shows as
its successor, chosen, with nothing to save. A design tried on that is deleted or removed meanwhile
is let go of.

## Made by people

Anyone with an account can make a frame, an effect, a nameplate or a name style, wear it, and share
it in their instance's gallery, where everyone can wear it with one click. A shared design is
visible at once; anyone can report it, and an administrator can take it away.

**What one is made of:**

| Kind | Worn in | Made from | Stored within | The maker is told to draw at |
|------|---------|-----------|---------------|------------------------------|
| Frame | `avatarFrame` | A picture (PNG, WebP or GIF, still or moving) | 512 × 512, set in the middle of a transparent square | 420 × 420 |
| Effect | `profileEffect` | One small piece, and the motion it moves in | 256 × 256, never enlarged | 128 × 128 |
| Nameplate | `nameplate` | A picture | 960 × 160, never enlarged | 720 × 120 |
| Name style | `nameEffect` | A look and its colours | (no picture) | |

**None of them can cover what it decorates.** A picture can be anything, so each kind is drawn
inside a rule that keeps the profile readable whatever it holds:

- A **frame** lies over the picture in the view a drawn frame takes, a fifth larger on every side,
  and its middle is masked clear (`.deco-made-frame .deco-made-fill`, a radial mask to 60% of the
  way out, where the avatar's edge lies at 71%): it may reach over the outer sixth of the picture,
  as ears, a crown or a headset do, never over the person.
- An **effect** is never one picture over the card. The maker uploads one small piece (a heart, a
  leaf, a star) and chooses one of Tavvit's motions (`EFFECT_MOTIONS`): `fall` (as snow), `tumble`
  (as leaves), `rise` (as hearts), `float` (as lanterns) or `twinkle` (as stars). Tavvit sends a few
  of the piece across the card with that motion's keyframes, as particles like a drawn effect's
  (`madeEffectParticles`: at most 14, at most 30 pixels): the piece is every particle's drawing
  (`--sprite-a` from `--made-moving`, or `--made-still` under Reduce motion). The motion is stored
  in the row's `style` as `{"motion": …}` and is required: an effect without one is
  `400 decoration_style_invalid`.
- A **nameplate** lies behind the row's content and fades out towards the picture and the name,
  with the same mask a drawn one has; its picture fills the row from the far end.
- A **name style** is one of seven looks (`gradient` and `flow` with 2 or 3 colours, `wave` with 2,
  `sticker` and `comic` with 1, `retro` and `glitch` with 3; `#rrggbb`, stored in lower case,
  `normalizeNameStyle`), drawn by decorations.css with the colours as `--c1` to `--c3`
  (`data-name-made`). A role's colour wins over it, as over a drawn effect.

**The pictures.** The server decodes every picture and encodes it again as WebP (quality 85), so
what it stores is always a picture it made; only PNG, WebP and GIF (a decoration needs
transparency, which JPEG lacks), at most 6 MB as sent, 40 million decoded pixels and 300 frames. A
moving one keeps its first frame beside it, for where it must stand still. They live in
`UPLOAD_DIR/decorations/<id>.webp` and `<id>-still.webp` (written through a temporary file, out of
the attachment janitor's way) and count towards the maker's storage. `GET /api/decorations/<file>`
serves them to anyone, cached as immutable, as a picture that never runs (uploads.md). A `User`
names them by **path** (`/api/decorations/<id>.webp`, `PICTURE_PATH`): this instance's own client
fetches them from the page's origin, and a client that reads the person while signed into another
instance makes the path absolute on that instance as it arrives (`normalizeUserAssets`), like an
avatar; drawing it still goes through the consent a picture from another server needs
(`useGatedPicture`). The client's guard draws a picture only from such a path or that path on an
origin, nothing else.

**Wearing one.** A field takes `custom:<id>` when the design exists, is of that field's kind, and
is shared or the person's own (`mayWearCustomDecoration`); else `400 profile_decoration_invalid`.
A private design is wearable by its maker alone, and others then see it on the maker's profile; it
is only out of the gallery. Sharing is what lets others wear it: when its maker takes a design out
of the gallery, it goes from the others' profiles (their reference stays, and it comes back if it
is shared again), and they are announced anew (`announceWearers`). Every `User` carries `customDecorations`: what a client needs to draw
each made design it wears (`CustomDecorationView`: id, kind, name, picture, still frame, style,
motion), null for none; a reference to a design that is gone or no longer allowed is not in it, and
the field then shows nothing. The server keeps the rows it has read in memory (at most 5000) and
forgets one when it changes.

**The gallery** (`GET /api/decorations?kind&sort&q&offset`) lists the shared designs of one kind,
24 at a time: `popular` (most worn first, counted at most every 30 seconds and again as soon as
someone changes what they wear) or `new`, and a search in the names. Each shows its maker and how
many wear it. **Mine** (`GET /api/decorations/mine`) is everything the person made, shared or not.
The maker can rename one, share it or take it out of the gallery (`PATCH`), and delete it
(`DELETE`).

**Limits:** 30 designs per account (instance administrators have none), a name of 1 to 32
characters on one line without hidden characters (`normalizeDecorationName`), 10 pictures per
minute and 40 new designs per day per account.

**Taking one away.** Deleting a design, an administrator's removal and a report's `content_removed`
all do the same (`removeCustomDecoration`): the row goes, its pictures go, and every profile that
wore it shows nothing in its place, announced to everyone who sees it (`user_updated`), so it goes
from screens at once. An administrator removes one from the gallery's tile
(`POST /api/admin/decorations/:id/remove { reason, ground }`): the platform audit log gets
`decoration_remove`, and its maker a `content_removed` notice with the reason, the ground and how to
object (legal.md). Anyone can report a design they can see, shared or worn by someone (report
target `decoration`): the snapshot keeps its name, kind, maker and picture address. Deleting an
account removes everything it made, from everyone who wore it.

**Between instances.** A design lives on the instance where it was made, and a reference means
something only there: like the rest of the decorations it is not relayed, and a copy of the person
on another instance wears none. A client signed into that instance reads the person there and draws
it from there.

## Adding a design

1. Add the name to its list in `shared/src/decorations.ts`, where the picker should offer it.
2. Draw it in `decorationArt.tsx` in the set's style (flat tones, a darker outline, light from the
   upper left, no glow), and add it to `frameArt` and `FRAME_LAYERS`, `effectArt`/`effectSprites`
   or `nameplateArt`/`nameplateSprites`; give its particles a shape in `utils/decorations.ts` and
   its placing and motion in `styles/decorations.css`. Every animated part of a frame, a nameplate
   or a name takes `animation-name: var(--deco-move, <its keyframes>)` after its `animation`, so it
   has no animation at rest (a test fails otherwise). It must stand still under Reduce motion, and
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
- The gallery reads every shared design of a kind for each page and sorts in memory: fine for
  thousands, not for millions.
- A removed design's pictures are cached as immutable: a browser that fetched one may keep its copy,
  though nothing names it any more and no screen draws it.
- Removing a design worn by many announces each wearer's profile in turn, while the request waits.
- A made frame's picture lies in front of the avatar only; it has no layer behind the head, as the
  drawn ones have.
