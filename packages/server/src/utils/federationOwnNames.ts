import { config } from '../config.js';
import { getOurOrigin, normalizeOriginForCompare } from './federationAuth.js';

/**
 * The names this instance answers to in federation: the origin it signs with, the domain it is set
 * up for, and in the two-instance harness the addresses it is dialled at (`setTestRouting`).
 * Everything that must tell "this instance" from "a peer" asks here: nobody peers under one of these
 * names (handlers/peerHandshake.ts, handlers/s2sAuth.ts), and the check of a handshake asks the
 * caller whether it dialled one of them (`probeEpoch` in peerHandshake.ts).
 */

/**
 * Test only: where the harness reaches an instance that names itself by a domain nothing resolves
 * (`home.test.local`), for the one call that must go to that name, and the addresses each instance
 * is dialled at besides its name. Set through `/api/admin/test/federation/dial-map`, and never read
 * outside NODE_ENV=test with ENABLE_TEST_ROUTES=1.
 */
const testDialMap = new Map<string, string>();
const testAliases = new Set<string>();

function testRoutesOn(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.ENABLE_TEST_ROUTES === '1';
}

export function setTestRouting(routing: { dial?: Readonly<Record<string, string>>; ownNames?: readonly string[] }): void {
  if (!testRoutesOn()) return;
  if (routing.dial) {
    testDialMap.clear();
    for (const [name, address] of Object.entries(routing.dial)) testDialMap.set(name, address);
  }
  if (routing.ownNames) {
    testAliases.clear();
    for (const name of routing.ownNames) testAliases.add(name);
  }
}

/** Where a handshake's check reaches the origin a caller claims: the origin itself, outside the harness. */
export function handshakeCheckOrigin(origin: string): string {
  return testRoutesOn() ? testDialMap.get(origin) ?? origin : origin;
}

/** Every origin that names this instance, each spelled once. */
export function ownOrigins(): string[] {
  const names = [getOurOrigin()];
  if (config.domain) names.push(`https://${config.domain}`);
  if (testRoutesOn()) names.push(...testAliases);
  return [...new Set(names)];
}

/** Whether `origin` is one of this instance's names, by host and port. */
export function isOwnOrigin(origin: string): boolean {
  const asked = normalizeOriginForCompare(origin);
  return asked !== null && ownOrigins().some((name) => normalizeOriginForCompare(name) === asked);
}
