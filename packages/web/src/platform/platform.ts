export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.backspace !== 'undefined';
}

export function isElectronMac(): boolean {
  return isElectron() && window.backspace?.platform === 'darwin';
}

export function getElectronAPI(): BackspaceElectronAPI | null {
  return window.backspace ?? null;
}

/** Game detection as the desktop app reports it (Settings → Games); declared with the bridge in electron.d.ts. */
export type GameDetection = GameDetectionState;
