#!/usr/bin/env node
/**
 * A load test against a Tavvit instance (docs/systems/operations.md, "Load test"): many people
 * connected, some of them writing, and how long everything takes.
 *
 *   node scripts/loadtest/run.mjs --url http://localhost:3005 --token <an admin's token> \
 *     --sockets 500 --rate 10 --seconds 30
 *
 * It refuses to start unless the instance was started with LOADTEST_ALLOWED=1, so it can never hit
 * real people by a typing mistake in an address. It leaves a space and accounts behind, so point it
 * at a test instance with a database of its own. Set DISABLE_RATE_LIMITS=1 there too: all the traffic
 * comes from one address, and the limits per address would otherwise be all it measures.
 *
 * What it says is about the machine it ran on and with this script on it as well, so read it as a
 * comparison between runs and not as how many people an instance can take.
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { deflateRawSync } from 'node:zlib';

const { values: given } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3005' },
    token: { type: 'string' },
    sockets: { type: 'string', default: '200' },
    members: { type: 'string' },
    rate: { type: 'string', default: '5' },
    seconds: { type: 'string', default: '30' },
    ramp: { type: 'string', default: '50' },
    channels: { type: 'string', default: '5' },
    roles: { type: 'string', default: '1' },
    history: { type: 'string', default: '0' },
    storm: { type: 'string', default: '0' },
    json: { type: 'string' },
  },
});

if (!given.token) {
  console.error('Give an administrator\'s token with --token.');
  process.exit(2);
}

const BASE = given.url.replace(/\/$/, '');
const ADMIN = `Bearer ${given.token}`;
const SOCKETS = Number(given.sockets);
const MEMBERS = Math.max(Number(given.members ?? SOCKETS), SOCKETS);
const RATE = Number(given.rate);
const SECONDS = Number(given.seconds);
const RAMP = Number(given.ramp);
const STORM_PERCENT = Number(given.storm);
/** So few that this script's own reading does not become what is measured. */
const LISTENERS = 50;
const READY_TIMEOUT_MS = 120_000;
const POST_TIMEOUT_MS = 30_000;
const SYSTEM_EVERY_MS = 2_000;
const MARK = 'lt:';

async function api(method, path, body, auth = ADMIN) {
  const response = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const answer = await response.json().catch(() => null);
  return { status: response.status, body: answer };
}

function percentile(values, share) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

