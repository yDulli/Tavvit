import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PRODUCTION_URL, removeLegacyInstanceFile, resolveAppUrl } from './appUrl';

describe('resolveAppUrl', () => {
  it('opens the production server in an installed build, whatever the environment says', () => {
    expect(resolveAppUrl({ isPackaged: true, devUrl: undefined })).toBe(PRODUCTION_URL);
    expect(resolveAppUrl({ isPackaged: true, devUrl: 'http://localhost:5173' })).toBe(PRODUCTION_URL);
  });

  it('lets an unpackaged build point at a development server', () => {
    expect(resolveAppUrl({ isPackaged: false, devUrl: 'http://localhost:5173' })).toBe('http://localhost:5173/');
  });

  it('falls back to production for a missing or unusable development address', () => {
    expect(resolveAppUrl({ isPackaged: false, devUrl: undefined })).toBe(PRODUCTION_URL);
    expect(resolveAppUrl({ isPackaged: false, devUrl: 'not a url' })).toBe(PRODUCTION_URL);
    expect(resolveAppUrl({ isPackaged: false, devUrl: 'file:///etc/passwd' })).toBe(PRODUCTION_URL);
  });

  it('is an https address', () => {
    expect(new URL(PRODUCTION_URL).protocol).toBe('https:');
  });
});

describe('removeLegacyInstanceFile', () => {
  it('deletes a server address saved by an older build, and tolerates its absence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-appurl-'));
    const file = path.join(dir, 'instance-url.json');
    fs.writeFileSync(file, JSON.stringify({ url: 'http://192.168.1.4:3000' }));
    removeLegacyInstanceFile(dir);
    expect(fs.existsSync(file)).toBe(false);
    expect(() => removeLegacyInstanceFile(dir)).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
