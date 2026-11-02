import { hasVoiceSession, useVoiceStore } from '../stores/voiceStore';

let unsubscribe: (() => void) | null = null;

/**
 * Tells the desktop app whether a voice session is open (docs/systems/
 * desktop.md, "Auto-Update"): a downloaded update installs and restarts the
 * app by itself, and never while someone is in a call. A shell without the
 * bridge, or a browser, is left alone.
 */
export function initCallStateBridge(): void {
  if (unsubscribe) return;
  const report = window.backspace?.setCallActive;
  if (!report) return;
  let last = hasVoiceSession(useVoiceStore.getState());
  report(last);
  unsubscribe = useVoiceStore.subscribe((state) => {
    const active = hasVoiceSession(state);
    if (active === last) return;
    last = active;
    report(active);
  });
}

export function teardownCallStateBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
}
