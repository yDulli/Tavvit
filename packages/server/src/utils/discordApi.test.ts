import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDiscordAsset, listGuildExpressions, parseBotToken, retryAfterOf } from './discordApi.js';

// The two list requests carry the bot token: only to fixed addresses on discord.com, only in the
// Authorization header, never across a redirect, and no failure says it back. Pictures come only
// from Discord's two content hosts, without the token.

const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GsEnTi.SentinelBotTokenValue0123456789';
const GUILD = '987654321098765432';

type Call = { url: string; init: RequestInit & { dispatcher?: unknown } };
let calls: Call[];
let answers: Array<Response | Error>;

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error('no answer prepared');
    if (next instanceof Error) throw next;
    return next;
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('parseBotToken', () => {
  it('takes a token as Discord issues it, with or without a pasted "Bot " in front', () => {
    expect(parseBotToken(TOKEN)).toBe(TOKEN);
    expect(parseBotToken(`  Bot ${TOKEN}\n`)).toBe(TOKEN);
  });

  it('refuses what is not one, so nothing unexpected ever reaches a header', () => {
    for (const value of [
      '', 'token', `${TOKEN} extra`, TOKEN.replace('.GsEnTi.', '.Gs\nTi.'), TOKEN.replace('Sentinel', 'Séntinel'),
      TOKEN.split('.').slice(0, 2).join('.'), `${TOKEN}${'a'.repeat(200)}`, 42, null, undefined,
    ]) {
      expect(parseBotToken(value)).toBeNull();
    }
  });
});

describe('retryAfterOf', () => {
  it('takes Discord\'s wait from the body, else the header, rounded up, else five seconds', () => {
    expect(retryAfterOf({ retry_after: 2.2 }, null)).toBe(3);
    expect(retryAfterOf(null, '7')).toBe(7);
    expect(retryAfterOf(null, null)).toBe(5);
  });
});

describe('listGuildExpressions', () => {
  it('asks for the emoji, then the stickers, with the token in the Authorization header only and no redirect', async () => {
    answers.push(
      json([{ id: '100000000000000001', name: 'wave', animated: false, managed: false, roles: [], user: { id: '1', username: 'someone' } }]),
      json([{ id: '200000000000000001', name: 'hello', format_type: 1, type: 2, description: 'kept out', tags: 'x' }]),
    );
    const result = await listGuildExpressions(GUILD, TOKEN);
    expect(result).toEqual({
      ok: true,
      listing: {
        emojis: [{ discordId: '100000000000000001', name: 'wave', animated: false, managed: false, roleRestricted: false }],
        stickers: [{ discordId: '200000000000000001', name: 'hello', format: 'png' }],
      },
    });
    expect(calls.map((call) => call.url)).toEqual([
      `https://discord.com/api/v10/guilds/${GUILD}/emojis`,
      `https://discord.com/api/v10/guilds/${GUILD}/stickers`,
    ]);
    for (const call of calls) {
      expect(call.init.redirect).toBe('error');
      expect(call.init.dispatcher).toBeDefined();
      expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bot ${TOKEN}`);
      expect(call.url).not.toContain(TOKEN);
    }
  });

  it('turns Discord\'s refusals into codes of its own, never a 401, and stops at the first', async () => {
    const cases: Array<[Response | Error, number, string]> = [
      [json({ message: '401: Unauthorized', code: 0 }, 401), 400, 'discord_bot_token_invalid'],
      [json({ message: 'Missing Access', code: 50001 }, 403), 400, 'discord_bot_not_in_server'],
      [json({ message: 'Unknown Guild', code: 10004 }, 404), 400, 'discord_bot_not_in_server'],
      [json({ message: 'You are being rate limited.', retry_after: 1.5, global: false }, 429), 429, 'discord_rate_limited'],
      [new Response('oops', { status: 500 }), 502, 'discord_unreachable'],
      [new TypeError('fetch failed'), 502, 'discord_unreachable'],
    ];
    for (const [answer, status, code] of cases) {
      calls = [];
      answers = [answer];
      const result = await listGuildExpressions(GUILD, TOKEN);
      expect(result).toMatchObject({ ok: false, status, code });
      expect(calls).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(TOKEN.split('.')[2]);
    }
  });

  it('asks nothing for a server id that is none', async () => {
    expect(await listGuildExpressions('12ab', TOKEN)).toMatchObject({ ok: false, code: 'discord_server_id_invalid' });
    expect(calls).toHaveLength(0);
  });

  it('takes a list that is not one as Discord being unreachable', async () => {
    answers.push(json({ not: 'a list' }));
    expect(await listGuildExpressions(GUILD, TOKEN)).toMatchObject({ ok: false, status: 502, code: 'discord_unreachable' });
  });
});

describe('fetchDiscordAsset', () => {
  it('fetches a picture from Discord\'s content servers only, without the token and without redirects', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    answers.push(new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const bytes = await fetchDiscordAsset('https://cdn.discordapp.com/emojis/100000000000000001.png', 1024);
    expect(bytes?.equals(png)).toBe(true);
    expect(calls[0]!.init.redirect).toBe('error');
    expect(JSON.stringify(calls[0]!.init.headers)).not.toContain('Authorization');
  });

  it('refuses another host, plain http and anything that is not a picture or too large', async () => {
    expect(await fetchDiscordAsset('https://example.com/emojis/1.png', 1024)).toBeNull();
    expect(await fetchDiscordAsset('http://cdn.discordapp.com/emojis/1.png', 1024)).toBeNull();
    expect(await fetchDiscordAsset('https://cdn.discordapp.com.evil.test/emojis/1.png', 1024)).toBeNull();
    expect(calls).toHaveLength(0);
    answers.push(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await fetchDiscordAsset('https://cdn.discordapp.com/emojis/1.png', 1024)).toBeNull();
    answers.push(new Response(Buffer.alloc(4096), { status: 200, headers: { 'content-type': 'image/png' } }));
    expect(await fetchDiscordAsset('https://cdn.discordapp.com/emojis/1.png', 1024)).toBeNull();
    answers.push(new TypeError('redirect mode is set to error'));
    expect(await fetchDiscordAsset('https://media.discordapp.net/stickers/1.gif', 1024)).toBeNull();
  });
});
