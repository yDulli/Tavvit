# Badges

Source files:
- `packages/shared/src/badges.ts` -- The registry (`BADGES`): scopes, sources, the id types, `orderedBadges()`, the granted lists
- `packages/server/src/utils/badges.ts` -- `userBadgesOf()`, `spaceBadgesOf()`, `grantedUserBadgesOf()`, `grantedSpaceBadgesOf()`
- `packages/server/src/utils/spaceWire.ts` -- `memberStaffBadges()` (administrator and moderator from role bits), `spaceToWire()`, `memberToWire()`
- `packages/server/src/utils/sanitize.ts` -- `sanitizeUser()` puts `badges` on every user the server sends
- `packages/server/src/utils/adminUser.ts` -- `AdminUser.grantedBadges`
- `packages/server/src/routes/platformAdmin.ts` -- The two grant routes, the admin area's space summaries
- `packages/server/src/routes/explore.ts` -- `ExploreSpace.badges`
- `packages/server/src/utils/reviewNotify.ts` -- `announceUserUpdate()`, `announceSpaceUpdate()`
- `packages/web/src/badges/BadgeGlyph.tsx` -- One picture per badge (`images/<id>.webp`)
- `packages/web/src/badges/BadgeList.tsx` -- `BadgeList`, `memberBadgeIds()`
- `packages/web/src/badges/BadgeCard.tsx` -- What a badge says when clicked
- `packages/web/src/badges/badgeText.ts` -- `useBadgeText()`
- `packages/web/src/hooks/useProfileMember.ts` -- `useProfileBadges()`
- `packages/web/src/locales/*/common.json` -- `common:badges.<id>.name` and `.description`
- `assets/brand/badge sheet.png` -- The badge sheet: 8 rows of 8 metal marks, the pictures are cut from it
- `scripts/badges/cut.mjs` -- Cuts the registry's pictures out of the sheet (`BADGE_CELLS`: which mark is which badge)

---

## Model

A badge is a small mark next to a person's name or on a space that says something true about it. Every badge comes from one place the server controls: never from a role a space can hand out as a platform mark, never from anything a client sends.

| Source | Where it comes from | Stored |
|--------|---------------------|--------|
| `derived` | Server state, read each time the wire shape is built: an instance admin (`users.is_admin`), a verification the platform granted (`spaces.verification_status`), the permission bits of a member's space roles, owning the space (`spaces.owner_id`) | Never |
| `granted` | An instance admin, in the admin area ([admin.md](admin.md), "Badges (grants)"), recorded in the platform audit log | JSON array in `users.badges` or `spaces.badges` |

| Scope | Belongs to | Shown |
|-------|-----------|-------|
| `user` | The person, everywhere on the instance that sends their row | On their profile: the card and the full profile |
| `member` | The person inside one space (owner, administrator, moderator there) | In that space only: on a profile opened from it |
| `space` | The space itself | On the space: its header, its Explore card, the admin area |

The badge columns are new with migration 0041. They have nothing to do with the `badges` and `user_badges` tables of migration 0034, which 0038 dropped; there is no badge table.

---

## The registry

`BADGES` in `packages/shared/src/badges.ts` is the one definition. Each entry is `{ id, scope, source }`; the array order is the display order everywhere.

| Id | Scope | Source | Name (en) | Comes from |
|----|-------|--------|-----------|------------|
| `staff` | user | derived | Staff | `users.is_admin = 1` on the instance that sends the row |
| `bot` | user | derived | Bot | `users.account_kind = 'bot'` on the instance that sends the row ([bots.md](bots.md)) |
| `server_owner` | member | derived | Space owner | The member's id is the space's `ownerId` (added by the client, `memberBadgeIds()`) |
| `administrator` | member | derived | Administrator | One of the member's roles, @everyone left out, holds `ADMINISTRATOR` |
| `moderator` | member | derived | Moderator | One of those roles holds `KICK_MEMBERS`, `BAN_MEMBERS`, `MODERATE_MEMBERS` or `MANAGE_MESSAGES`, and none holds `ADMINISTRATOR` |
| `helper` | user | granted | Helper | An admin's grant |
| `founder` | user | granted | Founder | An admin's grant |
| `early_supporter` | user | granted | Early supporter | An admin's grant |
| `bug_hunter` | user | granted | Bug hunter | An admin's grant |
| `developer` | user | granted | Developer | An admin's grant |
| `creator` | user | granted | Creator | An admin's grant |
| `event_participant` | user | granted | Event participant | An admin's grant |
| `community_contributor` | user | granted | Community contributor | An admin's grant |
| `beta_tester` | user | granted | Beta tester | An admin's grant |
| `verified` | space | derived | Verified | `spaces.verification_status = 'verified'` ([admin.md](admin.md), "Verification") |
| `partner` | space | granted | Partner | An admin's grant |

