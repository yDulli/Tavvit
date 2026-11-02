/**
 * Right click in a text field.
 *
 * The page draws every menu itself, in Tavvit's look (packages/web,
 * globalContextMenu.ts), and this process draws none. A text field's menu
 * needs what only Chromium knows here, the misspelled word under the pointer
 * and the dictionary's suggestions for it, so main hands those over on the
 * window's `context-menu` event and runs the commands the menu's items stand
 * for (the IPC table in docs/systems/desktop.md).
 */

/** The most suggestions the menu lists, as Chrome's own menu does. */
export const MAX_SUGGESTIONS = 5;

/** The longest word the spell checker is asked to take or put in. */
const MAX_WORD_LENGTH = 100;

/** What the page is told about a right click in a text field. */
export interface EditMenuParams {
  misspelledWord: string;
  suggestions: string[];
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canSelectAll: boolean;
}

type ContextParams = Pick<Electron.ContextMenuParams, 'isEditable' | 'misspelledWord' | 'dictionarySuggestions' | 'editFlags'>;

/** The page's view of a right click, or null when it was not in a text field. */
export function editMenuParams(params: ContextParams): EditMenuParams | null {
  if (!params.isEditable) return null;
  return {
    misspelledWord: params.misspelledWord,
    suggestions: params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS),
    canCut: params.editFlags.canCut,
    canCopy: params.editFlags.canCopy,
    canPaste: params.editFlags.canPaste,
    canSelectAll: params.editFlags.canSelectAll,
  };
}

/** The commands the page may ask for, each a method of the window's webContents. */
export const EDIT_COMMANDS = ['cut', 'copy', 'paste', 'selectAll'] as const;
export type EditCommand = (typeof EDIT_COMMANDS)[number];

export function isEditCommand(value: unknown): value is EditCommand {
  return typeof value === 'string' && (EDIT_COMMANDS as readonly string[]).includes(value);
}

/** A word for the spell checker: one line, not empty, not absurdly long. */
export function isSpellingWord(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_WORD_LENGTH
    && !/[\r\n\u0000]/.test(value);
}
