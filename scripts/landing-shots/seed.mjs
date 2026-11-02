// Fills a scratch dev server with a fictional community for the product page's
// pictures (see README.md here), through the same REST API the app uses. A few
// things go straight into the database: reactions (they are WebSocket-only), the
// instance's Discovery switch, and message times, so a conversation does not read
// as written in one minute. Never point this at a server with real data.
// Usage: DB_PATH=<the scratch database> node scripts/landing-shots/seed.mjs <seed.json to write>
import fs from 'node:fs';
import { createRequire } from 'node:module';

const API = 'http://localhost:3005/api';
const OUT = process.argv[2];
if (!OUT) throw new Error('Usage: seed.mjs <seed.json to write>');
const DB_PATH = process.env.DB_PATH;
const PASSWORD = 'demo-password-1234';
const require = createRequire(new URL('../../packages/server/package.json', import.meta.url));

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: token.startsWith('Bot ') ? token : `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const PEOPLE = [
  ['mara', 'Mara Lindqvist', 'lavender', 'Runs the Saturday raids. Coffee first.', 'she/her'],
  ['jonas', 'Jonas Weber', 'sky', 'Backend by day, bad at Tetris by night.', 'he/him'],
  ['noor', 'Noor Haddad', 'rose', 'Film photography and very long walks.', 'she/her'],
  ['theo', 'Theo Marchetti', 'mint', 'Plays bass. Will talk about synths if you let him.', 'he/him'],
  ['yuki', 'Yuki Tanaka', 'amber', 'Indie games, ramen, and spreadsheets.', 'they/them'],
  ['sam', 'Sam Okafor', 'coral', 'Always in voice.', 'he/him'],
  ['lena', 'Lena Hoffmann', 'peach', 'Mod team. Be nice to each other.', 'she/her'],
  ['diego', 'Diego Ramos', 'sky', 'Speedruns and street food.', 'he/him'],
];

const users = {};
for (const [username, displayName, avatarColor, bio, pronouns] of PEOPLE) {
  // The first of them was made with tavvit-admin (README.md): registering makes no administrators.
  const { token, user } = await call('POST', '/auth/register', null, { username, password: PASSWORD, displayName, avatarColor })
    .catch(() => call('POST', '/auth/login', null, { username, password: PASSWORD }));
  users[username] = { token, id: user.id, displayName };
  await call('PATCH', '/users/@me', token, { bio, pronouns });
}
const me = users.mara;
await call('PATCH', '/users/@me', users.sam.token, { customStatus: 'Ranked, send snacks' });
await call('PATCH', '/users/@me', users.noor.token, { customStatus: 'Developing film' });

// ── Spaces ──────────────────────────────────────────────────────────────────
async function space(owner, name, avatarColor, description, sections, members) {
  const created = await call('POST', '/spaces', owner.token, { name, avatarColor, description, visibility: 'public' });
  const detail = await call('GET', `/spaces/${created.id}`, owner.token);
  const channels = {};
  for (const [category, list] of sections) {
    const cat = await call('POST', `/spaces/${created.id}/categories`, owner.token, { name: category });
    for (const [channelName, type, topic] of list) {
      const made = await call('POST', `/spaces/${created.id}/channels`, owner.token, { name: channelName, type, topic, categoryId: cat.id });
      channels[channelName] = made.id;
    }
  }
  // A new space comes with starter channels; this community has its own.
  for (const channel of detail.channels ?? []) await call('DELETE', `/channels/${channel.id}`, owner.token);
  for (const category of detail.categories ?? []) await call('DELETE', `/categories/${category.id}`, owner.token).catch(() => {});
  const { inviteCode } = await call('POST', `/spaces/${created.id}/invite`, owner.token);
  for (const member of members) await call('POST', '/spaces/join', member.token, { inviteCode });
  return { id: created.id, channels };
}

const nightShift = await space(me, 'Night Shift', 'lavender', 'A late-night crew for co-op games, ranked grinds and bad movies. New players welcome.', [
  ['Hangout', [['general', 'text', 'Say hi. Plans, memes and everything else.'], ['clips', 'text', 'Your best and worst moments.'], ['lounge', 'voice'], ['movie-night', 'voice']]],
  ['Games', [['raid-planning', 'text', 'Saturday, 20:00. Sign up here.'], ['patch-notes', 'text', 'What changed and why it hurts.']]],
], [users.jonas, users.noor, users.theo, users.yuki, users.sam, users.lena, users.diego]);

const fieldNotes = await space(users.noor, 'Field Notes', 'rose', 'Photographers sharing work, feedback and places worth the walk.', [
  ['Studio', [['critique', 'text', 'Honest feedback, kindly given.'], ['gear-talk', 'text', 'Lenses, film stocks, regrets.']]],
], [me, users.theo, users.lena]);

const openFriday = await space(users.jonas, 'Fix-it Friday', 'mint', 'Pick an issue, fix it together, ship it before the weekend.', [
  ['Work', [['good-first-issues', 'text', 'Start here.'], ['code-review', 'text', 'Be kind, be specific.'], ['pairing', 'voice']]],
], [me, users.yuki, users.diego]);

const bookshelf = await space(users.lena, 'Bookshelf', 'peach', 'One book a month and a long conversation about it.', [
  ['Reading', [['this-month', 'text', 'The current book. Spoilers in threads.'], ['recommendations', 'text', 'What should we read next?']]],
], [me, users.noor]);

await call('PATCH', `/spaces/${nightShift.id}`, me.token, { description: 'A late-night crew for co-op games, ranked grinds and bad movies. New players welcome.' });

// ── Roles, with colours and a gradient ──────────────────────────────────────
async function role(space, name, color, colorSecondary, members, extra = {}) {
  const made = await call('POST', `/spaces/${space.id}/roles`, me.token, { name, color, colorSecondary, hoist: true, ...extra });
  for (const member of members) await call('POST', `/spaces/${space.id}/members/${member.id}/roles`, me.token, { roleId: made.id });
  return made;
}
await role(nightShift, 'Raid Lead', '#a78bfa', '#f472b6', [users.lena, users.jonas], { icon: '⚔️' });
await role(nightShift, 'Regulars', '#5cc491', null, [users.theo, users.yuki, users.noor]);
await role(nightShift, 'New Blood', '#60a5e6', null, [users.diego, users.sam]);

// ── Conversation ────────────────────────────────────────────────────────────
const say = (who, channel, content, replyToId) => call('POST', `/channels/${channel}/messages`, who.token, { content, ...(replyToId ? { replyToId } : {}) });
const general = nightShift.channels.general;
await say(users.jonas, general, 'Anyone still up for one more round? The queue is short right now.');
const m2 = await say(users.sam, general, 'Always. Give me two minutes to find my headset.');
const m3 = await say(users.yuki, general, 'I made a thing for Saturday. Damage numbers by class, sorted so nobody can argue.');
await say(users.yuki, general, '```ts\nconst carry = party\n  .filter((p) => p.alive)\n  .sort((a, b) => b.dps - a.dps)[0];\n```');
const m5 = await say(users.lena, general, `<@${users.yuki.id}> this is exactly what we needed. Pinning it for raid night.`);
const m6 = await say(users.theo, general, 'Is that why I am always last?', m3.id);
await say(users.yuki, general, 'Yes.', m6.id);
const m8 = await say(users.diego, general, 'First time here. Is it okay if I just listen in the Lounge for a bit?');
const m9 = await say(me, general, `<@${users.diego.id}> of course. Grab a seat, nobody bites. **Saturday at 20:00** is the big one if you want in.`, m8.id);
await say(users.noor, general, 'Movie night after? I vote for something with subtitles and no explosions.');
await say(users.sam, general, 'Explosions are a love language.');
await say(users.sam, nightShift.channels['raid-planning'], 'Who is writing up Saturday?');
await say(users.lena, nightShift.channels['raid-planning'], 'Jonas is. He has the spreadsheet open already.');
await say(users.theo, nightShift.channels['raid-planning'], 'Last time we wiped on the second add for twenty minutes.');
await say(users.yuki, nightShift.channels['raid-planning'], 'Twenty-three. I have the numbers, if anyone wants them.');
const raidPlan = await say(users.jonas, nightShift.channels['raid-planning'], '**Saturday raid, 20:00**\n- Tanks: Lena, Sam\n- Healers: Noor\n- Everyone else: please read the fight notes this time');
await say(users.lena, nightShift.channels['raid-planning'], 'Added the boss timeline to the topic. Sign up with a reaction.');
await say(users.noor, nightShift.channels['raid-planning'], 'Signed up. I am bringing the good flasks this time.');
const firstRaid = await say(users.diego, nightShift.channels['raid-planning'], 'My first raid. Is there anything I should read before Saturday?');
await say(users.lena, nightShift.channels['raid-planning'], 'Start with the fight notes. Ask anything you like in there.', firstRaid.id);
await say(users.theo, nightShift.channels.clips, 'Exhibit A: I fall off the map in the first ten seconds.');
await say(users.jonas, openFriday.channels['good-first-issues'], 'Three small fixes up for grabs this week, all under an hour.');
await say(users.lena, fieldNotes.channels.critique, 'Anyone tried the new 400 film yet? Mine came back grainier than I expected.');
await say(users.noor, fieldNotes.channels.critique, 'Push it one stop and the grain looks like you meant it.');
await say(users.theo, fieldNotes.channels.critique, 'That is also my advice for bass solos.');
await say(users.noor, fieldNotes.channels.critique, 'House rules for this channel: say what works, say what does not, then say what you would try.');
await say(users.theo, fieldNotes.channels.critique, 'Here is my first roll. Please be gentle, half of it is my thumb.');
await say(users.lena, fieldNotes.channels.critique, 'The thumb has a strong sense of composition.');
await say(users.lena, fieldNotes.channels['gear-talk'], 'Selling my old 50mm. It has seen things.');
await say(me, fieldNotes.channels.critique, 'Harbour walk on Sunday, seven sharp. Bring a tripod.');
await say(users.lena, fieldNotes.channels.critique, 'Seven is brutal. I will be there.');
await say(me, fieldNotes.channels.critique, 'Shot this roll at the harbour on Sunday. Be honest about the horizon.');
await say(users.noor, fieldNotes.channels.critique, 'The horizon is fine. The light is the real story here.');
await say(users.lena, bookshelf.channels['this-month'], 'This month\'s book is picked. We start on Monday, and spoilers stay in threads.');
await say(users.noor, bookshelf.channels['this-month'], 'I started early. The first line alone is worth it.');
await say(me, bookshelf.channels['this-month'], 'Forty pages in. Is the narrator lying, or is it just me?');
await say(users.lena, bookshelf.channels['this-month'], 'No spoilers, but keep that question in mind.');
await say(users.noor, bookshelf.channels['this-month'], 'I made a list of every time the weather changes. It means something, I am sure of it.');
await say(me, bookshelf.channels['this-month'], 'You made a list.');
await say(users.noor, bookshelf.channels['this-month'], 'It has columns.');
await say(users.lena, bookshelf.channels.recommendations, 'Next month: something short. We have all earned it.');
await say(users.lena, bookshelf.channels['this-month'], 'Chapter eight changed my mind about the narrator completely.');
await say(users.noor, bookshelf.channels['this-month'], `<@${me.id}> have you got that far yet?`);

// Reactions are WebSocket-only, so they go straight into the database.
const Database = require('better-sqlite3');
const db = new Database(DB_PATH);
const react = db.prepare('INSERT INTO reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)');
let reactionId = 9000000000000000000n;
for (const [message, who, emoji] of [
  [m3, users.jonas, '🔥'], [m3, users.lena, '🔥'], [m3, users.sam, '🔥'], [m3, me, '📈'], [m3, users.noor, '📈'],
  [m5, users.yuki, '🙏'], [m6, users.sam, '😂'], [m6, users.jonas, '😂'], [m6, me, '😂'], [m6, users.noor, '😂'],
  [m9, users.diego, '❤️'], [m9, users.lena, '❤️'], [m2, users.jonas, '🎧'],
]) {
  reactionId += 1n;
  react.run(reactionId.toString(), message.id, who.id, emoji, Date.now());
}
db.close();

// ── Friends and direct messages ─────────────────────────────────────────────
for (const name of ['jonas', 'noor', 'theo', 'yuki', 'sam', 'lena']) {
  await call('POST', '/social/requests', me.token, { username: name });
  const requests = await call('GET', '/social/requests', users[name].token);
  const request = requests.find((row) => row.fromId === me.id);
  await call('PATCH', `/social/requests/${request.id}`, users[name].token, { status: 'accepted' });
}
await call('POST', '/social/requests', users.diego.token, { username: 'mara' });

const dm = await call('POST', '/dm', me.token, { userId: users.noor.id });
const dmSay = (who, content, replyToId) => call('POST', `/dm/${dm.id}/messages`, who.token, { content, ...(replyToId ? { replyToId } : {}) });
await dmSay(users.noor, 'Are you bringing the 35mm on Sunday?');
await dmSay(me, 'Yes, and the good tripod. Harbour at seven?');
await dmSay(users.noor, 'Seven is brutal. But the light will be worth it.');
await dmSay(me, 'That is what you said last time.');
await dmSay(users.noor, 'And was I wrong?');
const dm2 = await call('POST', '/dm', me.token, { userId: users.jonas.id });
await call('POST', `/dm/${dm2.id}/messages`, users.jonas.token, { content: 'Pushed the fix. Can you take a look before Friday?' });
const dm3 = await call('POST', '/dm', me.token, { userId: users.yuki.id });
await call('POST', `/dm/${dm3.id}/messages`, users.yuki.token, { content: 'Spreadsheet v3 is ready. It has charts now.' });
const group = await call('POST', '/dm/group', me.token, { users: [{ id: users.sam.id }, { id: users.theo.id }, { id: users.lena.id }] }).catch(() => null);
if (group) await call('POST', `/dm/${group.id}/messages`, users.sam.token, { content: 'I am in charge of crisps. This is not up for debate.' });

// ── Around the conversation: a thread, a poll, an event, rules, a bot ───────
const thread = await call('POST', `/messages/${raidPlan.id}/thread`, users.jonas.token, { name: 'Fight notes' });
await say(users.lena, thread.id, 'Phase two starts at 60 percent, not 50. I checked the logs twice.');
await say(users.sam, thread.id, 'So I stop saving the cooldown for the end?');
await say(users.lena, thread.id, 'Use it on the second add. I will call it in voice.');
await say(users.diego, thread.id, 'What does the second add do?');
await say(users.lena, thread.id, 'Silences healers for ten seconds. Noor, stay at range for that one.');
await say(users.noor, thread.id, 'Noted. I will say when I am back in.');
await say(me, thread.id, 'Good. Adding that to the sheet.');

const poll = await call('POST', `/channels/${nightShift.channels['patch-notes']}/polls`, users.lena.token, {
  question: 'Did the last patch ruin tanks?',
  options: ['Completely', 'A little', 'Skill issue'],
  durationHours: 72,
});
const [completely, little, skill] = poll.poll.options;
for (const [voter, option] of [[me, skill], [users.jonas, skill], [users.yuki, skill], [users.noor, skill], [users.lena, little], [users.theo, little], [users.sam, completely]]) {
  await call('PUT', `/messages/${poll.id}/poll/votes`, voter.token, { optionIds: [option.id] });
}

const saturday = new Date();
saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7));
saturday.setHours(20, 0, 0, 0);
const raid = await call('POST', `/spaces/${nightShift.id}/events`, me.token, {
  title: 'Saturday raid',
  description: 'Two bosses and one break. Read the fight notes, bring flasks, and be in voice ten minutes early.',
  channelId: nightShift.channels.lounge,
  startsAt: saturday.getTime(),
  endsAt: saturday.getTime() + 3 * 3600 * 1000,
});
for (const person of [me, users.lena, users.sam, users.jonas, users.noor, users.theo]) await call('PUT', `/events/${raid.id}/rsvp`, person.token);

// A space's welcome opens over everything until it is answered, so it stays out of the space the other pictures show.
await call('PUT', `/spaces/${bookshelf.id}/welcome`, users.lena.token, {
  welcomeText: 'One book a month and a long conversation about it. Pull up a chair.',
  rulesText: '1. No spoilers outside threads.\n2. Disagree with the book, not with each other.\n3. Finishing the book is optional. Being kind is not.',
  rulesRequired: true,
  channelIds: [bookshelf.channels['this-month'], bookshelf.channels.recommendations],
});

await call('PUT', '/admin/bots/enabled', me.token, { enabled: true });
const buildBot = await call('POST', '/bots', users.jonas.token, { name: 'Build Bot', description: 'Says how the nightly build went.' });
// VIEW_CHANNEL, SEND_MESSAGES and READ_MESSAGE_HISTORY.
await call('POST', `/bots/${buildBot.bot.id}/spaces/${openFriday.id}`, users.jonas.token, { permissions: String(2 + 1024 + 8192) });
await say(users.yuki, openFriday.channels['code-review'], 'Two small pull requests up. Both under fifty lines, I promise.');
await say(users.diego, openFriday.channels['code-review'], 'I can take the one about the upload bar. My first review here, so be nice.');
await say(users.jonas, openFriday.channels['code-review'], 'Be specific, be kind, and nitpicks start with "nit". That is the whole rulebook.');
await say(users.diego, openFriday.channels['code-review'], '```diff\n- const limit = 10\n+ const limit = config.uploads.max\n```');
await say(users.yuki, openFriday.channels['code-review'], 'Nit: I would call it maxUploads. Otherwise this looks good to me.');
await say(me, openFriday.channels['code-review'], 'Merging after lunch unless someone shouts.');
await say(users.jonas, openFriday.channels['code-review'], 'Merged the two small fixes from this morning.');
await call('POST', `/channels/${openFriday.channels['code-review']}/messages`, `Bot ${buildBot.token}`, {
  content: 'The nightly build is done.',
  cards: [{
    title: 'Build passed',
    text: 'All checks are green on `main`, and the fixes are live on staging.',
    color: '#34c77b',
    fields: [{ name: 'Tests', value: '412 passed', inline: true }, { name: 'Coverage', value: '87%', inline: true }, { name: 'Took', value: '3 min 12 s', inline: true }],
    footer: 'Build Bot',
  }],
});

// ── Listed on Explore, verified ─────────────────────────────────────────────
for (const [space, owner, category] of [[nightShift, me, 'gaming'], [fieldNotes, users.noor, 'art'], [openFriday, users.jonas, 'technology'], [bookshelf, users.lena, 'education']]) {
  await call('PUT', `/spaces/${space.id}/discovery`, owner.token, { category }).catch((e) => console.warn(e.message));
  await call('POST', `/admin/spaces/${space.id}/discovery/approve`, me.token, {}).catch((e) => console.warn(e.message));
}
await call('PUT', `/spaces/${nightShift.id}/verification`, me.token, {
  category: 'gaming', reason: 'We run this community and want it to be recognisable.', proof: 'I am the founder and can show this through the space.',
}).catch((e) => console.warn(e.message));
await call('POST', `/admin/spaces/${nightShift.id}/verification/approve`, me.token, {}).catch((e) => console.warn(e.message));

// Someone who has joined nothing, for the picture of Explore.
{
  const { token, user } = await call('POST', '/auth/register', null, { username: 'robin', password: PASSWORD, displayName: 'Robin Keller', avatarColor: 'mint' });
  users.robin = { token, id: user.id, displayName: 'Robin Keller' };
}

// ── What the API does not offer ──────────────────────────────────
const seededAt = Date.now();
{
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  db.prepare('UPDATE instance_settings SET discovery_enabled = 1 WHERE id = 1').run();
  // Each channel's messages end a little before now, some minutes apart.
  const STEPS_MINUTES = [3, 7, 2, 11, 4, 1, 6, 9, 2, 5];
  const rows = db.prepare('SELECT id, channel_id FROM messages ORDER BY created_at DESC, id DESC').all();
  const seen = new Map();
  const setTime = db.prepare('UPDATE messages SET created_at = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of rows) {
      const back = seen.get(row.channel_id) ?? { at: seededAt - 2 * 60 * 1000, n: 0 };
      setTime.run(back.at, row.id);
      seen.set(row.channel_id, { at: back.at - STEPS_MINUTES[back.n % STEPS_MINUTES.length] * 60 * 1000, n: back.n + 1 });
    }
  })();
  db.close();
}

fs.writeFileSync(OUT, JSON.stringify({
  seededAt,
  password: PASSWORD,
  users: Object.fromEntries(Object.entries(users).map(([k, v]) => [k, { token: v.token, id: v.id }])),
  spaces: { nightShift, fieldNotes, openFriday, bookshelf },
  dm: dm.id,
  thread: thread.id,
}, null, 2));
console.log('seeded', Object.keys(users).length, 'people,', 4, 'spaces');
