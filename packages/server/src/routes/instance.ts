import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, getRawDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { getInstanceId } from '../utils/federationEpoch.js';
import { readDirectoryBrowseEnabled } from '../directory/state.js';
import { sourceOffer } from '../utils/sourceOffer.js';
import { emailEnabled } from '../email/service.js';
import { twoFactorAvailable } from '../security/twoFactor.js';
import { translationAvailable } from '../utils/translation.js';
import { twitchLiveAvailable } from '../utils/twitchApi.js';
import type { InstanceInfoResponse } from '@backspace/shared';
import { DEFAULT_INSTANCE_NAME } from '@backspace/shared/src/constants.js';

export async function instanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/instance/info', async (_request, reply) => {
    const db = getDb();

    const settings = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    const instanceName = settings?.instanceName ?? DEFAULT_INSTANCE_NAME;

    // DB setting overrides env var if explicitly set by admin
    const registrationOpen = settings?.registrationOpen !== null && settings?.registrationOpen !== undefined
      ? settings.registrationOpen === 1
      : config.registrationOpen;

    // A fresh private instance has no account and, with registration closed, no
    // way to make one from the browser. Say so, so the login page can show the
    // operator the one command that fixes it instead of a dead end. This is a
    // boolean about this server's own state; it names no account.
    const hasLocalAccount = getRawDb().prepare(
      "SELECT 1 FROM users WHERE home_instance IS NULL AND account_kind = 'person' AND (is_deleted IS NULL OR is_deleted = 0) LIMIT 1",
    ).get() !== undefined;

    const source = sourceOffer();
    const response: InstanceInfoResponse = {
      name: instanceName,
      version: config.version,
      registrationOpen,
      email: emailEnabled(),
      emailRequired: emailEnabled() && settings?.emailRequiredSince != null,
      twoFactor: twoFactorAvailable(),
      translation: translationAvailable(),
      twitchLive: twitchLiveAvailable(),
      emojiPolicy: settings?.emojiPolicy === 'everyone' ? 'everyone' : 'admins',
      federatedRegistrationOpen: settings?.federatedRegistrationOpen === 1,
      instanceId: getInstanceId(),
      // AGPL-3.0 § 13: advertise the source of the running version to every
      // network user (and federated peer) — public/unauthenticated by design.
      sourceCodeUrl: source.url,
      commit: config.commit,
      // Reported on its own, not folded into the two below it. Whether this
      // instance has a hub to talk to is the fact every directory promise
      // rests on, and a client that could only see `directoryAvailable` had
      // no way to tell a missing endpoint from an admin who turned browsing
      // off, so it offered listing and browsing on instances where neither
      // could happen.
      directoryConfigured: config.directory.endpoint !== '',
      // Browsing needs an endpoint to reach and the admin's permission to use
      // it. The endpoint is asked first: it is the operator-level switch, and
      // the admin's flag cannot conjure a directory that is not configured.
      // Listing is the other axis entirely, and its own opt-in below.
      directoryAvailable: config.directory.endpoint !== '' && readDirectoryBrowseEnabled(getRawDb()),
      directoryEnabled: settings?.directoryEnabled === 1,
      // Read by the web client alone, to hide the Support card. A missing row
      // falls back to the column default.
      federationEnabled: config.federation.enabled,
      setupRequired: !hasLocalAccount && !registrationOpen,
      sourceCodeConfigured: source.configured,
      accentColor: settings?.accentColor ?? null,
    };

    return reply.code(200).send(response);
  });
}
