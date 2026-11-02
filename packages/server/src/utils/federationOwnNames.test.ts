import { describe, expect, it, vi } from 'vitest';

// The names this instance answers to: the origin it signs with and the domain it is set up for,
// which may differ (PUBLIC_ORIGIN on a subdomain). A peer under either would speak for everyone here.

vi.mock('../config.js', () => ({
  config: { domain: 'example.com', publicOrigin: 'https://chat.example.com', port: 3000 },
}));

const { isOwnOrigin, ownOrigins, setTestRouting, handshakeCheckOrigin } = await import('./federationOwnNames.js');

describe("this instance's names", () => {
  it('are the origin it signs with and the domain it is set up for', () => {
    expect(ownOrigins()).toEqual(['https://chat.example.com', 'https://example.com']);
    for (const name of ['https://chat.example.com', 'https://example.com', 'https://EXAMPLE.com/', 'http://example.com']) {
      expect(isOwnOrigin(name), name).toBe(true);
    }
    for (const other of ['https://peer.example', 'https://example.com.evil.test', 'https://sub.example.com']) {
      expect(isOwnOrigin(other), other).toBe(false);
    }
  });

  it('take nothing from the test routing outside a test instance', () => {
    setTestRouting({ dial: { 'https://peer.example': 'http://127.0.0.1:1' }, ownNames: ['http://127.0.0.1:2'] });
    expect(ownOrigins()).not.toContain('http://127.0.0.1:2');
    expect(handshakeCheckOrigin('https://peer.example')).toBe('https://peer.example');
  });
});
