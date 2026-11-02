import { describe, expect, it } from 'vitest';
import { base32Encode, generateTotpSecret, hotp, matchTotp, otpauthUrl, timeStep } from './totp.js';

// The published test vectors. Passing them says this speaks the same TOTP as every authenticator app.

describe('HOTP (RFC 4226, appendix D)', () => {
  const secret = Buffer.from('12345678901234567890');
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

  it.each(expected.map((code, counter) => [counter, code] as const))('counter %i is %s', (counter, code) => {
    expect(hotp(secret, counter)).toBe(code);
  });
});

describe('TOTP (RFC 6238, appendix B)', () => {
  const sha1 = Buffer.from('12345678901234567890');
  const sha256 = Buffer.from('12345678901234567890123456789012');
  const sha512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234');
  const vectors: Array<[number, string, string, string]> = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];

  it.each(vectors)('at %i seconds', (seconds, one, two, five) => {
    const step = timeStep(seconds * 1000);
    expect(hotp(sha1, step, 8, 'sha1')).toBe(one);
    expect(hotp(sha256, step, 8, 'sha256')).toBe(two);
    expect(hotp(sha512, step, 8, 'sha512')).toBe(five);
  });
});

describe('base32 (RFC 4648)', () => {
  it.each([['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']])('%s', (text, encoded) => {
    expect(base32Encode(Buffer.from(text))).toBe(encoded);
  });
});

describe('checking a code', () => {
  const secret = generateTotpSecret();
  const now = 1_800_000_000_000;
  const step = timeStep(now);

  it('accepts the current step and one either way, for a clock a little off', () => {
    expect(matchTotp(secret, hotp(secret, step), now, null)).toBe(step);
    expect(matchTotp(secret, hotp(secret, step - 1), now, null)).toBe(step - 1);
    expect(matchTotp(secret, hotp(secret, step + 1), now, null)).toBe(step + 1);
  });

  it('refuses anything further away', () => {
    expect(matchTotp(secret, hotp(secret, step - 2), now, null)).toBeNull();
    expect(matchTotp(secret, hotp(secret, step + 2), now, null)).toBeNull();
    expect(matchTotp(secret, hotp(secret, step - 100), now, null)).toBeNull();
  });

  it('refuses a step already used, and any before it', () => {
    expect(matchTotp(secret, hotp(secret, step), now, step)).toBeNull();
    expect(matchTotp(secret, hotp(secret, step - 1), now, step)).toBeNull();
    expect(matchTotp(secret, hotp(secret, step + 1), now, step)).toBe(step + 1);
  });

  it('refuses what is not a code', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', '１２３４５６']) expect(matchTotp(secret, bad, now, null)).toBeNull();
  });

  it('refuses another secret\'s code', () => {
    const other = generateTotpSecret();
    expect(matchTotp(secret, hotp(other, step), now, null)).toBeNull();
  });
});

describe('the address an app reads', () => {
  it('names the issuer, the account and the standard parameters', () => {
    const secret = Buffer.from('12345678901234567890');
    const url = otpauthUrl({ issuer: 'My Server', account: 'alice', secret });
    expect(url.startsWith('otpauth://totp/My%20Server:alice?')).toBe(true);
    const query = new URL(url).searchParams;
    expect(query.get('secret')).toBe(base32Encode(secret));
    expect(query.get('issuer')).toBe('My Server');
    expect(query.get('algorithm')).toBe('SHA1');
    expect(query.get('digits')).toBe('6');
    expect(query.get('period')).toBe('30');
  });

  it('gives every secret twenty random bytes', () => {
    expect(generateTotpSecret()).toHaveLength(20);
    expect(generateTotpSecret().equals(generateTotpSecret())).toBe(false);
  });
});
