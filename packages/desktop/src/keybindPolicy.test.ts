import { describe, expect, it } from 'vitest';
import { acceptedKeybinds, typesText } from './keybindPolicy';

/** The hash the web client stores for a DOM code (KeybindsPanel's codeToNumeric). */
function hashOf(code: string): number {
  let hash = 5381;
  for (let i = 0; i < code.length; i++) hash = ((hash << 5) + hash + code.charCodeAt(i)) | 0;
  return hash >>> 0;
}

const KNOWN = ['KeyA', 'KeyB', 'KeyM', 'KeyV', 'Digit1', 'Numpad5', 'Space', 'Enter', 'Tab', 'Backspace', 'ShiftLeft',
  'ControlLeft', 'AltLeft', 'MetaLeft', 'F13', 'CapsLock', 'Backquote', 'Period'];
const byHash = new Map(KNOWN.map((code) => [hashOf(code), code]));
const codeOf = (hash: number) => byHash.get(hash);
const bind = (actionId: string, codes: string[], mouseButton?: number) =>
  ({ actionId, keys: codes.map(hashOf), ...(mouseButton !== undefined ? { mouseButton } : {}) });
const accepted = (...binds: unknown[]) => acceptedKeybinds(binds, codeOf).map((kb) => kb.actionId);

describe('a global shortcut the page asks for', () => {
  it('is taken when it cannot type text: with Ctrl, Alt or the system key, a function key, a lock key, punctuation or a mouse button', () => {
    expect(accepted(bind('toggleMute', ['ControlLeft', 'KeyM']))).toEqual(['toggleMute']);
    expect(accepted(bind('toggleDeafen', ['AltLeft', 'Digit1']))).toEqual(['toggleDeafen']);
    expect(accepted(bind('pushToTalk', ['Backquote']))).toEqual(['pushToTalk']);
    expect(accepted(bind('pushToTalk', ['F13']))).toEqual(['pushToTalk']);
    expect(accepted(bind('pushToTalk', ['CapsLock']))).toEqual(['pushToTalk']);
    expect(accepted(bind('pushToTalk', [], 4))).toEqual(['pushToTalk']);
    expect(accepted(bind('pushToTalk', ['KeyV'], 4))).toEqual(['pushToTalk']);
  });

  it('is refused when it types text: a letter, a digit, space, enter, tab or backspace, alone or with Shift (the keylogger case)', () => {
    for (const codes of [['KeyV'], ['KeyA', 'KeyB'], ['ShiftLeft', 'KeyA'], ['Digit1'], ['Numpad5'], ['Space'], ['Enter'], ['Tab'], ['Backspace']]) {
      expect(accepted(bind('pushToTalk', codes)), codes.join('+')).toEqual([]);
    }
    expect(typesText(['KeyA'])).toBe(true);
    expect(typesText(['MetaLeft', 'KeyA'])).toBe(false);
  });

  it('is refused for an action the app does not have, and only the first per action counts', () => {
    // Every action the settings offer is taken (web/src/stores/keybindStore.ts).
    expect(accepted(...['toggleMute', 'toggleDeafen', 'pushToTalk', 'toggleCamera', 'toggleScreenShare', 'disconnect']
      .map((id, i) => bind(id, [['F13'], ['CapsLock'], ['Backquote'], ['Period'], ['ControlLeft', 'KeyA'], ['AltLeft', 'KeyB']][i]!))))
      .toEqual(['toggleMute', 'toggleDeafen', 'pushToTalk', 'toggleCamera', 'toggleScreenShare', 'disconnect']);
    expect(accepted(bind('keylog-a', ['ControlLeft', 'KeyA']))).toEqual([]);
    expect(acceptedKeybinds([bind('toggleMute', ['F13']), bind('toggleMute', ['ControlLeft', 'KeyM'])], codeOf))
      .toEqual([{ actionId: 'toggleMute', keys: [hashOf('F13')] }]);
  });

  it('is refused for more keys than a hand holds, a key the hook does not know, a clicking mouse button, or nothing at all', () => {
    expect(accepted(bind('toggleMute', ['ControlLeft', 'AltLeft', 'MetaLeft', 'ShiftLeft', 'KeyM']))).toEqual([]);
    expect(accepted({ actionId: 'toggleMute', keys: [12345] })).toEqual([]);
    expect(accepted(bind('pushToTalk', [], 1))).toEqual([]);
    expect(accepted(bind('pushToTalk', []))).toEqual([]);
    expect(acceptedKeybinds('not a list', codeOf)).toEqual([]);
    expect(acceptedKeybinds([null, 42, { actionId: 'toggleMute', keys: 'F13' }], codeOf)).toEqual([]);
  });
});
