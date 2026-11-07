import { apiErrorHandler } from './utils/apiErrorHandler.js';
import { startSessionSweeper, stopSessionSweeper } from './utils/sessions.js';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { getDb, getRawDb, closeDatabase, schema } from './db/index.js';
import { checkFfmpeg } from './utils/thumbnail.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { spaceRoutes } from './routes/spaces.js';
import { spaceModerationRoutes } from './routes/spaceModeration.js';
import { discordImportRoutes } from './routes/discordImport.js';
import { discordExpressionImportRoutes } from './routes/discordExpressionImport.js';
import { spaceExpressionRoutes } from './routes/spaceExpressions.js';
import { removeUnusedEmojiFiles } from './utils/spaceExpressions.js';
import { removeUnusedDecorationFiles } from './utils/customDecorations.js';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { pinRoutes } from './routes/pins.js';
import { forwardRoutes } from './routes/forward.js';
import { pollRoutes } from './routes/polls.js';
import { pushRoutes } from './routes/push.js';
import { threadRoutes } from './routes/threads.js';
import { forumRoutes } from './routes/forums.js';
import { translationRoutes } from './routes/translation.js';
import { linkedAccountRoutes } from './routes/linkedAccounts.js';
import { voiceOverlayRoutes } from './routes/voiceOverlay.js';
import { loadVoiceOverlayChannels } from './utils/voiceOverlays.js';
import { channelFollowRoutes } from './routes/channelFollows.js';
import { eventRoutes } from './routes/events.js';
import { webhookRoutes } from './routes/webhooks.js';
import { savedRoutes } from './routes/saved.js';
import { botRoutes } from './routes/bots.js';
import { soundboardRoutes } from './routes/soundboard.js';
import { watchRoutes } from './routes/watch.js';
import { removeUnusedSoundFiles } from './utils/soundFiles.js';
import { keywordRoutes } from './routes/keywords.js';
import { startSavedReminderSweeper } from './utils/savedReminders.js';
import { pathForLog, removeUnusedWebhookAccounts } from './utils/webhookAccounts.js';
import { welcomeRoutes } from './routes/welcome.js';
import { startEventReminderSweeper } from './utils/eventReminders.js';
import { stickerRoutes } from './routes/stickers.js';
import { customDecorationRoutes } from './routes/customDecorations.js';
import { uploadRoutes } from './routes/uploads.js';
import { filesRoutes } from './routes/files.js';
import { dmRoutes } from './routes/dm.js';
import { livekitRoutes } from './routes/livekit.js';
import { socialRoutes } from './routes/social.js';
import { settingsRoutes } from './routes/settings.js';
import { notificationSettingsRoutes } from './routes/notificationSettings.js';
import { utilRoutes } from './routes/utils.js';
import { instanceRoutes } from './routes/instance.js';
import { emailRoutes, emailWebhookRoutes } from './routes/email.js';
import { startEmailWorker, stopEmailWorker } from './email/service.js';
import { startSecuritySweeper, stopSecuritySweeper } from './security/events.js';
import { twoFactorRoutes } from './routes/twoFactor.js';
import { invitesRoutes } from './routes/invites.js';
import { exploreRoutes } from './routes/explore.js';
import { directoryRoutes } from './routes/directory.js';
import { searchRoutes } from './routes/search.js';
import { adminRoutes } from './routes/admin.js';
import { platformAdminRoutes } from './routes/platformAdmin.js';
import { adminConsoleRoutes } from './routes/adminConsole.js';
import { spaceReviewRoutes } from './routes/spaceReview.js';
import { gifRoutes } from './routes/gif.js';
import { desktopDownloadRoutes } from './routes/desktopDownloads.js';
import { legalRoutes } from './routes/legal.js';
import { startLegalRecordSweeper } from './utils/reports.js';
import { inboxRoutes } from './routes/inbox.js';
import { dataExportRoutes } from './routes/dataExport.js';
import { accountStorageRoutes } from './routes/accountStorage.js';
import { botFileRoutes } from './routes/botFiles.js';
import { startDataExportSweeper, stopDataExportSweeper } from './utils/dataExport.js';
import { blockRoutes } from './routes/blocks.js';
import { profileImageRoutes } from './routes/profileImages.js';
import { emojiRoutes } from './routes/emojis.js';
import { startCustomStatusSweeper, stopCustomStatusSweeper } from './utils/customStatusExpiry.js';
import { startTwitchLive, stopTwitchLive } from './utils/twitchLive.js';
import { federationRoutes } from './routes/federation.js';
import { cspReportRoutes } from './routes/cspReport.js';
import { buildCspHeaderValue, CSP_REPORT_GROUP, CSP_REPORT_PATH } from './utils/csp.js';
import { startFederationWorkers, stopFederationWorkers } from './utils/federationWorker.js';
import { startBackupWorker, stopBackupWorker } from './utils/backupWorker.js';
import { startRuntimeStats, stopRuntimeStats } from './utils/runtimeStats.js';
import { startOperatorAlerts, stopOperatorAlerts } from './utils/operatorAlerts.js';
import { publicStatusRoutes } from './routes/publicStatus.js';
import { loadtestRoutes } from './routes/loadtest.js';
import { startDirectoryPinger, stopDirectoryPinger } from './directory/pinger.js';
import { buildStartupSummary } from './utils/startupSummary.js';
import { sourceOffer } from './utils/sourceOffer.js';
import { registerDeveloperDocs } from './utils/developerDocs.js';
import { createWebDocuments, isStaticAssetPath, registerWebDocumentRoutes, sendIndex, type InviteCard } from './utils/webDocument.js';
import { rateLimitsDisabled, warnIgnoredRateLimitSwitch } from './utils/rateLimitSwitch.js';
import { trustProxyFor } from './utils/trustProxy.js';
import { registerJsonBodyParser } from './utils/jsonBody.js';
import { registerBodyGuard } from './utils/bodyGuard.js';
import { getLocalInvitePreview } from './utils/spaceInviteSnapshot.js';
import { uploadNameOf } from './utils/profileImageRefs.js';
import { errorBody } from './utils/httpErrors.js';
import './utils/federationRollback.js'; // Side-effect: registers rollback callbacks for outbox terminal failures.
import { registerCallRelayHooks } from './ws/events.js';
import { resetStalePresenceOnBoot } from './utils/presenceBoot.js';

