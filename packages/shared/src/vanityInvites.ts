/**
 * A space's own invite address (docs/systems/spaces.md, "Own invite address"): `/join/<name>`
 * in place of a random code. It lets people in like any other link and never runs out.
 */
export const VANITY_CODE_LIMITS = { MIN_LENGTH: 3, MAX_LENGTH: 32 } as const;

/** Small letters, digits and hyphens, with a letter or digit at each end. */
const VANITY_CODE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Names nobody may take: those that would pass for the operator or the product, and those
 * that read as a part of the site. An operator can block more by taking one away.
 */
export const RESERVED_VANITY_CODES: ReadonlySet<string> = new Set([
  'about', 'abuse', 'account', 'admin', 'administrator', 'announcements', 'api', 'app', 'apps', 'backspace', 'billing',
  'blog', 'bot', 'bots', 'changelog', 'community', 'contact', 'developer', 'developers', 'discord', 'docs', 'download',
  'downloads', 'explore', 'faq', 'help', 'home', 'imprint', 'info', 'invite', 'join', 'legal', 'login', 'logout', 'mod',
  'moderator', 'news', 'official', 'orbit', 'owner', 'privacy', 'register', 'report', 'root', 'security', 'settings',
  'signin', 'signup', 'staff', 'status', 'support', 'system', 'tavvit', 'team', 'terms', 'test', 'verified', 'www',
]);

/** The name as it is stored: trimmed and in small letters. */
export function normalizeVanityCode(value: string): string {
  return value.trim().toLowerCase();
}

export function isVanityCodeShape(code: string): boolean {
  return code.length >= VANITY_CODE_LIMITS.MIN_LENGTH
    && code.length <= VANITY_CODE_LIMITS.MAX_LENGTH
    && VANITY_CODE.test(code);
}
