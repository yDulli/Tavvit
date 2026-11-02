import { hasLeadingZeroBits, type SignupChallengeResponse, type SignupChallengeSolution } from '@backspace/shared/src/signupChallenge.js';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { hashPassword } from '../../src/utils/passwordHash.js';
import type { SpawnedInstance } from './twoInstanceHarness.js';

export interface TestUser {
  id: string;
  username: string;
  password: string;
  token: string;
  origin: string;        // origin where this token authenticates
  homeUserId?: string;   // present for federated users — the id on the user's home instance
  homeInstance?: string; // present for federated users
}

const nano = () => crypto.randomBytes(4).toString('hex');

/**
 * Register a native local user on `instance` via POST /api/auth/register.
 * Returns the user record + JWT.
 *
 * Endpoint contract (verified against packages/server/src/routes/auth.ts):
 *  - Request body: { username, password, displayName?, avatarColor?, homeInstance?, homeUserId? }
 *  - Response 201: { token, user: { id, ... } }
 */
/** What a browser does before it asks for an account (utils/signupChallenge.ts). Nothing when the instance asks nothing. */
async function answerSignupTask(instance: SpawnedInstance): Promise<SignupChallengeSolution | undefined> {
  const task = await (await fetch(`${instance.origin}/api/auth/challenge`)).json() as SignupChallengeResponse;
  if (task.level === 'off') return undefined;
  for (let nonce = 0; ; nonce += 1) {
    if (hasLeadingZeroBits(crypto.createHash('sha256').update(`${task.salt}:${nonce}`).digest(), task.bits)) {
      return { salt: task.salt, bits: task.bits, signature: task.signature, nonce: String(nonce) };
    }
  }
}

export async function registerLocal(instance: SpawnedInstance, baseName = 't'): Promise<TestUser> {
  // Username validator (auth.ts): /^[a-z0-9_]+$/, length 3-32. Lowercase the
  // baseName and use underscore separator so callers can pass readable names
  // like "probe-local" without tripping the validator.
  const safeBase = baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const username = `${safeBase}_${nano()}`;
  const password = `pw_${crypto.randomBytes(8).toString('hex')}`;
  const res = await fetch(`${instance.origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, displayName: username, challenge: await answerSignupTask(instance) }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`registerLocal failed (${instance.origin}): ${res.status} ${txt}`);
  }
  const data = await res.json() as { user: { id: string }; token: string };
  // The harness's people talk to each other freely: these suites are about the
  // relay, and utils/contactPolicy.ts has tests of its own.
  const open = await fetch(`${instance.origin}/api/users/@me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
    body: JSON.stringify({ dmPolicy: 'anyone' }),
  });
  if (!open.ok) throw new Error(`registerLocal could not open DMs (${instance.origin}): ${open.status}`);
  return {
    id: data.user.id,
    username,
    password,
    token: data.token,
    origin: instance.origin,
  };
}

/** An administrator, which registering never makes: on a real instance `tavvit-admin` writes this. */
export function makeAdmin(instance: SpawnedInstance, userId: string): void {
  const db = new Database(instance.dbPath);
  try {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userId);
  } finally {
    db.close();
  }
}

/**
 * Someone from `home`'s account on `remote`, as a registration with a proof leaves it. It is
 * written to the database because a proof takes the two instances to already trust each other
 * under names a test cannot resolve, and these suites are about what comes after.
 * `src/routes/auth.homeProof.test.ts` tests the registration itself.
 */
export async function insertFederatedAccount(remote: SpawnedInstance, home: SpawnedInstance, homeUser: TestUser): Promise<TestUser> {
  const username = `${homeUser.username}@${home.domain}`;
  const id = String((BigInt(Date.now()) << 22n) | BigInt(crypto.randomInt(1 << 22)));
  const sessionId = crypto.randomBytes(16).toString('hex');
  const token = jwt.sign({ userId: id, username, sid: sessionId }, remote.jwtSecret, { expiresIn: '30d' });
  const now = Date.now();
  const passwordHash = await hashPassword(homeUser.password);
  const db = new Database(remote.dbPath);
  try {
    db.prepare(`INSERT INTO users (id, username, display_name, password_hash, home_instance, home_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, username, homeUser.username, passwordHash, home.domain, homeUser.id, now);
    db.prepare(`INSERT INTO sessions (id, user_id, created_at, last_active_at, expires_at, client_label, address_hint)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sessionId, id, now, now, now + 30 * 24 * 60 * 60 * 1000, 'Test', '127.0.0.x');
  } finally {
    db.close();
  }
  return {
    id,
    username,
    password: homeUser.password,
    token,
    origin: remote.origin,
    homeUserId: homeUser.id,
    homeInstance: home.domain,
  };
}

/**
 * Create a federated account: register `home` first (native), then create the
 * `username@homeDomain` mirror on `remote` via POST /api/auth/register with
 * homeInstance + homeUserId — the production federated-account-creation path
 * documented in client-federation.md §1. Returns BOTH user records.
 *
 * Also seeds the home's user_federation_registry via PUT
 * /api/users/@me/federation-registry so the home's federation-identity
 * delete endpoint sees this remote in the user's registry.
 *
 * Registry PUT contract (verified against packages/server/src/routes/users.ts):
 *  - Body: { registry: Array<{...}>, updatedAt: number }
 *    NOTE: the route's array key is `registry`, NOT `entries` as the original
 *    plan template suggested. The deviation has been applied here.
 *  - Per-entry required: { origin: string, status: 'connected'|'disconnected'|'unreachable'|'auth_expired', addedAt: number }
 *  - Per-entry optional: { label, username, remoteUserId, lastConnectedAt, disconnectedAt, errorMessage }
 *  - LWW guard: updatedAt must be > stored federationRegistryUpdatedAt (else 409).
 */
export async function createFederatedUser(
  home: SpawnedInstance,
  remote: SpawnedInstance,
  baseName = 't',
): Promise<{ homeUser: TestUser; remoteUser: TestUser }> {
  const homeUser = await registerLocal(home, baseName);
  const remoteUser = await insertFederatedAccount(remote, home, homeUser);

  // Seed the home user's federation registry. Body shape matches the route's
  // declared Body<{ registry, updatedAt }> — see users.ts L591-L594.
  const registryUpdatedAt = Date.now();
  const registryRes = await fetch(`${home.origin}/api/users/@me/federation-registry`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${homeUser.token}`,
    },
    body: JSON.stringify({
      updatedAt: registryUpdatedAt,
      registry: [
        {
          origin: remote.origin,
          label: remote.domain,
          username: remoteUser.username,
          remoteUserId: remoteUser.id,
          status: 'connected',
          addedAt: registryUpdatedAt,
          lastConnectedAt: registryUpdatedAt,
        },
      ],
    }),
  });
  if (!registryRes.ok) {
    const txt = await registryRes.text();
    throw new Error(`registry sync failed: ${registryRes.status} ${txt}`);
  }

  return { homeUser, remoteUser };
}
