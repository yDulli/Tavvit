import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { hasLeadingZeroBits, SIGNUP_CHALLENGE_BITS, type SignupChallengeResponse } from '@backspace/shared/src/signupChallenge.js';

vi.mock('../db/index.js', () => ({ getDb: () => ({}), schema: {} }));
vi.mock('../config.js', () => ({ config: { jwtSecret: 'a-secret-that-is-only-for-these-tests' } }));

const { acceptSignupChallenge, createSignupChallenge } = await import('./signupChallenge.js');

type Task = Extract<SignupChallengeResponse, { salt: string }>;

function solve(task: Pick<Task, 'salt' | 'bits'>): string {
  for (let nonce = 0; ; nonce += 1) {
    if (hasLeadingZeroBits(createHash('sha256').update(`${task.salt}:${nonce}`).digest(), task.bits)) return String(nonce);
  }
}

const NOW = 1_800_000_000_000;
const normalTask = () => createSignupChallenge('normal', NOW) as Task;

describe('the task at sign-up', () => {
  it('asks nothing when it is off', () => {
    expect(createSignupChallenge('off', NOW)).toEqual({ level: 'off' });
    expect(acceptSignupChallenge(undefined, 'off', NOW)).toBe(true);
  });

  it('opens the door to a solved task, once', () => {
    const task = normalTask();
    const answer = { ...task, nonce: solve(task) };
    expect(acceptSignupChallenge(answer, 'normal', NOW)).toBe(true);
    expect(acceptSignupChallenge(answer, 'normal', NOW)).toBe(false);
  });

  it('wants an answer at all, in the right shape', () => {
    expect(acceptSignupChallenge(undefined, 'normal', NOW)).toBe(false);
    expect(acceptSignupChallenge('nope', 'normal', NOW)).toBe(false);
    expect(acceptSignupChallenge({ salt: 'x' }, 'normal', NOW)).toBe(false);
    const task = normalTask();
    expect(acceptSignupChallenge({ ...task, nonce: '' }, 'normal', NOW)).toBe(false);
    expect(acceptSignupChallenge({ ...task, nonce: 'x'.repeat(33) }, 'normal', NOW)).toBe(false);
  });

  it('refuses a wrong answer', () => {
    const task = normalTask();
    let wrong = 0;
    while (hasLeadingZeroBits(createHash('sha256').update(`${task.salt}:${wrong}`).digest(), task.bits)) wrong += 1;
    expect(acceptSignupChallenge({ ...task, nonce: String(wrong) }, 'normal', NOW)).toBe(false);
  });

  it('refuses a task it did not give, or one made easier afterwards', () => {
    const task = normalTask();
    const easier = { salt: task.salt, bits: 1, signature: task.signature };
    expect(acceptSignupChallenge({ ...easier, nonce: solve(easier) }, 'normal', NOW)).toBe(false);
    const made = { salt: `${NOW + 1000}.abc`, bits: 1, signature: 'f'.repeat(64) };
    expect(acceptSignupChallenge({ ...made, nonce: solve(made) }, 'normal', NOW)).toBe(false);
  });

  it('refuses a task too old', () => {
    const task = normalTask();
    const later = NOW + 11 * 60_000;
    expect(acceptSignupChallenge({ ...task, nonce: solve(task) }, 'normal', later)).toBe(false);
  });

  it('asks the level in force now, not the one the task was given at', () => {
    const task = normalTask();
    expect(acceptSignupChallenge({ ...task, nonce: solve(task) }, 'high', NOW)).toBe(false);
    expect(SIGNUP_CHALLENGE_BITS.high).toBeGreaterThan(SIGNUP_CHALLENGE_BITS.normal);
  });
});

describe('counting zero bits', () => {
  it('reads across bytes, and within one', () => {
    expect(hasLeadingZeroBits(Uint8Array.from([0, 0, 0x0f]), 20)).toBe(true);
    expect(hasLeadingZeroBits(Uint8Array.from([0, 0, 0x1f]), 20)).toBe(false);
    expect(hasLeadingZeroBits(Uint8Array.from([0, 0x80]), 8)).toBe(true);
    expect(hasLeadingZeroBits(Uint8Array.from([0, 0x80]), 9)).toBe(false);
    expect(hasLeadingZeroBits(Uint8Array.from([0xff]), 0)).toBe(true);
  });
});
