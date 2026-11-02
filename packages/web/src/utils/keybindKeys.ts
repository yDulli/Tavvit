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
 * Keys that type text, and Shift, which only makes capitals. The desktop app's global hook hears
 * every key pressed anywhere on the computer, so it refuses a shortcut made of these alone: with one
 * per letter, the page would hear everything typed in other programs (desktop/src/keybindPolicy.ts
 * holds the same list and is what decides).
 */
const TYPING_CODES = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  'Space', 'Enter', 'Backspace', 'Tab',
  'ShiftLeft', 'ShiftRight',
];
const TYPING_KEYS: ReadonlySet<number> = new Set(TYPING_CODES.map(codeToNumeric));

/** Whether a shortcut of these keys types text on its own, so the desktop app does not listen for it. */
export function shortcutTypesText(keys: readonly number[], mouseButton?: number): boolean {
  return mouseButton === undefined && keys.length > 0 && keys.every((key) => TYPING_KEYS.has(key));
}
