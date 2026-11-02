import { createHash } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { domainToASCII } from 'node:url';

/** RFC 5321's limit on a whole path. */
const EMAIL_MAX_LENGTH = 254;
const LOCAL_PART_MAX_LENGTH = 64;
/** Whitespace and control characters (no header can be smuggled in), and what would need quoting. */
const NOT_IN_LOCAL_PART = /[\s\p{Cc}<>()",;:\\[\]]/u;
const NOT_IN_DOMAIN = /[\s\p{Cc}<>()",;:\\[\]@/!#$%&'*+=?^`{|}~]/u;

/**
 * An address as this server keeps it: trimmed, in lower case, its domain in its one ASCII
 * spelling (so `bücher.example` and `xn--bcher-kva.example` are one domain to every check and
 * limit), or null when it cannot be one. Deliberately simple: whether an address works is
 * decided by a mail arriving there.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const address = raw.trim().toLowerCase();
  if (address.length > EMAIL_MAX_LENGTH) return null;
  const at = address.indexOf('@');
  if (at < 1 || at > LOCAL_PART_MAX_LENGTH || at !== address.lastIndexOf('@')) return null;
  if (NOT_IN_LOCAL_PART.test(address.slice(0, at))) return null;
  const domain = domainToASCII(address.slice(at + 1));
  if (!domain) return null;
  const labels = domain.split('.');
  if (labels.length < 2) return null;
  const labelFine = (label: string): boolean => label.length > 0 && label.length <= 63
    && !label.startsWith('-') && !label.endsWith('-') && !NOT_IN_DOMAIN.test(label);
  return labels.every(labelFine) ? `${address.slice(0, at)}@${domain}` : null;
}

/** What the limits per address and the suppression list key on. */
export function hashAddress(address: string): string {
  return createHash('sha256').update(address).digest('hex');
}

/** An address as a mail to someone else may name it: enough to recognise, not enough to copy. */
export function maskEmail(address: string): string {
  const at = address.indexOf('@');
  return at < 1 ? '***' : `${address[0]}***${address.slice(at)}`;
}

/**
 * Whether the address's domain can receive mail at all, so a typo costs neither a bounce
 * (a provider pauses the whole account over those) nor a place in the day's budget.
 * Only a clear no counts: our resolver's trouble must not refuse anyone.
 */
export async function domainReceivesMail(address: string): Promise<boolean> {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  const domain = address.slice(address.indexOf('@') + 1);
  const nothingThere = (error: unknown): boolean => {
    const code = (error as { code?: string }).code;
    return code === 'ENOTFOUND' || code === 'ENODATA';
  };
  try {
    const records = await resolver.resolveMx(domain);
    // RFC 7505: a single "0 ." says the domain takes no mail.
    return records.some((record) => record.exchange !== '' && record.exchange !== '.');
  } catch (error) {
    if (!nothingThere(error)) return true;
  }
  // Without MX, mail goes to the domain's own address (RFC 5321, 5.1).
  try {
    return (await resolver.resolve4(domain)).length > 0;
  } catch (error) {
    if (!nothingThere(error)) return true;
  }
  try {
    return (await resolver.resolve6(domain)).length > 0;
  } catch (error) {
    return !nothingThere(error);
  }
}
