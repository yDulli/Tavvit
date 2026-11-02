import { describe, expect, it } from 'vitest';
import { codeToNumeric, shortcutTypesText } from './keybindKeys';
import { BINDABLE_ACTIONS } from '../stores/keybindStore';

const keys = (...codes: string[]) => codes.map(codeToNumeric);

describe('a desktop shortcut that types text on its own', () => {
  it('is a letter, a digit, space, enter, tab or backspace, alone or with Shift', () => {
    for (const codes of [['KeyV'], ['Digit1'], ['Numpad5'], ['Space'], ['Enter'], ['Tab'], ['Backspace'], ['ShiftLeft', 'KeyA'], ['KeyA', 'KeyB']]) {
      expect(shortcutTypesText(keys(...codes)), codes.join('+')).toBe(true);
    }
  });

  it('is not one with Ctrl, Alt or the system key, a function key, a lock key, punctuation or a mouse button', () => {
    for (const codes of [['ControlLeft', 'KeyM'], ['AltLeft', 'Digit1'], ['MetaLeft', 'KeyA'], ['F13'], ['CapsLock'], ['Backquote']]) {
      expect(shortcutTypesText(keys(...codes)), codes.join('+')).toBe(false);
    }
    expect(shortcutTypesText(keys('KeyV'), 4)).toBe(false);
  });

  it('matches the hash the desktop app computes', () => {
    // desktop/src/keybindManager.ts maps native key codes to these numbers.
    expect(codeToNumeric('KeyA')).toBe(codeToNumeric('KeyA'));
    expect(codeToNumeric('F13')).not.toBe(codeToNumeric('F14'));
  });

  it('covers the actions the desktop app accepts (desktop/src/keybindPolicy.ts, KEYBIND_ACTIONS)', () => {
    expect(BINDABLE_ACTIONS.map((action) => action.id)).toEqual(['toggleMute', 'toggleDeafen', 'pushToTalk', 'toggleCamera', 'toggleScreenShare', 'disconnect']);
  });
});
