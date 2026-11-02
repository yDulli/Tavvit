import { readFileSync } from 'node:fs';

/**
 * Throwaway mail domains (email/throwawayDomains.txt; docs/systems/email.md, "Throwaway addresses"),
 * read once, the first time one is asked about: about ten thousand lines a server rarely needs
 * before its first sign-up.
 */
let domains: ReadonlySet<string> | null = null;

function throwawayDomains(): ReadonlySet<string> {
  if (domains === null) {
    const text = readFileSync(new URL('./throwawayDomains.txt', import.meta.url), 'utf8');
    domains = new Set(text.split('\n').map((line) => line.trim().toLowerCase()).filter((line) => line !== '' && !line.startsWith('#')));
  }
  return domains;
}

/** Whether a normalized address is at a throwaway domain, or at a subdomain of one. */
export function isThrowawayAddress(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at < 0) return false;
  const parts = address.slice(at + 1).toLowerCase().split('.');
  const list = throwawayDomains();
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (list.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}
