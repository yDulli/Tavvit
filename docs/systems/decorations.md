# Profile decorations

A frame round the picture, an effect over the profile's banner, a nameplate behind the name in
lists, and a style for the name itself: a typeface and light inside the letters. Free for
everyone. Every design is Tavvit's own, drawn by the client in CSS from a name the profile
stores; nothing is uploaded, and nothing loads from another server.

## Files

- `packages/shared/src/decorations.ts`: the names (`AVATAR_FRAMES`, `PROFILE_EFFECTS`,
  `NAMEPLATES`, `NAME_FONTS`, `NAME_EFFECTS`), `PARTICLE_FRAMES`, the guards, `decorationsOf`
  (what a profile shows), `decorationUpdateOf` (what an update asks), `DECORATION_FIELDS`
- `packages/server/src/routes/users.ts`: `PATCH /api/users/@me` takes and checks them
- `packages/server/src/utils/sanitize.ts`: every `User` carries them; `utils/userDeletion.ts`
  clears them
- `packages/server/drizzle/0073_tavvit_profile_decorations.sql`: the five columns
- `packages/web/src/styles/decorations.css`: every design, the motion rules, the accessibility rules
- `packages/web/src/styles/nameFonts.css`, `packages/web/public/fonts/names/`: the name typefaces
- `packages/web/src/utils/decorations.ts`: `personDecorations`, `decorationColors`, the particles
- `packages/web/src/components/ui/Decorations.tsx`: `ProfileEffectLayer`, `CardTopEffect`,
  `NameplateLayer`, `DecoratedName`
- `packages/web/src/components/ui/Avatar.tsx`: the `frame` and `frameMotion` props
- `packages/web/src/components/modals/settingsPanels/DecorationsPanel.tsx`: Settings → Decorations

## The designs

