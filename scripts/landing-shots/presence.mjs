// Keeps the demo people connected, so friends and members show as online.
// Usage: node scripts/landing-shots/presence.mjs <seed.json> (runs until stopped)
import fs from 'node:fs';

const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ONLINE = ['jonas', 'noor', 'theo', 'yuki', 'sam', 'lena'];

function connect(name) {
  const socket = new WebSocket('ws://localhost:3005/ws');
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token: seed.users[name].token })));
  socket.addEventListener('close', () => setTimeout(() => connect(name), 2000));
  socket.addEventListener('error', () => {});
  const timer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
  }, 20000);
  socket.addEventListener('close', () => clearInterval(timer));
}

for (const name of ONLINE) connect(name);
console.log('presence up for', ONLINE.join(', '));
