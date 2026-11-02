import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscordImportPlan } from '@backspace/shared/src/discordImport.js';
import * as schema from '../db/schema.js';
import { PermissionBits, permissionsToString } from '../utils/permissions.js';

// The Discord template import (spaces.md, "Importing a Discord template"):
// who may import where, what lands in the space and in which order, the bits a
// manager cannot hand out, and that nothing but a checked source is read. The
// request to Discord is mocked; utils/discordTemplateFetch.ts makes it.

let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let currentUserId = 'owner';
const announceSpaceAccessChange = vi.fn();
const addUserSpace = vi.fn();
const fetchDiscordTemplate = vi.fn();
vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (req: { userId?: string }) => { req.userId = currentUserId; } }));
vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToSpace: vi.fn(),
    announceSpaceAccessChange: (...args: unknown[]) => announceSpaceAccessChange(...args),
    addUserSpace: (...args: unknown[]) => addUserSpace(...args),
    removeUserSpace: vi.fn(),
    getUserRoom: () => undefined,
  },
}));
vi.mock('../ws/events.js', () => ({ checkVoicePermissions: vi.fn(), disconnectMemberFromSpaceVoice: vi.fn() }));
vi.mock('../utils/discordTemplateFetch.js', () => ({ fetchDiscordTemplate: (...args: unknown[]) => fetchDiscordTemplate(...args) }));

// Discord's permission bits the template below uses.
const D = {
  KICK: 1 << 1,
  ADMINISTRATOR: 1 << 3,
  VIEW: 1 << 10,
  SEND: 1 << 11,
  MANAGE_MESSAGES: 1 << 13,
  HISTORY: 1 << 16,
  CONNECT: 1 << 20,
  SPEAK: 1 << 21,
  MANAGE_NICKNAMES: 1 << 27,
};

const TEMPLATE = {
  name: 'Study Group',
  description: 'A place to learn',
  usage_count: 4,
  creator: { username: 'maker' },
  serialized_source_guild: {
    name: 'Study Group',
    roles: [
      { id: 0, name: '@everyone', permissions: String(D.VIEW | D.SEND | D.HISTORY | D.CONNECT | D.SPEAK) },
      { id: 1, name: 'Helper', permissions: '0', color: 0x00ff00 },
      { id: 2, name: 'Tutor', permissions: String(D.KICK | D.MANAGE_MESSAGES | D.MANAGE_NICKNAMES), color: 0x3498db, hoist: true, mentionable: true, unicode_emoji: '\u{1F4DA}' },
      { id: 3, name: 'Head', permissions: String(D.ADMINISTRATOR), color: 0xf1c40f, hoist: true },
    ],
    channels: [
      { id: 10, type: 4, name: 'Info', position: 0, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: String(D.SEND) }] },
      { id: 11, type: 0, name: 'rules', position: 0, parent_id: 10, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: String(D.SEND) }] },
      { id: 12, type: 5, name: 'news', position: 1, parent_id: 10, permission_overwrites: [{ id: 0, type: 0, allow: '0', deny: String(D.SEND) }] },
      { id: 20, type: 4, name: 'Talk', position: 1 },
      { id: 21, type: 0, name: 'chat', position: 0, parent_id: 20 },
      {
        id: 22, type: 0, name: 'Homework Help', position: 1, parent_id: 20, rate_limit_per_user: 7,
        permission_overwrites: [
          { id: 2, type: 0, allow: String(D.MANAGE_MESSAGES | D.KICK), deny: '0' },
          { id: 77, type: 1, allow: String(D.SEND), deny: '0' },
        ],
      },
      { id: 23, type: 13, name: 'Stage', position: 2, parent_id: 20 },
      { id: 24, type: 14, name: 'directory', position: 3, parent_id: 20 },
    ],
  },
};

