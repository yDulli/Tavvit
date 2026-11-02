import { describe, it, expect } from 'vitest';
import { LoginThrottle, loginThrottleKey, loginWait } from './loginThrottle.js';

function make(options: Partial<ConstructorParameters<typeof LoginThrottle>[0]> = {}) {
  const clock = { now: 1_000_000 };
  const throttle = new LoginThrottle({
    windowMs: 60_000,
    freeFailures: 3,
    sourceCapMs: 30_000,
    accountCapMs: 5000,
    maxInFlight: 2,
    maxTracked: 100,
    now: () => clock.now,
    ...options,
  });
  return { throttle, clock };
}

const failTimes = (throttle: LoginThrottle, times: number, account = 'a', source = 'ip1') => {
  for (let i = 0; i < times; i += 1) throttle.recordFailure(account, source);
};

describe('LoginThrottle', () => {
  it('lets the first few mistakes cost nothing', () => {
    const { throttle } = make();
    expect(throttle.waitFor('a', 'ip1')).toBe(0);
    failTimes(throttle, 3);
    expect(throttle.waitFor('a', 'ip1')).toBe(0);
  });

  it('doubles the wait from there, up to its limit, for the one making the guesses', () => {
    const { throttle } = make();
    const waits = [];
    for (let i = 0; i < 10; i += 1) {
      throttle.recordFailure('a', 'ip1');
      waits.push(throttle.waitFor('a', 'ip1'));
    }
    expect(waits).toEqual([0, 0, 0, 1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('costs the owner only a few seconds, however many guesses came from elsewhere', () => {
    const { throttle } = make();
    failTimes(throttle, 50, 'a', 'griefer');
    expect(throttle.waitFor('a', 'griefer')).toBe(30_000);
    expect(throttle.waitFor('a', 'owner')).toBe(5000);
  });

  it('never involves another account', () => {
    const { throttle } = make();
    failTimes(throttle, 20, 'a', 'ip1');
    expect(throttle.waitFor('b', 'ip1')).toBe(0);
  });

  it('forgets failures older than the window', () => {
    const { throttle, clock } = make();
    failTimes(throttle, 8);
    expect(throttle.waitFor('a', 'ip1')).toBeGreaterThan(0);
    clock.now += 60_000;
    expect(throttle.waitFor('a', 'ip1')).toBe(0);
  });

  it('forgives the name and the place on the right password', () => {
    const { throttle } = make();
    failTimes(throttle, 8);
    throttle.recordSuccess('a', 'ip1');
    expect(throttle.waitFor('a', 'ip1')).toBe(0);
  });

  it('runs only a few attempts on one name at once, and frees the place again', () => {
    const { throttle } = make();
    expect(throttle.enter('a')).toBe(true);
    expect(throttle.enter('a')).toBe(true);
    expect(throttle.enter('a')).toBe(false);
    expect(throttle.enter('b')).toBe(true);
    throttle.leave('a');
    expect(throttle.enter('a')).toBe(true);
  });

  it('is bounded: a spray of invented usernames cannot grow the table without limit', () => {
    const { throttle } = make({ maxTracked: 10 });
    for (let i = 0; i < 200; i += 1) throttle.recordFailure(`name${i}`, 'ip');
    expect(throttle.size).toBeLessThanOrEqual(10);
  });
});

describe('loginThrottleKey', () => {
  it('treats a name the same however it is written', () => {
    expect(loginThrottleKey('  Alice ')).toBe('alice');
  });
});

describe('loginWait', () => {
  it('does not wait for nothing', async () => {
    await expect(loginWait.sleep(0)).resolves.toBeUndefined();
  });
});
