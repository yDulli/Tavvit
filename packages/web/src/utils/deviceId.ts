const DEVICE_ID_KEY = 'tavvit-device-id';

/**
 * A random id this browser keeps, sent when signing in so that the server can tell a device
 * it knows from a new one and warn about the latter. It identifies nothing but this browser
 * to this account, and the server keeps only a hash of the two together.
 */
export function deviceId(): string | undefined {
  try {
    const known = localStorage.getItem(DEVICE_ID_KEY);
    if (known) return known;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Without storage every sign-in looks new; nothing else depends on it.
    return undefined;
  }
}