const MANAGER_BITS = PermissionBits.MANAGE_ROLES | PermissionBits.MANAGE_CHANNELS;
const EVERYONE_BITS = PermissionBits.VIEW_CHANNEL | PermissionBits.SEND_MESSAGES | PermissionBits.READ_MESSAGE_HISTORY;

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';
  vi.clearAllMocks();
  for (const id of ['owner', 'manager', 'member', 'outsider']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: 'space', name: 'Space', ownerId: 'owner', createdAt: 1 }).run();
  for (const userId of ['owner', 'manager', 'member']) {
    testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId, joinedAt: 1 }).run();
  }
  testDb.insert(schema.roles).values([
    { id: 'space', spaceId: 'space', name: '@everyone', permissions: permissionsToString(EVERYONE_BITS), position: 0, createdAt: 1 },
    { id: 'helper', spaceId: 'space', name: 'Helper', permissions: '0', position: 1, createdAt: 1 },
    { id: 'lead', spaceId: 'space', name: 'Lead', permissions: permissionsToString(MANAGER_BITS), position: 2, createdAt: 1 },
  ]).run();
  testDb.insert(schema.memberRoles).values({ spaceId: 'space', userId: 'manager', roleId: 'lead' }).run();
  testDb.insert(schema.channelCategories).values({ id: 'cat-talk', spaceId: 'space', name: 'Talk', position: 0, createdAt: 1 }).run();
  testDb.insert(schema.channels).values([
    { id: 'general', spaceId: 'space', name: 'general', type: 'text', position: 0, categoryId: null, createdAt: 1 },
    { id: 'chat', spaceId: 'space', name: 'chat', type: 'text', position: 0, categoryId: 'cat-talk', createdAt: 1 },
  ]).run();
  // A fresh module per test: the per-user start limit is module state. The
  // fresh modules include the id generator, which needs its worker id again.
  vi.resetModules();
  (await import('../utils/snowflake.js')).setWorkerId(1);
  const { discordImportRoutes } = await import('./discordImport.js');
  app = Fastify();
  await app.register(discordImportRoutes);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const preview = (payload: object) => app.inject({ method: 'POST', url: '/api/import/discord/preview', payload });
const apply = (payload: object) => app.inject({ method: 'POST', url: '/api/import/discord/apply', payload });
const intoSpace = { template: TEMPLATE, target: { kind: 'existing', spaceId: 'space' } };
const rolesOf = (spaceId: string) => testDb.select().from(schema.roles).where(eq(schema.roles.spaceId, spaceId)).all()
  .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
const channelsOf = (spaceId: string) => testDb.select().from(schema.channels).where(eq(schema.channels.spaceId, spaceId)).all();
const categoriesOf = (spaceId: string) => testDb.select().from(schema.channelCategories).where(eq(schema.channelCategories.spaceId, spaceId)).all();
const orbitBits = (...names: (keyof typeof PermissionBits)[]) => permissionsToString(names.reduce((all, name) => all | PermissionBits[name], 0n));

