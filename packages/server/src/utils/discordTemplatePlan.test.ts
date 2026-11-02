import { describe, expect, it } from 'vitest';
import {
  mapDiscordPermissions,
  parseDiscordTemplateCode,
  planDiscordImport,
  readDiscordTemplate,
  type DiscordImportTarget,
  type DiscordTemplateSource,
} from '@backspace/shared/src/discordImport.js';
import { ALL_PERMISSIONS, PermissionBits } from '@backspace/shared/src/permissions.js';

// The pure half of the Discord template import (packages/shared/src/discordImport.ts):
// reading a pasted link, mapping Discord's permission bits, and planning.

const NEW_SPACE: DiscordImportTarget = {
  kind: 'new', grantsEveryBit: true, heldPermissions: ALL_PERMISSIONS,
  standing: { isOwner: true, isInstanceAdmin: false, topPosition: 0 }, roles: [], categories: [], channels: [],
};

/** An existing space, imported into by a manager whose top role sits at `topPosition`. */
function managerTarget(held: bigint, topPosition: number, space: Partial<Pick<DiscordImportTarget, 'roles' | 'categories' | 'channels'>> = {}): DiscordImportTarget {
  return {
    kind: 'existing', grantsEveryBit: false, heldPermissions: held,
    standing: { isOwner: false, isInstanceAdmin: false, topPosition },
    roles: space.roles ?? [], categories: space.categories ?? [], channels: space.channels ?? [],
  };
}

function source(guild: { roles?: unknown[]; channels?: unknown[] }): DiscordTemplateSource {
  const read = readDiscordTemplate({
    name: 'T',
    serialized_source_guild: {
      name: 'Guild',
      roles: guild.roles ?? [{ id: 0, name: '@everyone', permissions: '0' }],
      channels: guild.channels ?? [],
    },
  }, null);
  if (!read.ok) throw new Error(`template not read: ${JSON.stringify(read)}`);
  return read.source;
}

describe('parseDiscordTemplateCode', () => {
  it.each([
    ['abcDEF12', 'abcDEF12'],
    ['  abcDEF12  ', 'abcDEF12'],
    ['discord.new/abcDEF12', 'abcDEF12'],
    ['https://discord.new/abcDEF12', 'abcDEF12'],
    ['https://discord.com/template/abcDEF12', 'abcDEF12'],
    ['discord.com/template/abcDEF12/', 'abcDEF12'],
    ['https://ptb.discord.com/template/abc-_12?ref=x', 'abc-_12'],
  ])('reads %s', (input, code) => {
    expect(parseDiscordTemplateCode(input)).toBe(code);
  });

  it.each([
    'https://evil.example/template/abc',
    'https://discord.com.evil.example/template/abc',
    'https://discord.com/api/v10/guilds/templates/abc',
    'https://discord.com/template/abc/extra',
    'javascript:alert(1)',
    'ftp://discord.new/abc',
    'discord.new/../x',
    'a',
    'x'.repeat(65),
    '',
  ])('refuses %s', (input) => {
    expect(parseDiscordTemplateCode(input)).toBeNull();
  });
});

describe('mapDiscordPermissions', () => {
  it('maps each bit to the Tavvit bit that does the same, and names the rest', () => {
    const manageGuild = 1n << 5n;
    const move = 1n << 24n;
    const nicknames = 1n << 27n;
    const unknown = 1n << 47n;
    const mapped = mapDiscordPermissions(String(manageGuild | move | nicknames | unknown));
    expect(mapped.native).toBe(PermissionBits.MANAGE_SPACE | PermissionBits.MOVE_MEMBERS | PermissionBits.DISCONNECT_MEMBERS);
    expect(mapped.unsupported).toEqual(['MANAGE_NICKNAMES', 'BIT_47']);
  });

  it('maps Discord\'s timeout bit to Tavvit\'s', () => {
    expect(mapDiscordPermissions(String(1n << 40n)).native).toBe(PermissionBits.MODERATE_MEMBERS);
  });
});

