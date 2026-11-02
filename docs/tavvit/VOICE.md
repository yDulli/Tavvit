# Voice, video and screen sharing

Tavvit's voice, video and screen sharing run on **LiveKit**, an open-source media
server that `install.sh` can set up next to Tavvit. Text chat works without it.

## How it fits together

```
 browser ── https/wss ──▶ Caddy (or your proxy) ──▶ Tavvit app   (chat, sign-in, tokens)
    │                          │
    │                          └─ /livekit/* ───────▶ LiveKit :7880   (signalling, WebSocket)
    │
    └────── UDP/TCP media, directly ──────────────▶ LiveKit :7881/tcp, :3478/udp, :50000-60000/udp
```

- Tavvit decides **who may join** a channel and hands the browser a short-lived
  token. LiveKit carries the audio and video.
- The browser reaches LiveKit's *signalling* through the same HTTPS address
  (`wss://your-domain/livekit`), so no extra public web port is needed.
- The *media* does not go through the proxy. It flows straight between the browser
  and the server on the ports below. **These must be reachable from the internet.**

## Ports to open

| Port | Protocol | What for |
| --- | --- | --- |
| 80, 443 | TCP | the web app and signalling (already needed) |
| **7881** | TCP | media over TCP, the fallback when UDP is blocked |
| **3478** | UDP | TURN: lets people behind strict NATs connect |
| **50000-60000** | UDP | the media itself |

On the server's firewall (ufw):

```bash
sudo ufw allow 7881/tcp
sudo ufw allow 3478/udp
sudo ufw allow 50000:60000/udp
```

If the server sits behind a home router, **forward the same ports to the server**.
This is the step most often forgotten, and the symptom is always the same: you can
join a voice channel, you see yourself connect, and nobody hears anybody.

LiveKit runs with host networking, so these are the real ports of the machine.
Another service already using one of them will stop LiveKit from starting.

## Browsers need HTTPS

Browsers only give a web page the microphone, camera and screen over **HTTPS** (or
`localhost`). Plain `http://` addresses show the voice UI but cannot capture
anything. Tavvit's bundled Caddy gets a certificate automatically.

**Through a tunnel (Cloudflare Tunnel, Tailscale Funnel...)** voice cannot work:
WebRTC media is UDP, and a tunnel carries web traffic only. Use the `allinone` or
`proxy` mode with the ports above if you want voice.

## Turning voice on

If you said yes to voice during `install.sh`, it already wrote everything:

- `.env`: `LIVEKIT_URL=wss://<domain>/livekit`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET` and `COMPOSE_PROFILES=voice`,
- `livekit.yaml`: LiveKit's configuration with the **same** key and secret.

To add it later, simply run `bash install.sh` again and answer yes. By hand:

```bash
cd /opt/tavvit
KEY="orbit$(openssl rand -hex 8)"; SECRET="$(openssl rand -hex 32)"
cat >> .env <<EOF

LIVEKIT_URL=wss://your-domain/livekit
LIVEKIT_API_KEY=$KEY
LIVEKIT_API_SECRET=$SECRET
COMPOSE_PROFILES=voice
EOF
cat > livekit.yaml <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
turn:
  enabled: true
  domain: your-domain
  udp_port: 3478
keys:
  $KEY: $SECRET
room:
  auto_create: true
  empty_timeout: 300
  departure_timeout: 20
logging:
  level: info
EOF
docker compose up -d
```

(Replace `your-domain` in the three places. The key in `.env` and in `livekit.yaml`
must match exactly, or sign-in to voice is refused.)

### Behind your own reverse proxy

Your proxy must forward `/livekit/` to LiveKit's signalling port **with WebSocket
upgrade**, stripping the `/livekit` prefix:

```nginx
location /livekit/ {
    proxy_pass http://127.0.0.1:7880/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

## When it does not connect

Start with `bash doctor.sh`: its *Voice and video* section checks that LiveKit is
running, that `.env` and `livekit.yaml` agree, and prints the port list above.

| Symptom | Likely cause |
| --- | --- |
| "Connection failed" at once | `LIVEKIT_URL` wrong, or the proxy does not pass `/livekit/` with WebSocket upgrade |
| Joins, but silence both ways | UDP ports closed, or not forwarded by the router |
| Works at home, not on mobile data | 3478/udp or 7881/tcp blocked; check both |
| Microphone permission never asked | the page is on `http://`, not `https://` |
| LiveKit container keeps restarting | `docker compose logs livekit`: usually a port already in use, or a malformed `livekit.yaml` |
| Works for you, not for one friend | their network blocks UDP; 7881/tcp is the fallback, so make sure it is open |

Logs: `docker compose logs --tail 100 livekit` and the browser console (F12) while
joining a channel.

## What it costs

Audio is cheap. Video and screen sharing are where bandwidth and CPU go: the
server forwards each stream to every viewer, so one screen share to five friends is
five times the upload. A 4-8 person voice channel with an occasional screen share
is comfortable on 2 vCPU and a 50-100 Mbit/s uplink. Administrators can cap
bitrates and resolutions in *Admin console → Streaming*.