**Types:** `BadgeId`; `UserBadgeId`, `MemberBadgeId`, `SpaceBadgeId` (every badge of a scope); `GrantedUserBadgeId`, `GrantedSpaceBadgeId` (the ones an admin gives). They are derived from the array, so a new entry widens them.

**Helpers:**
- `badgeDefinition(id)`: the entry, or undefined.
- `isGrantedUserBadge(value)`, `isGrantedSpaceBadge(value)`: true only for a known id of that scope with source `granted`.
- `GRANTED_USER_BADGES`, `GRANTED_SPACE_BADGES`: the badges an admin can give, in display order.
- `orderedBadges(ids)`: the ids in registry order, each once; ids the registry does not know (a newer host's) are left out, so an older client shows the rest instead of failing.

---

## Where each badge comes from

### A person: `userBadgesOf(row)`

`utils/badges.ts`: the granted badges read from `users.badges`, plus `staff` when `is_admin = 1`, in registry order. `sanitizeUser()` puts the result on `User.badges`, so every user the server sends carries it: the ready payload, member rows, profiles, `user_updated`. A tombstoned account is sent `badges: []`.

### A space: `spaceBadgesOf(row)`

The granted badges read from `spaces.badges`, plus `verified` while `verification_status = 'verified'`. `spaceToWire()` puts it on `Space.badges`, so every space the server sends carries it (the ready payload, the space detail and lists, join answers, `space_updated`); the Explore listing and the admin area call it too.

### A member: `memberStaffBadges(roles, assignedRoleIds, spaceId)`

`utils/spaceWire.ts`. Worked out by the instance that hosts the space, because members cannot see role bits ([permissions.md](permissions.md)). It joins the permission bits of the member's assigned roles, leaving out @everyone (whose id is the space id: what everyone holds marks nobody), and answers `['administrator']` when `ADMINISTRATOR` is among them, else `['moderator']` when any moderation bit is, else `[]`. Never both. Only the roles count, not the resolved permissions: an instance admin, who holds every permission in every space of that instance, shows `staff` there, and `administrator` only when a role of theirs gives it. The result is `MemberWithUser.badges`, sent with the member lists (the ready payload, `GET /api/spaces/:id`, `GET /api/spaces/:id/members`, the space built for a new member after a public join or an accepted request) and with `member_updated` (`loadMemberWire()`). `member_joined` carries `[]`: a member who just joined holds no role. After a change to the roles or to a member's roles, members are sent `space_access_changed` and refetch the space detail, which carries the new member badges.

### Owning the space: `memberBadgeIds(member, space)`

`server_owner` is never sent. The client adds it in `memberBadgeIds()` (`packages/web/src/badges/BadgeList.tsx`) when the member's id is the space's `ownerId`; both ids come from the instance that hosts the space. The owner outranks every role, so for the owner `administrator` and `moderator` are dropped beside the crown. The owner group (`ownerGroup`) and the owner title (`ownerTitle`) only change how the member list groups and heads the owner; on the profile the title is shown as a note on the crown's name ("Space owner · Captain").

### Granted badges

Read through `grantedUserBadgesOf()` and `grantedSpaceBadgesOf()`, which keep only known granted badges of that scope, in order, each once. The grant routes and their rules: [admin.md](admin.md), "Badges (grants)".

---

## Security rules

1. **Platform badges exist only server-side.** `staff` and `verified` are never stored and never accepted from a request. Staff follows `users.is_admin`, which changes only through an admin's `PATCH /api/admin/users/:id/role` or the server's own admin bootstrap ([deployment.md](deployment.md)); verified follows `spaces.verification_status`, which only an instance admin's verification decision sets to `verified`. The grant routes accept only granted badges of the right scope (`400 badge_invalid` for staff, verified, a badge of the other scope or an unknown id), and reading a stored list drops anything else, so a hand-edited row cannot hand out staff or verified.
2. **Nothing a client sends becomes a badge.** The only writes are `PUT /api/admin/users/:id/badges` and `PUT /api/admin/spaces/:id/badges`, behind `requireAdmin`. No profile or space route reads a `badges` field. The client renders what the server sent, plus the owner's crown from the owner id.
3. **Roles never become platform badges.** What a space's roles can give is the member-scope `administrator` or `moderator`, worked out on the server from permission bits, never from a role's name, colour or position. A role called "Staff", "Admin" or "Owner" gives nothing its bits do not, and no role bit gives `staff`, `verified` or a granted badge. Member badges show only inside their space.
4. **The owner is detected by `owner_id`.** The crown comes from `Space.ownerId` against the member's id, never from a role, the owner group or the owner title.
5. **Badges are per instance.** The badges on a row are what the instance that sent it says. No federation route or relay reads or writes the badge columns, so a peer never stores or forwards another instance's badges. `staff` marks an administrator of the instance that sent the row: in a space hosted elsewhere it marks that host's admins. A federated account cannot be made an admin (`federated_user_cannot_be_admin`), so a replicated row never shows staff; an admin can give a granted badge to a federated account's row on their instance, and it shows wherever that instance sends the row.

---

## Wire fields

| Field | Type | Carries |
|-------|------|---------|
| `User.badges` | `UserBadgeId[]` | staff and the granted person badges, in registry order; `[]` for a deleted account |
| `MemberWithUser.badges` | `MemberBadgeId[]` | `administrator` or `moderator` from role bits; never `server_owner` |
| `Space.badges` | `SpaceBadgeId[]` | verified and the granted space badges |
| `ExploreSpace.badges` | `SpaceBadgeId[]` | the same, on the Explore listing |
| `AdminUser.grantedBadges` | `GrantedUserBadgeId[]` | only what admins gave, never staff |
| `AdminSpaceSummary.badges`, `.grantedBadges` | `SpaceBadgeId[]`, `GrantedSpaceBadgeId[]` | every badge the space shows; what admins gave |
| `BadgeGrantBody` | `{ badges: string[]; reason?: string \| null }` | the body of both grant routes |

`User.badges`, `MemberWithUser.badges`, `Space.badges` and `ExploreSpace.badges` are optional: hosts that predate badges send none, and every reader takes absent as `[]`. The directory document and `DirectoryEntry` carry no badges, so Outer Space cards show none; `UserSearchResult` carries none either.

**How a change reaches clients:**

| Change | Event |
|--------|-------|
| An admin changes a person's granted badges | `user_updated` to the person (self view) and to everyone who sees them: space co-members, DM co-members, friends |
| An admin changes a space's granted badges | `space_updated` to the space's members |
| A verification is approved or revoked | `space_updated` to the space's members, with every verification step |
| A role or a member's roles change | `space_access_changed`; members refetch the space detail |
| An account is made or unmade an admin | `user_updated` to that person only (`routes/admin.ts`); others see `staff` come or go when they next load that person |

---

## Web components

`packages/web/src/badges/`:

- **`BadgeGlyph({ id, size })`**: the badge's picture, an `<img>` of `size` pixels with an empty `alt` and `aria-hidden` (what holds it carries the name). `PICTURES` is a `Record<BadgeId, string>` of the files in `badges/images/`, bundled with a hash in their names, so a registry entry without a picture does not compile.
- **`BadgeList({ badges, size = 'sm', max, notes })`**: the badges in registry order (`orderedBadges`), nothing when there are none. Sizes `sm` 16px, `md` 18px, `lg` 20px, 4px apart. Each glyph says its name in a `Tooltip` and, when clicked or pressed, opens `BadgeCard`. It is a `listitem` of a `list` and carries its name as `aria-label`. `max` shows the first badges and a mono `+N` for the rest (hidden from assistive technology). `notes` adds a word to a badge's name, used for the owner title on the crown.
- **`BadgeCard({ id, name, description, anchorRef, onClose })`**: the small card a click opens: the picture at 28px on a plain sunken tile (`bg-surface-input`, a `border-soft` hairline), the name and what it means. It portals above whatever opened it and leaves that open; a press anywhere else or Escape closes only the card. A badge is a `span` with `role="button"`, not a `button`, because it can sit inside one (a space's header), and its click goes no further than itself.
- **`memberBadgeIds(member, space)`**: every badge a person shows inside a space: their own (`member.user.badges`), the ones their roles give (`member.badges`), and the crown for the owner (see above).
- **`useBadgeText()`**: each badge's name and description from `common:badges.<id>.name` and `.description`, a `Record<BadgeId, BadgeText>`, so a badge without text does not compile.

`useProfileBadges(user, member)` (`hooks/useProfileMember.ts`) decides what a profile shows: opened for a member of the space that is loaded, `memberBadgeIds()` with the owner title; opened anywhere else, the person's own badges.

---

## Where badges show

| Surface | Component | Badges | Size |
|---------|-----------|--------|------|
| Profile popout | `UserProfilePopout` | `useProfileBadges()`, beside the handle | `sm` |
| Full profile (and the phone's profile screen) | `UserProfileModal` | `useProfileBadges()`, beside the handle | `md` |
| Space header | `ChannelSidebar` | `space.badges` | `sm` |
| Explore card (Inner Space) | `SpaceCard` | `space.badges` | `md` |
| Listing preview | `ListingPreview` (`components/review/ReviewParts.tsx`): the owner's Discovery tab and the admin's space detail | the space's badges | `sm` |
| Admin area | `ReviewQueuePanel`, `PlatformSpacesPanel`, `AdminSpaceDetailModal` | `AdminSpaceSummary.badges` | `sm` |
| Admin grant forms | `AdminUserDetailModal`, `AdminSpaceDetailModal` | a checkbox per badge that can be given, with its 16px picture and its name | -- |
| Platform audit log | `PlatformAuditList` | badge names in "added" and "removed" lines | text |

Outside the admin area, a person's badges show on their profile and nowhere else. The member lists (`MemberSidebar`, `MobileMembersScreen`) and a message's author line (`Message.tsx`) carry none: there a name is marked by its top role's colour or gradient (`memberNameStyle`, `utils/memberGroups.ts`) and the role's emoji. The one mark the member lists keep is the owner's crown while the owner is listed among the roles (`ownerGroup` off): an `Icon`, not a badge, named with the owner title or "Owner". A profile opened from a space shows the name in the same role colour or gradient (`useProfileNameStyle`, `hooks/useProfileMember.ts`) and each role chip's name in its role's (`ProfileRoles`, `roleTextStyle`).

---

## Design rules

- **Pictures cut from the sheet.** Each badge is one mark of `assets/brand/badge sheet.png`, matte metal on a dark face, cut out by `scripts/badges/cut.mjs` and written as a 72px WebP into `packages/web/src/badges/images/`, sharp from 16px next to a name to 28px on the card. The script finds each mark by its crisp edges and takes the sheet's ground, its light, the shadows and the glows away as one soft field, so a badge lies flat on any surface; whatever a rim encloses stays whole. The sheet draws more marks than the registry holds (flags, months and years, more shields): only registry entries exist in the product, and `node scripts/badges/cut.mjs --preview <dir>` shows every mark cut out, to choose from.
- **No light, no chip.** A badge is its picture: no glow, no colour of a tone, no pill, no border. Under the pointer it grows a little and nothing lights up; on its card it sits on a plain sunken tile.
- **Every badge names itself.** A tooltip gives the name and so does the accessible label; a click opens the card with its meaning, also on a touch screen. A person's badges stand in one place on a profile, beside the handle, and are not repeated further down.
- **A fixed order, short rows.** The registry decides the order on every surface. A dense row can cap the count (`max`) and show `+N`; the profile shows all.
- **On the profile, not on the name.** Lists and messages, where names repeat, stay free of badges; a person's badges are read on their profile.

---

## Adding a badge

1. Add an entry to `BADGES` in `packages/shared/src/badges.ts` (`id` in snake_case, `scope`, `source`) where it should sort.
2. Choose its mark on the sheet: its row and column in `BADGE_CELLS` (`scripts/badges/cut.mjs`). Run `node scripts/badges/cut.mjs`, and import the new picture into `PICTURES` (`packages/web/src/badges/BadgeGlyph.tsx`). A mark the sheet does not have is drawn into the sheet first.
3. Give it text: an entry in `useBadgeText()` (`badgeText.ts`) and `common:badges.<id>.name` and `.description` in every catalog (`packages/web/src/locales/{en,de,pt,ru,zh}/common.json`).
4. A **granted** badge needs nothing more: the admin area's checkboxes list `GRANTED_USER_BADGES` or `GRANTED_SPACE_BADGES`, the grant routes accept it through `isGrantedUserBadge` or `isGrantedSpaceBadge`, the stored list keeps it, and the audit log names it.
5. A **derived** badge is worked out on the server from server state only: in `userBadgesOf()` or `spaceBadgesOf()` (`utils/badges.ts`) for a person or a space, in `memberStaffBadges()` (`utils/spaceWire.ts`) for a member. Never from a role's name, never from a field a client sends; a space's roles may give member-scope badges only.
6. Clients that do not know the new id leave it out (`orderedBadges`), so the server can send it before every client has the drawing.
7. Add it to the registry table above, and for a derived badge say where it comes from.
