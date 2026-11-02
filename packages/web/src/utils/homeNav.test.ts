import { describe, it, expect } from 'vitest';
import { activeHomeNavItem, HOME_ROUTES, isFriendsLinkView, isHomeAreaPath, showsHomeDashboard } from './homeNav';

describe('activeHomeNavItem', () => {
  it('selects Explore on /explore', () => {
    expect(activeHomeNavItem('/explore', null)).toBe('explore');
  });

  it('selects About on /about', () => {
    expect(activeHomeNavItem('/about', null)).toBe('about');
  });

  it('selects Friends on /friends', () => {
    expect(activeHomeNavItem('/friends', null)).toBe('friends');
  });

  it('selects Home on the DM home with no channel open', () => {
    expect(activeHomeNavItem('/channels/@me', null)).toBe('home');
  });

  it('selects nothing while a DM is open', () => {
    expect(activeHomeNavItem('/channels/@me/dm-1', 'dm-1')).toBeNull();
  });

  it('selects nothing in a space channel', () => {
    expect(activeHomeNavItem('/channels/space-1/channel-1', 'channel-1')).toBeNull();
  });

  it('keeps the page items selected even when a stale channel id lingers', () => {
    expect(activeHomeNavItem('/explore', 'channel-1')).toBe('explore');
    expect(activeHomeNavItem('/about', 'channel-1')).toBe('about');
    expect(activeHomeNavItem('/friends', 'channel-1')).toBe('friends');
  });

  it('does not treat a path that only starts with a page name as that page', () => {
    expect(activeHomeNavItem('/about-old', null)).toBe('home');
    expect(activeHomeNavItem('/friendship', null)).toBe('home');
    expect(activeHomeNavItem('/explorer', null)).toBe('home');
  });
});

describe('isHomeAreaPath', () => {
  it('is true for the three standalone pages', () => {
    expect(isHomeAreaPath(HOME_ROUTES.friends)).toBe(true);
    expect(isHomeAreaPath(HOME_ROUTES.explore)).toBe(true);
    expect(isHomeAreaPath(HOME_ROUTES.about)).toBe(true);
  });

  it('is false for the channel routes, Home included', () => {
    expect(isHomeAreaPath('/channels/@me')).toBe(false);
    expect(isHomeAreaPath('/channels/space-1/channel-1')).toBe(false);
  });
});

describe('showsHomeDashboard', () => {
  const view = { pathname: '/channels/@me', showDms: true, currentSpaceId: null, currentChannelId: null };

  it('is true on the DM home with no conversation open', () => {
    expect(showsHomeDashboard(view)).toBe(true);
  });

  it('is false with a conversation open', () => {
    expect(showsHomeDashboard({ ...view, currentChannelId: 'dm-1' })).toBe(false);
  });

  it('is false on the home-area pages', () => {
    for (const pathname of ['/inbox', '/friends', '/explore', '/about']) {
      expect(showsHomeDashboard({ ...view, pathname })).toBe(false);
    }
  });

  it('is false in a space', () => {
    expect(showsHomeDashboard({ pathname: '/channels/space-1', showDms: false, currentSpaceId: 'space-1', currentChannelId: null })).toBe(false);
  });
});

describe('isFriendsLinkView', () => {
  it('names only the add and pending views', () => {
    expect(isFriendsLinkView('add')).toBe(true);
    expect(isFriendsLinkView('pending')).toBe(true);
    expect(isFriendsLinkView('online')).toBe(false);
    expect(isFriendsLinkView(null)).toBe(false);
  });
});
