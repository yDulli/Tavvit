import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const livekit = vi.hoisted(() => ({
  configured: true,
  apiUrl: 'http://host.docker.internal:7880' as string | null,
  rooms: [] as Array<{ name: string; people: string[] }>,
  removed: [] as Array<[string, string]>,
  hosts: [] as string[],
  failing: false,
}));

vi.mock('../config.js', () => ({
  config: {
    get livekit() {
      return livekit.configured
        ? { apiUrl: livekit.apiUrl, url: 'wss://example.org/livekit', apiKey: 'key', apiSecret: 'secret' }
        : { apiUrl: null, url: null, apiKey: null, apiSecret: null };
    },
  },
}));

vi.mock('../db/index.js', () => ({
  schema: { users: { homeUserId: 'homeUserId', id: 'id' } },
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: () => ({ homeUserId: 'home-7' }) }) }) }),
  }),
}));

vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    constructor(host: string) { livekit.hosts.push(host); }
    async listRooms() {
      if (livekit.failing) throw new Error('unreachable');
      return livekit.rooms.map((room) => ({ name: room.name }));
    }
    async listParticipants(name: string) {
      return (livekit.rooms.find((room) => room.name === name)?.people ?? []).map((identity) => ({ identity }));
    }
    async removeParticipant(room: string, identity: string) { livekit.removed.push([room, identity]); }
  },
}));

const { evictFromLiveKit } = await import('./livekitEviction.js');

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  livekit.configured = true;
  livekit.apiUrl = 'http://host.docker.internal:7880';
  livekit.rooms = [];
  livekit.removed = [];
  livekit.hosts = [];
  livekit.failing = false;
});

afterEach(() => vi.restoreAllMocks());

describe('putting someone out of their calls', () => {
  it('finds them in every room, and nobody else', async () => {
    livekit.rooms = [
      { name: 'room-1', people: ['u1:anna', 'u2:ben'] },
      { name: 'room-2', people: ['u10:clara'] },
      { name: 'room-3', people: ['u1:anna-old-name', 'u3:dan'] },
    ];
    evictFromLiveKit('u1');
    await settle();
    expect(livekit.removed).toEqual([['room-1', 'u1:anna'], ['room-3', 'u1:anna-old-name']]);
  });

  it('finds someone from elsewhere under the id their home gave them', async () => {
    livekit.rooms = [{ name: 'room-1', people: ['home-7:Visitor'] }];
    evictFromLiveKit('u1');
    await settle();
    expect(livekit.removed).toEqual([['room-1', 'home-7:Visitor']]);
  });

  it('does nothing without voice', async () => {
    livekit.configured = false;
    evictFromLiveKit('u1');
    await settle();
    expect(livekit.hosts).toEqual([]);
  });

  it('asks at the inner address, since the public one has a path the client would drop', async () => {
    evictFromLiveKit('u1');
    await settle();
    expect(livekit.hosts).toEqual(['http://host.docker.internal:7880']);
  });

  it('falls back to the public address where no inner one is given', async () => {
    livekit.apiUrl = null;
    evictFromLiveKit('u1');
    await settle();
    expect(livekit.hosts).toEqual(['wss://example.org/livekit']);
  });

  it('says so and goes on when LiveKit cannot be reached', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    livekit.failing = true;
    expect(() => evictFromLiveKit('u1')).not.toThrow();
    await settle();
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
  });
});
