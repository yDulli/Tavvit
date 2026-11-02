import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// config.ts reads process.env at module load, so each case sets the variable
// and re-imports a fresh copy of the module.
async function loadConfig(): Promise<typeof import('./config.js')['config']> {
  vi.resetModules();
  const mod = await import('./config.js');
  return mod.config;
}

const saved = process.env.DIRECTORY_ENDPOINT;

beforeEach(() => {
  delete process.env.DIRECTORY_ENDPOINT;
});

afterEach(() => {
  if (saved === undefined) delete process.env.DIRECTORY_ENDPOINT;
  else process.env.DIRECTORY_ENDPOINT = saved;
});

describe('config.directory.endpoint', () => {
  it('defaults to empty, which means disabled, when DIRECTORY_ENDPOINT is unset', async () => {
    // A private instance neither lists its spaces nor contacts a public hub.
    const config = await loadConfig();
    expect(config.directory.endpoint).toBe('');
  });

  it('an empty DIRECTORY_ENDPOINT stays empty, which means disabled', async () => {
    process.env.DIRECTORY_ENDPOINT = '';
    const config = await loadConfig();
    expect(config.directory.endpoint).toBe('');
  });

  it('drops trailing slashes from a custom hub', async () => {
    process.env.DIRECTORY_ENDPOINT = 'https://x.test/';
    const config = await loadConfig();
    expect(config.directory.endpoint).toBe('https://x.test');
  });
});

describe('config.federation.backoffDivisor', () => {
  const savedDivisor = process.env.FEDERATION_BACKOFF_DIVISOR;

  beforeEach(() => {
    delete process.env.FEDERATION_BACKOFF_DIVISOR;
  });

  afterEach(() => {
    if (savedDivisor === undefined) delete process.env.FEDERATION_BACKOFF_DIVISOR;
    else process.env.FEDERATION_BACKOFF_DIVISOR = savedDivisor;
  });

  it('is 1, the production schedule, when FEDERATION_BACKOFF_DIVISOR is unset', async () => {
    const config = await loadConfig();
    expect(config.federation.backoffDivisor).toBe(1);
  });

  it('takes a whole number of at least 1', async () => {
    process.env.FEDERATION_BACKOFF_DIVISOR = '30';
    const config = await loadConfig();
    expect(config.federation.backoffDivisor).toBe(30);
  });

  it('refuses 0, which would make every retry wait infinite', async () => {
    process.env.FEDERATION_BACKOFF_DIVISOR = '0';
    await expect(loadConfig()).rejects.toThrow(/FEDERATION_BACKOFF_DIVISOR/);
  });

  it('refuses a fraction, which would lengthen the waits', async () => {
    process.env.FEDERATION_BACKOFF_DIVISOR = '0.5';
    await expect(loadConfig()).rejects.toThrow(/FEDERATION_BACKOFF_DIVISOR/);
  });
});

// ─── Tavvit: private by default ───────────────────────────────────────────────
// Each of these is a promise made to the person running the server: with an
// empty .env, nothing is open to strangers and nothing phones home. They read
// the defaults, so every variable they depend on is cleared first.

describe('Tavvit private-by-default configuration', () => {
  const keys = [
    'REGISTRATION_OPEN', 'FEDERATION_ENABLED', 'BACKSPACE_UPDATE_CHECK', 'TELEMETRY_ENDPOINT',
    'DIRECTORY_ENDPOINT', 'TAVVIT_SOURCE_URL', 'BACKSPACE_SOURCE_URL',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('closes registration unless the operator opens it', async () => {
    expect((await loadConfig()).registrationOpen).toBe(false);
    process.env.REGISTRATION_OPEN = 'true';
    expect((await loadConfig()).registrationOpen).toBe(true);
  });

  it('turns federation off unless the operator enables it', async () => {
    expect((await loadConfig()).federation.enabled).toBe(false);
    process.env.FEDERATION_ENABLED = 'true';
    expect((await loadConfig()).federation.enabled).toBe(true);
    process.env.FEDERATION_ENABLED = '1';
    expect((await loadConfig()).federation.enabled).toBe(true);
    process.env.FEDERATION_ENABLED = 'yes';
    expect((await loadConfig()).federation.enabled).toBe(false);
  });

  it('contacts nobody by default: no directory hub', async () => {
    const config = await loadConfig();
    expect(config.directory.endpoint).toBe('');
  });

  it('reports the AGPL source offer as unconfigured until the operator names where the source is', async () => {
    const config = await loadConfig();
    expect(config.sourceCodeConfigured).toBe(false);
    // The link is never dead: it falls back to upstream, which is where this code came from.
    expect(config.sourceCodeUrl).toBe('https://github.com/TheZwiss/backspace');
  });

  it('counts a source URL as configured when it names somewhere other than upstream', async () => {
    process.env.TAVVIT_SOURCE_URL = 'https://git.example.org/friends/orbit';
    const config = await loadConfig();
    expect(config.sourceCodeConfigured).toBe(true);
    expect(config.sourceCodeUrl).toBe('https://git.example.org/friends/orbit');
  });

  it('still honours the legacy BACKSPACE_SOURCE_URL name, and prefers TAVVIT_SOURCE_URL over it', async () => {
    process.env.BACKSPACE_SOURCE_URL = 'https://legacy.example.org/src';
    expect((await loadConfig()).sourceCodeUrl).toBe('https://legacy.example.org/src');
    process.env.TAVVIT_SOURCE_URL = 'https://new.example.org/src';
    expect((await loadConfig()).sourceCodeUrl).toBe('https://new.example.org/src');
  });

  it('does not count pointing the offer back at upstream as configured, whatever the case or slash', async () => {
    process.env.TAVVIT_SOURCE_URL = 'https://GitHub.com/TheZwiss/backspace/';
    expect((await loadConfig()).sourceCodeConfigured).toBe(false);
  });

  it('refuses a source URL that is not http(s)', async () => {
    process.env.TAVVIT_SOURCE_URL = 'ftp://example.org/src';
    await expect(loadConfig()).rejects.toThrow(/TAVVIT_SOURCE_URL/);
  });
});
