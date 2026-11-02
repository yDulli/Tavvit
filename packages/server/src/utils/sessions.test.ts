import { describe, it, expect } from 'vitest';
import { describeClient, maskAddress } from './sessions.js';

describe('maskAddress', () => {
  it('cuts off the part that names one connection', () => {
    expect(maskAddress('203.0.113.77')).toBe('203.0.113.0');
    expect(maskAddress('::ffff:203.0.113.77')).toBe('203.0.113.0');
    expect(maskAddress('2001:db8:1234:5678:9abc:def0:1234:5678')).toBe('2001:db8:1234::');
    expect(maskAddress('2001:db8::1')).toBe('2001:db8::');
  });

  it('keeps nothing of what is not an address', () => {
    expect(maskAddress('unknown')).toBeNull();
    expect(maskAddress(undefined)).toBeNull();
  });
});

describe('describeClient', () => {
  it('names a browser and a system, and nothing else of the User-Agent', () => {
    expect(describeClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toBe('Chrome · Windows');
    expect(describeClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iOS');
    expect(describeClient('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(describeClient('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('Firefox · Linux');
    expect(describeClient('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Tavvit/1.17.0 Electron/43.0.0 Safari/537.36')).toBe('Tavvit Desktop · Windows');
  });

  it('says nothing when it was told nothing', () => {
    expect(describeClient(undefined)).toBeNull();
    expect(describeClient('curl/8.0')).toBeNull();
  });
});
