import { rateLimitsDisabled } from './rateLimitSwitch.js';

/**
 * How guessing a password is slowed down, without ever refusing the right one.
 *
 * The route limiter (15 attempts in 2 minutes) is per address, so it does not stop a
 * guesser who rotates addresses. This used to lock a name after 10 failures, which also
 * let anyone who knows a username keep its owner out with 10 requests every 15 minutes.
 * Now failures make the next attempt wait before the password is even looked at:
 *
 * - **From the same place** (name and address) the wait doubles up to half a minute: the
 *   one making the guesses pays for them.
 * - **On the name from anywhere** it doubles up to a few seconds: a guesser with many addresses
 *   gets slower, and the worst a griefer can do to the owner is that short wait.
 * - **At most a few passwords for a name are checked at once.** The wait comes first and holds
 *   no place, so only a flood that keeps that many comparisons running from many addresses
 *   reaches this, and past it an attempt is told to come back in a moment.
 *
 * State is in memory, per process. A restart forgives everyone, and the maps are bounded
 * so a spray of made-up usernames cannot grow them without limit.
 */

export interface LoginThrottleOptions {
  /** A failure older than this no longer counts. */
  windowMs: number;
  /** Failures that cost nothing: everyone mistypes. */
  freeFailures: number;
  /** The longest wait for the same name from the same address. */
  sourceCapMs: number;
  /** The longest wait for a name, whoever asks. */
  accountCapMs: number;
  /** Passwords for one name checked at the same time; a waiting attempt is not one of them. */
  maxInFlight: number;
  /** Hard cap on keys remembered at once. */
  maxTracked: number;
  now?: () => number;
}

interface Failures {
  count: number;
  last: number;
}

export class LoginThrottle {
  private readonly failures = new Map<string, Failures>();
  private readonly inFlight = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: LoginThrottleOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Takes one of the name's places, or false when they are all in use. Pair with `leave`. */
  enter(account: string): boolean {
    const running = this.inFlight.get(account) ?? 0;
    if (running >= this.options.maxInFlight) return false;
    this.inFlight.set(account, running + 1);
    return true;
  }

  leave(account: string): void {
    const running = (this.inFlight.get(account) ?? 1) - 1;
    if (running <= 0) this.inFlight.delete(account);
    else this.inFlight.set(account, running);
  }

  /** How long this attempt waits before its password is checked, in ms. */
  waitFor(account: string, source: string): number {
    return Math.max(
      this.delay(this.count(`${account}\u0000${source}`), this.options.sourceCapMs),
      this.delay(this.count(account), this.options.accountCapMs),
    );
  }

  recordFailure(account: string, source: string): void {
    this.bump(`${account}\u0000${source}`);
    this.bump(account);
    this.evictIfFull();
  }

  /** The right password forgives this place and the name. */
  recordSuccess(account: string, source: string): void {
    this.failures.delete(`${account}\u0000${source}`);
    this.failures.delete(account);
  }

  /** Keys currently remembered. Exposed for tests. */
  get size(): number {
    return this.failures.size;
  }

  private delay(count: number, capMs: number): number {
    if (count <= this.options.freeFailures) return 0;
    return Math.min(1000 * 2 ** (count - this.options.freeFailures - 1), capMs);
  }

  private count(key: string): number {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    if (this.now() - entry.last >= this.options.windowMs) {
      this.failures.delete(key);
      return 0;
    }
    return entry.count;
  }

  private bump(key: string): void {
    const count = this.count(key) + 1;
    // Re-inserted, so the Map's order follows recency for eviction.
    this.failures.delete(key);
    this.failures.set(key, { count, last: this.now() });
  }

  private evictIfFull(): void {
    if (this.failures.size <= this.options.maxTracked) return;
    for (const key of this.failures.keys()) {
      if (this.failures.size <= this.options.maxTracked) break;
      this.failures.delete(key);
    }
  }
}

export const loginThrottle = new LoginThrottle({
  windowMs: 15 * 60 * 1000,
  freeFailures: 3,
  sourceCapMs: 30_000,
  accountCapMs: 5000,
  maxInFlight: 4,
  maxTracked: 20_000,
});

/** Waiting, as an object so tests can look at what was asked for instead of sitting through it. */
export const loginWait = {
  sleep: (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms); }) : Promise.resolve()),
};

/** The throttle's key for a typed username: trimmed, lowercased, bounded in length. */
export function loginThrottleKey(username: string): string {
  return username.trim().toLowerCase().slice(0, 100);
}

/**
 * The test harness and CI set `DISABLE_RATE_LIMITS` so that many sign-ins from one
 * loopback address do not exhaust the route limiter; the same switch turns this off.
 * Read at call time, never cached, and ignored in production (utils/rateLimitSwitch.ts).
 */
export function loginThrottleDisabled(): boolean {
  return rateLimitsDisabled();
}
