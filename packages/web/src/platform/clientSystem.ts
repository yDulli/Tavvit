/**
 * Which operating system and processor the visitor's browser runs on, for the
 * download page: it decides which installer the main button offers.
 *
 * User-Agent Client Hints first (Chromium), the user-agent string otherwise
 * (Firefox, Safari). Neither is trusted for anything but this choice, and the
 * page always lists every installer as well, so a wrong guess costs one click.
 */

export type ClientOs = 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'other';
export type ClientArch = 'x64' | 'arm64';

interface UaDataLike {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }>;
}

function uaData(): UaDataLike | undefined {
  return (navigator as Navigator & { userAgentData?: UaDataLike }).userAgentData;
}

export function osFromUserAgent(userAgent: string, hintPlatform?: string): ClientOs {
  const platform = (hintPlatform ?? '').toLowerCase();
  if (platform === 'windows') return 'windows';
  if (platform === 'macos') return 'mac';
  if (platform === 'android') return 'android';
  if (platform === 'linux' || platform === 'chrome os') return 'linux';
  if (platform === 'ios') return 'ios';

  const ua = userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/windows nt/.test(ua)) return 'windows';
  if (/mac os x|macintosh/.test(ua)) return 'mac';
  if (/linux|cros/.test(ua)) return 'linux';
  return 'other';
}

export function detectClientOs(): ClientOs {
  return osFromUserAgent(navigator.userAgent, uaData()?.platform);
}

/**
 * The processor, when the browser says. Only Client Hints can tell an ARM
 * Windows machine from an x64 one (the classic user agent reports x64 for
 * both), so without them the answer is null and the caller defaults to x64,
 * which runs on both.
 */
export async function detectClientArch(): Promise<ClientArch | null> {
  const data = uaData();
  if (!data?.getHighEntropyValues) return null;
  try {
    const values = await data.getHighEntropyValues(['architecture', 'bitness']);
    if (values.architecture === 'arm' && values.bitness === '64') return 'arm64';
    if (values.architecture === 'x86' && values.bitness === '64') return 'x64';
  } catch {
    // Hints refused: no answer is better than a guess.
  }
  return null;
}
