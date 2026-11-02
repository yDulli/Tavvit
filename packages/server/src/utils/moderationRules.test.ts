import { describe, expect, it } from 'vitest';
import { MODERATION_LIMITS, type SpaceModerationSettings } from '@backspace/shared';
import {
  DEFAULT_MODERATION_SETTINGS,
  compileBlockedWords,
  countMentions,
  findModerationViolation,
  normalizeModerationSettings,
} from '@backspace/shared/src/moderation.js';

// The pure rules of a space's automatic moderation (packages/shared/src/moderation.ts),
// which the server enforces and a client may run. docs/systems/spaces.md, "Moderation".

const DEFAULTS: SpaceModerationSettings = { ...DEFAULT_MODERATION_SETTINGS, blockedWords: [] };

function rules(patch: Partial<SpaceModerationSettings>): SpaceModerationSettings {
  return { ...DEFAULTS, ...patch };
}

function check(content: string, patch: Partial<SpaceModerationSettings>): string | null {
  return findModerationViolation(content, rules(patch), countMentions(content))?.code ?? null;
}

describe('normalizeModerationSettings', () => {
  it('keeps the fields a patch leaves out and the current updatedAt', () => {
    const current = rules({ blockedWords: ['spoiler'], blockLinks: true, maxMentions: 5, updatedAt: 42 });
    const result = normalizeModerationSettings(current, { blockInvites: true });
    expect(result).toEqual({ ok: true, value: { ...current, blockInvites: true } });
  });

  it('stores blocked words trimmed, deduplicated without case and without empty entries', () => {
    const result = normalizeModerationSettings(DEFAULTS, {
      blockedWords: ['  Bad  ', 'bad', '', '   ', '*', 'very   bad\nword', '**part**', 'BAD*'],
    });
    expect(result).toEqual({ ok: true, value: { ...DEFAULTS, blockedWords: ['Bad', 'very bad word', '*part*', 'BAD*'] } });
  });

  it('refuses a list over the limits and entries that are not one-line text', () => {
    const tooMany = Array.from({ length: MODERATION_LIMITS.MAX_BLOCKED_WORDS + 1 }, (_, i) => `word${i}`);
    expect(normalizeModerationSettings(DEFAULTS, { blockedWords: tooMany })).toEqual({ ok: false, field: 'blockedWords' });
    const longest = 'a'.repeat(MODERATION_LIMITS.MAX_BLOCKED_WORD_LENGTH);
    expect(normalizeModerationSettings(DEFAULTS, { blockedWords: [longest] }).ok).toBe(true);
    expect(normalizeModerationSettings(DEFAULTS, { blockedWords: [`${longest}a`] })).toEqual({ ok: false, field: 'blockedWords' });
    expect(normalizeModerationSettings(DEFAULTS, { blockedWords: ['ok', 7] })).toEqual({ ok: false, field: 'blockedWords' });
    expect(normalizeModerationSettings(DEFAULTS, { blockedWords: 'bad' })).toEqual({ ok: false, field: 'blockedWords' });
    expect(normalizeModerationSettings(DEFAULTS, { blockedWords: ['a\u0000b'] })).toEqual({ ok: false, field: 'blockedWords' });
    expect(normalizeModerationSettings(DEFAULTS, { blockedWords: ['\u202ebad'] })).toEqual({ ok: false, field: 'blockedWords' });
  });

  it('counts duplicates once against the limit', () => {
    const repeated = Array.from({ length: MODERATION_LIMITS.MAX_BLOCKED_WORDS * 2 }, (_, i) => (i % 2 === 0 ? `w${i / 2}` : `W${(i - 1) / 2}`));
    const result = normalizeModerationSettings(DEFAULTS, { blockedWords: repeated });
    expect(result.ok && result.value.blockedWords).toHaveLength(MODERATION_LIMITS.MAX_BLOCKED_WORDS);
  });

  it('takes booleans and whole numbers in range, and names the first field that is not', () => {
    expect(normalizeModerationSettings(DEFAULTS, { blockLinks: 'yes' })).toEqual({ ok: false, field: 'blockLinks' });
    expect(normalizeModerationSettings(DEFAULTS, { blockInvites: 1 })).toEqual({ ok: false, field: 'blockInvites' });
    expect(normalizeModerationSettings(DEFAULTS, { maxMentions: MODERATION_LIMITS.MAX_MENTIONS_CAP + 1 })).toEqual({ ok: false, field: 'maxMentions' });
    expect(normalizeModerationSettings(DEFAULTS, { maxMentions: 2.5 })).toEqual({ ok: false, field: 'maxMentions' });
    expect(normalizeModerationSettings(DEFAULTS, { minAccountAgeMinutes: -1 })).toEqual({ ok: false, field: 'minAccountAgeMinutes' });
    expect(normalizeModerationSettings(DEFAULTS, { minMemberAgeMinutes: MODERATION_LIMITS.MAX_AGE_MINUTES + 1 })).toEqual({ ok: false, field: 'minMemberAgeMinutes' });
    expect(normalizeModerationSettings(DEFAULTS, { minMemberAgeMinutes: '10' })).toEqual({ ok: false, field: 'minMemberAgeMinutes' });
    const value = normalizeModerationSettings(DEFAULTS, {
      maxMentions: MODERATION_LIMITS.MAX_MENTIONS_CAP, minAccountAgeMinutes: 0, minMemberAgeMinutes: MODERATION_LIMITS.MAX_AGE_MINUTES,
    });
    expect(value).toEqual({
      ok: true,
      value: { ...DEFAULTS, maxMentions: MODERATION_LIMITS.MAX_MENTIONS_CAP, minMemberAgeMinutes: MODERATION_LIMITS.MAX_AGE_MINUTES },
    });
  });

  it('refuses a body that is not an object and ignores fields it does not know', () => {
    expect(normalizeModerationSettings(DEFAULTS, null)).toEqual({ ok: false, field: 'body' });
    expect(normalizeModerationSettings(DEFAULTS, ['blockLinks'])).toEqual({ ok: false, field: 'body' });
    expect(normalizeModerationSettings(DEFAULTS, { updatedAt: 5, other: true })).toEqual({ ok: true, value: DEFAULTS });
  });
});

