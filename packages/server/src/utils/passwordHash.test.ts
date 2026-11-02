import { afterEach, describe, it, expect, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { hashPassword, passwordNeedsRehash, verifyPassword } from './passwordHash.js';

describe('password hashes', () => {
  const nodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
    vi.resetModules();
  });

  it('are Argon2id, each with its own salt, and verify', async () => {
    const first = await hashPassword('correct horse');
    const second = await hashPassword('correct horse');
    expect(first.startsWith('$argon2id$v=19$')).toBe(true);
    expect(first).not.toBe(second);
    await expect(verifyPassword('correct horse', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong horse', first)).resolves.toBe(false);
  });

  it('take the whole password into account, unlike bcrypt, which stops at 72 bytes', async () => {
    const long = 'x'.repeat(80);
    const hash = await hashPassword(long);
    await expect(verifyPassword(long, hash)).resolves.toBe(true);
    await expect(verifyPassword(`${long}y`, hash)).resolves.toBe(false);
  });

  it('are strong outside the test suite, and carry their settings with them', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { config } = await import('../config.js');
    expect(config.passwordArgon2).toEqual({ memoryKiB: 65_536, passes: 3 });
    process.env.NODE_ENV = nodeEnv;
    vi.resetModules();
    const strong = await new Promise<string>((resolve, reject) => {
      import('node:crypto').then(({ default: crypto }) => {
        const salt = crypto.randomBytes(16);
        (crypto as unknown as { argon2: (a: string, p: object, c: (e: Error | null, k: Buffer) => void) => void }).argon2('argon2id', {
          message: 'correct horse', nonce: salt, parallelism: 1, tagLength: 32, memory: 65_536, passes: 3,
        }, (error, key) => {
          if (error) reject(error);
          else resolve(`$argon2id$v=19$m=65536,t=3,p=1$${salt.toString('base64').replace(/=+$/, '')}$${key.toString('base64').replace(/=+$/, '')}`);
        });
      }, reject);
    });
    await expect(verifyPassword('correct horse', strong)).resolves.toBe(true);
  });

  it('from before still open the account, until the next login replaces them', async () => {
    const old = await bcrypt.hash('correct horse', 4);
    await expect(verifyPassword('correct horse', old)).resolves.toBe(true);
    await expect(verifyPassword('wrong horse', old)).resolves.toBe(false);
    expect(passwordNeedsRehash(old)).toBe(true);
    expect(passwordNeedsRehash(await hashPassword('correct horse'))).toBe(false);
  });

  it('with other settings than this server uses now are replaced too', () => {
    expect(passwordNeedsRehash('$argon2id$v=19$m=1024,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).toBe(true);
  });

  it('that are not hashes open nothing: the marker on a replicated row, a deleted account', async () => {
    for (const stored of ['!federation-replicated', 'x', '', 'a'.repeat(64), '$argon2id$garbage']) {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    }
  });

  it('that ask for more than a server should give open nothing, and cost nothing', async () => {
    await expect(verifyPassword('x', '$argon2id$v=19$m=99999999,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).resolves.toBe(false);
  });
});
