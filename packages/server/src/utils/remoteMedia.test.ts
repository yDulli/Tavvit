import { describe, expect, it, vi } from 'vitest';

vi.mock('./federationAuth.js', async (importActual) => {
  const actual = await importActual<typeof import('./federationAuth.js')>();
  return { ...actual, getOurOrigin: () => 'https://local.test' };
});

const { instanceOrigin, isStickerFrom, isUploadOn, mediaOriginsFor, shownAccountPicture, shownPicture } = await import('./remoteMedia.js');

const OURS = 'https://local.test';
const HASH = 'a'.repeat(64);
const sticker = (origin: string) => `sticker:${origin}/api/stickers/assets/${HASH}.webp`;

describe('the origins a person\'s pictures and stickers may come from', () => {
  it('are this instance alone for an account that lives here', () => {
    expect(mediaOriginsFor(null)).toEqual([OURS]);
    expect(mediaOriginsFor(OURS)).toEqual([OURS]);
  });

  it('add the home of an account that lives elsewhere, however its home is written', () => {
    expect(mediaOriginsFor('home.test')).toEqual([OURS, 'https://home.test']);
    expect(mediaOriginsFor('https://Home.test/')).toEqual([OURS, 'https://home.test']);
    expect(instanceOrigin('not a host at all')).toBeNull();
  });
});

describe('an upload named by its address', () => {
  it('is one on an allowed origin, at the upload path', () => {
    expect(isUploadOn(`${OURS}/api/uploads/a.png`, [OURS])).toBe(true);
    expect(isUploadOn('https://home.test/api/uploads/b.webp', [OURS, 'https://home.test'])).toBe(true);
  });

  it('is nothing on any other server, by another scheme, or with anything added to it', () => {
    for (const address of [
      'https://tracker.example/api/uploads/a.png',
      'http://local.test/api/uploads/a.png',
      `${OURS}/api/uploads/a.png?victim=1`,
      `${OURS}/api/uploads/a.png#x`,
      'https://user:pass@local.test/api/uploads/a.png',
      `${OURS}/api/stickers/assets/${HASH}.webp`,
      `${OURS}/api/uploads/../admin`,
      `${OURS}/api/uploads/sub/a.png`,
      'javascript:alert(1)',
    ]) {
      expect(isUploadOn(address, [OURS]), address).toBe(false);
    }
  });
});

describe('a picture field as others see it', () => {
  it('keeps a file here, by name or by path', () => {
    expect(shownPicture('a.png', [OURS])).toBe('a.png');
    expect(shownPicture('/api/uploads/a.png', [OURS])).toBe('/api/uploads/a.png');
    expect(shownPicture('/uploads/group-icon.png', [OURS])).toBe('/uploads/group-icon.png');
    expect(shownPicture(`${OURS}/api/uploads/a.png`, [OURS])).toBe(`${OURS}/api/uploads/a.png`);
  });

  it('shows nothing for an address another server would be asked for', () => {
    for (const value of [
      'https://tracker.example/pixel.png',
      '//tracker.example/pixel.png',
      '/\\tracker.example/pixel.png',
      'HTTPS://tracker.example/pixel.png',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'javascript:alert(1)',
      '',
    ]) {
      expect(shownPicture(value, [OURS]), value).toBeNull();
    }
    expect(shownPicture(null, [OURS])).toBeNull();
  });

  it('of an account keeps a file at its home, and nothing anywhere else', () => {
    expect(shownAccountPicture('https://home.test/api/uploads/me.png', 'home.test')).toBe('https://home.test/api/uploads/me.png');
    expect(shownAccountPicture('https://home.test/api/uploads/me.png', null)).toBeNull();
    expect(shownAccountPicture('https://tracker.example/me.png', 'home.test')).toBeNull();
    expect(shownAccountPicture('me.png', 'home.test')).toBe('me.png');
  });
});

describe('a sticker in a message or a reaction', () => {
  it('is fine when it is not a sticker at all', () => {
    expect(isStickerFrom('hello', [OURS])).toBe(true);
    expect(isStickerFrom('sticker:not a token', [OURS])).toBe(true);
  });

  it('is fine from an allowed origin, and from nowhere else', () => {
    expect(isStickerFrom(sticker(OURS), [OURS])).toBe(true);
    expect(isStickerFrom(sticker('https://home.test'), [OURS, 'https://home.test'])).toBe(true);
    expect(isStickerFrom(sticker('https://tracker.example'), [OURS])).toBe(false);
    expect(isStickerFrom(sticker('http://local.test'), [OURS])).toBe(false);
    expect(isStickerFrom(sticker('http://127.0.0.1:4999'), [OURS])).toBe(false);
  });
});