describe('blocked words', () => {
  it('match whole words without regard to case', () => {
    const words = { blockedWords: ['bad'] };
    expect(check('this is BAD!', words)).toBe('automod_blocked_word');
    expect(check('bad', words)).toBe('automod_blocked_word');
    expect(check('(bad)', words)).toBe('automod_blocked_word');
    expect(check('a badge', words)).toBeNull();
    expect(check('notbad', words)).toBeNull();
    expect(check('bad_word', words)).toBeNull();
    expect(check('bad2', words)).toBeNull();
  });

  it('let a side marked with * sit inside a longer word', () => {
    expect(check('a badge', { blockedWords: ['bad*'] })).toBe('automod_blocked_word');
    expect(check('notbad', { blockedWords: ['bad*'] })).toBeNull();
    expect(check('notbad', { blockedWords: ['*bad'] })).toBe('automod_blocked_word');
    expect(check('a badge', { blockedWords: ['*bad'] })).toBeNull();
    expect(check('xbadx', { blockedWords: ['*bad*'] })).toBe('automod_blocked_word');
  });

  it('match a phrase across any whitespace and words outside the Latin script', () => {
    expect(check('so very\n  bad', { blockedWords: ['very bad'] })).toBe('automod_blocked_word');
    expect(check('verybad', { blockedWords: ['very bad'] })).toBeNull();
    expect(check('Это ПЛОХО.', { blockedWords: ['плохо'] })).toBe('automod_blocked_word');
    expect(check('неплохо', { blockedWords: ['плохо'] })).toBeNull();
    expect(check('Straße', { blockedWords: ['strasse'] })).toBeNull();
  });

  it('see through compatibility forms and zero-width characters', () => {
    expect(check('ｂａｄ', { blockedWords: ['bad'] })).toBe('automod_blocked_word');
    expect(check('b\u200bad', { blockedWords: ['bad'] })).toBe('automod_blocked_word');
  });

  it('treat characters with a meaning in a regular expression as text', () => {
    expect(check('c++ rocks', { blockedWords: ['c++'] })).toBe('automod_blocked_word');
    expect(check('cpp rocks', { blockedWords: ['c++'] })).toBeNull();
    expect(check('a.b', { blockedWords: ['a.b'] })).toBe('automod_blocked_word');
    expect(check('axb', { blockedWords: ['a.b'] })).toBeNull();
    expect(compileBlockedWords([])).toBeNull();
    expect(compileBlockedWords(['(', '[x', '\\'])?.test('[x')).toBe(true);
  });
});