describe('who may import where', () => {
  it('refuses a member without MANAGE_ROLES and MANAGE_CHANNELS, and someone outside the space', async () => {
    currentUserId = 'member';
    const byMember = await apply(intoSpace);
    expect(byMember.statusCode).toBe(403);
    expect(byMember.json().code).toBe('import_target_forbidden');
    currentUserId = 'outsider';
    expect((await preview({ template: TEMPLATE, spaceId: 'space' })).json().code).toBe('import_target_forbidden');
    expect(rolesOf('space')).toHaveLength(3);
    expect(channelsOf('space')).toHaveLength(2);
  });

  it('answers 404 for a space that does not exist', async () => {
    const response = await preview({ template: TEMPLATE, spaceId: 'nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('space_not_found');
  });

  it('previews without writing anything', async () => {
    const response = await preview({ template: TEMPLATE, spaceId: 'space' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { plan: DiscordImportPlan; notTransferred: string[]; template: { guildName: string } };
    expect(body.template.guildName).toBe('Study Group');
    expect(body.notTransferred).toEqual(expect.arrayContaining(['messages', 'members', 'bots', 'webhooks']));
    expect(body.plan.roles.map((role) => [role.name, role.action])).toEqual([
      ['@everyone', 'keep_everyone'], ['Helper', 'reuse'], ['Tutor', 'create'], ['Head', 'create'],
    ]);
    expect(rolesOf('space')).toHaveLength(3);
    expect(channelsOf('space')).toHaveLength(2);
    expect(announceSpaceAccessChange).not.toHaveBeenCalled();
  });
});

describe('importing into an existing space', () => {
  it('puts the new roles below the space\'s own and writes the plan in one go', async () => {
    const response = await apply(intoSpace);
    expect(response.statusCode).toBe(200);

    const roles = rolesOf('space');
    expect(roles.map((role) => [role.name, role.position])).toEqual([
      ['@everyone', 0], ['Tutor', 1], ['Head', 2], ['Helper', 3], ['Lead', 4],
    ]);
    const tutor = roles.find((role) => role.name === 'Tutor')!;
    // MANAGE_NICKNAMES has no Tavvit equivalent and is not granted in its place.
    expect(tutor).toMatchObject({ permissions: orbitBits('KICK_MEMBERS', 'MANAGE_MESSAGES'), color: '#3498db', icon: '\u{1F4DA}', hoist: 1, mentionable: 1 });
    expect(roles.find((role) => role.name === 'Head')!.permissions).toBe(orbitBits('ADMINISTRATOR'));
    // The space's @everyone keeps its own bits.
    expect(roles.find((role) => role.id === 'space')!.permissions).toBe(permissionsToString(EVERYONE_BITS));

    // Talk exists and is reused; chat exists in it and is skipped.
    const categories = categoriesOf('space');
    expect(categories.map((category) => category.name).sort()).toEqual(['Info', 'Talk']);
    const channels = channelsOf('space');
    expect(channels.map((channel) => channel.name).sort()).toEqual(['chat', 'general', 'homework-help', 'news', 'rules', 'stage']);
    const info = categories.find((category) => category.name === 'Info')!;
    const homework = channels.find((channel) => channel.name === 'homework-help')!;
    expect(homework).toMatchObject({ categoryId: 'cat-talk', type: 'text', slowmodeSeconds: 5 });
    expect(channels.find((channel) => channel.name === 'news')).toMatchObject({ type: 'announcement', categoryId: info.id });
    expect(channels.find((channel) => channel.name === 'stage')).toMatchObject({ type: 'voice', categoryId: 'cat-talk' });

    // Every channel in Info carries the category's overwrites, so they sit on the category.
    expect(testDb.select().from(schema.categoryOverrides).where(eq(schema.categoryOverrides.categoryId, info.id)).all())
      .toEqual([{ categoryId: info.id, targetType: 'role', targetId: 'space', allow: '0', deny: orbitBits('SEND_MESSAGES') }]);
    const rules = channels.find((channel) => channel.name === 'rules')!;
    expect(testDb.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, rules.id)).all()).toEqual([]);
    // The member overwrite cannot come over; the role overwrite does.
    expect(testDb.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, homework.id)).all())
      .toEqual([{ channelId: homework.id, targetType: 'role', targetId: tutor.id, allow: orbitBits('KICK_MEMBERS', 'MANAGE_MESSAGES'), deny: '0' }]);

    const audit = testDb.select().from(schema.spaceAuditLog).where(eq(schema.spaceAuditLog.spaceId, 'space')).all();
    expect(audit.map((entry) => entry.action)).toEqual(['template_import']);
    expect(JSON.parse(audit[0]!.changes!)).toEqual([
      { key: 'template', to: 'Study Group' }, { key: 'roles', to: 2 }, { key: 'categories', to: 1 }, { key: 'channels', to: 4 },
    ]);
    expect(announceSpaceAccessChange).toHaveBeenCalledTimes(1);
    const [spaceId, userIds] = announceSpaceAccessChange.mock.calls[0] as [string, string[]];
    expect(spaceId).toBe('space');
    expect([...userIds].sort()).toEqual(['manager', 'member', 'owner']);
  });

  it('adds nothing the second time', async () => {
    expect((await apply(intoSpace)).statusCode).toBe(200);
    const roles = rolesOf('space').length;
    const channels = channelsOf('space').length;
    const second = await apply(intoSpace);
    expect(second.statusCode).toBe(200);
    expect(rolesOf('space')).toHaveLength(roles);
    expect(channelsOf('space')).toHaveLength(channels);
    expect(categoriesOf('space')).toHaveLength(2);
  });

  it('withholds the bits a manager does not hold, from roles and overrides alike', async () => {
    currentUserId = 'manager';
    const response = await apply(intoSpace);
    expect(response.statusCode).toBe(200);
    const plan = (response.json() as { plan: DiscordImportPlan }).plan;
    expect(plan.roles.find((role) => role.name === 'Head')!.withheld).toEqual(['ADMINISTRATOR']);
    expect(plan.roles.find((role) => role.name === 'Tutor')!.withheld).toEqual(expect.arrayContaining(['KICK_MEMBERS', 'MANAGE_MESSAGES']));
    const roles = rolesOf('space');
    expect(roles.find((role) => role.name === 'Head')!.permissions).toBe('0');
    expect(roles.find((role) => role.name === 'Tutor')!.permissions).toBe('0');
    // The manager's own role still ranks above everything they imported.
    expect(roles.at(-1)!.id).toBe('lead');
    const homework = channelsOf('space').find((channel) => channel.name === 'homework-help')!;
    expect(testDb.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, homework.id)).all()).toEqual([]);
    // SEND_MESSAGES is the manager's through @everyone, so the deny on Info comes over.
    const info = categoriesOf('space').find((category) => category.name === 'Info')!;
    expect(testDb.select().from(schema.categoryOverrides).where(eq(schema.categoryOverrides.categoryId, info.id)).all()).toHaveLength(1);
  });
});

