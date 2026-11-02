import { BlockList, isIPv4, isIPv6 } from 'node:net';

// Which addresses in `X-Forwarded-For` Fastify believes, so `request.ip` (every rate limit's key,
// http and socket alike) is the client's and not something the client wrote. `TRUSTED_PROXY_HOPS`
// counts the proxies in front of this server (config.ts). Fastify 5 no longer takes that count as
// it is: a count alone would also believe a client that reached this server directly and sent
// enough forwarded hops of its own, so it now trusts nobody for a number, and every client would
// share the proxy's address. The function below keeps the count and adds what the count lacked: the
// nearest hop, the one that connected, must come from a private network, which is where the
// reverse proxy sits (Caddy on the Docker network, or this machine). The hops beyond it, such as a
// CDN in front of Caddy, are believed by number as before.

const PRIVATE_NETWORKS = new BlockList();
PRIVATE_NETWORKS.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_NETWORKS.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_NETWORKS.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_NETWORKS.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_NETWORKS.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_NETWORKS.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_NETWORKS.addAddress('::1', 'ipv6');
PRIVATE_NETWORKS.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_NETWORKS.addSubnet('fe80::', 10, 'ipv6');

/** Whether `address` is on this machine or a private network (an IPv4 address mapped into IPv6 counts as itself). */
export function isPrivateAddress(address: string): boolean {
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : address;
  if (isIPv4(mapped)) return PRIVATE_NETWORKS.check(mapped, 'ipv4');
  if (isIPv6(address)) return PRIVATE_NETWORKS.check(address, 'ipv6');
  return false;
}

/**
 * Fastify's `trustProxy` for `hops` proxies in front: hop 0 (the address that connected) is
 * believed when it is private, every further hop up to `hops` by number. With 0 nothing is
 * believed and `request.ip` is the connecting address.
 */
export function trustProxyFor(hops: number): (address: string, hop: number) => boolean {
  if (hops <= 0) return () => false;
  return (address, hop) => (hop === 0 ? isPrivateAddress(address) : hop < hops);
}