describe('links and invites', () => {
  it('find web links but not ordinary words with dots', () => {
    const links = { blockLinks: true };
    expect(check('see https://example.com/page', links)).toBe('automod_link_blocked');
    expect(check('http://10.0.0.1:8080', links)).toBe('automod_link_blocked');
    expect(check('go to www.example.org now', links)).toBe('automod_link_blocked');
    expect(check('e.g. this, i.e. that', links)).toBeNull();
    expect(check('open file.txt or example.com', links)).toBeNull();
    expect(check('www.e.g', links)).toBeNull();
    expect(check('https:// nothing', links)).toBeNull();
    expect(check('see https://example.com', {})).toBeNull();
  });

  it('find invites in every form this codebase reads one', () => {
    const invites = { blockInvites: true };
    expect(check('join https://nova.ddns.net/join/a3f1b2c4', invites)).toBe('automod_invite_blocked');
    expect(check('nova.ddns.net/join/a3f1b2c4', invites)).toBe('automod_invite_blocked');
    expect(check('https://my.host/join/a3f1b2c4%40nova.ddns.net', invites)).toBe('automod_invite_blocked');
    expect(check('tavvit://join/a3f1b2c4', invites)).toBe('automod_invite_blocked');
    expect(check('code a3f1b2c4@nova.ddns.net', invites)).toBe('automod_invite_blocked');
    expect(check('today\'s links https://tavvit.com/join/A3f_b2-Q', invites)).toBe('automod_invite_blocked');
    expect(check('https://example.com/join/team', invites)).toBeNull();
    expect(check('write to someone@example.com', invites)).toBeNull();
    expect(check('https://example.com/docs/join/a3f1b2c4', invites)).toBeNull();
    expect(check('a3f1b2c4', invites)).toBeNull();
  });

  it('name the invite before the link when both rules are on', () => {
    expect(check('https://nova.ddns.net/join/a3f1b2c4', { blockLinks: true, blockInvites: true })).toBe('automod_invite_blocked');
    expect(check('https://nova.ddns.net/join/a3f1b2c4', { blockLinks: true })).toBe('automod_link_blocked');
  });

  it('leave a sticker alone, which carries no text', () => {
    const sticker = `sticker:https://nova.ddns.net/api/stickers/assets/${'a'.repeat(64)}.webp`;
    expect(check(sticker, { blockLinks: true, blockedWords: ['api'] })).toBeNull();
    expect(check(`${sticker} https://other.example`, { blockLinks: true })).toBe('automod_link_blocked');
  });
});

describe('mentions', () => {
  it('count distinct people and roles outside code', () => {
    expect(countMentions('<@a> <@a> <@b> <@&r> `<@c>` @everyone')).toBe(3);
    expect(countMentions(null)).toBe(0);
  });

  it('refuse more than the limit with the limit in the details', () => {
    const content = '<@a> <@b> <@c>';
    expect(findModerationViolation(content, rules({ maxMentions: 2 }), countMentions(content)))
      .toEqual({ code: 'automod_too_many_mentions', details: { max: 2 } });
    expect(findModerationViolation(content, rules({ maxMentions: 3 }), countMentions(content))).toBeNull();
    expect(findModerationViolation(content, rules({ maxMentions: 0 }), countMentions(content))).toBeNull();
  });

  it('check a blocked word before the mention limit', () => {
    expect(check('bad <@a> <@b>', { blockedWords: ['bad'], maxMentions: 1 })).toBe('automod_blocked_word');
  });

  it('find nothing in empty content or under the default rules', () => {
    expect(findModerationViolation(null, DEFAULTS, 0)).toBeNull();
    expect(findModerationViolation('https://example.com bad <@a>', DEFAULTS, 1)).toBeNull();
  });
});
