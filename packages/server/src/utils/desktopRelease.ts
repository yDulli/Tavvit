import fs from 'node:fs';
import path from 'node:path';
import type { DesktopReleaseFile, DesktopReleaseResponse } from '@backspace/shared';

/**
 * The desktop release, read from what electron-builder wrote.
 *
 * A Windows build leaves three files in `dist-electron/`: the installer, its
 * `.blockmap`, and `latest.yml`, which names the installer with its size and
 * SHA-512. Those are copied into `<downloadsDir>/desktop/` unchanged
 * (scripts/package-desktop.mjs bundles them). `latest.yml` is then read twice:
 * electron-updater in every installed app fetches it to look for updates, and
 * this module reads it so the download page offers exactly the file the
 * updater would install, with the same version. Nothing else records a version
 * or a file name, so the page and the updater cannot disagree.
 *
 * A file that latest.yml names but that is not on disk is left out, so the page
 * never links to a download that would 404.
 */

export const DESKTOP_DOWNLOAD_PREFIX = '/downloads/desktop/';

/** Names the server will serve or link: no paths, no hidden files. */
export const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const WINDOWS_INSTALLER = /-win-(x64|arm64)\.exe$/;

interface LatestYml {
  version: string;
  releaseDate: string | null;
  files: Array<{ url: string; sha512: string; size: number | null }>;
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Reads the subset of electron-builder's latest.yml this server needs: the
 * top-level `version` and `releaseDate`, and the `files` list of
 * `url`/`sha512`/`size` entries. The format is fixed by electron-builder
 * (two-space indentation, `  - url:` items), which is why a full YAML parser
 * is not pulled in for it. Returns null for anything that is not that shape.
 */
export function parseLatestYml(text: string): LatestYml | null {
  let version: string | null = null;
  let releaseDate: string | null = null;
  const files: LatestYml['files'] = [];
  let inFiles = false;
  let current: { url?: string; sha512?: string; size?: number | null } | null = null;

  const flush = () => {
    if (current?.url && current.sha512) {
      files.push({ url: current.url, sha512: current.sha512, size: current.size ?? null });
    }
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) continue;
    const topLevel = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(rawLine);
    if (topLevel) {
      flush();
      const [, key, value] = topLevel as unknown as [string, string, string];
      inFiles = key === 'files' && value.trim() === '';
      if (key === 'version') version = unquote(value);
      if (key === 'releaseDate') releaseDate = unquote(value) || null;
      continue;
    }
    if (!inFiles) continue;
    const item = /^\s+-\s+([A-Za-z0-9]+):\s*(.*)$/.exec(rawLine);
    const field = item ?? /^\s+([A-Za-z0-9]+):\s*(.*)$/.exec(rawLine);
    if (!field) continue;
    if (item) {
      flush();
      current = {};
    }
    if (!current) continue;
    const [, key, value] = field as unknown as [string, string, string];
    const v = unquote(value);
    if (key === 'url') current.url = v;
    else if (key === 'sha512') current.sha512 = v;
    else if (key === 'size') {
      const n = Number(v);
      current.size = Number.isSafeInteger(n) && n >= 0 ? n : null;
    }
  }
  flush();

  if (!version || !/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) return null;
  return { version, releaseDate, files };
}

/** The release in `<downloadsDir>/desktop`, or null when none has been published there. */
export function readDesktopRelease(downloadsDir: string): DesktopReleaseResponse['release'] {
  const dir = path.join(downloadsDir, 'desktop');
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8');
  } catch {
    return null;
  }
  const parsed = parseLatestYml(text);
  if (!parsed) return null;

  const files: DesktopReleaseFile[] = [];
  for (const entry of parsed.files) {
    if (!SAFE_FILE_NAME.test(entry.url)) continue;
    const match = WINDOWS_INSTALLER.exec(entry.url);
    if (!match) continue;
    let size: number;
    try {
      const stat = fs.statSync(path.join(dir, entry.url));
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      continue;
    }
    files.push({
      platform: 'windows',
      arch: match[1] as 'x64' | 'arm64',
      fileName: entry.url,
      url: `${DESKTOP_DOWNLOAD_PREFIX}${encodeURIComponent(entry.url)}`,
      size,
      sha512: entry.sha512,
    });
  }
  if (files.length === 0) return null;

  const releasedAt = parsed.releaseDate && !Number.isNaN(Date.parse(parsed.releaseDate))
    ? new Date(parsed.releaseDate).toISOString()
    : null;
  return { version: parsed.version, releasedAt, files };
}
