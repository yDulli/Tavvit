import { describe, it, expect } from 'vitest';
import { isTwitchStreamUrl, twitchChannelOf, twitchChannelOfLinks, twitchChannelUrl, twitchStreamOf } from '@backspace/shared/src/twitch.js';

// How a profile names a Twitch channel, read the same way by the instance that
// asks Twitch and by the client that offers the way to the stream
// (docs/systems/activity-presence.md, "Live on Twitch").
describe('twitchChannelOf', () => {
  it('reads the channel from its page, in lower case', () => {
    expect(twitchChannelOf('https://www.twitch.tv/Mara_Plays')).toBe('mara_plays');
    expect(twitchChannelOf('https://twitch.tv/mara/videos')).toBe('mara');
    expect(twitchChannelOf('http://m.twitch.tv/mara?ref=x')).toBe('mara');
  });

  it('names no channel for other pages, other sites or names Twitch would refuse', () => {
    expect(twitchChannelOf('https://www.twitch.tv/directory')).toBeNull();
    expect(twitchChannelOf('https://www.twitch.tv/')).toBeNull();
    expect(twitchChannelOf('https://twitch.tv.example.com/mara')).toBeNull();
    expect(twitchChannelOf('https://www.twitch.tv/abc')).toBeNull();
    expect(twitchChannelOf('https://www.twitch.tv/mara-plays')).toBeNull();
    expect(twitchChannelOf('ftp://twitch.tv/mara')).toBeNull();
    expect(twitchChannelOf('not a url')).toBeNull();
  });

  it('takes the first channel among a profile\'s links', () => {
    expect(twitchChannelOfLinks([
      { url: 'https://example.com/', label: null },
      { url: 'https://www.twitch.tv/first', label: 'Stream' },
      { url: 'https://www.twitch.tv/second', label: null },
    ])).toBe('first');
    expect(twitchChannelOfLinks(null)).toBeNull();
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
