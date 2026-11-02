import { describe, expect, it } from 'vitest';
import { storedUploadName } from './uploadNames.js';
import { uploadNameOf } from './profileImageRefs.js';
import { thumbFilename } from './thumbnail.js';
import { byteRange } from '../routes/uploads.js';

describe('the name a file is stored and served under', () => {
  it('cannot be counted from the clock: 128 random bits follow the snowflake', () => {
    const a = storedUploadName('375355738666467328', '.png');
    const b = storedUploadName('375355738666467328', '.png');
    expect(a).toMatch(/^375355738666467328-[0-9a-f]{32}\.png$/);
    expect(a).not.toBe(b);
  });

  it('is a name every picture field and the thumbnail rule still take', () => {
    const name = storedUploadName('375355738666467328', '.webp');
    expect(uploadNameOf(name)).toBe(name);
    expect(uploadNameOf(`/api/uploads/${name}`)).toBe(name);
    expect(thumbFilename(name)).toBe(`${name.slice(0, -'.webp'.length)}_thumb.webp`);
  });
});

describe('a Range header on a served file', () => {
  it('reads the one range a player asks for, clamped to the file', () => {
    expect(byteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(byteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(byteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('answers a range past the end as unsatisfiable', () => {
    expect(byteRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(byteRange('bytes=-0', 1000)).toBe('unsatisfiable');
  });

  it('ignores what is not a single byte range, so the whole file is sent instead of an error', () => {
    for (const header of ['bytes=abc', 'bytes=5-1', 'bytes=0-1,5-9', 'items=0-1', 'bytes=-', '']) {
      expect(byteRange(header, 1000), header).toBeNull();
    }
  });
});
