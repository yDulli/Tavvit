import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Answer = { address: string; family: number };
const lookup = vi.fn<(host: string) => Promise<Answer | Answer[]>>();
const answersFor = async (host: string): Promise<Answer[]> => {
  const answer = await lookup(host);
  return Array.isArray(answer) ? answer : [answer];
};
// Both ways a name is resolved: the check before a request (promises) and the connection (callback).
vi.mock('dns', () => ({
  default: {
    promises: {
      lookup: async (host: string, options?: { all?: boolean }) => {
        const answers = await answersFor(host);
        return options?.all ? answers : answers[0];
      },
    },
    lookup: (host: string, _options: unknown, callback: (err: Error | null, answers?: Answer[]) => void) => {
      answersFor(host).then((answers) => callback(null, answers), (err: Error) => callback(err));
    },
  },
}));

const { validateExternalUrl, isPrivateIp, publicOnlyLookup, safeFetch } = await import('./ssrf.js');

describe('isPrivateIp', () => {
  it('still answers the addresses it always answered', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  it('answers the ones it used to miss', () => {
    for (const ip of ['::ffff:7f00:1', '::ffff:127.0.0.1', '::', '100.64.0.1', 'fe9a::1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
});

describe('validateExternalUrl', () => {
  // Block bodies, not concise arrows: a hook that RETURNS a function has that
  // function registered as a teardown callback and invoked with no arguments at
  // the end of the test. `mockReset()` returns the mock, so `() => m.mockReset()`
  // silently calls the mock once per test — which an implementation that reads
  // its argument then trips over.
  beforeEach(() => {
    lookup.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a hostname whose AAAA record is a v4-mapped loopback', async () => {
    lookup.mockResolvedValue({ address: '::ffff:7f00:1', family: 6 });
    await expect(validateExternalUrl('https://rebind.example/x')).rejects.toThrow('Private IP not allowed');
  });

  it('rejects a hostname resolving into CGNAT', async () => {
    lookup.mockResolvedValue({ address: '100.64.9.9', family: 4 });
    await expect(validateExternalUrl('https://cgnat.example/x')).rejects.toThrow('Private IP not allowed');
  });

  it('accepts a public address', async () => {
    lookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await expect(validateExternalUrl('https://example.com/x')).resolves.toBeUndefined();
  });

  it('strips brackets before resolving, so an IPv6 literal is understood rather than accidentally ENOTFOUND', async () => {
    lookup.mockImplementation(async (host: string) => {
      // The old code passed '[::1]' straight to dns.lookup, which threw
      // ENOTFOUND and produced the right answer for the wrong reason.
      if (host.startsWith('[')) throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
      return { address: host, family: 6 };
    });
    await expect(validateExternalUrl('http://[::1]/x')).rejects.toThrow('Private IP not allowed');
    expect(lookup).toHaveBeenCalledWith('::1');
  });

  it('lets a public IPv6 literal through, which it could not before', async () => {
    lookup.mockImplementation(async (host: string) => ({ address: host, family: 6 }));
    await expect(validateExternalUrl('https://[2606:4700::1111]/x')).resolves.toBeUndefined();
    // The resolve alone is not evidence: with a doubled resolver the old code
    // also resolved, because the bracketed string matched none of its prefixes.
    // What the old code could not do is hand the resolver an address it could
    // actually look up, so assert on the argument.
    expect(lookup).toHaveBeenCalledWith('2606:4700::1111');
  });

  it('refuses non-http schemes before touching DNS', async () => {
    await expect(validateExternalUrl('file:///etc/passwd')).rejects.toThrow('Invalid URL scheme');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a name with a private address beside a public one', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    await expect(validateExternalUrl('https://mixed.example/x')).rejects.toThrow('Private IP not allowed');
  });
});

describe('the connection, where a name is resolved a second time', () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  const connectLookup = (all: boolean) => new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((done) => {
    publicOnlyLookup('rebind.example', { all }, (err, address, family) => { done({ err, address, family }); });
  });

  it('is refused when the second answer is private, though the check saw a public one', async () => {
    lookup.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 }).mockResolvedValue({ address: '127.0.0.1', family: 4 });
    await validateExternalUrl('https://rebind.example/x');
    expect((await connectLookup(false)).err?.message).toMatch(/Private IP not allowed/);
  });

  it('gets the checked public addresses, one or all as it asks', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }]);
    expect(await connectLookup(false)).toEqual({ err: null, address: '93.184.216.34', family: 4 });
    expect((await connectLookup(true)).address).toHaveLength(2);
  });

  it('of safeFetch never reaches a server on this machine, whatever the check was told', async () => {
    let reached = 0;
    const server = http.createServer((_request, response) => { reached += 1; response.end('internal'); });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address() as AddressInfo;
    try {
      // The check is told `localhost` is public; the connection is told the truth.
      lookup.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 }).mockResolvedValue({ address: '127.0.0.1', family: 4 });
      await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow();
      expect(reached).toBe(0);
      // The same address without safeFetch is reached: the refusal above is the dispatcher's.
      await (await fetch(`http://127.0.0.1:${port}/`)).text();
      expect(reached).toBe(1);
    } finally {
      await new Promise<void>((resolve) => { server.close(() => resolve()); });
    }
  });
});
