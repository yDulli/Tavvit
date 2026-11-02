// What the page may register as a global shortcut. The hook (uiohook) hears every key pressed
// anywhere on the computer, and the page that registers shortcuts is remote code: the instance's
// web client. So the main process takes only what the settings can produce, and never a shortcut
// made of keys that type text on their own: a page holding one per letter would hear everything
// typed in every program, passwords included (docs/systems/desktop-security.md, "Global shortcuts").

/** The actions the web client binds (web/src/stores/keybindStore.ts, `BINDABLE_ACTIONS`). */
export const KEYBIND_ACTIONS = ['toggleMute', 'toggleDeafen', 'pushToTalk', 'toggleCamera', 'toggleScreenShare', 'disconnect'] as const;

/** More keys than anyone holds at once is not a shortcut. */
export const MAX_KEYBIND_KEYS = 4;

/** The extra mouse buttons the hook reports (it ignores 1 to 2, the buttons that click). */
const MOUSE_BUTTONS = new Set([3, 4, 5, 6, 7]);

/** Keys that type text: letters, digits, the number pad's digits, space, enter, backspace and tab. */
const TYPING_CODES: ReadonlySet<string> = new Set([
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  'Space', 'Enter', 'Backspace', 'Tab',
]);

/** Shift turns a letter into a capital: it is typing too, so it does not lift the rule. */
const SHIFT_CODES: ReadonlySet<string> = new Set(['ShiftLeft', 'ShiftRight']);

export interface KeybindConfig {
  actionId: string;
  keys: number[];
  mouseButton?: number;
}

/**
 * Whether a shortcut of these keys (by their DOM codes) types text when pressed: only typing keys
 * and Shift, and no mouse button. Such a shortcut is refused, so the hook never reports them.
 */
export function typesText(codes: readonly string[], mouseButton?: number): boolean {
  if (mouseButton !== undefined) return false;
  return codes.length > 0 && codes.every((code) => TYPING_CODES.has(code) || SHIFT_CODES.has(code));
}

/**
 * The shortcuts the page asked for that the hook may listen to: one per known action, at most
 * `MAX_KEYBIND_KEYS` known keys, an extra mouse button or none, and never one that types text.
 * `codeOf` names a key's DOM code from the hash the page stores; an unknown key refuses its
 * shortcut. Anything that is not such a list counts as no shortcuts.
 */
export function acceptedKeybinds(input: unknown, codeOf: (hash: number) => string | undefined): KeybindConfig[] {
  if (!Array.isArray(input)) return [];
  const accepted: KeybindConfig[] = [];
  for (const entry of input.slice(0, KEYBIND_ACTIONS.length * 2)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { actionId, keys, mouseButton } = entry as Record<string, unknown>;
    if (typeof actionId !== 'string' || !(KEYBIND_ACTIONS as readonly string[]).includes(actionId)) continue;
    if (accepted.some((kb) => kb.actionId === actionId)) continue;
    if (!Array.isArray(keys) || keys.length > MAX_KEYBIND_KEYS || !keys.every((k) => Number.isInteger(k))) continue;
    if (mouseButton !== undefined && !(Number.isInteger(mouseButton) && MOUSE_BUTTONS.has(mouseButton as number))) continue;
    const codes = (keys as number[]).map(codeOf);
    if (codes.some((code) => code === undefined)) continue;
    if (keys.length === 0 && mouseButton === undefined) continue;
    if (typesText(codes as string[], mouseButton as number | undefined)) continue;
    accepted.push({ actionId, keys: [...(keys as number[])], ...(mouseButton !== undefined ? { mouseButton: mouseButton as number } : {}) });
  }
  return accepted;
}
