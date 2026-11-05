# The product page's pictures

`shoot.mjs` takes the pictures of the page at `/` (`packages/web/src/landing/`) from
the running app, with invented people in it, and writes them optimised to
`packages/web/src/landing/assets/`, their sizes to `imageSizes.ts` and the link
preview to `packages/web/public/social-card.jpg` (`card.mjs`: the window just taken
beside the logo and the headline, from `social-card.html`). Retake them when the
app's look changes, or the page shows an app that no longer exists. To redraw only
the card from the window there is:
`PLAYWRIGHT_PREFIX=/tmp/landing-shots node scripts/landing-shots/card.mjs`.

Nothing here touches a real server: it needs a scratch database of its own.

```bash
# 1. A tool for this job only, kept out of the project's dependencies.
npm install --prefix /tmp/landing-shots playwright-core

# 2. A scratch server. Everything under a folder you can throw away.
export DB_PATH=/tmp/landing-shots/data/demo.db UPLOAD_DIR=/tmp/landing-shots/data/uploads
export DOWNLOADS_DIR=/tmp/landing-shots/data/downloads BACKUP_DIR=/tmp/landing-shots/data/backups
export JWT_SECRET=demo-only-secret-demo-only-secret-0123456789 DOMAIN=localhost:5173
export REGISTRATION_OPEN=true DISABLE_RATE_LIMITS=1 FEDERATION_ENABLED=false PORT=3005
(cd packages/server && npx tsx src/index.ts) &
(cd packages/web && npx vite --port 5173 --strictPort) &

# 3. The administrator, who is also the first person in the pictures.
printf '%s\n' 'demo-password-1234' | (cd packages/server && npx tsx src/scripts/tavvit-admin.ts create mara --admin --display-name "Mara Lindqvist" --password-stdin)

# 4. The community, the people online, the pictures.
node scripts/landing-shots/seed.mjs /tmp/landing-shots/seed.json
node scripts/landing-shots/presence.mjs /tmp/landing-shots/seed.json &
PLAYWRIGHT_PREFIX=/tmp/landing-shots node scripts/landing-shots/shoot.mjs /tmp/landing-shots/seed.json
```

`CHROME_PATH` names the browser (it defaults to Chrome's place on Windows). A second
argument to `shoot.mjs` retakes one picture by name. Night Shift's banner is painted by
`seed.mjs` itself and sent as the app sends one. When ports 3005 and 5173 are taken (a
dev server in use), run the scratch pair on others and name them: `API_URL`
(`http://localhost:3007/api`) for `seed.mjs`, `WS_URL` (`ws://localhost:3007/ws`) for
`presence.mjs`, `WEB_URL` (`http://localhost:5174`) for `shoot.mjs`, with Vite's proxy
pointed at that server.

The voice room comes from `packages/web/dev-voice-room.html`: the real components
with seeded stores, because a call would need a LiveKit server and other people.