const summary = (values) => ({ count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.length ? Math.max(...values) : 0 });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const allowed = await api('GET', '/loadtest');
  if (allowed.status === 404) {
    console.error(`Refusing: ${BASE} has not set LOADTEST_ALLOWED=1. This script is for a test instance.`);
    return 2;
  }
  if (allowed.status !== 200) {
    console.error(`Refusing: that token is not an administrator's on ${BASE} (${allowed.status}).`);
    return 2;
  }
  if (!allowed.body.rateLimitsOff) console.warn('The limits per address are on, so most of this traffic will be refused. Set DISABLE_RATE_LIMITS=1 on the test instance.');

  console.log(`Making ${MEMBERS} people...`);
  const madeAt = Date.now();
  const made = await api('POST', '/loadtest/people', { count: MEMBERS, channels: Number(given.channels), rolesPerPerson: Number(given.roles), messages: Number(given.history) });
  if (made.status !== 201) {
    console.error(`Could not make them: ${made.status} ${JSON.stringify(made.body)}`);
    return 1;
  }
  console.log(`  ${Date.now() - madeAt} ms`);
  const { people, channelIds } = made.body;

  const stats = {
    ready: [],
    readyBytes: [],
    stormReady: [],
    posts: [],
    deliveries: [],
    refused: {},
    received: 0,
    receivedBytes: 0,
    closedEarly: 0,
    mostInFlight: 0,
    system: [],
  };

  /** One person's socket. Resolves when `ready` has come, with how long it took. */
  function connect(person, listens, onReady) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const socket = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`);
      let isReady = false;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('no ready'));
      }, READY_TIMEOUT_MS);

      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token: person.token, batch: true })));
      socket.addEventListener('message', (incoming) => {
        const text = incoming.data;
        stats.received += 1;
        stats.receivedBytes += text.length;
        if (!isReady) {
          // The first thing back is `ready`, or the refusal.
          if (!text.startsWith('{"type":"ready"')) return;
          isReady = true;
          clearTimeout(timeout);
          // What it weighs on the wire, once: the same kind of compression as the instance's.
          stats.readyWire ??= deflateRawSync(text, { level: 3 }).length;
          onReady(Date.now() - startedAt, text.length);
          resolve(socket);
          return;
        }
        if (!listens) return;
        const at = text.indexOf(`"content":"${MARK}`);
        if (at >= 0) stats.deliveries.push(Date.now() - Number.parseInt(text.slice(at + 11 + MARK.length), 10));
      });
      socket.addEventListener('close', (closed) => {
        if (!closingOnPurpose.has(socket)) stats.closedEarly += 1;
        clearTimeout(timeout);
        if (!isReady) reject(new Error(`closed ${closed.code}`));
      });
    });
  }

  const closingOnPurpose = new Set();
  const sockets = [];

  console.log(`Connecting ${SOCKETS} sockets, ${RAMP} a second...`);
  const connectingAt = Date.now();
  {
    const pending = [];
    for (let at = 0; at < SOCKETS; at += 1) {
      pending.push(connect(people[at], at < LISTENERS, (ms, bytes) => {
        stats.ready.push(ms);
        stats.readyBytes.push(bytes);
      }).then((socket) => { sockets[at] = socket; }).catch((error) => { stats.refused[error.message] = (stats.refused[error.message] ?? 0) + 1; }));
      if ((at + 1) % RAMP === 0) await wait(1000);
    }
    await Promise.all(pending);
  }
  console.log(`  ${Date.now() - connectingAt} ms, ${sockets.filter(Boolean).length} connected`);

  // The server's own view, while everything runs.
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const system = await api('GET', '/admin/system').catch(() => null);
      if (system?.status === 200) {
        stats.system.push({ eventLoop: system.body.eventLoop, rssBytes: system.body.memory.rssBytes, sockets: system.body.sockets });
      }
      await wait(SYSTEM_EVERY_MS);
    }
  })();

  console.log(`Writing ${RATE} messages a second for ${SECONDS} s...`);
  {
    let inFlight = 0;
    const posts = [];
    const everyMs = 1000 / RATE;
    const endsAt = Date.now() + SECONDS * 1000;
    let nth = 0;
    while (Date.now() < endsAt) {
      const author = people[nth % SOCKETS];
      const channel = channelIds[nth % channelIds.length];
      nth += 1;
      const sentAt = Date.now();
      inFlight += 1;
      stats.mostInFlight = Math.max(stats.mostInFlight, inFlight);
      posts.push(fetch(`${BASE}/api/channels/${channel}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${author.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `${MARK}${sentAt}` }),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      }).then(async (response) => {
        await response.arrayBuffer();
        if (response.ok) stats.posts.push(Date.now() - sentAt);
        else stats.refused[response.status] = (stats.refused[response.status] ?? 0) + 1;
      }).catch(() => {
        stats.refused.timeout = (stats.refused.timeout ?? 0) + 1;
      }).finally(() => { inFlight -= 1; }));
      await wait(everyMs);
    }
    await Promise.all(posts);
    // What is still on its way arrives before the counting ends.
    await wait(2000);
  }

  if (STORM_PERCENT > 0) {
    const count = Math.floor(SOCKETS * STORM_PERCENT / 100);
    console.log(`Dropping and reconnecting ${count} sockets at once...`);
    for (let at = 0; at < count; at += 1) {
      if (!sockets[at]) continue;
      closingOnPurpose.add(sockets[at]);
      sockets[at].close();
    }
    await wait(500);
    const stormAt = Date.now();
    await Promise.all(Array.from({ length: count }, (_unused, at) => connect(people[at], false, (ms) => stats.stormReady.push(ms))
      .then((socket) => { sockets[at] = socket; })
      .catch((error) => { stats.refused[`storm: ${error.message}`] = (stats.refused[`storm: ${error.message}`] ?? 0) + 1; })));
    console.log(`  ${Date.now() - stormAt} ms`);
  }

  // One full window of the server's own measure after the work.
  await wait(1000);
  sampling = false;
  await sampler;
  for (const socket of sockets) {
    if (!socket) continue;
    closingOnPurpose.add(socket);
    socket.close();
  }

  const loops = stats.system.map((sample) => sample.eventLoop).filter(Boolean);
  const report = {
    setup: { url: BASE, sockets: SOCKETS, members: MEMBERS, rate: RATE, seconds: SECONDS, channels: channelIds.length, roles: Number(given.roles), history: Number(given.history) },
    readyMs: summary(stats.ready),
    readyBytes: summary(stats.readyBytes),
    readyWireBytes: stats.readyWire ?? 0,
    stormReadyMs: summary(stats.stormReady),
    postMs: summary(stats.posts),
    deliveryMs: summary(stats.deliveries),
    eventLoopMs: {
      p50: percentile(loops.map((loop) => loop.p50Ms), 0.5),
      worstP99: loops.length ? Math.max(...loops.map((loop) => loop.p99Ms)) : null,
      worstMax: loops.length ? Math.max(...loops.map((loop) => loop.maxMs)) : null,
    },
    mostRssMb: stats.system.length ? Math.round(Math.max(...stats.system.map((sample) => sample.rssBytes)) / 1024 / 1024) : null,
    mostInFlight: stats.mostInFlight,
    received: stats.received,
    receivedMb: Math.round(stats.receivedBytes / 1024 / 1024),
    refused: stats.refused,
    closedEarly: stats.closedEarly,
  };

  const row = (name, value) => console.log(`${name.padEnd(26)}${value}`);
  const times = (part) => `p50 ${part.p50} ms   p95 ${part.p95} ms   max ${part.max} ms   (${part.count})`;
  console.log('');
  row('Ready', times(report.readyMs));
  row('Ready, size', `p50 ${Math.round(report.readyBytes.p50 / 1024)} KB   max ${Math.round(report.readyBytes.max / 1024)} KB   about ${Math.round(report.readyWireBytes / 1024)} KB compressed`);
  if (STORM_PERCENT > 0) row('Ready, in a storm', times(report.stormReadyMs));
  row('Writing a message', times(report.postMs));
  row('Message reaching others', times(report.deliveryMs));
  row('Event loop delay', `p50 ${report.eventLoopMs.p50} ms   worst p99 ${report.eventLoopMs.worstP99} ms   worst ${report.eventLoopMs.worstMax} ms`);
  row('Memory', `${report.mostRssMb} MB`);
  row('Most requests under way', String(report.mostInFlight));
  row('Received here', `${report.received} events, ${report.receivedMb} MB`);
  row('Refused', Object.keys(report.refused).length ? JSON.stringify(report.refused) : 'nothing');
  row('Sockets closed early', String(report.closedEarly));

  if (given.json) fs.writeFileSync(given.json, `${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

// Leaving by itself leaves nothing open. An exit straight after a request can crash on Windows.
main().then((code) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2000).unref();
}, (error) => {
  console.error(error);
  process.exitCode = 1;
});
