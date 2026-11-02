import { afterEach, describe, expect, it, vi } from 'vitest';
import { rateLimitsDisabled } from './rateLimitSwitch.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the switch that turns every rate limit off', () => {
  it('works where tests and local load runs set it', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DISABLE_RATE_LIMITS', '1');
    expect(rateLimitsDisabled()).toBe(true);
    vi.stubEnv('DISABLE_RATE_LIMITS', 'true');
    expect(rateLimitsDisabled()).toBe(true);
  });

  it('is ignored in production, so a copied test setting cannot take away the brakes on password guessing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DISABLE_RATE_LIMITS', '1');
    expect(rateLimitsDisabled()).toBe(false);
  });

  it('is off unless set to exactly 1 or true', () => {
    vi.stubEnv('NODE_ENV', 'test');
    for (const value of ['', '0', 'yes', 'TRUE ']) {
      vi.stubEnv('DISABLE_RATE_LIMITS', value);
      expect(rateLimitsDisabled(), value).toBe(false);
    }
  });
});
