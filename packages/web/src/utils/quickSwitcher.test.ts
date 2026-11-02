import { describe, it, expect } from 'vitest';
import { fold, rankSwitcherItems, scoreItem, type SwitcherItem } from './quickSwitcher';

function item(label: string, over: Partial<SwitcherItem> = {}): SwitcherItem {
  return { id: label, kind: 'dm', label, target: { type: 'route', path: '/x' }, ...over };
}

describe('fold', () => {
  it('lowercases and removes accents', () => {
    expect(fold('Müller Ünal')).toBe('muller unal');
    expect(fold('José')).toBe('jose');
  });
});

describe('scoreItem', () => {
  it('is zero for no query and for no match', () => {
    expect(scoreItem('', item('Amy'))).toBe(0);
    expect(scoreItem('zzz', item('Amy'))).toBe(0);
  });

  it('ranks exact over prefix over word-start over substring over scattered letters', () => {
    const exact = scoreItem('game', item('game'));
    const prefix = scoreItem('game', item('Game Night'));
    const wordStart = scoreItem('night', item('Game Night'));
    const substring = scoreItem('ame', item('Game Night'));
    const scattered = scoreItem('gnt', item('Game Night'));
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(0);
  });

  it('ignores case and accents', () => {
    expect(scoreItem('JOSE', item('José'))).toBeGreaterThan(0);
    expect(scoreItem('muller', item('Müller'))).toBeGreaterThan(0);
  });

  it('needs every word of the query to match', () => {
    expect(scoreItem('game night', item('Game Night'))).toBeGreaterThan(0);
    expect(scoreItem('game zebra', item('Game Night'))).toBe(0);
  });

  it('finds an item by its detail or keywords, but counts the name for more', () => {
    const byName = scoreItem('amy', item('Amy'));
    const byDetail = scoreItem('amy', item('Dm 1', { detail: '@amy' }));
    const byKeyword = scoreItem('amy', item('Dm 2', { keywords: 'amy' }));
    expect(byDetail).toBeGreaterThan(0);
    expect(byKeyword).toBeGreaterThan(0);
    expect(byName).toBeGreaterThan(byDetail);
  });

  it('does not match two-letter queries by scattered letters', () => {
    expect(scoreItem('gt', item('Game Night'))).toBe(0);
  });
});

describe('rankSwitcherItems', () => {
  const items = [
    item('Game Night', { id: 's1', kind: 'space' }),
    item('general', { id: 'c1', kind: 'channel', detail: 'Game Night' }),
    item('Gabi', { id: 'f1', kind: 'friend' }),
    item('Home', { id: 'p1', kind: 'page' }),
    item('Gary', { id: 'd1', kind: 'dm', recency: 50 }),
    item('Gwen', { id: 'd2', kind: 'dm', recency: 90 }),
  ];

  it('puts the best match first', () => {
    expect(rankSwitcherItems(items, 'home', 5)[0]!.id).toBe('p1');
    expect(rankSwitcherItems(items, 'gabi', 5)[0]!.id).toBe('f1');
  });

  it('breaks ties by kind, then by recency', () => {
    const result = rankSwitcherItems([
      item('Gab', { id: 'f', kind: 'friend' }),
      item('Gab', { id: 'd-old', kind: 'dm', recency: 1 }),
      item('Gab', { id: 'd-new', kind: 'dm', recency: 2 }),
    ], 'gab', 5);
    expect(result.map((i) => i.id)).toEqual(['d-new', 'd-old', 'f']);
  });

  it('respects the limit', () => {
    expect(rankSwitcherItems(items, 'g', 2)).toHaveLength(2);
  });

  it('with no query offers what is unread first, then conversations by recency', () => {
    const list = [
      item('Quiet channel', { id: 'c', kind: 'channel' }),
      item('Old chat', { id: 'd-old', kind: 'dm', recency: 1 }),
      item('New chat', { id: 'd-new', kind: 'dm', recency: 9 }),
      item('Loud channel', { id: 'c-unread', kind: 'channel', unread: true }),
    ];
    expect(rankSwitcherItems(list, '   ', 10).map((i) => i.id)).toEqual(['c-unread', 'd-new', 'd-old', 'c']);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(rankSwitcherItems(items, 'qqqq', 5)).toEqual([]);
  });
});
