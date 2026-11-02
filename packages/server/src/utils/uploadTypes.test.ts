import { describe, expect, it } from 'vitest';
import { mimetypeFromFilename, relayedMimetype, servedUploadType } from './uploadTypes.js';

describe('a stored file is served', () => {
  it('in the page only as a picture, a video or a sound', () => {
    expect(servedUploadType('image/png')).toEqual({ type: 'image/png', inline: true });
    expect(servedUploadType('video/mp4')).toEqual({ type: 'video/mp4', inline: true });
    expect(servedUploadType('application/pdf')).toEqual({ type: 'application/pdf', inline: false });
  });

  it('never as a document in the page, whatever was stored for it', () => {
    for (const stored of ['image/svg+xml', 'image/svg+xml; charset=utf-8', 'IMAGE/SVG+XML', 'text/html', 'application/xhtml+xml', 'text/xml', '']) {
      const served = servedUploadType(stored);
      expect(served.inline, stored).toBe(false);
      expect(served.type, stored).not.toMatch(/html|text\/xml/);
    }
    // The first of a list is what counts, and it is only what it is.
    expect(servedUploadType('image/png,text/html')).toEqual({ type: 'image/png', inline: true });
  });
});

describe('the type of a file a peer relays', () => {
  it('is the peer\'s word only for a type this server knows, else that of the file\'s name', () => {
    expect(relayedMimetype('video/mp4', 'clip')).toBe('video/mp4');
    expect(relayedMimetype('text/html', 'page.html')).toBe('application/octet-stream');
    expect(relayedMimetype('image/png; charset=x', 'a.png')).toBe('image/png');
    expect(relayedMimetype(undefined, 'a.webm')).toBe(mimetypeFromFilename('a.webm'));
  });
});