describe('the role hierarchy', () => {
  it('refuses new roles to a manager whose top role is the lowest, as POST /roles does', async () => {
    testDb.update(schema.roles).set({ position: 1 }).where(eq(schema.roles.id, 'lead')).run();
    testDb.update(schema.roles).set({ position: 2 }).where(eq(schema.roles.id, 'helper')).run();
    currentUserId = 'manager';
    for (const response of [await preview({ template: TEMPLATE, spaceId: 'space' }), await apply(intoSpace)]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('role_hierarchy');
    }
    expect(rolesOf('space')).toHaveLength(3);
    expect(channelsOf('space')).toHaveLength(2);
  });

  it('leaves out overrides on roles the manager does not outrank', async () => {
    const onLead = structuredClone(TEMPLATE);
    onLead.serialized_source_guild.roles.push({ id: 4, name: 'Lead', permissions: '0' });
    onLead.serialized_source_guild.channels.push({ id: 30, type: 0, name: 'office', position: 9, permission_overwrites: [{ id: 4, type: 0, allow: String(D.SEND), deny: '0' }] });
    currentUserId = 'manager';
    const response = await apply({ template: onLead, target: { kind: 'existing', spaceId: 'space' } });
    expect(response.statusCode).toBe(200);
    const office = channelsOf('space').find((channel) => channel.name === 'office')!;
    expect(testDb.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, office.id)).all()).toEqual([]);
    expect((response.json() as { plan: DiscordImportPlan }).plan.notes).toContainEqual({ kind: 'override_hierarchy', subject: 'office', detail: 'Lead' });
  });
});

describe('templates that name one thing twice', () => {
  it('imports a template with two roles of one name twice without a conflict', async () => {
    const twins = structuredClone(TEMPLATE);
    twins.serialized_source_guild.roles.push({ id: 5, name: 'Tutor', permissions: '0' });
    twins.serialized_source_guild.channels[5]!.permission_overwrites!.push({ id: 5, type: 0, allow: String(D.SEND), deny: '0' });
    const first = await apply({ template: twins, target: { kind: 'existing', spaceId: 'space' } });
    expect(first.statusCode).toBe(200);
    expect(rolesOf('space').map((role) => role.name)).toEqual(expect.arrayContaining(['Tutor', 'Tutor (2)']));
    const roles = rolesOf('space').length;
    testDb.delete(schema.channels).where(eq(schema.channels.name, 'homework-help')).run();
    const second = await apply({ template: twins, target: { kind: 'existing', spaceId: 'space' } });
    expect(second.statusCode).toBe(200);
    expect(rolesOf('space')).toHaveLength(roles);
    expect(channelsOf('space').filter((channel) => channel.name === 'homework-help')).toHaveLength(1);
  });
});

