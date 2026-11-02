import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Whether this device loads images, audio and video from other servers
 * (docs/systems/legal.md, "Content from other servers"). A server that delivers
 * a file sees the address of whoever fetches it, so nothing is fetched before
 * the person agrees: one host at a time for this session, or always. "Always"
 * is their consent, kept on this device and withdrawn in the privacy settings.
 */
interface ExternalMediaState {
  alwaysAllow: boolean;
  /** Hosts allowed one at a time, until the app is closed. */
  allowedHosts: readonly string[];
  setAlwaysAllow: (always: boolean) => void;
  allowHost: (host: string) => void;
}

export const useExternalMediaStore = create<ExternalMediaState>()(
  persist(
    (set) => ({
      alwaysAllow: false,
      allowedHosts: [],
      setAlwaysAllow: (alwaysAllow) => set(alwaysAllow ? { alwaysAllow } : { alwaysAllow, allowedHosts: [] }),
      allowHost: (host) => set((state) => (state.allowedHosts.includes(host) ? state : { allowedHosts: [...state.allowedHosts, host] })),
    }),
    {
      name: 'tavvit-external-media',
      partialize: (state) => ({ alwaysAllow: state.alwaysAllow }),
    },
  ),
);

/** The host of an address on another server; null for this server's own files and unusable addresses. */
export function externalHostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin) return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}
