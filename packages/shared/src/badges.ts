// Badges (docs/systems/badges.md): small marks next to a name or on a space
// that say something true about it. Every badge comes from one place the
// server controls, never from a role a space can hand out or from anything a
// client sends:
//
//   derived  - read from server state: an instance admin (`users.is_admin`),
//              owning the space (`spaces.owner_id`, not a role called owner),
//              a space role's bits, a verification the platform granted;
//   granted  - given by an instance admin in the admin area, recorded in the
//              platform audit log.
//
// This list is the one definition; the client draws each badge from it
// (packages/web/src/badges/), and a new badge is a new entry here.

/** Where a badge belongs. */
export type BadgeScope =
  /** The person, everywhere on this instance. */
  | 'user'
  /** The person, inside one space (owner, administrator, moderator there). */
  | 'member'
  /** The space itself. */
  | 'space';

export type BadgeSource = 'derived' | 'granted';

/**
 * What kind of thing a badge says, in the order a badge's card and the profile's grid name them:
 * the platform's own marks, a place in a space, the community, building the software, its first days.
 */
export const BADGE_CATEGORIES = ['platform', 'space', 'community', 'building', 'early'] as const;
export type BadgeCategory = (typeof BADGE_CATEGORIES)[number];

export interface BadgeDefinition {
  id: string;
  scope: BadgeScope;
  source: BadgeSource;
  category: BadgeCategory;
}

export const BADGES = [
  // Staff and ownership
  { id: 'staff', scope: 'user', source: 'derived', category: 'platform' },
  { id: 'bot', scope: 'user', source: 'derived', category: 'platform' },
  { id: 'server_owner', scope: 'member', source: 'derived', category: 'space' },
  { id: 'administrator', scope: 'member', source: 'derived', category: 'space' },
  { id: 'moderator', scope: 'member', source: 'derived', category: 'space' },
  { id: 'helper', scope: 'user', source: 'granted', category: 'community' },
  // Community and support
  { id: 'founder', scope: 'user', source: 'granted', category: 'early' },
  { id: 'early_supporter', scope: 'user', source: 'granted', category: 'early' },
  { id: 'bug_hunter', scope: 'user', source: 'granted', category: 'building' },
  { id: 'developer', scope: 'user', source: 'granted', category: 'building' },
  { id: 'creator', scope: 'user', source: 'granted', category: 'community' },
  { id: 'event_participant', scope: 'user', source: 'granted', category: 'community' },
  { id: 'community_contributor', scope: 'user', source: 'granted', category: 'community' },
  { id: 'beta_tester', scope: 'user', source: 'granted', category: 'building' },
  // Spaces
  { id: 'verified', scope: 'space', source: 'derived', category: 'platform' },
  { id: 'partner', scope: 'space', source: 'granted', category: 'platform' },
] as const satisfies readonly BadgeDefinition[];

export type BadgeId = (typeof BADGES)[number]['id'];

type BadgeOf<S extends BadgeScope, R extends BadgeSource> = Extract<(typeof BADGES)[number], { scope: S; source: R }>['id'];

/** Badges a person carries on this instance. */
export type UserBadgeId = BadgeOf<'user', BadgeSource>;
/** Badges a person carries inside one space. */
export type MemberBadgeId = BadgeOf<'member', BadgeSource>;
/** Badges a space carries. */
export type SpaceBadgeId = BadgeOf<'space', BadgeSource>;
/** Badges an instance admin gives a person. */
export type GrantedUserBadgeId = BadgeOf<'user', 'granted'>;
/** Badges an instance admin gives a space. */
export type GrantedSpaceBadgeId = BadgeOf<'space', 'granted'>;

const BY_ID: ReadonlyMap<string, (typeof BADGES)[number]> = new Map(BADGES.map((badge) => [badge.id, badge]));

export function badgeDefinition(id: string): BadgeDefinition | undefined {
  return BY_ID.get(id);
}

export function isGrantedUserBadge(value: unknown): value is GrantedUserBadgeId {
  const badge = typeof value === 'string' ? BY_ID.get(value) : undefined;
  return badge !== undefined && badge.scope === 'user' && badge.source === 'granted';
}

export function isGrantedSpaceBadge(value: unknown): value is GrantedSpaceBadgeId {
  const badge = typeof value === 'string' ? BY_ID.get(value) : undefined;
  return badge !== undefined && badge.scope === 'space' && badge.source === 'granted';
}

/** The badges an admin can give a person, in display order. */
export const GRANTED_USER_BADGES = BADGES.filter((badge) => badge.scope === 'user' && badge.source === 'granted').map((badge) => badge.id) as GrantedUserBadgeId[];
/** The badges an admin can give a space, in display order. */
export const GRANTED_SPACE_BADGES = BADGES.filter((badge) => badge.scope === 'space' && badge.source === 'granted').map((badge) => badge.id) as GrantedSpaceBadgeId[];

/** `ids` in the order of `BADGES`, each once; ids this list does not know (a newer host's) are left out. */
export function orderedBadges<T extends string>(ids: readonly T[]): T[] {
  const wanted = new Set<string>(ids);
  return BADGES.filter((badge) => wanted.has(badge.id)).map((badge) => badge.id as string as T);
}
