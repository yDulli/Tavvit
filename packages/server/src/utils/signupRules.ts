import { domainToASCII } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import type { SignupRule, SignupRuleKind } from '@backspace/shared/src/adminConsole.js';
import { getDb, schema } from '../db/index.js';
import { isThrowawayAddress } from '../email/throwaway.js';

/**
 * Who may not sign up (docs/systems/admin.md, "Who may sign up"): an address at a
 * domain, or a name. The rules are asked when an account is made and when an address is
 * set; they touch no account that exists, and they say nothing about one: a name or a
 * domain on the list is refused whether anyone has it or not.
 */

const DOMAIN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
/** What a local username may be (routes/auth.ts). */
const USERNAME = /^[a-z0-9_]{3,32}$/;

/** A rule's value as it is kept, or null when it could not be one. */
export function normalizeRuleValue(kind: SignupRuleKind, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  if (kind === 'username') return USERNAME.test(lower) ? lower : null;
  // People paste an address, or a domain with its @.
  const domain = domainToASCII(lower.includes('@') ? lower.slice(lower.lastIndexOf('@') + 1) : lower);
  return DOMAIN.test(domain) ? domain : null;
}

/** The domain of a normalized address and every one above it: `a.mail.example.com` is caught by `example.com`. */
function domainsOf(address: string): string[] {
  const at = address.lastIndexOf('@');
  if (at < 0) return [];
  const parts = address.slice(at + 1).toLowerCase().split('.');
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) out.push(parts.slice(i).join('.'));
  return out;
}

/**
 * Whether an address may not be used here: its domain, or one above it, is on the list of
 * the operator's sign-up rules, or it is a throwaway domain while the instance refuses those
 * (`instance_settings.block_throwaway_email`, email/throwaway.ts). Asked at sign-up and when an
 * address is set; an address already on an account stays.
 */
export function emailDomainBlocked(address: string): boolean {
  const domains = domainsOf(address);
  if (domains.length === 0) return false;
  const db = getDb();
  const listed = db.select({ value: schema.signupRules.value }).from(schema.signupRules)
    .where(and(eq(schema.signupRules.kind, 'email_domain'), inArray(schema.signupRules.value, domains)))
    .get() !== undefined;
  if (listed) return true;
  const settings = db.select({ blockThrowaway: schema.instanceSettings.blockThrowawayEmail }).from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1)).get();
  return (settings?.blockThrowaway ?? 1) === 1 && isThrowawayAddress(address);
}

export function usernameReserved(username: string): boolean {
  return getDb().select({ value: schema.signupRules.value }).from(schema.signupRules)
    .where(and(eq(schema.signupRules.kind, 'username'), eq(schema.signupRules.value, username.trim().toLowerCase())))
    .get() !== undefined;
}

export function listSignupRules(): SignupRule[] {
  return getDb().select().from(schema.signupRules).all()
    .map((row) => ({ kind: row.kind as SignupRuleKind, value: row.value, note: row.note, createdAt: row.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt || a.value.localeCompare(b.value));
}
