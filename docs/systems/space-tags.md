# Space tags

A short mark a space can have: two to four letters or digits beside a symbol of Tavvit's own set,
in one of the accent colours. Its members can wear it beside their name wherever this instance
shows them, and a click on it shows the space, with a way in. A community is seen by everyone its
people meet. The space decides the tag; each member decides whether to wear it.

## Files

- `packages/shared/src/spaceTags.ts`: `SpaceTag`, `WornSpaceTag`, `SPACE_TAG_COLORS`, `SPACE_TAG_LIMITS`, `checkSpaceTag`, `spaceTagOf`, `wornSpaceTagOf`, the stored-column readers
- `packages/server/src/utils/spaceTags.ts`: `wornSpaceTagFor`, `refreshSpaceTagWearers`, `releaseSpaceTag`, `releaseSpaceTagsOf`, `announceSpaceTagChange`
- `packages/server/src/routes/spaces.ts`: `PATCH /api/spaces/:id` takes `tag`; leaving, being kicked and being banned release it
- `packages/server/src/routes/users.ts`: `PATCH /api/users/@me` takes `spaceTag`
- `packages/server/src/routes/explore.ts`: `GET /api/spaces/:id/tag`
- `packages/server/src/utils/spaceDeletion.ts`: a deleted space takes its tag off everyone
- `packages/web/src/components/ui/SpaceTag.tsx`: `SpaceTagChip`, `SpaceTagMark`, `shownSpaceTag`, the card
- `packages/web/src/components/modals/spaceSettingsPanels/SpaceTagPanel.tsx`: Space settings → Tag
- `packages/web/src/components/modals/spaceSettingsPanels/YourSpacePanel.tsx`: wearing it, in Your settings

## The rules

`checkSpaceTag` is the one rule, applied by the server and read again by every client:

- **Text:** 2 to 4 characters after trimming and NFC, letters and digits only (`\p{L}\p{N}`), and from
  one of the scripts that look alike (Latin, Cyrillic, Greek) at most, so `MОD` with a Cyrillic `О` is
  refused. Kept as typed, not uppercased.
- **Reserved:** words that would read as a mark of the platform or of a role, in any case: `MOD`,
  `MODS`, `ADM`, `ADMN`, `STAF`, `TEAM`, `SYS`, `BOT`, `BOTS`, `HELP`, `OWNR`, `TAV`, `TAVV`.
  Badges are the platform's marks ([badges.md](badges.md)); a tag must not pass for one.
- **Symbol:** a glyph of the role set (`ROLE_GLYPH_IDS`, shared/src/roleGlyphs.ts).
- **Colour:** `silver`, `mint`, `peach`, `lavender`, `sky`, `amber`, `rose`, `coral`, drawn with the
  theme's tokens.

Refusals: `400 space_tag_invalid` with `details: { min, max, reason }` (`length`, `characters`,
`glyph`, `color`), `400 space_tag_reserved`.

## Stored and sent

- `spaces.tag`: JSON `{ text, glyph, color }`, null for none (migration 0074). Set with
  `PATCH /api/spaces/:id` `{ tag }` (MANAGE_SPACE; null takes it away). Every `Space` carries `tag`.
- `users.space_tag`: the tag the person wears, a copy `{ spaceId, text, glyph, color }`, null for
  none. Set with `PATCH /api/users/@me` `{ spaceTag: spaceId | null }`; the space must be of this
  instance, have a tag, and the person must be its member (`400 space_tag_unavailable` otherwise).
  Every `User` carries `spaceTag`, null for none, sent as null so that an update merged over an
  older copy takes it off ([decorations.md](decorations.md) says why).

The copy keeps every list of people reading it with the rest of the profile, without a join. It
follows the space (`utils/spaceTags.ts`): a changed tag is written into every wearer's copy, a
removed tag clears them, and so do leaving, a kick, a ban and the space being deleted. Each change
is announced as `user_updated` (`announceProfileChange`). Deleting an account clears it.

Not relayed to federation peers: a tag shows wherever this instance shows the person, and a person
wears tags of spaces on the instance their account row is on. A space on another instance shows
"its tag is worn with an account there".

## Where it shows

Beside the name in a message's author line, in the member lists (desktop and phone) and on the
profile card and full profile. In a member list the tag comes from the row the space's instance
sent, and its card asks that instance. Reply previews, mentions and the like stay plain.

**The card** (`GET /api/spaces/:id/tag`, signed in): the space as Explore shows it (name, picture,
description, member count, visibility, whether the asker is in it) and its tag; `404
space_tag_unavailable` without a tag. It offers: open (a member), join (public, the Explore flow
`publicJoin`), ask to join (`request`), nothing but "by invitation only" (private), and wearing or
taking off the tag for a member on the page's own instance.

**A private space with a tag** shows its name, picture, description and member count to anyone
signed in on the instance who opens the card; joining still needs an invite. The Tag panel says so
for a private space before anyone sets one.

## Settings

- **Space settings → Tag** (MANAGE_SPACE): a preview beside the editor's own name, the letters, the
  symbol grid (the role set by group) and the colour swatches; save, or remove (which takes it off
  everyone).
- **Space settings → Your settings → Space tag**: wear it or take it off.
- The card: wear it or take it off.

## Design

`.space-tag` (globals.css): 16px tall, Geist Mono 10px semibold, the colour's text on a 10% ground
with a 32% hairline, a small radius, no glow; `data-color` picks the token, `data-static` for the
mark that is not a control (the card, the previews).

## Known limits

- Not relayed between instances (above).
- One tag per person.
- Retiring a glyph from the role set makes a tag that names it show nothing until the space picks
  another (`spaceTagOf`).
