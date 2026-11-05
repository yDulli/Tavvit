import { describe, expect, it } from 'vitest';
import { mapDiscordPermissions } from '@backspace/shared/src/discordImport.js';
import { PermissionBits } from '@backspace/shared/src/permissions.js';
import {
  discordAssetUrl,
  emojiNameFromDiscord,
  freeExpressionName,
  planDiscordExpressionImport,
  readDiscordEmojiList,
  readDiscordStickerList,
  type DiscordExpressionListing,
  type DiscordExpressionTarget,
} from '@backspace/shared/src/discordExpressionImport.js';

// What a Discord server's emoji and stickers become here (shared/src/discordExpressionImport.ts):
// read with only what is kept, named so that nothing in the space clashes, room taken in Discord's
// order, and the addresses the pictures may come from.

const target = (over: Partial<DiscordExpressionTarget> = {}): DiscordExpressionTarget => ({
  emojiNames: [], stickerNames: [], importedDiscordIds: new Set(), emojiRoom: 200, stickerRoom: 60, ...over,
});

const emoji = (id: string, name: string, extra: Partial<DiscordExpressionListing['emojis'][number]> = {}) => ({
  discordId: id, name, animated: false, managed: false, roleRestricted: false, ...extra,
});

describe('reading Discord\'s answers', () => {
  it('keeps an entry\'s id, name and flags, and drops who uploaded it and which roles could use it', () => {
    const read = readDiscordEmojiList([
      { id: '100000000000000001', name: 'wave', animated: true, managed: false, roles: ['1'], user: { id: '5', username: 'uploader' } },
      { id: null, name: null },
    ]);
    expect(read).toEqual([{ discordId: '100000000000000001', name: 'wave', animated: true, managed: false, roleRestricted: true }]);
    expect(JSON.stringify(read)).not.toContain('uploader');
  });

  it('keeps a server\'s own stickers only, without description or tags', () => {
    const read = readDiscordStickerList([
      { id: '200000000000000001', name: 'hi', format_type: 4, type: 2, description: 'a secret', tags: 'x' },
      { id: '200000000000000002', name: 'standard', format_type: 1, type: 1 },
    ]);
    expect(read).toEqual([{ discordId: '200000000000000001', name: 'hi', format: 'gif' }]);
  });

  it('refuses an answer that is not a list, or a list too long to be a server\'s', () => {
    expect(readDiscordEmojiList({})).toBeNull();
    expect(readDiscordEmojiList(Array.from({ length: 1001 }, () => ({})))).toBeNull();
    expect(readDiscordStickerList('x')).toBeNull();
  });
});

describe('names', () => {
  it('turns a Discord name into an emoji name, and finds a free one without regard to case', () => {
    expect(emojiNameFromDiscord('Party-Parrot!')).toBe('party_parrot_');
    expect(emojiNameFromDiscord('x')).toBe('x_');
    expect(freeExpressionName('wave', new Set(['wave', 'wave_2']), 'emoji')).toBe('wave_3');
    expect(freeExpressionName('a'.repeat(32), new Set(['a'.repeat(32)]), 'emoji')).toBe(`${'a'.repeat(30)}_2`);
    expect(freeExpressionName('Hello', new Set(['hello']), 'sticker')).toBe('Hello (2)');
  });
});

describe('the plan', () => {
  const listing: DiscordExpressionListing = {
    emojis: [emoji('100000000000000001', 'Wave'), emoji('100000000000000002', 'wave'), emoji('100000000000000003', 'sub', { managed: true })],
    stickers: [
      { discordId: '200000000000000001', name: 'Hi', format: 'apng' },
      { discordId: '200000000000000002', name: 'Dance', format: 'lottie' },
    ],
  };

  it('names everything free in the space and among what comes, and says what changes', () => {
    const items = planDiscordExpressionImport(listing, target({ emojiNames: ['wave'] }));
    expect(items.map((item) => [item.sourceName, item.action, item.name, item.skip, item.notes])).toEqual([
      ['Wave', 'import', 'wave_2', null, ['renamed']],
      ['wave', 'import', 'wave_3', null, ['renamed']],
      ['sub', 'skip', 'sub', 'managed', []],
      ['Hi', 'import', 'Hi', null, ['still_picture']],
      ['Dance', 'skip', 'Dance', 'lottie', []],
    ]);
  });

  it('takes room in Discord\'s order and leaves what an earlier import brought', () => {
    const items = planDiscordExpressionImport(listing, target({ emojiRoom: 1, importedDiscordIds: new Set(['200000000000000001']) }));
    expect(items.map((item) => [item.sourceName, item.skip])).toEqual([
      ['Wave', null], ['wave', 'no_room'], ['sub', 'managed'], ['Hi', 'already_here'], ['Dance', 'lottie'],
    ]);
  });

  it('puts what was not picked out first, whatever else is true of it', () => {
    const items = planDiscordExpressionImport(listing, target({ selection: new Set(['emoji:100000000000000002']) }));
    expect(items.map((item) => [item.sourceName, item.action, item.skip])).toEqual([
      ['Wave', 'skip', 'not_selected'],
      ['wave', 'import', null],
      ['sub', 'skip', 'not_selected'],
      ['Hi', 'skip', 'not_selected'],
      ['Dance', 'skip', 'not_selected'],
    ]);
  });
});

describe('a Discord role\'s rights over emoji, stickers and sounds', () => {
  const bits = (...numbers: number[]) => numbers.reduce((all, bit) => all | (1n << BigInt(bit)), 0n).toString();
  const managing = PermissionBits.MANAGE_EMOJIS | PermissionBits.MANAGE_SOUNDS;

  it('become Tavvit\'s only when the role could both add (43) and manage (30) them on Discord', () => {
    expect(mapDiscordPermissions(bits(30, 43)).native & managing).toBe(managing);
    expect(mapDiscordPermissions(bits(30, 43)).unsupported).toEqual([]);
  });

  it('give nothing for one of the two alone, and name it', () => {
    expect(mapDiscordPermissions(bits(30))).toEqual({ native: 0n, unsupported: ['MANAGE_GUILD_EXPRESSIONS'] });
    expect(mapDiscordPermissions(bits(43))).toEqual({ native: 0n, unsupported: ['CREATE_GUILD_EXPRESSIONS'] });
  });
});

describe('where the pictures come from', () => {
  it('names only Discord\'s content servers, and nothing for a vector sticker', () => {
    expect(discordAssetUrl({ kind: 'emoji', discordId: '100000000000000001', animated: true })).toBe('https://cdn.discordapp.com/emojis/100000000000000001.gif');
    expect(discordAssetUrl({ kind: 'emoji', discordId: '100000000000000001', animated: false })).toBe('https://cdn.discordapp.com/emojis/100000000000000001.png');
    expect(discordAssetUrl({ kind: 'sticker', discordId: '200000000000000001', animated: true, format: 'gif' })).toBe('https://media.discordapp.net/stickers/200000000000000001.gif');
    expect(discordAssetUrl({ kind: 'sticker', discordId: '200000000000000001', animated: false, format: 'apng' })).toBe('https://cdn.discordapp.com/stickers/200000000000000001.png');
    expect(discordAssetUrl({ kind: 'sticker', discordId: '200000000000000002', animated: false, format: 'lottie' })).toBeNull();
    expect(discordAssetUrl({ kind: 'emoji', discordId: '../../x', animated: false })).toBeNull();
  });
});
