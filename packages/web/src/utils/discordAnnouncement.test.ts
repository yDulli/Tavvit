import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { buildDiscordAnnouncement, DISCORD_MESSAGE_MAX, escapeDiscordText } from './discordAnnouncement';

// The text people paste into their Discord server: a name cannot ping the server or change the
// formatting, the link stays a link, and the text says only what is true of this space and server.

const ZERO_WIDTH_SPACE = '​';

describe('escapeDiscordText', () => {
  it('escapes markdown, so a name shows as written', () => {
    expect(escapeDiscordText('**Bold** _it_ ~x~ `c` ||s|| [l](u) # > -')).toBe(
      '\\*\\*Bold\\*\\* \\_it\\_ \\~x\\~ \\`c\\` \\|\\|s\\|\\| \\[l\\]\\(u\\) \\# \\> \\-',
    );
  });

  it('breaks every kind of mention, which a backslash would not stop', () => {
    expect(escapeDiscordText('@everyone @HERE')).toBe(`@${ZERO_WIDTH_SPACE}everyone @${ZERO_WIDTH_SPACE}HERE`);
    for (const mention of ['<@123>', '<@&123>', '<#123>', '<:name:123>', '<a:name:123>', '<t:1700000000>', '</cmd:1>']) {
      expect(escapeDiscordText(mention).startsWith(`<${ZERO_WIDTH_SPACE}`)).toBe(true);
    }
    expect(escapeDiscordText('a < b')).toBe('a < b');
  });
});

describe('buildDiscordAnnouncement', () => {
  const t = i18n.getFixedT('en', 'spaces');
  const base = {
    t,
    spaceName: 'Night Shift',
    instanceName: 'Tavvit',
    link: 'https://tavvit.com/join/abc123?from=discord',
    request: false,
    withEmoji: true,
    registrationOpen: true,
  };

  it('says where the community went, what is set up and how to come, with the link on a line of its own', () => {
    expect(buildDiscordAnnouncement(base).split('\n')).toEqual([
      '**Night Shift has moved to Tavvit.**',
      'Our channels, roles and emoji are already set up there.',
      'Creating an account takes about a minute.',
      '',
      'Join us with this link:',
      'https://tavvit.com/join/abc123?from=discord',
      '',
      'Everything written here stays on Discord.',
    ]);
  });

  it('claims no emoji that did not come, no quick sign-up a closed server does not offer, and asks for a request space', () => {
    const text = buildDiscordAnnouncement({ ...base, withEmoji: false, registrationOpen: false, request: true });
    expect(text).toContain('Our channels and roles are already set up there.');
    expect(text).not.toContain('about a minute');
    expect(text).toContain('Ask to join with this link, and we will let you in:');
  });

  it('escapes the names but never the link, and stays within one Discord message', () => {
    const text = buildDiscordAnnouncement({ ...base, spaceName: '@everyone **x**'.padEnd(100, '_'), instanceName: '<@1> hub' });
    expect(text).not.toContain('@everyone');
    expect(text).not.toContain('<@1>');
    expect(text).toContain('https://tavvit.com/join/abc123?from=discord');
    expect(text.length).toBeLessThanOrEqual(DISCORD_MESSAGE_MAX);
  });
});