| Kind | Field | Names |
|------|-------|-------|
| Frame | `avatarFrame` | metal `silver`, `gilded`, `rosegold`, `obsidian`; colour `ember`, `tide`, `bloom`, `aurora`, `prism`, `theme`; pattern `orbit`, `binary`, `dial`, `pulse`; with particles `stardust`, `frost`, `kindling`, `blossom`, `fizz` |
| Effect | `profileEffect` | `stars`, `sparkles`, `shooting`, `nebula`, `aurora`, `sunbeams`, `snow`, `rain`, `waves`, `bubbles`, `fireflies`, `embers`, `petals`, `leaves`, `hearts`, `confetti` |
| Nameplate | `nameplate` | `dusk`, `tide`, `ember`, `moss`, `theme`, `aurora`, `sunset`, `holo`, `nebula`, `starlit`, `snow`, `rain`, `sakura`, `embers`, `pinstripe`, `waves`, `circuit` |
| Name typeface | `nameFont` | `classic` (the interface's own, stored as none), `mono`, `serif`, `round`, `hand`, `pixel`, `engraved`, `wide` |
| Name effect | `nameEffect` | `shimmer`, `gold`, `silver`, `frost`, `aurora`, `sunset`, `ocean`, `candy`, `ember`, `prism`, `theme` |

The lists' order is the picker's. `theme` ("Your colours") takes the person's profile theme, or
without one the colour of their picture's tile (`decorationColors`), so it is theirs either way.

## Stored, checked, sent

Five text columns on `users` (`avatar_frame`, `profile_effect`, `nameplate`, `name_font`,
`name_effect`, migration 0073), NULL for none. Only the account itself writes them, with
`PATCH /api/users/@me` (api.md, "Decorations"): a name of a design, or null to clear it; the classic
typeface is stored as NULL. Anything else, a name the server does not know, a number, an empty
string, is refused with `400 profile_decoration_invalid` and `details.field`, and nothing of that
update is stored. The server checks; the picker only offers what the server takes.

Every `User` the server sends carries the five fields, null for none, read through
`decorationsOf`: a name stored before a design was retired shows as none. They are sent even when
null because clients merge an update over the copy they hold (`{ ...current, ...event.user }`); a
field left out would keep a decoration that was taken off. A change goes out as `user_updated` to
everyone who sees the profile (`announceProfileChange`). Deleting the account clears them, and the
personal export has them in `account.json`.

Like pronouns, links and the layout (auth.md, "Profile fields"), they are kept on the instance that
stores the profile and **not relayed to federation peers**: a profile shows them wherever this
instance shows it, and another instance's copy of the person carries none.

## Where they show

| Surface | Frame | Effect | Nameplate | Name style | Moves |
|---------|-------|--------|-----------|------------|-------|
| Profile card, full profile (`UserProfilePopout`, `UserProfileModal`) | yes | over the banner | | yes | always |
| The account panel's preview, the decorations panel's preview | yes | over the banner | the list row | yes | always |
| Member list (`MemberSidebar`, `MobileMembersScreen`) | yes | | yes | yes | while the row is pointed at |
| DM list, a conversation with one person (`DmListItem`, `MobileDmsScreen`) | yes | | yes | yes | while the row is pointed at |
| A message's author (`Message`) | yes | | | yes | while the message is pointed at |

On the compact layout, which has no banner, the effect plays across the top of the card instead
(`CardTopEffect`), as high as the banner would be (`ProfileHeaderLook.effectHeight`). Reply
previews, mentions, voice tiles, reactions and the like stay plain. A phone has no pointer, so its
lists show the decorations still. An offline member's row dims them with the rest of the row.

**A role's colour wins over the name's effect.** In a space where a role (or the owner's colour)
gives the name its colour, the name shows that colour and its typeface, without the effect
(`DecoratedName`'s `roleColored`). The colour says something about the person in that space; the
effect is only decoration.

## How they are drawn

- **Frame:** a box larger than the picture by the frame's width and gap on every side, its corner
  the picture's corner plus that, so the curves run side by side and follow `--avatar-roundness`;
  the ring is cut out of it with a mask (`.deco-frame-ring`). It shares the status dot's cutout.
  Its light turns through the registered property `--deco-angle`; the heartbeat uses `--deco-pulse`.
  Width and gap grow with the picture (`frameMetrics`, 2 to 5 and 2 to 4 pixels).
- **Particles** (particle frames, effects, some nameplates) are `<i>` elements placed by a small
  seeded generator (`utils/decorations.ts`), the same on every screen, each already under way
  when first seen. What falls or rises crosses the whole box: `--fall` is the box's height.
- **Effect:** a layer over the banner, under the card's content, fading out before the text.
- **Nameplate:** colour gathered at the far end of the row, masked away from the picture and the
  name. It lies at `z-index: -1` in a row that is its own stacking context (`isolate`): over the
  row's background, hover and selection, under its content.
- **Name:** `data-name-font` sets the typeface; `data-name-effect` paints a gradient into the
  letters (`background-clip: text`). No glow round the text (design-system.md).

**Motion** (`data-motion`): `on` moves always, `hover` only while the surrounding `.deco-hover`
(the row, the message) is pointed at or focused, `off` never. A frame's particles in `hover` mode
appear only then, so a list is not full of specks. Under Reduce motion everything is still, the
particles resting where they are scattered and shooting stars gone. Under Higher contrast and in
forced colours, effects and nameplates are not drawn and a name shows in its plain colour; a frame
stays, in forced colours as `CanvasText`.

**Typefaces:** Fraunces, Comfortaa, Caveat, Pixelify Sans, Cinzel and Unbounded, under the SIL Open
Font License (the licence beside each in `public/fonts/names/`, and in NOTICE), served by the app
itself in Latin, Latin Extended and, where the typeface has them, Cyrillic subsets. A browser
fetches a file only when a name on screen uses that typeface and that range of characters; they
are never precached (`PRECACHE_FILE_EXTENSIONS`). Characters a typeface lacks, Chinese for one,
fall back to the interface's typeface.

## Settings → Decorations

A preview at the top that stays in view (the profile card, a member row, a chat line), four
categories (frame, effect, nameplate, name), and a grid of every design, each tried on in the
preview before anything is saved. The save bar sends only what changed; Reset goes back to what is
stored. A change saved on another device resets the choices to it.

## Adding a design

1. Add the name to its list in `shared/src/decorations.ts`, where the picker should offer it.
2. Draw it in `styles/decorations.css` (and add its particles' shape in `utils/decorations.ts`
   if it has any). Keep to the rules above: behind content, no glow, still under Reduce motion,
   gone under Higher contrast if it lies behind text.
3. Give it a label in `settings:decorations.*` in every language.

Retiring a design needs no migration: a stored name the client does not know shows as none.

## Known limits

- Not relayed between instances (above).
- No hover on a phone: lists there show the decorations still.
- The name typefaces have no Chinese, Japanese or Korean glyphs.
