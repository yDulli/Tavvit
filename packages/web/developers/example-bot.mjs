// A whole Tavvit bot, with no dependencies. The guide is at /developers on any instance.
//
//   TAVVIT_URL=https://your.instance TAVVIT_TOKEN=<token> node example-bot.mjs
//
// It answers to /roll, in the channel or for the person alone, and reacts to anyone who writes
// "hello bot", with a card.

const BASE = (process.env.TAVVIT_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.TAVVIT_TOKEN;
if (!BASE || !TOKEN) {
  console.error('Set TAVVIT_URL and TAVVIT_TOKEN.');
  process.exit(1);
}

const RECONNECT_MS = 5_000;
const PING_MS = 30_000;
/** What this bot answers to. Told to the instance once at each start. */
const COMMANDS = [{
  name: 'roll',
  description: 'Roll dice',
  options: [
    { name: 'dice', description: 'For example 2d6', type: 'text' },
    { name: 'private', description: 'Show the result to me alone', type: 'boolean' },
  ],
}];

async function api(method, path, body) {
  const response = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Authorization: `Bot ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const answer = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${answer?.code ?? ''}`);
  return answer;
}

function roll(dice) {
  const match = /^(\d{1,2})d(\d{1,3})$/.exec(dice || '1d6');
  if (!match) return 'Try something like 2d6.';
  const [count, sides] = [Number(match[1]), Number(match[2])];
  if (count < 1 || sides < 2) return 'Try something like 2d6.';
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  return `${rolls.join(' + ')} = ${rolls.reduce((sum, value) => sum + value, 0)}`;
}

/** Someone asked for /roll. The answer goes under the id the question came with. */
function answerRoll(event) {
  const who = event.user.displayName ?? event.user.username;
  const result = roll(event.options.dice ?? event.args);
  return api('POST', `/interactions/${event.interactionId}/reply`, {
    content: `${who} rolled: ${result}`,
    ephemeral: event.options.private === true,
  });
}

/** Someone said hello: a reaction on their message and a card in the channel. */
async function greet(message) {
  await api('PUT', `/messages/${message.id}/reactions/${encodeURIComponent('👋')}`);
  await api('POST', `/channels/${message.channelId}/messages`, {
    cards: [{ title: 'Hello!', text: 'Try `/roll` in the composer.', color: '#7466e8', footer: 'Example bot' }],
  });
}

function connect(selfId) {
  const socket = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`);
  let pinger;

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'auth', token: `Bot ${TOKEN}` }));
    pinger = setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), PING_MS);
  });

  socket.addEventListener('message', (incoming) => {
    const event = JSON.parse(incoming.data);
    switch (event.type) {
      case 'ready':
        console.log(`Connected, in ${event.spaces.length} space(s).`);
        break;
      case 'command_invoked':
        if (event.name === 'roll') answerRoll(event).catch(console.error);
        break;
      case 'message_created':
        // A bot sees its own messages too: without this it would answer itself.
        if (event.message.userId !== selfId && /\bhello bot\b/i.test(event.message.content ?? '')) {
          greet(event.message).catch(console.error);
        }
        break;
      default:
        break;
    }
  });

  socket.addEventListener('close', (closed) => {
    clearInterval(pinger);
    console.log(`Disconnected (${closed.code}). Trying again shortly.`);
    setTimeout(() => connect(selfId), RECONNECT_MS);
  });
}

const { bot } = await api('GET', '/bots/@me');
console.log(`Running as ${bot.name}.`);
await api('PUT', '/bots/@me/commands', { commands: COMMANDS });
connect(bot.id);
