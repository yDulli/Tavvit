import { describe, expect, it } from 'vitest';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { isPushServiceAddress } from '@backspace/shared/src/push.js';
import { encryptPushPayload, generateVapidKeys, vapidAuthorization } from './webPush.js';

/** RFC 8291, section 5: the worked example, byte for byte. */
const VECTOR = {
  plaintext: 'When I grow up, I want to be a watermelon',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  receiverPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** What a browser does with the body. */
function decryptAsBrowser(body: Buffer, receiver: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20]!;
  const senderKey = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  const shared = receiver.computeSecret(senderKey);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), senderKey]);
  const inputKey = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
  const contentKey = Buffer.from(hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', inputKey, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString();
}

describe('encrypting a push message', () => {
  it('matches the worked example of RFC 8291', () => {
    const sender = createECDH('prime256v1');
    sender.setPrivateKey(Buffer.from(VECTOR.senderPrivate, 'base64url'));
    const body = encryptPushPayload(Buffer.from(VECTOR.plaintext), VECTOR.receiverPublic, VECTOR.auth, {
      sender,
      salt: Buffer.from(VECTOR.salt, 'base64url'),
    });
    expect(body.toString('base64url')).toBe(VECTOR.body);
  });

  it('can be read by the browser it is for, with fresh keys each time, and by nobody else', () => {
    const receiver = createECDH('prime256v1');
    receiver.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const words = JSON.stringify({ title: 'Mara', body: 'Grüße' });
    const once = encryptPushPayload(Buffer.from(words), receiver.getPublicKey().toString('base64url'), auth.toString('base64url'));
    const twice = encryptPushPayload(Buffer.from(words), receiver.getPublicKey().toString('base64url'), auth.toString('base64url'));

    expect(decryptAsBrowser(once, receiver, auth)).toBe(words);
    expect(once.equals(twice)).toBe(false);
    expect(once.toString('latin1')).not.toContain('Mara');

    const stranger = createECDH('prime256v1');
    stranger.generateKeys();
    expect(() => decryptAsBrowser(once, stranger, auth)).toThrow();
  });
});

describe('saying who sends', () => {
  it('signs for that one service, for a limited time, in a form it can check', () => {
    const keys = generateVapidKeys();
    const now = 1_800_000_000_000;
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://tavvit.example', now);
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match?.[2]).toBe(keys.publicKey);
    const [head, claims, signature] = match![1]!.split('.');
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://tavvit.example',
    });

    const point = Buffer.from(keys.publicKey, 'base64url');
    const publicKey = createPublicKey({
      format: 'jwk',
      key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33, 65).toString('base64url') },
    });
    expect(verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'))).toBe(true);
  });
});

describe('where a server may send', () => {
  it('takes the addresses of the push services', () => {
    for (const address of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://api.push.apple.com/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isPushServiceAddress(address), address).toBe(true);
    }
  });

  it('takes nothing else, whatever it looks like', () => {
    for (const address of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/abc',
      'https://evil.example/fcm.googleapis.com',
      'https://push.apple.com.evil.example/',
      'https://user:pass@fcm.googleapis.com/abc',
      'https://fcm.googleapis.com:8443/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/abc',
      'https://tavvit.example/api/admin',
      'file:///etc/passwd',
      'not an address',
      `https://fcm.googleapis.com/${'x'.repeat(2100)}`,
      7,
      null,
    ]) {
      expect(isPushServiceAddress(address), String(address)).toBe(false);
    }
  });
});
