import type Database from 'better-sqlite3';
import type { config as appConfig } from '../config.js';

type AppConfig = typeof appConfig;

interface SummaryRow {
  registration_open: number | null;
}

/**
 * The boot summary: what this instance will and will not do, in a few lines an
 * operator can read in `docker compose logs`. It exists so a security posture
 * is visible instead of inferred from an `.env` file, and so the one setup step
 * an operator can forget (creating the first administrator) is named in the
 * log where they will be looking when the login page shows nothing.
 *
 * It names no secret, no address and no account: counts and switches only.
 */
export function buildStartupSummary(
  sqlite: Database.Database,
  cfg: AppConfig,
  source: { url: string; configured: boolean } = { url: cfg.sourceCodeUrl, configured: cfg.sourceCodeConfigured },
): string[] {
  const settings = sqlite
    .prepare('SELECT registration_open FROM instance_settings WHERE id = 1')
    .get() as SummaryRow | undefined;
  const registrationOpen = settings?.registration_open !== null && settings?.registration_open !== undefined
    ? settings.registration_open === 1
    : cfg.registrationOpen;

  const accounts = sqlite
    .prepare(
      `SELECT COUNT(*) AS accounts, COALESCE(SUM(is_admin), 0) AS admins
       FROM users WHERE home_instance IS NULL AND account_kind = 'person' AND (is_deleted IS NULL OR is_deleted = 0)`,
    )
    .get() as { accounts: number; admins: number };

  const lines: string[] = [];
  lines.push(`Tavvit ${cfg.version}${cfg.commit ? ` (${cfg.commit})` : ''} is ready`);
  lines.push(
    `  registration : ${registrationOpen
      ? 'OPEN - anyone who can reach this server can create an account'
      : 'closed - invite links and admin-created accounts only'}`,
  );
  lines.push(`  accounts     : ${accounts.accounts} (${accounts.admins} admin${accounts.admins === 1 ? '' : 's'})`);
  lines.push(`  2FA          : ${cfg.twoFactorKey ? 'available' : 'unavailable - set TOTP_ENCRYPTION_KEY (openssl rand -hex 32)'}`);
  lines.push(`  email        : ${cfg.email.transport === 'none' ? 'off - no addresses, no password reset by mail' : `${cfg.email.transport}, links to ${cfg.email.baseUrl}`}`);
  if (accounts.admins === 0) {
    lines.push('  NEXT STEP    : no administrator exists. Create one with:');
    lines.push('                 ./tavvit-admin.sh create <username> --admin        (in the install folder, on the server)');
  }
  lines.push(`  federation   : ${cfg.federation.enabled ? 'ENABLED' : 'disabled (private instance)'}`);
  lines.push(`  voice        : ${cfg.livekit.url && cfg.livekit.apiKey && cfg.livekit.apiSecret ? 'LiveKit configured' : 'not configured (voice and video are unavailable)'}`);
  lines.push(`  outbound     : public directory ${cfg.directory.endpoint === '' ? 'off' : 'hub set'}`);
  if (!source.configured) {
    lines.push('  AGPL         : no source offer: run publish-source.sh or set TAVVIT_SOURCE_URL. This is a modified version of Backspace (AGPL-3.0):');
    lines.push('                 network users must be offered the source of the version you run. See docs/tavvit/LICENSING.md.');
  } else {
    lines.push(`  source offer : ${source.url}`);
  }
  return lines;
}
