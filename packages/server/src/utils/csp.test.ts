import { describe, it, expect } from 'vitest';
import { buildCspDirectives, buildCspHeaderValue, EMBED_FRAME_ORIGINS } from './csp.js';

const directivesOf = (input: Parameters<typeof buildCspDirectives>[0]) =>
  buildCspDirectives(input);

describe('buildCspDirectives', () => {
  it('locks down the directives that actually stop script injection', () => {
    const d = directivesOf({});
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
  });

  it("never allows 'unsafe-eval' or 'unsafe-inline' in script-src", () => {
    const d = directivesOf({});
    expect(d['script-src']).not.toContain("'unsafe-eval'");
    expect(d['script-src']).not.toContain("'unsafe-inline'");
  });

  it("allows 'wasm-unsafe-eval' because the noise suppressor is WebAssembly", () => {
    // packages/web/src/audio/AudioManager.ts:399 instantiates rnnoise.wasm.
    // Without this directive, noise suppression fails to initialise.
    expect(directivesOf({})['script-src']).toContain("'wasm-unsafe-eval'");
  });

  it('allows blob: workers because the WebSocket heartbeat is one', () => {
    // packages/web/src/hooks/useWebSocket.ts:90 runs the 15s keepalive in a
    // Worker built from a blob URL. worker-src falls back to script-src, so
    // without this every connection silently loses its heartbeat.
    const d = directivesOf({});
    expect(d['worker-src']).toContain('blob:');
    expect(d['worker-src']).toContain("'self'");
  });

  it('allows the three embed providers to be framed and nothing else', () => {
    const d = directivesOf({});
    expect(d['frame-src']).toEqual([
      'https://www.youtube-nocookie.com',
      'https://player.vimeo.com',
      'https://open.spotify.com',
    ]);
    expect(EMBED_FRAME_ORIGINS).toEqual(d['frame-src']);
  });

  it('keeps content origins broad, because the content is arbitrary', () => {
    const d = directivesOf({});
    for (const key of ['img-src', 'media-src']) {
      expect(d[key]).toContain('https:');
      expect(d[key]).toContain('data:');
      expect(d[key]).toContain('blob:');
    }
  });

  it('adds the configured LiveKit origin to connect-src', () => {
    const d = directivesOf({ livekitUrl: 'wss://voice.example.org' });
    expect(d['connect-src']).toContain('wss://voice.example.org');
  });

  it('adds a plain ws:// LiveKit origin too, for LAN self-hosters', () => {
    // This is the case the wildcard does not cover: connect-src lists wss: but
    // not ws:, so an operator running LiveKit unencrypted on a LAN needs the
    // exact origin. This is why the policy is built at runtime at all.
    const d = directivesOf({ livekitUrl: 'ws://192.168.1.50:7880' });
    expect(d['connect-src']).toContain('ws://192.168.1.50:7880');
  });

  it('normalises a LiveKit url with a path down to its origin', () => {
    const d = directivesOf({ livekitUrl: 'wss://voice.example.org/livekit/' });
    expect(d['connect-src']).toContain('wss://voice.example.org');
    expect(d['connect-src']).not.toContain('wss://voice.example.org/livekit/');
  });

  it('omits any LiveKit entry when voice is not configured', () => {
    for (const livekitUrl of [undefined, null, '', '   ']) {
      const d = directivesOf({ livekitUrl });
      expect(d['connect-src']!.some((s) => s.includes('livekit'))).toBe(false);
    }
  });

  it('ignores an unparseable LiveKit url instead of emitting a broken directive', () => {
    const d = directivesOf({ livekitUrl: 'not a url' });
    expect(d['connect-src']!.join(' ')).not.toContain('not a url');
  });

  it('points reports at the in-app sink', () => {
    expect(directivesOf({})['report-uri']).toEqual(['/api/csp-report']);
    expect(directivesOf({})['report-to']).toEqual(['csp']);
  });
});

describe('buildCspHeaderValue', () => {
  it('serialises to a single-line header with directives separated by semicolons', () => {
    const v = buildCspHeaderValue({ livekitUrl: 'wss://voice.example.org' });
    expect(v).not.toContain('\n');
    expect(v).toContain("default-src 'self'");
    expect(v).toContain('wss://voice.example.org');
    expect(v.split('; ').length).toBe(Object.keys(buildCspDirectives({})).length);
  });

  it('emits no empty directive segments', () => {
    for (const segment of buildCspHeaderValue({}).split('; ')) {
      expect(segment.trim()).not.toBe('');
      expect(segment.split(' ').length).toBeGreaterThan(1);
    }
  });
});

describe('buildCspDirectives with federation switched off', () => {
  it('limits connect-src to this instance, blob:, data: and the video hosts of Bluesky posts', () => {
    const d = buildCspDirectives({ federationEnabled: false });
    expect(d['connect-src']).toEqual(["'self'", 'blob:', 'data:', 'https://video.bsky.app', 'https://video.cdn.bsky.app']);
  });

  it('no longer allows connections to arbitrary hosts or schemes', () => {
    const connect = buildCspDirectives({ federationEnabled: false })['connect-src']!;
    for (const wildcard of ['https:', 'http:', 'wss:', 'ws:', '*']) {
      expect(connect).not.toContain(wildcard);
    }
  });

  it('still lets the browser reach LiveKit, over both its WebSocket and its HTTPS probe', () => {
    const connect = buildCspDirectives({
      federationEnabled: false,
      livekitUrl: 'wss://chat.example.org/livekit',
    })['connect-src']!;
    expect(connect).toContain('wss://chat.example.org');
    expect(connect).toContain('https://chat.example.org');
  });

  it('lists the plain-HTTP twin of an unencrypted LAN LiveKit', () => {
    const connect = buildCspDirectives({
      federationEnabled: false,
      livekitUrl: 'ws://192.168.1.50:7880',
    })['connect-src']!;
    expect(connect).toContain('ws://192.168.1.50:7880');
    expect(connect).toContain('http://192.168.1.50:7880');
  });

  it('leaves every other directive exactly as it is with federation on', () => {
    const withoutConnect = (directives: ReturnType<typeof buildCspDirectives>) =>
      Object.fromEntries(Object.entries(directives).filter(([name]) => name !== 'connect-src'));
    const off = withoutConnect(buildCspDirectives({ federationEnabled: false }));
    const on = withoutConnect(buildCspDirectives({ federationEnabled: true }));
    expect(off).toEqual(on);
  });

  it('keeps the permissive policy when federation is on or unspecified', () => {
    for (const federationEnabled of [true, undefined]) {
      const connect = buildCspDirectives({ federationEnabled })['connect-src']!;
      for (const scheme of ['https:', 'http:', 'wss:', 'ws:']) expect(connect).toContain(scheme);
    }
  });
});