describe('planDiscordImport', () => {
  const SEND = String(1 << 11);

  it('puts overrides on a category only when every channel in it has the same', () => {
    const plan = planDiscordImport(source({
      channels: [
        { id: 1, type: 4, name: 'Synced', position: 0, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: SEND }] },
        { id: 2, type: 0, name: 'a', parent_id: 1, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: SEND }] },
        { id: 3, type: 4, name: 'Mixed', position: 1, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: SEND }] },
        { id: 4, type: 0, name: 'b', parent_id: 3, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: SEND }] },
        { id: 5, type: 0, name: 'c', parent_id: 3, permission_overwrites: [] },
      ],
    }), NEW_SPACE);
    const synced = plan.categories.find((category) => category.name === 'Synced')!;
    const mixed = plan.categories.find((category) => category.name === 'Mixed')!;
    expect(synced.overrides).toHaveLength(1);
    expect(plan.channels.find((channel) => channel.name === 'a')!.overrides).toEqual([]);
    // Mixed's channels keep what each had on Discord: b its deny, c nothing.
    expect(mixed.overrides).toEqual([]);
    expect(plan.channels.find((channel) => channel.name === 'b')!.overrides).toHaveLength(1);
    expect(plan.channels.find((channel) => channel.name === 'c')!.overrides).toEqual([]);
    expect(plan.notes).toContainEqual({ kind: 'permissions_per_channel', subject: 'Mixed', detail: null });
  });

  it('converts the channel kinds Tavvit lacks, leaves out the unknown and notes both', () => {
    const plan = planDiscordImport(source({
      channels: [
        { id: 1, type: 5, name: 'news' },
        { id: 2, type: 13, name: 'Stage' },
        { id: 3, type: 15, name: 'forum' },
        { id: 4, type: 16, name: 'media' },
        { id: 5, type: 14, name: 'directory' },
      ],
    }), NEW_SPACE);
    // Voice names take Tavvit's form too, as every channel created here does.
    expect(plan.channels.map((channel) => [channel.name, channel.type, channel.converted])).toEqual([
      ['news', 'announcement', false], ['forum', 'forum', false], ['media', 'text', true], ['stage', 'voice', true],
    ]);
    expect(plan.notes).not.toContainEqual(expect.objectContaining({ kind: 'channel_converted', subject: 'news' }));
    expect(plan.notes).toContainEqual({ kind: 'channel_converted', subject: 'media', detail: 'media' });
    expect(plan.notes).toContainEqual({ kind: 'channel_converted', subject: 'stage', detail: 'stage' });
    expect(plan.notes).toContainEqual({ kind: 'channel_unsupported', subject: 'directory', detail: '14' });
  });

  it('rounds slow mode down to an Tavvit step, off below the shortest', () => {
    const plan = planDiscordImport(source({
      channels: [
        { id: 1, type: 0, name: 'slow', rate_limit_per_user: 7 },
        { id: 2, type: 0, name: 'brisk', rate_limit_per_user: 3 },
        { id: 3, type: 0, name: 'exact', rate_limit_per_user: 30 },
      ],
    }), NEW_SPACE);
    expect(plan.channels.map((channel) => [channel.name, channel.slowmodeSeconds])).toEqual([['slow', 5], ['brisk', 0], ['exact', 30]]);
    expect(plan.notes.filter((note) => note.kind === 'slowmode_adjusted')).toEqual([
      { kind: 'slowmode_adjusted', subject: 'slow', detail: '5' },
      { kind: 'slowmode_adjusted', subject: 'brisk', detail: '0' },
    ]);
  });

  it('renames a second role of one name, drops member overwrites and notes a missing parent', () => {
    const plan = planDiscordImport(source({
      roles: [
        { id: 0, name: '@everyone', permissions: '0' },
        { id: 1, name: 'Crew', permissions: '0' },
        { id: 2, name: 'crew', permissions: '0' },
      ],
      channels: [
        { id: 10, type: 0, name: 'orphan', parent_id: 99, permission_overwrites: [{ id: 5, type: 1, allow: SEND, deny: '0' }] },
      ],
    }), NEW_SPACE);
    expect(plan.roles.map((role) => role.name)).toEqual(['@everyone', 'Crew', 'crew (2)']);
    expect(plan.notes).toContainEqual({ kind: 'role_renamed', subject: 'crew (2)', detail: 'crew' });
    expect(plan.notes).toContainEqual({ kind: 'member_overwrite_dropped', subject: 'orphan', detail: null });
    expect(plan.notes).toContainEqual({ kind: 'reference_missing', subject: 'orphan', detail: null });
    expect(plan.channels[0]).toMatchObject({ name: 'orphan', categoryKey: null, overrides: [] });
  });

  it('withholds for a non-owner exactly the bits they do not hold', () => {
    const plan = planDiscordImport(source({
      roles: [
        { id: 0, name: '@everyone', permissions: '0' },
        { id: 1, name: 'Boss', permissions: String((1 << 3) | (1 << 13)) },
      ],
    }), managerTarget(PermissionBits.MANAGE_MESSAGES, 5));
    const boss = plan.roles.find((role) => role.name === 'Boss')!;
    expect(boss.withheld).toEqual(['ADMINISTRATOR']);
    expect(BigInt(boss.permissions)).toBe(PermissionBits.MANAGE_MESSAGES);
  });

  it('sets no override on a role the importer does not outrank, and names what it leaves out', () => {
    const MANAGE_MESSAGES = String(1 << 13);
    const plan = planDiscordImport(source({
      roles: [
        { id: 0, name: '@everyone', permissions: '0' },
        { id: 1, name: 'Senior', permissions: '0' },
        { id: 2, name: 'Fresh', permissions: '0' },
      ],
      channels: [{
        id: 10, type: 0, name: 'desk', permission_overwrites: [
          { id: 1, type: 0, allow: SEND, deny: '0' },
          { id: 2, type: 0, allow: SEND, deny: '0' },
          { id: 0, type: 0, allow: MANAGE_MESSAGES, deny: SEND },
        ],
      }],
    }), managerTarget(PermissionBits.SEND_MESSAGES, 3, { roles: [{ id: 'senior', name: 'Senior', position: 5 }] }));
    const desk = plan.channels.find((channel) => channel.name === 'desk')!;
    // Senior (5) ranks above the importer (3): no override for it. Fresh is
    // created below the importer; @everyone loses the bit they do not hold.
    expect(desk.overrides.map((override) => override.roleKey).sort()).toEqual(['0', '2']);
    expect(desk.overrides.find((override) => override.roleKey === '0')).toMatchObject({ allow: '0', deny: String(PermissionBits.SEND_MESSAGES) });
    expect(plan.notes).toContainEqual({ kind: 'override_hierarchy', subject: 'desk', detail: 'Senior' });
    expect(plan.notes).toContainEqual({ kind: 'override_withheld', subject: 'desk', detail: 'MANAGE_MESSAGES' });
    // A reused role is not written, so nothing of it is reported as adjusted.
    expect(plan.roles.find((role) => role.name === 'Senior')).toMatchObject({ action: 'reuse', withheld: [], unsupported: [] });
  });

  it('takes over each existing role and category once, so a second import of duplicates adds nothing', () => {
    const template = source({
      roles: [
        { id: 0, name: '@everyone', permissions: '0' },
        { id: 1, name: 'Muted', permissions: '0' },
        { id: 2, name: 'Muted', permissions: '0' },
      ],
      channels: [
        { id: 10, type: 4, name: '----', position: 0 },
        { id: 11, type: 4, name: '----', position: 1 },
      ],
    });
    const first = planDiscordImport(template, NEW_SPACE);
    expect(first.roles.map((role) => role.name)).toEqual(['@everyone', 'Muted', 'Muted (2)']);
    const again = planDiscordImport(template, {
      ...NEW_SPACE,
      kind: 'existing',
      roles: [{ id: 'm1', name: 'Muted', position: 1 }, { id: 'm2', name: 'Muted (2)', position: 2 }],
      categories: [{ id: 'c1', name: '----' }, { id: 'c2', name: '----' }],
    });
    expect(again.roles.slice(1).map((role) => [role.action, role.existingRoleId])).toEqual([['reuse', 'm1'], ['reuse', 'm2']]);
    expect(again.categories.map((category) => [category.action, category.existingCategoryId])).toEqual([['reuse', 'c1'], ['reuse', 'c2']]);
    expect(again.counts).toMatchObject({ roles: 0, categories: 0 });
  });

  it('knows an existing channel by its kind and Tavvit name', () => {
    const plan = planDiscordImport(source({
      channels: [
        { id: 1, type: 2, name: 'General' },
        { id: 2, type: 2, name: 'Game Night' },
      ],
    }), { ...NEW_SPACE, kind: 'existing', channels: [
      { name: 'general', type: 'text', categoryId: null },
      { name: 'game-night', type: 'voice', categoryId: null },
    ] });
    expect(plan.channels.map((channel) => [channel.name, channel.action])).toEqual([['general', 'create'], ['game-night', 'skip']]);
  });

  it('keeps only real emoji as role icons and drops hidden characters from names', () => {
    const plan = planDiscordImport(source({
      roles: [
        { id: 0, name: '@everyone', permissions: '0' },
        { id: 1, name: `Ad${String.fromCharCode(0x202e)}min`, permissions: '0', unicode_emoji: 'ADMIN' },
        { id: 2, name: '@everyone', permissions: '0', unicode_emoji: String.fromCodePoint(0x2b50) },
      ],
    }), NEW_SPACE);
    expect(plan.roles[1]).toMatchObject({ name: 'Admin', icon: null });
    expect(plan.notes).toContainEqual({ kind: 'role_icon_dropped', subject: 'Admin', detail: null });
    // A second @everyone is only a name; it is renamed, never a copy of the real one.
    expect(plan.roles[2]).toMatchObject({ name: '@everyone (2)', icon: String.fromCodePoint(0x2b50), action: 'create' });
  });
});
