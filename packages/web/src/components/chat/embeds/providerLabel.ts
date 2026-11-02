/** How the services spell themselves; the server sends their name in lower case. */
const SPELLED: Record<string, string> = {
  youtube: 'YouTube',
};

/** A provider's name as it is shown, or null when the embed names none. */
export function providerLabel(provider: string | null | undefined): string | null {
  if (!provider) return null;
  return SPELLED[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}
