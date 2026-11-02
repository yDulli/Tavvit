/**
 * The pages anyone can read without the app: what is running, how things work, what is new, what comes
 * (docs/systems/operations.md). Decided before any other code loads, like the product page, and
 * free of the app's modules for the same reason.
 */
export const PUBLIC_PAGE_PATHS = ['/status', '/help', '/changelog', '/roadmap'] as const;
export type PublicPagePath = (typeof PUBLIC_PAGE_PATHS)[number];

export function publicPageAt(pathname: string): PublicPagePath | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return PUBLIC_PAGE_PATHS.find((candidate) => candidate === path) ?? null;
}

export function showsPublicPage(): boolean {
  return publicPageAt(window.location.pathname) !== null;
}
