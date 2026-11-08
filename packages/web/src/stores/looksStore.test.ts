import { beforeEach, describe, expect, it } from 'vitest';
import { CARBON_SETTINGS } from '../utils/appTheme';
import type { Look } from '../utils/looks';
import { normalizeSavedLooks, SAVED_LOOKS_MAX, savedLookOf, useLooksStore } from './looksStore';

// The looks kept on a device (the theme studio): named, at most thirty, renamed, deleted with an
// undo, and read back defensively from what the browser kept.

const LOOK: Look = {
  surface: CARBON_SETTINGS,
  accent: null,
  light: 'on',
  corners: 'standard',
  font: 'geist',
  avatarShape: 'rounded',
  messageStyle: 'rows',
  density: 'cozy',
};

beforeEach(() => {
  useLooksStore.setState({ looks: [] });
});

describe('kept looks', () => {
  it('keeps a look under a clean name, newest first, and knows the look again', () => {
    const store = useLooksStore.getState();
    expect(store.save('   ', LOOK)).toBeNull();
    const first = store.save('  Carbon  ', LOOK)!;
    const second = useLooksStore.getState().save('Round', { ...LOOK, corners: 'round' })!;
    expect(useLooksStore.getState().looks.map((saved) => saved.name)).toEqual(['Round', 'Carbon']);
    expect(first.name).toBe('Carbon');
    expect(savedLookOf(useLooksStore.getState().looks, { ...LOOK, corners: 'round' })?.id).toBe(second.id);
  });

  it('keeps no more than the shelf holds', () => {
    for (let n = 0; n < SAVED_LOOKS_MAX; n += 1) useLooksStore.getState().save(`Look ${n}`, LOOK);
    expect(useLooksStore.getState().save('One more', LOOK)).toBeNull();
    expect(useLooksStore.getState().looks).toHaveLength(SAVED_LOOKS_MAX);
  });

  it('renames, and puts a deleted look back where it was', () => {
    const store = useLooksStore.getState();
    store.save('A', LOOK);
    const b = useLooksStore.getState().save('B', LOOK)!;
    store.save('C', LOOK);
    expect(useLooksStore.getState().rename(b.id, '  Bee ')).toBe(true);
    expect(useLooksStore.getState().rename(b.id, ' ')).toBe(false);
    const index = useLooksStore.getState().looks.findIndex((saved) => saved.id === b.id);
    const kept = useLooksStore.getState().looks[index]!;
    useLooksStore.getState().remove(b.id);
    expect(useLooksStore.getState().looks.map((saved) => saved.name)).toEqual(['C', 'A']);
    useLooksStore.getState().restore(kept, index);
    expect(useLooksStore.getState().looks.map((saved) => saved.name)).toEqual(['C', 'Bee', 'A']);
  });

  it('reads back what the browser kept, leaving out what is not a look', () => {
    const looks = normalizeSavedLooks({
      looks: [
        { id: 'a', name: 'Kept', look: LOOK, savedAt: 5 },
        { id: 'b', name: '', look: LOOK },
        { id: 'c', name: 'No look', look: 'violet' },
        { name: 'No id', look: LOOK },
      ],
    });
    expect(looks).toEqual([{ id: 'a', name: 'Kept', look: LOOK, savedAt: 5 }]);
    expect(normalizeSavedLooks(null)).toEqual([]);
  });
});
