import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTIONS, editMenuParams, isEditCommand, isSpellingWord } from './editMenu';

const flags = { canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false };

describe('edit menu', () => {
  it('tells the page about a right click in a text field only', () => {
    expect(editMenuParams({ isEditable: false, misspelledWord: '', dictionarySuggestions: [], editFlags: flags })).toBeNull();
    expect(editMenuParams({ isEditable: true, misspelledWord: 'helo', dictionarySuggestions: ['hello', 'help'], editFlags: { ...flags, canCut: false } }))
      .toEqual({ misspelledWord: 'helo', suggestions: ['hello', 'help'], canCut: false, canCopy: true, canPaste: true, canSelectAll: true });
  });

  it('lists at most five suggestions', () => {
    const suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(editMenuParams({ isEditable: true, misspelledWord: 'x', dictionarySuggestions: suggestions, editFlags: flags })?.suggestions)
      .toHaveLength(MAX_SUGGESTIONS);
  });

  it('runs only the edit commands it names, and takes only plain words', () => {
    expect(isEditCommand('paste')).toBe(true);
    expect(isEditCommand('openDevTools')).toBe(false);
    expect(isEditCommand(42)).toBe(false);
    expect(isSpellingWord('Tavvit')).toBe(true);
    expect(isSpellingWord('')).toBe(false);
    expect(isSpellingWord('two\nlines')).toBe(false);
    expect(isSpellingWord('x'.repeat(101))).toBe(false);
  });
});
