/**
 * The number a keybind stores for a key: a djb2 hash of its `KeyboardEvent.code`. The desktop app
 * computes the same (desktop/src/keybindManager.ts), and so does `useKeybinds`.
 */
export function codeToNumeric(code: string): number {
  let hash = 5381;
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) + hash + code.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // ensure unsigned
}

/**
 * The desktop app's global hook hears every key pressed anywhere on the computer, so it takes only a
 * shortcut that cannot type: with one per character, the page would hear everything typed in other
 * programs (desktop/src/keybindPolicy.ts holds the same rule and is what decides). Keys that type
 * nothing whatever is held with them: function keys, locks and moving about. Every other key types
 * on some keyboard, punctuation and the number pad too.
 */
const SILENT_KEYS: ReadonlySet<number> = new Set([
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  'Escape', 'CapsLock', 'NumLock', 'ScrollLock', 'PrintScreen', 'Pause', 'ContextMenu',
  'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
].map(codeToNumeric));
/** Ctrl and the system key: with one held, a key gives a command. */
const COMMAND_KEYS: ReadonlySet<number> = new Set(['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight'].map(codeToNumeric));
/** Alt with a key types a character on many keyboards: Option on a Mac, AltGr, and Ctrl with Alt. */
const ALT_KEYS: ReadonlySet<number> = new Set(['AltLeft', 'AltRight'].map(codeToNumeric));
/** Shift only makes capitals. */
const SHIFT_KEYS: ReadonlySet<number> = new Set(['ShiftLeft', 'ShiftRight'].map(codeToNumeric));

/** Whether a shortcut of these keys can type text, so the desktop app does not listen for it. */
export function shortcutTypesText(keys: readonly number[], mouseButton?: number): boolean {
  if (mouseButton !== undefined || keys.length === 0) return false;
  const others = keys.filter((key) => !COMMAND_KEYS.has(key) && !ALT_KEYS.has(key) && !SHIFT_KEYS.has(key));
  if (others.every((key) => SILENT_KEYS.has(key))) return others.length === 0 && keys.every((key) => SHIFT_KEYS.has(key));
  return !keys.some((key) => COMMAND_KEYS.has(key)) || keys.some((key) => ALT_KEYS.has(key));
}
