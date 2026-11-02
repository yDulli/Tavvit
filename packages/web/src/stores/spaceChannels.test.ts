import { describe, expect, it } from 'vitest';
import type { Channel } from '@backspace/shared';
import { dropChannels, putChannels, replaceSpaceChannels, type SpaceChannelTables } from './spaceChannels';

const channel = (id: string, extra: Partial<Channel> = {}): Channel => ({
  id, spaceId: 's1', name: id, type: 'text', ...extra,
} as Channel);

const empty: SpaceChannelTables = { index: new Map(), permissions: new Map(), lastMessageIds: new Map() };

const withThreads = () => putChannels(empty, 's1', '', [
  channel('c1'),
  channel('c2'),
  channel('t1', { type: 'thread', parentChannelId: 'c1' }),
  channel('t2', { type: 'thread', parentChannelId: 'c2' }),
]);

const idsOf = (tables: SpaceChannelTables) => [...tables.index.keys()].sort();

describe('threads in the channel index', () => {
  it('go with the channel they belong to, and only with that one', () => {
    expect(idsOf(dropChannels(withThreads(), ['c1']))).toEqual(['c2', 't2']);
  });

  it('stay when a space lists its channels again: no listing names a thread', () => {
    const { tables, dropped } = replaceSpaceChannels(withThreads(), 's1', '', [channel('c1'), channel('c2')]);
    expect(dropped).toEqual([]);
    expect(idsOf(tables)).toEqual(['c1', 'c2', 't1', 't2']);
  });

  it('go when the listing no longer has their channel', () => {
    const { tables, dropped } = replaceSpaceChannels(withThreads(), 's1', '', [channel('c2')]);
    expect(dropped).toEqual(['c1']);
    expect(idsOf(tables)).toEqual(['c2', 't2']);
  });
});

describe("a channel's icon in the index", () => {
  it('is kept, so a list away from the space shows it too', () => {
    const tables = putChannels(empty, 's1', '', [channel('c1', { icon: 'glyph:rocket' }), channel('c2')]);
    expect(tables.index.get('c1')?.icon).toBe('glyph:rocket');
    expect(tables.index.get('c2')?.icon).toBeUndefined();
  });

  it('goes when the channel goes back to its type icon', () => {
    const before = putChannels(empty, 's1', '', [channel('c1', { icon: '🎮' })]);
    const after = putChannels(before, 's1', '', [channel('c1', { icon: null })]);
    expect(after.index.get('c1')?.icon).toBeUndefined();
  });
});
