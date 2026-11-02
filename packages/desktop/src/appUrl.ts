import fs from 'fs';
import path from 'path';

/**
 * Where the desktop app lives. Tavvit Desktop is a window onto one server, the
 * production one, and opens it directly: there is no instance picker, no saved
 * server address and no setup step between launching the app and seeing it.
 *
 * The download page and the update feed sit on the same origin, so the three
 * addresses below can never point at different servers.
 */
export const PRODUCTION_URL = 'https://tavvit.com';

/** The public page that offers the installers (the web client's `/download` route). */
export const DOWNLOAD_PAGE_URL = `${PRODUCTION_URL}/download`;

/**
 * The environment variable a developer sets to point an unpackaged build at a
 * local server (`TAVVIT_DEV_URL=http://localhost:5173 pnpm --filter @backspace/desktop dev`).
 * A packaged build ignores it, so an installed app can never be sent to a
 * development or test server by a stray variable.
 */
export const DEV_URL_ENV = 'TAVVIT_DEV_URL';

export interface AppUrlInput {
  /** `app.isPackaged`: true for an installed build. */
  isPackaged: boolean;
  /** The value of `TAVVIT_DEV_URL`, if any. */
  devUrl: string | undefined;
}

/** The address the main window loads. Always the production server in a packaged build. */
export function resolveAppUrl({ isPackaged, devUrl }: AppUrlInput): string {
  if (isPackaged || !devUrl) return PRODUCTION_URL;
  try {
    const parsed = new URL(devUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {
    // Not a URL: fall through to production rather than load nothing.
  }
  return PRODUCTION_URL;
}

/**
 * Earlier builds remembered a server address chosen in a picker, in
 * `<userData>/instance-url.json`. Nothing reads it any more; it is deleted on
 * start so a stale address can never be mistaken for a setting.
 */
export function removeLegacyInstanceFile(userDataDir: string): void {
  try {
    fs.unlinkSync(path.join(userDataDir, 'instance-url.json'));
  } catch {
    // Absent on every install that never had a picker: nothing to do.
  }
}