describe('importing as a new space', () => {
  it('creates a private space owned by the importer, with the template\'s @everyone', async () => {
    const response = await apply({ template: TEMPLATE, target: { kind: 'new', name: '  My Study Group  ' } });
    expect(response.statusCode).toBe(201);
    const { space } = response.json() as { space: { id: string; name: string; ownerId: string; visibility: string } };
    expect(space).toMatchObject({ name: 'My Study Group', ownerId: 'owner', visibility: 'private' });
    const member = testDb.select().from(schema.spaceMembers)
      .where(and(eq(schema.spaceMembers.spaceId, space.id), eq(schema.spaceMembers.userId, 'owner'))).get();
    expect(member).toBeDefined();
    const roles = rolesOf(space.id);
    expect(roles.map((role) => role.name)).toEqual(['@everyone', 'Helper', 'Tutor', 'Head']);
    expect(roles[0]).toMatchObject({ id: space.id, position: 0, permissions: orbitBits('VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY', 'CONNECT', 'SPEAK') });
    expect(channelsOf(space.id).map((channel) => channel.name).sort()).toEqual(['chat', 'homework-help', 'news', 'rules', 'stage']);
    expect(addUserSpace).toHaveBeenCalledWith('owner', space.id);
  });
});

describe('the source', () => {
  it('reads nothing but a template code, and fetches only that code', async () => {
    for (const code of ['../x', 'https://evil.example/template/abc', 'discord.com/api/v10/users/@me', 'a']) {
      const response = await preview({ code });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('discord_template_code_invalid');
    }
    expect(fetchDiscordTemplate).not.toHaveBeenCalled();

    fetchDiscordTemplate.mockResolvedValueOnce({ ok: true, data: TEMPLATE });
    expect((await preview({ code: 'https://discord.new/abcDEF12' })).statusCode).toBe(200);
    expect(fetchDiscordTemplate).toHaveBeenCalledWith('abcDEF12');
  });

  it('passes Discord\'s refusals on', async () => {
    fetchDiscordTemplate.mockResolvedValueOnce({ ok: false, status: 404, code: 'discord_template_not_found' });
    const response = await preview({ code: 'abcdef' });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('discord_template_not_found');
  });

  it('refuses what is not a template, and a template over the limits', async () => {
    const invalid = await preview({ template: { serialized_source_guild: { roles: 'x', channels: [] } } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'discord_template_invalid', details: { field: 'roles' } });

    const twice = structuredClone(TEMPLATE);
    twice.serialized_source_guild.channels[1]!.permission_overwrites!.push({ id: 0, type: 0, allow: '0', deny: '0' });
    expect((await preview({ template: twice })).json()).toMatchObject({ code: 'discord_template_invalid', details: { field: 'channels.permission_overwrites' } });

    const roles = Array.from({ length: 251 }, (_, id) => ({ id, name: `r${id}`, permissions: '0' }));
    const tooMany = await preview({ template: { roles, channels: [] } });
    expect(tooMany.statusCode).toBe(413);
    expect(tooMany.json()).toMatchObject({ code: 'discord_template_too_many_roles', details: { max: 250 } });
  });

  it('limits how often one person starts an import', async () => {
    for (let i = 0; i < 10; i += 1) expect((await preview({ template: TEMPLATE })).statusCode).toBe(200);
    const limited = await preview({ template: TEMPLATE });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('rate_limited');
    currentUserId = 'manager';
    expect((await preview({ template: TEMPLATE })).statusCode).toBe(200);
  });
});
