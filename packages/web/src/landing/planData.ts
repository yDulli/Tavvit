/**
 * The plan the product page draws (Plan.tsx): one space of the demo community, Night Shift, as a
 * floor plan. Its rooms are the space's channels, the wings they stand in its categories, and the
 * marks in the rooms the people in them. It is the same space the page's pictures show
 * (`scripts/landing-shots/seed.mjs`): the same channels in the same categories, the same people
 * with the same roles, the same thread. Every kind of room on it is a part of a space the app has
 * (docs/systems/landing.md, "What it may say").
 */

/** Everyone on the plan, drawn as the app draws a person without a picture: an initial on a colour. */
export const PEOPLE = {
  mara: { initial: 'M', color: 'rgb(var(--accent-rose))' },
  yuki: { initial: 'Y', color: 'rgb(var(--accent-amber))' },
  lena: { initial: 'L', color: 'rgb(var(--accent-lavender))' },
  theo: { initial: 'T', color: 'rgb(var(--accent-mint))' },
  diego: { initial: 'D', color: 'rgb(var(--accent-sky))' },
  noor: { initial: 'N', color: 'rgb(var(--accent-peach))' },
  jonas: { initial: 'J', color: 'rgb(var(--accent-sky))' },
  sam: { initial: 'S', color: 'rgb(var(--accent-coral))' },
} as const;

export type PersonId = keyof typeof PEOPLE;

/**
 * The space's roles, as the seed makes them: their names (a space's own words, so not translated),
 * the colour a member's name takes, and the icon Raid Lead carries beside it.
 */
export const ROLES = {
  raidLead: { name: 'Raid Lead', color: '#c084fc', icon: '⚔️' },
  regulars: { name: 'Regulars', color: '#5cc491', icon: null },
  newBlood: { name: 'New Blood', color: '#60a5e6', icon: null },
} as const;

export type RoleKey = keyof typeof ROLES;

/**
 * Everyone in Night Shift as the app shows them in a conversation and in its member list: their names,
 * their handles, the colour of their avatar (the pictures' own, a white initial on it), their role, and
 * the two statuses the seed sets. Mara owns the space and has no role.
 */
export const MEMBERS: Record<PersonId, { name: string; handle: string; avatar: string; role: RoleKey | null; owner?: true; status?: string }> = {
  jonas: { name: 'Jonas Weber', handle: 'jonas', avatar: '#3d7be0', role: 'raidLead' },
  lena: { name: 'Lena Hoffmann', handle: 'lena', avatar: '#2a8f8f', role: 'raidLead' },
  noor: { name: 'Noor Haddad', handle: 'noor', avatar: '#c9507c', role: 'regulars', status: 'Developing film' },
  theo: { name: 'Theo Marchetti', handle: 'theo', avatar: '#2f9e77', role: 'regulars' },
  yuki: { name: 'Yuki Tanaka', handle: 'yuki', avatar: '#b0761c', role: 'regulars' },
  diego: { name: 'Diego Ramos', handle: 'diego', avatar: '#3d6fd0', role: 'newBlood' },
  sam: { name: 'Sam Okafor', handle: 'sam', avatar: '#d9593d', role: 'newBlood', status: 'Ranked, send snacks' },
  mara: { name: 'Mara Lindqvist', handle: 'mara', avatar: '#c9506e', role: null, owner: true },
};

/** The kinds of room: a text or a voice channel, the space's events, and its way in (the welcome page and the rules). */
export type RoomKind = 'text' | 'voice' | 'events' | 'entrance';

/** What a room says of itself under its name: who is in it and what is going on, with a count where there is one. */
export type RoomState = 'here' | 'talking' | 'watching' | 'unread' | 'upcoming' | 'rules';

export type RoomId = 'general' | 'clips' | 'lounge' | 'movie' | 'raid' | 'patch' | 'events' | 'entrance';

export interface PlanRoom {
  id: RoomId;
  kind: RoomKind;
  /** The channel's name, as the app writes it; a part of the space (its events, its way in) is named by its kind instead. */
  name: string | null;
  /** The colour of the light that falls into it: the accent family, as the app lights a place. */
  place: string;
  people: readonly PersonId[];
  /** Whoever is speaking in a voice room, ringed as the app rings them. */
  speaking?: PersonId;
  state?: RoomState;
  count?: number;
  /**
   * Where its door is: the rooms above the hall open onto it through their bottom wall, the rooms
   * below it through their top wall, and the hall, which is the way in, opens out of the house.
   */
  door: 'top' | 'bottom' | 'out';
}

/** The space's name, its categories and its invite address, as the pictures show them. */
export const PLAN_SPACE = {
  name: 'Night Shift',
  initials: 'N',
  wings: { hangout: 'Hangout', games: 'Games' },
  invite: '/join/night-shift',
  thread: { name: 'Fight notes', replies: 7 },
} as const;

/**
 * The rooms in the order a screen reader meets them: the Hangout's channels, then the Games', then
 * the hall and the events. Where each stands is the stylesheet's (`.lp-plan-floor`).
 */
export const PLAN_ROOMS: readonly PlanRoom[] = [
  { id: 'general', kind: 'text', name: 'general', place: 'rgb(var(--accent-primary))', people: ['yuki', 'theo', 'sam'], state: 'here', count: 3, door: 'bottom' },
  { id: 'clips', kind: 'text', name: 'clips', place: 'rgb(var(--accent-sky))', people: [], state: 'unread', door: 'bottom' },
  { id: 'lounge', kind: 'voice', name: 'lounge', place: 'rgb(var(--accent-mint))', people: ['diego', 'mara'], speaking: 'mara', state: 'talking', count: 2, door: 'top' },
  { id: 'movie', kind: 'voice', name: 'movie-night', place: 'rgb(var(--accent-amber))', people: ['noor'], state: 'watching', door: 'top' },
  { id: 'raid', kind: 'text', name: 'raid-planning', place: 'rgb(var(--accent-coral))', people: ['jonas', 'lena'], state: 'here', count: 2, door: 'bottom' },
  { id: 'patch', kind: 'text', name: 'patch-notes', place: 'rgb(var(--accent-lavender))', people: [], door: 'top' },
  { id: 'entrance', kind: 'entrance', name: null, place: 'rgb(var(--accent-rose))', people: [], state: 'rules', door: 'out' },
  { id: 'events', kind: 'events', name: null, place: 'rgb(var(--accent-peach))', people: [], state: 'upcoming', count: 1, door: 'top' },
];

/** Every room of the plan, for a lens that lights them all. */
export const ALL_ROOMS: ReadonlySet<RoomId> = new Set(PLAN_ROOMS.map((room) => room.id));

/** How many people are in the space. */
export const PLAN_PEOPLE = Object.keys(PEOPLE).length;
