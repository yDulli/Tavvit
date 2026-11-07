import { describe, it, expect } from 'vitest';
import { isTwitchLogin, isTwitchStreamUrl, twitchChannelOf, twitchChannelUrl, twitchStreamOf } from '@backspace/shared/src/twitch.js';
import {
  linkedAccountUrl,
  normalizeProfileLinkedAccounts,
  parseStoredProfileLinkedAccounts,
} from '@backspace/shared/src/linkedAccounts.js';

// Twitch accounts and the way to their streams, read the same way by the
// instance that stores and asks and by the client that shows and links
// (docs/systems/linked-accounts.md, activity-presence.md "Live on Twitch").
describe('Twitch logins and channel pages', () => {
  it('takes a login only as Twitch writes one', () => {
    expect(isTwitchLogin('mara_plays')).toBe(true);
    expect(isTwitchLogin('b0')).toBe(true);
    expect(isTwitchLogin('Mara')).toBe(false);
    expect(isTwitchLogin('mara-plays')).toBe(false);
    expect(isTwitchLogin('a'.repeat(26))).toBe(false);
    expect(isTwitchLogin(42)).toBe(false);
  });

  it('reads the channel from its page, in lower case', () => {
    expect(twitchChannelOf('https://www.twitch.tv/Mara_Plays')).toBe('mara_plays');
    expect(twitchChannelOf('https://twitch.tv/mara/videos')).toBe('mara');
    expect(twitchChannelOf('http://m.twitch.tv/mara?ref=x')).toBe('mara');
  });

  it('names no channel for other pages, other sites or names Twitch would refuse', () => {
    expect(twitchChannelOf('https://www.twitch.tv/directory')).toBeNull();
    expect(twitchChannelOf('https://www.twitch.tv/')).toBeNull();
    expect(twitchChannelOf('https://twitch.tv.example.com/mara')).toBeNull();
    expect(twitchChannelOf('https://www.twitch.tv/mara-plays')).toBeNull();
    expect(twitchChannelOf('ftp://twitch.tv/mara')).toBeNull();
    expect(twitchChannelOf('not a url')).toBeNull();
  });
});

describe('the way to a stream', () => {
  it('is only the channel\'s own page', () => {
    expect(twitchChannelUrl('mara')).toBe('https://www.twitch.tv/mara');
    expect(isTwitchStreamUrl('https://www.twitch.tv/mara')).toBe(true);
    expect(isTwitchStreamUrl('https://twitch.tv/mara')).toBe(false);
    expect(isTwitchStreamUrl('https://www.twitch.tv/mara/videos')).toBe(false);
    expect(isTwitchStreamUrl(42)).toBe(false);
  });

  it('is offered only for an activity a home found on Twitch', () => {
    expect(twitchStreamOf({ source: 'twitch', url: 'https://www.twitch.tv/mara' })).toBe('https://www.twitch.tv/mara');
    expect(twitchStreamOf({ url: 'https://www.twitch.tv/mara' })).toBeNull();
    expect(twitchStreamOf({ source: 'twitch', url: 'https://example.com/' })).toBeNull();
    expect(twitchStreamOf(null)).toBeNull();
  });
});

describe('linked accounts as a profile shows them', () => {
  it('keeps what a service would name, once per service, and leads only to the account\'s page', () => {
    expect(normalizeProfileLinkedAccounts([
      { provider: 'twitch', login: 'mara', name: ' Mara ‮' },
      { provider: 'twitch', login: 'second', name: 'Second' },
      { provider: 'youtube', login: 'mara', name: 'Mara' },
      { provider: 'twitch', login: 'javascript:alert(1)', name: 'x' },
    ])).toEqual([{ provider: 'twitch', login: 'mara', name: 'Mara' }]);
    expect(linkedAccountUrl({ provider: 'twitch', login: 'mara' })).toBe('https://www.twitch.tv/mara');
    expect(linkedAccountUrl({ provider: 'twitch', login: '../evil' })).toBeNull();
  });

  it('reads a stored list, and nothing from what is not one', () => {
    expect(parseStoredProfileLinkedAccounts(JSON.stringify([{ provider: 'twitch', login: 'mara', name: 'Mara' }])))
      .toEqual([{ provider: 'twitch', login: 'mara', name: 'Mara' }]);
    expect(parseStoredProfileLinkedAccounts('not json')).toEqual([]);
    expect(parseStoredProfileLinkedAccounts(null)).toEqual([]);
    expect(normalizeProfileLinkedAccounts([{ provider: 'twitch', login: 'mara', name: '' }])).toEqual([]);
  });
});
