import { describe, expect, it } from 'vitest';
import { codeToNumeric, shortcutTypesText } from './keybindKeys';
import { BINDABLE_ACTIONS } from '../stores/keybindStore';

const keys = (...codes: string[]) => codes.map(codeToNumeric);

describe('a desktop shortcut that types text on its own', () => {
  it('is a letter, a digit, punctuation, the number pad, space, enter, tab or backspace, alone or with Shift', () => {
    for (const codes of [['KeyV'], ['Digit1'], ['Numpad5'], ['NumpadAdd'], ['Space'], ['Enter'], ['Tab'], ['Backspace'], ['ShiftLeft', 'KeyA'],
      ['KeyA', 'KeyB'], ['Backquote'], ['Semicolon'], ['ShiftLeft', 'Quote'], ['ShiftLeft']]) {
      expect(shortcutTypesText(keys(...codes)), codes.join('+')).toBe(true);
    }
  });

  it('is one with Alt, which types a character with a key on many keyboards', () => {
    for (const codes of [['AltLeft', 'Digit1'], ['AltRight', 'KeyQ'], ['ControlLeft', 'AltRight', 'KeyQ'], ['ControlLeft', 'AltLeft', 'KeyQ']]) {
      expect(shortcutTypesText(keys(...codes)), codes.join('+')).toBe(true);
    }
  });

  it('is not one with Ctrl or the system key, a key that types nothing, a modifier alone, or a mouse button', () => {
    for (const codes of [['ControlLeft', 'KeyM'], ['MetaLeft', 'KeyA'], ['ControlLeft', 'ShiftLeft', 'Semicolon'], ['F13'], ['F5'], ['CapsLock'],
      ['AltLeft'], ['ShiftLeft', 'F5'], ['AltLeft', 'F13']]) {
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
    expect(BINDABLE_ACTIONS.map((action) => action.id)).toEqual(['toggleMute', 'toggleDeafen', 'pushToTalk', 'toggleCamera', 'toggleScreenShare', 'disconnect', 'toggleStreamerMode']);
  });
});