import { registerWebSocket } from './ws/handler.js';
import { WEBSOCKET_OPTIONS } from './ws/socketOptions.js';
import path from 'path';
import fs from 'fs';
import { MESSAGE_PAGING_HEADER } from '@backspace/shared';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';
import { eq } from 'drizzle-orm';

async function main(): Promise<void> {
  const app = Fastify({
    // A count of trusted hops, not `true`. `request.ip` is the address the
    // nearest proxy appended rather than the left-most thing in
    // `X-Forwarded-For`, so a client cannot pick the address its rate limits
    // are counted under. `TRUSTED_PROXY_HOPS` in config.ts carries what the
    // number means and when an operator changes it; utils/trustProxy.ts why it
    // is a function now (Fastify 5 trusts nobody for a bare number).
    trustProxy: trustProxyFor(config.trustedProxyHops),
    logger: {
      level: 'info',
      // Which request, not who sent it or what they searched for: no address,
      // no query string and no webhook token reach the logs (docs/systems/legal.md).
      serializers: {
        req(request) {
          return { method: request.method, url: pathForLog(request.url) };
        },
      },
    },
  });

  // An empty JSON body is no body, as before Fastify 5 (utils/jsonBody.ts).
  registerJsonBodyParser(app);
  // A large body is read only from someone who has shown who they are (utils/bodyGuard.ts).
  registerBodyGuard(app);

  // The origin is deliberately reflected rather than restricted to a peer
  // allowlist. Client federation has a browser on one instance call
  // /api/instance/info, /api/auth/register and /api/auth/login directly against
  // another instance BEFORE any server-to-server peering exists, and peering can
  // legitimately be declined by an admin while that browser connection keeps
  // working (see instanceStore.connectToRemote and docs/systems/client-federation.md).
  // An allowlist would reject the whole onboarding flow.
  //
  // Reflecting is safe here only because there is no ambient credential to ride
  // on: this API has no cookies and no HTTP auth, and the bearer token is read
  // from localStorage and attached explicitly by our own client. A cross-origin
  // page cannot obtain it and the browser will not attach it. That premise is
  // enforced by test/cors-posture.test.ts. Access-Control-Allow-Credentials is
  // therefore NOT set: it grants nothing today and would make this reflection
  // genuinely unsafe the moment a cookie appeared.
  // See docs/systems/web-security.md.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    // Tus-* and Upload-* headers are required for federated tus uploads
    // (cross-origin POST/HEAD/PATCH/DELETE on /api/files/*). Without them the
    // browser preflight blocks the request before it ever reaches the server.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Tus-Resumable',
      'Upload-Length',
      'Upload-Offset',
      'Upload-Metadata',
      'Upload-Defer-Length',
      'Upload-Concat',
      'Upload-Checksum',
      'X-HTTP-Method-Override',
    ],
    // Expose tus response headers so tus-js-client can read them across origins
    // (Location is the per-upload URL returned on POST; the rest are standard
    // tus protocol headers). MESSAGE_PAGING_HEADER tells a client talking to
    // another instance that a history request honoured `after`.
    exposedHeaders: [
      MESSAGE_PAGING_HEADER,
      'Location',
      'Tus-Resumable',
      'Tus-Version',
      'Tus-Extension',
      'Tus-Max-Size',
      'Tus-Checksum-Algorithm',
      'Upload-Offset',
      'Upload-Length',
      'Upload-Metadata',
      'Upload-Expires',
    ],
  });

  // helmet supplies the static security headers. It is explicitly NOT allowed to
  // manage the CSP: the policy depends on runtime config and has to defer to
  // routes that set their own, so it is applied by the onSend hook below and
  // lives in exactly one place.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    // Only the TLS terminator knows whether HTTPS is actually in play. Caddy
    // owns HSTS; see Caddyfile and docs/systems/web-security.md.
    strictTransportSecurity: false,
    // Federation loads avatars and attachments across origins with plain <img>
    // and <video>. helmet's default of same-origin would block all of it.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // Not enabled: it would require CORP headers on every third-party image an
    // embed pulls in, which is not something this app controls.
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
  });

  // The policy is built once at boot because its only input is config, which
  // does not change while the process runs.
  const cspHeaderValue = buildCspHeaderValue({
    livekitUrl: config.livekit.url,
    federationEnabled: config.federation.enabled,
  });
  // Enforcing since 2026-09-03. It shipped report-only first and was flipped
  // only after the observation phase in docs/systems/web-security.md section 7
  // ran on two real deployments with a violation detector validated on each.
  // `Reporting-Endpoints` and the sink below stay: an enforcing policy still
  // reports, and those reports are now the only signal that this broke a flow
  // nobody exercised.
  const cspHeaderName = 'Content-Security-Policy';
  const reportingEndpoints = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
  // What the page may ask the browser for (web-security.md, "Permissions-Policy"): camera,
  // microphone and screen capture for itself alone, for calls, and nothing it never uses. What an
  // embedded player is handed (fullscreen, autoplay, picture-in-picture, encrypted media) is left
  // out on purpose: naming it here would stop an iframe's `allow` from passing it on.
  const PERMISSIONS_POLICY = 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), browsing-topics=()';

  app.addHook('onSend', async (_request, reply, payload) => {
    // A route that has already set its own policy is asserting something
    // stricter about its own response than the app policy can. routes/uploads.ts
    // sandboxes served user files under `default-src 'none'`; overwriting that
    // with the app policy would widen it. The guard and the header below now
    // carry the same name, which is why this reads as a plain "first writer
    // wins" rather than as two competing headers.
    if (!reply.getHeader('Content-Security-Policy')) {
      reply.header(cspHeaderName, cspHeaderValue);
      reply.header('Reporting-Endpoints', reportingEndpoints);
    }
    if (!reply.getHeader('Permissions-Policy')) reply.header('Permissions-Policy', PERMISSIONS_POLICY);
    return payload;
  });

  // Before anything can throw. Fastify's default answers with the error's own message
  // and logs it, and those carry things that must go nowhere: the parser quotes the
  // body it could not read, passwords included.
  app.setErrorHandler(apiErrorHandler);

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    // The budget is per client address, and only per address. The limiter runs
    // on `onRequest`, while `authenticate` is a route `preHandler`, so nothing
    // has put a user on the request yet when this key is taken: a key that
    // reached for `request.userId` would read undefined on every request and
    // fall back here anyway. Stated plainly instead, because the consequence is
    // an operator's to know: everyone behind one NAT, VPN exit or corporate
    // proxy shares one 200-per-minute budget. Which address that is comes from
    // `config.trustedProxyHops`, which is what keeps a client from choosing
    // its own. See docs/systems/api.md, "Rate limiting".
    keyGenerator: (request: FastifyRequest) => request.ip,
    // Test harnesses set DISABLE_RATE_LIMITS=1 to bypass per-IP exhaustion when
    // many tests share the loopback IP; production ignores it (utils/rateLimitSwitch.ts).
    // The page's own files are served from disk and a first visit asks for about
    // 40 of them, so counting them would leave a handful of new visitors behind
    // one address with a black page.
    allowList: (request: FastifyRequest) => rateLimitsDisabled() || isStaticAssetPath(request.url),
    // The shared error shape (see localization.md) plus `retryAfter` in
    // seconds; the plugin sets the Retry-After header itself. One builder
    // covers every per-route override too, so a route that tightens its own
    // limit does not need to spell the body out again.
    errorResponseBuilder: (_request, context) => ({
      ...errorBody(429, 'rate_limited'),
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });

  // The frame limit and compression: ws/socketOptions.ts.
  await app.register(websocket, WEBSOCKET_OPTIONS);

  // Serve built frontend in production
  const webDistPath = path.resolve(import.meta.dirname ?? '.', '../../web/dist');
  const webDocuments = fs.existsSync(webDistPath) ? createWebDocuments(webDistPath, config.publicOrigin ?? `https://${config.domain}`) : null;
  const inviteCardFor = (code: string): InviteCard | null => {
    const preview = getLocalInvitePreview(code);
    if (!preview) return null;
    const icon = uploadNameOf(preview.icon);
    return {
      spaceName: preview.spaceName,
      description: preview.description,
      memberCount: preview.memberCount,
      iconPath: icon ? `/api/uploads/${icon}` : null,
    };
  };
  const currentInstanceName = (): string => {
    const row = getDb().select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    return row?.instanceName?.trim() || DEFAULT_INSTANCE_NAME;
  };
  if (webDocuments) {
    // The app's page and the manifest carry the instance's own name, and the
    // website's pages its origin (see utils/webDocument.ts), so they are answered
    // ahead of the static handler that would send the files as the build wrote
    // them. The website's pages sit in dist/.site, which this handler leaves alone
    // because it serves no dot files.
    registerWebDocumentRoutes(app, webDocuments, currentInstanceName, inviteCardFor);
    registerDeveloperDocs(app, webDistPath);
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      wildcard: false,
      setHeaders: (reply, filePath) => {
        const served = path.relative(webDistPath, filePath);
        // Vite (assets/) and the website's build (_astro/) name these by their
        // content, and the camera effects' WebAssembly sits under the version
        // of the package it comes from (mediapipe/<version>/, see
        // packages/web/src/build/visionAssets.mjs), so a copy can never go
        // stale. A typeface's file changes name when it changes. The rest is
        // revalidated.
        if (served.startsWith(`assets${path.sep}`) || served.startsWith(`_astro${path.sep}`) || served.startsWith(`mediapipe${path.sep}`)) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        else if (served.startsWith(`fonts${path.sep}`)) reply.header('Cache-Control', 'public, max-age=604800');
      },
    });
  }

  // Initialize database
  getDb();

  // Reset orphaned `users.status` rows this instance owns (native and detached
  // accounts). The previous process's in-memory disconnect timers are gone, so
  // any non-offline owned row is stale by construction. Replicated rows are
  // skipped — their status is a projection of remote presence, not local WS
  // state. Must run
  // before WS auth is accepted so the first connection broadcasts the correct
  // online transition. See utils/presenceBoot.ts.
  resetStalePresenceOnBoot();

  await app.register(authRoutes);
  await app.register(loadtestRoutes);
  await app.register(publicStatusRoutes);
  await app.register(userRoutes);
  await app.register(blockRoutes);
  await app.register(profileImageRoutes);
  await app.register(emojiRoutes);
  await app.register(spaceRoutes);
  await app.register(spaceModerationRoutes);
  await app.register(discordImportRoutes);
  await app.register(discordExpressionImportRoutes);
  await app.register(spaceExpressionRoutes);
  await app.register(channelRoutes);
  await app.register(messageRoutes);
  await app.register(pinRoutes);
  await app.register(forwardRoutes);
  await app.register(pollRoutes);
  await app.register(pushRoutes);
  await app.register(threadRoutes);
  await app.register(forumRoutes);
  await app.register(translationRoutes);
  await app.register(linkedAccountRoutes);
  await app.register(voiceOverlayRoutes);
  await app.register(channelFollowRoutes);
  await app.register(eventRoutes);
  await app.register(webhookRoutes);
  await app.register(savedRoutes);
  await app.register(soundboardRoutes);
  await app.register(watchRoutes);
  await app.register(botRoutes);
  await app.register(keywordRoutes);
  await app.register(welcomeRoutes);
  await app.register(uploadRoutes);
  await app.register(stickerRoutes);
  await app.register(customDecorationRoutes);
  await app.register(filesRoutes);
  await app.register(dmRoutes);
  await app.register(livekitRoutes);
  await app.register(socialRoutes);
  await app.register(settingsRoutes);
  await app.register(notificationSettingsRoutes);
  await app.register(utilRoutes);
  await app.register(instanceRoutes);
  await app.register(twoFactorRoutes);
  await app.register(emailRoutes);
  await app.register(emailWebhookRoutes);
  await app.register(invitesRoutes);
  await app.register(exploreRoutes);
  await app.register(directoryRoutes);
  await app.register(searchRoutes);
  await app.register(adminRoutes);
  await app.register(platformAdminRoutes);
  await app.register(adminConsoleRoutes);
  await app.register(spaceReviewRoutes);
  await app.register(gifRoutes);
  await app.register(desktopDownloadRoutes);
  await app.register(legalRoutes);
  await app.register(inboxRoutes);
  await app.register(dataExportRoutes);
  await app.register(accountStorageRoutes);
  await app.register(botFileRoutes);
  // Federation is opt-in. Left unregistered, /api/federation/* answers with the
  // ordinary 404 of any unknown API path, so a stranger probing for it learns
  // nothing about this instance. See config.federation.enabled.
  if (config.federation.enabled) {
    await app.register(federationRoutes);
  }
  // Registered here rather than beside the hook above so it sits behind the
  // rate limiter. The sink is unauthenticated by design and writes a log line
  // per report, and @fastify/rate-limit only covers routes registered after it.
  await app.register(cspReportRoutes);
  await app.register(registerWebSocket);

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  // SPA fallback - serve index.html for non-API routes
  if (webDocuments) {
    app.setNotFoundHandler((request, reply) => {
      // A missing download must be a 404, never the app's page: the desktop
      // updater would otherwise read HTML as latest.yml.
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws') || request.url.startsWith('/downloads/')) {
        return reply.code(404).send({ error: 'Not found', statusCode: 404 });
      }
      const html = webDocuments.index(currentInstanceName());
      if (html === null) return reply.code(404).send({ error: 'Not found', statusCode: 404 });
      return sendIndex(reply, html);
    });
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`Tavvit server running at http://${config.host}:${config.port}`);
    for (const line of buildStartupSummary(getRawDb(), config, sourceOffer())) console.log(line);
    warnIgnoredRateLimitSwitch();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Log ffmpeg availability at startup (so admins see the warning immediately)
  checkFfmpeg();

  // Register WS-layer call relay hooks (ring-timeout fan-out).
  registerCallRelayHooks();

  // Start federation background workers (outbox delivery, file download, health check,
  // storage janitor, federated-call sentinel). Skip when DISABLE_FEDERATION_WORKERS is
  // set to '1' or 'true' (matches envBool semantics in config.ts; used by integration
  // tests to keep two-instance harnesses quiet).
  const disableWorkers = process.env.DISABLE_FEDERATION_WORKERS === '1'
    || process.env.DISABLE_FEDERATION_WORKERS === 'true';
  if (disableWorkers) {
    console.log('[startup] federation workers disabled via DISABLE_FEDERATION_WORKERS');
  } else {
    startFederationWorkers();
  }

  startBackupWorker();
  startRuntimeStats();
  startOperatorAlerts();
  // Statuses set to "clear after..." end here (utils/customStatusExpiry.ts).
  startCustomStatusSweeper();
  startEventReminderSweeper();
  startSavedReminderSweeper();
  removeUnusedWebhookAccounts();
  removeUnusedSoundFiles();
  removeUnusedEmojiFiles();
  removeUnusedDecorationFiles();
  startSessionSweeper();
  startDataExportSweeper();
  startLegalRecordSweeper();
  startEmailWorker();
  startSecuritySweeper();
  // Which voice channels have an overlay link, for every channel sent from now on (utils/voiceOverlays.ts).
  loadVoiceOverlayChannels();
  // Only with TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET set (utils/twitchLive.ts).
  startTwitchLive(config.twitch.redirectUri);

  // The space directory pinger stays outside the workers guard on purpose:
  // the two-instance harness disables the workers and still needs the pinger,
  // pointed at a local stub. It has its own guard, an empty DIRECTORY_ENDPOINT.
  startDirectoryPinger();

  const shutdown = async () => {
    console.log('Shutting down...');
    stopFederationWorkers();
    stopDirectoryPinger();
    stopBackupWorker();
    stopRuntimeStats();
    stopOperatorAlerts();
    stopCustomStatusSweeper();
    stopSessionSweeper();
    stopDataExportSweeper();
    stopEmailWorker();
    stopSecuritySweeper();
    stopTwitchLive();
    await app.close();
    closeDatabase(); // checkpoints WAL — leaves a complete on-disk file
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
