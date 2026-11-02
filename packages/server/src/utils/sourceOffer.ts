import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getOurOrigin } from './federationAuth.js';

/** Where the source archive of the running version is served from (publish-source.sh). */
export const SOURCE_DOWNLOAD_PREFIX = '/downloads/source/';

export function sourceDownloadDir(): string {
  return path.join(config.downloadsDir, 'source');
}

/**
 * The archive of the version that is running: the file whose name ends in this
 * build's id, so a leftover from an earlier version is never offered as this
 * one's source. An install without a build id (a checkout) has no such file.
 */
function runningSourceArchive(): string | null {
  if (!config.commit) return null;
  const suffix = `-${config.commit}.tar.gz`;
  try {
    return fs.readdirSync(sourceDownloadDir()).find((name) => name.endsWith(suffix)) ?? null;
  } catch {
    return null;
  }
}

/**
 * The AGPL section 13 source offer: an address the operator set, else the
 * archive this server holds, else upstream with `configured: false`, which the
 * admin UI and the boot log report as incomplete. Read per call, because
 * publishing the archive is copying a file in and needs no restart.
 */
export function sourceOffer(): { url: string; configured: boolean } {
  if (config.sourceCodeConfigured) return { url: config.sourceCodeUrl, configured: true };
  const archive = runningSourceArchive();
  if (archive) return { url: `${getOurOrigin()}${SOURCE_DOWNLOAD_PREFIX}${archive}`, configured: true };
  return { url: config.sourceCodeUrl, configured: false };
}
