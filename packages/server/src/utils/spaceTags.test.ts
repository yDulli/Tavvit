import { describe, expect, it } from 'vitest';
import { checkSpaceTag, parseStoredWornSpaceTag, spaceTagOf, wornSpaceTagOf } from '@backspace/shared/src/spaceTags.js';
import {
  DEFAULT_VOICE_OVERLAY_OPTIONS,
  voiceOverlayOptionsOf,
  voiceOverlayPath,
  voiceOverlayQuery,
  voiceOverlaySecretOf,
} from '@backspace/shared/src/voiceOverlay.js';

// The rules of space tags (shared/src/spaceTags.ts) and of overlay addresses
// (shared/src/voiceOverlay.ts), as the server checks them and every client reads them again.

const tag = (text: string, over: Record<string, unknown> = {}) => ({ text, glyph: 'moon', color: 'lavender', ...over });

describe('checkSpaceTag', () => {
  it('takes two to four letters or digits, trimmed and composed', () => {
    expect(checkSpaceTag(tag('  NSFT '))).toEqual({ ok: true, tag: { text: 'NSFT', glyph: 'moon', color: 'lavender' } });
    expect(checkSpaceTag(tag('42'))).toMatchObject({ ok: true });
    expect(checkSpaceTag(tag('游戏'))).toMatchObject({ ok: true });
    expect(checkSpaceTag(tag('Ночь'))).toMatchObject({ ok: true });
  });

  it.each([
    ['N', 'length'],
    ['NIGHT', 'length'],
    ['N-S', 'characters'],
    ['N S', 'characters'],
    ['NS​', 'characters'],
    // Latin with a Cyrillic letter that looks the same: it could pass for another word.
    ['MОD', 'characters'],
    ['mod', 'reserved'],
    ['Team', 'reserved'],
  ])('refuses %j (%s)', (text, reason) => {
    expect(checkSpaceTag(tag(text))).toEqual({ ok: false, reason });
  });

  it('refuses a symbol or colour it does not know', () => {
    expect(checkSpaceTag(tag('NSFT', { glyph: 'unicorn' }))).toEqual({ ok: false, reason: 'glyph' });
    expect(checkSpaceTag(tag('NSFT', { color: 'violet' }))).toEqual({ ok: false, reason: 'color' });
    expect(checkSpaceTag(null)).toEqual({ ok: false, reason: 'length' });
  });

  it('reads a worn tag only with a space id and a tag that passes', () => {
    expect(wornSpaceTagOf({ ...tag('NSFT'), spaceId: '376044515219042304' })).toMatchObject({ text: 'NSFT', spaceId: '376044515219042304' });
    expect(wornSpaceTagOf({ ...tag('NSFT'), spaceId: '../x' })).toBeNull();
    expect(wornSpaceTagOf(tag('NSFT'))).toBeNull();
    expect(parseStoredWornSpaceTag('not json')).toBeNull();
    expect(spaceTagOf(tag('MOD'))).toBeNull();
  });
});

describe('overlay addresses', () => {
  it('finds the secret only in an overlay path', () => {
    const secret = 'A'.repeat(43);
    expect(voiceOverlaySecretOf(voiceOverlayPath(secret))).toBe(secret);
    expect(voiceOverlaySecretOf(`/overlay/voice/${secret}/`)).toBe(secret);
    expect(voiceOverlaySecretOf('/overlay/voice/short')).toBeNull();
    expect(voiceOverlaySecretOf('/channels/@me')).toBeNull();
  });

  it('carries only the options that differ from the defaults, and reads anything else as them', () => {
    expect(voiceOverlayQuery(DEFAULT_VOICE_OVERLAY_OPTIONS)).toBe('');
    const query = voiceOverlayQuery({ layout: 'row', show: 'speaking', names: false });
    expect(voiceOverlayOptionsOf(query)).toEqual({ layout: 'row', show: 'speaking', names: false });
    expect(voiceOverlayOptionsOf('?layout=grid&show=all')).toEqual(DEFAULT_VOICE_OVERLAY_OPTIONS);
  });
});
