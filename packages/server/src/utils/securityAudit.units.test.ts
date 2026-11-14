import { afterEach, describe, expect, it, vi } from 'vitest';

// The smaller findings of the security audit of 2026-11-14, each held here.

vi.mock('../db/index.js', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ get: () => ({ level: 'normal' }) }) }) }),
  schema: { instanceSettings: { signupChallenge: 'signup_challenge' } },
}));
vi.mock('../config.js', () => ({ config: { jwtSecret: 'a-secret-that-is-only-for-these-tests' } }));

const { classifyAddress, isPublicAddress } = await import('./ipClass.js');
const { pathForLog } = await import('./webhookAccounts.js');
const { signupChallengeLevel } = await import('./signupChallenge.js');

describe('an IPv4 address carried inside an IPv6 one', () => {
  // A gateway (NAT64, 6to4) hands the packet on to the IPv4 address inside, so these reach this
  // machine or its network wherever one stands in the way; they were classed as public.
  it.each([
    ['64:ff9b::7f00:1', 'loopback', 'NAT64 of 127.0.0.1'],
    ['64:ff9b::a00:1', 'private', 'NAT64 of 10.0.0.1'],
    ['64:ff9b::a9fe:a9fe', 'link-local', 'NAT64 of 169.254.169.254, the metadata address'],
    ['2002:7f00:1::1', 'loopback', '6to4 of 127.0.0.1'],
    ['2002:c0a8:101::', 'private', '6to4 of 192.168.1.1'],
    ['::7f00:1', 'reserved', 'the IPv4-compatible form of 127.0.0.1'],
    ['0:0:0:0:0:ffff:7f00:1', 'reserved', 'the mapped form written out in full'],
    ['2001:db8::1', 'reserved', 'documentation'],
  ])('%s is %s (%s)', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ['64:ff9b::808:808', 'NAT64 of 8.8.8.8'],
    ['2002:808:808::1', '6to4 of 8.8.8.8'],
    ['2606:4700:4700::1111', 'an ordinary public address'],
  ])('%s stays public (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('a path in the request log', () => {
  // The overlay's page asks every few seconds, and its address is its whole secret: the log held it in clear.
  it('does not carry a voice overlay\'s secret', () => {
    const secret = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4';
    expect(pathForLog(`/api/overlay/voice/${secret}`)).toBe('/api/overlay/voice/[secret]');
    expect(pathForLog(`/overlay/voice/${secret}?x=1`)).toBe('/overlay/voice/[secret]');
  });

  it('still hides a webhook\'s token and leaves other paths as they are', () => {
    expect(pathForLog('/api/webhooks/123/abcdef')).toBe('/api/webhooks/123/[token]');
    expect(pathForLog('/api/channels/5/voice-overlay')).toBe('/api/channels/5/voice-overlay');
    expect(pathForLog('/api/overlay/voice')).toBe('/api/overlay/voice');
  });
});

describe('the switch that turns the rate limits off', () => {
  const before = { ...process.env };
  afterEach(() => {
    process.env.NODE_ENV = before.NODE_ENV;
    if (before.DISABLE_RATE_LIMITS === undefined) delete process.env.DISABLE_RATE_LIMITS;
    else process.env.DISABLE_RATE_LIMITS = before.DISABLE_RATE_LIMITS;
  });

  // It took the task at sign-up away in production too, though a server there ignores it for every limit.
  it('does not take the task at sign-up away from a server in production', () => {
    process.env.DISABLE_RATE_LIMITS = '1';
    process.env.NODE_ENV = 'production';
    expect(signupChallengeLevel()).toBe('normal');
    process.env.NODE_ENV = 'test';
    expect(signupChallengeLevel()).toBe('off');
    delete process.env.DISABLE_RATE_LIMITS;
    expect(signupChallengeLevel()).toBe('normal');
  });
});
