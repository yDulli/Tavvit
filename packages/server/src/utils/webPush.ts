import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type ECDH,
} from 'node:crypto';

/**
 * Web Push with what Node already has: the message encryption of RFC 8291 (aes128gcm,
 * RFC 8188) and the sender identification of RFC 8292 (VAPID). Pure apart from `sendWebPush`.
 * A push service sees the size, the time and the device's address, never the words.
 */

const P256 = 'prime256v1';
const RECORD_SIZE = 4096;

export interface VapidKeys {
  /** The public point, uncompressed, base64url: what a browser subscribes with. */
  publicKey: string;
  /** The private scalar, base64url. */
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH(P256);
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: ecdh.getPrivateKey().toString('base64url') };
}

/** The value of the Authorization header for one push service, good for 12 hours. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now: number = Date.now()): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  const point = Buffer.from(keys.publicKey, 'base64url');
  const privateKey = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33, 65).toString('base64url'),
    },
  });
  const signature = sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${keys.publicKey}`;
}

const hkdf = (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Buffer =>
  Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

/**
 * The body of a push request: one record for the browser that gave `p256dh` and `auth`.
 * `fixed` is for the RFC's test vector; a real message gets fresh ones each time, and
 * reusing them would give the words away.
 */
export function encryptPushPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  fixed?: { sender: ECDH; salt: Uint8Array },
): Buffer {
  const receiverKey = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  const sender = fixed?.sender ?? createECDH(P256);
  if (!fixed) sender.generateKeys();
  const senderKey = sender.getPublicKey();
  const salt = fixed?.salt ?? randomBytes(16);

  const sharedSecret = sender.computeSecret(receiverKey);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverKey, senderKey]);
  const inputKey = hkdf(authSecret, sharedSecret, keyInfo, 32);
  const contentKey = hkdf(salt, inputKey, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, inputKey, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.update(Buffer.from([2])), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, recordSize, Buffer.from([senderKey.length]), senderKey, body]);
}

export interface WebPushDevice {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushOptions {
  /** How long the service keeps trying, in seconds. */
  ttl: number;
  urgency: 'normal' | 'high';
}

/** `gone`: the device stopped wanting this; forget it. `failed`: the service had a problem, nothing more. */
export type WebPushOutcome = 'sent' | 'gone' | 'failed';

/** One message to one device. Never follows a redirect: the address was checked, where it points to was not. */
export async function sendWebPush(
  device: WebPushDevice,
  payload: unknown,
  keys: VapidKeys,
  subject: string,
  options: WebPushOptions,
): Promise<WebPushOutcome> {
  try {
    const response = await fetch(device.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: vapidAuthorization(device.endpoint, keys, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttl),
        Urgency: options.urgency,
      },
      body: encryptPushPayload(Buffer.from(JSON.stringify(payload)), device.p256dh, device.auth),
    });
    if (response.ok) return 'sent';
    return response.status === 404 || response.status === 410 ? 'gone' : 'failed';
  } catch {
    return 'failed';
  }
}
