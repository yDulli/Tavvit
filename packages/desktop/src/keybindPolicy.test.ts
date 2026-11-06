import { describe, expect, it } from 'vitest';
import { acceptedKeybinds, createKeybindSyncLimit, typesText } from './keybindPolicy';

/** The hash the web client stores for a DOM code (KeybindsPanel's codeToNumeric). */
function hashOf(code: string): number {
  let hash = 5381;
  for (let i = 0; i < code.length; i++) hash = ((hash << 5) + hash + code.charCodeAt(i)) | 0;
  return hash >>> 0;
}

const KNOWN = ['KeyA', 'KeyB', 'KeyM', 'KeyQ', 'KeyV', 'Digit1', 'Numpad5', 'NumpadAdd', 'NumpadDecimal', 'Space', 'Enter', 'Tab',
  'Backspace', 'ShiftLeft', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'F5', 'F13', 'CapsLock', 'Home',
  'Backquote', 'Period', 'Semicolon', 'Quote', 'BracketLeft', 'Minus', 'Comma', 'Equal', 'Slash', 'Backslash'];
const byHash = new Map(KNOWN.map((code) => [hashOf(code), code]));
const codeOf = (hash: number) => byHash.get(hash);
const bind = (actionId: string, codes: string[], mouseButton?: number) =>
  ({ actionId, keys: codes.map(hashOf), ...(mouseButton !== undefined ? { mouseButton } : {}) });
const accepted = (...binds: unknown[]) => acceptedKeybinds(binds, codeOf).map((kb) => kb.actionId);

describe('a global shortcut the page asks for', () => {
  it('is taken when it cannot type text: with Ctrl or the system key, a key that types nothing, a modifier, or a mouse button', () => {
    expect(accepted(bind('toggleMute', ['ControlLeft', 'KeyM']))).toEqual(['toggleMute']);
    expect(accepted(bind('toggleMute', ['ControlLeft', 'ShiftLeft', 'Semicolon']))).toEqual(['toggleMute']);
    expect(accepted(bind('toggleDeafen', ['MetaLeft', 'Digit1']))).toEqual(['toggleDeafen']);
    for (const codes of [['F13'], ['F5'], ['CapsLock'], ['Home'], ['AltLeft'], ['ControlLeft'], ['ShiftLeft', 'F5'], ['AltLeft', 'F13']]) {
      expect(accepted(bind('pushToTalk', codes)), codes.join('+')).toEqual(['pushToTalk']);
    }
    expect(accepted(bind('pushToTalk', [], 4))).toEqual(['pushToTalk']);
    expect(accepted(bind('pushToTalk', ['KeyV'], 4))).toEqual(['pushToTalk']);
  });

  it('is refused when it types text: a letter, a digit, space, enter, tab or backspace, alone or with Shift (the keylogger case)', () => {
    for (const codes of [['KeyV'], ['KeyA', 'KeyB'], ['ShiftLeft', 'KeyA'], ['Digit1'], ['Numpad5'], ['Space'], ['Enter'], ['Tab'], ['Backspace'], ['ShiftLeft']]) {
      expect(accepted(bind('pushToTalk', codes)), codes.join('+')).toEqual([]);
    }
    expect(typesText(['KeyA'])).toBe(true);
    expect(typesText(['MetaLeft', 'KeyA'])).toBe(false);
  });

  it('is refused for punctuation and the number pad alone: ö, ä, ü and ß on a German keyboard, m on a French one', () => {
    for (const code of ['Backquote', 'Period', 'Semicolon', 'Quote', 'BracketLeft', 'Minus', 'Comma', 'Equal', 'Slash', 'Backslash', 'NumpadAdd', 'NumpadDecimal']) {
      expect(accepted(bind('pushToTalk', [code])), code).toEqual([]);
      expect(accepted(bind('pushToTalk', ['ShiftLeft', code])), `Shift+${code}`).toEqual([]);
    }
  });

  it('is refused with Alt, which types a character with a key on many keyboards: AltGr, Ctrl with Alt, and Option', () => {
    for (const codes of [['AltRight', 'KeyQ'], ['ControlLeft', 'AltRight', 'KeyQ'], ['ControlLeft', 'AltLeft', 'KeyQ'], ['AltLeft', 'Digit1'], ['AltLeft', 'KeyB']]) {
      expect(accepted(bind('pushToTalk', codes)), codes.join('+')).toEqual([]);
    }
  });

  it('is refused for an action the app does not have, and only the first per action counts', () => {
    // Every action the settings offer is taken (web/src/stores/keybindStore.ts).
    expect(accepted(...['toggleMute', 'toggleDeafen', 'pushToTalk', 'toggleCamera', 'toggleScreenShare', 'disconnect', 'toggleStreamerMode']
      .map((id, i) => bind(id, [['F13'], ['CapsLock'], ['F5'], ['Home'], ['ControlLeft', 'KeyA'], ['MetaLeft', 'KeyB'], ['ControlLeft', 'ShiftLeft', 'KeyQ']][i]!))))
      .toEqual(['toggleMute', 'toggleDeafen', 'pushToTalk', 'toggleCamera', 'toggleScreenShare', 'disconnect', 'toggleStreamerMode']);
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

describe('handing over the shortcuts', () => {
  it('is listened to as often as settings change, and not as fast as a page could swap them', () => {
    let at = 0;
    const allowed = createKeybindSyncLimit(3, 60_000, () => at);
    expect([allowed(), allowed(), allowed(), allowed()]).toEqual([true, true, true, false]);
    at = 60_000;
    expect(allowed()).toBe(true);
  });
});
