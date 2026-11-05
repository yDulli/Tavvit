/**
 * Which item of the home block (the first group in the DM sidebar) is selected.
 *
 * One function for every item, because the selection is one fact: an inline
 * condition per item is how a fifth page ends up with two items selected at
 * once. The space rail's home tile reads it too, to stay lit on every page of
 * the home area.
 *
 * `/inbox`, `/friends`, `/explore` and `/about` are pages in the main area and win over a
 * lingering channel id. Anywhere else the Home dashboard is what shows when no
 * channel is open (`showsHomeDashboard`), and with a channel open (a
 * conversation) none is selected.
 */

export type HomeNavItem = 'home' | 'inbox' | 'friends' | 'explore' | 'about';

/** The route of every home page that has its own path; Home is `/channels/@me`. */
export const HOME_ROUTES = {
  home: '/channels/@me',
  inbox: '/inbox',
  friends: '/friends',
  explore: '/explore',
  about: '/about',
} as const satisfies Record<HomeNavItem, string>;

/**
 * Home's rows that fold under "More" in the column: seldom needed, carrying no count, and reachable
 * elsewhere (Explore is the top bar's compass, both are in Ctrl K). One list, read by the column and by
 * what opens the group when one of them is reached another way.
 */
export const HOME_NAV_MORE = ['explore', 'about'] as const satisfies readonly HomeNavItem[];

/** Whether a row of Home's navigation is one of those under "More". */
export function isHomeNavMoreItem(item: HomeNavItem | null): boolean {
  return item !== null && (HOME_NAV_MORE as readonly HomeNavItem[]).includes(item);
}

export function activeHomeNavItem(pathname: string, currentChannelId: string | null): HomeNavItem | null {
  if (pathname === HOME_ROUTES.inbox) return 'inbox';
  if (pathname === HOME_ROUTES.friends) return 'friends';
  if (pathname === HOME_ROUTES.explore) return 'explore';
  if (pathname === HOME_ROUTES.about) return 'about';
  if (currentChannelId === null) return 'home';
  return null;
}

/** Whether `pathname` is one of the pages that live beside the space routes. */
export function isHomeAreaPath(pathname: string): boolean {
  return pathname === HOME_ROUTES.inbox || pathname === HOME_ROUTES.friends || pathname === HOME_ROUTES.explore || pathname === HOME_ROUTES.about;
}

/**
 * The search parameter that opens the Friends page on one of its views, and
 * the views it can name: the Add Friend search and the pending requests. The
 * page reads it once and drops it, so a later visit opens on the online list
 * again.
 */
export const FRIENDS_VIEW_PARAM = 'view';
export type FriendsLinkView = 'add' | 'pending';

export function isFriendsLinkView(value: string | null): value is FriendsLinkView {
  return value === 'add' || value === 'pending';
}

/** The Friends page opened on its Add Friend view. */
export const FRIENDS_ADD_PATH = `${HOME_ROUTES.friends}?${FRIENDS_VIEW_PARAM}=add`;
/** The Friends page opened on the requests waiting for an answer. */
export const FRIENDS_PENDING_PATH = `${HOME_ROUTES.friends}?${FRIENDS_VIEW_PARAM}=pending`;

/** What decides whether the main area shows the Home dashboard. */
export interface HomeDashboardView {
  pathname: string;
  /** The DM side of the app is showing (`/channels/@me`). */
  showDms: boolean;
  currentSpaceId: string | null;
  currentChannelId: string | null;
}

/**
 * Whether the main area shows the Home dashboard: the DM side with no
 * conversation open, and none of the pages above on screen. MainContent
 * renders HomePage on exactly this condition, and the people column stays out
 * of the way on it, because the dashboard lists who is online itself.
 */
export function showsHomeDashboard(view: HomeDashboardView): boolean {
  if (isHomeAreaPath(view.pathname)) return false;
  return (view.showDms || !view.currentSpaceId) && !view.currentChannelId;
}
