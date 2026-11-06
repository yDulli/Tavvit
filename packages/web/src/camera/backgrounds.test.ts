import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_CHOICES,
  NO_BACKGROUND,
  SCENE_IDS,
  backgroundKey,
  isActiveBackground,
  parseCameraBackground,
  sameBackground,
} from './backgrounds';
import { SCENE_PICTURES } from './scenes';

describe('a stored camera background', () => {
  it('is taken as it is when the app knows it', () => {
    expect(parseCameraBackground({ kind: 'none' })).toEqual(NO_BACKGROUND);
    expect(parseCameraBackground({ kind: 'blur', strength: 'strong' })).toEqual({ kind: 'blur', strength: 'strong' });
    expect(parseCameraBackground({ kind: 'scene', scene: 'tavern' })).toEqual({ kind: 'scene', scene: 'tavern' });
    expect(parseCameraBackground({ kind: 'own' })).toEqual({ kind: 'own' });
  });

  it('is the room as it is when it is anything else: a background nobody chose is never laid over the picture', () => {
    for (const stored of [
      undefined,
      null,
      'blur',
      { kind: 'blur' },
      { kind: 'blur', strength: 'medium' },
      { kind: 'scene', scene: 'beach' },
      { kind: 'scene' },
      { kind: 'video' },
      { strength: 'light' },
      42,
    ]) {
      expect(parseCameraBackground(stored), JSON.stringify(stored)).toEqual(NO_BACKGROUND);
    }
  });

  it('keeps only the fields of its kind', () => {
    expect(parseCameraBackground({ kind: 'own', scene: 'tavern', extra: true })).toEqual({ kind: 'own' });
  });
});

describe('the choices', () => {
  it('are offered in the picker\'s order: none, the two blurs, the scenes, the own picture', () => {
    expect(BACKGROUND_CHOICES.map(backgroundKey)).toEqual([
      'none',
      'blur:light',
      'blur:strong',
      ...SCENE_IDS.map((scene) => `scene:${scene}`),
      'own',
    ]);
  });

  it('each have a key of their own, and are told apart by it', () => {
    const keys = BACKGROUND_CHOICES.map(backgroundKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(sameBackground({ kind: 'blur', strength: 'light' }, { kind: 'blur', strength: 'light' })).toBe(true);
    expect(sameBackground({ kind: 'blur', strength: 'light' }, { kind: 'blur', strength: 'strong' })).toBe(false);
  });

  it('need the processor for every background but the room as it is', () => {
    expect(BACKGROUND_CHOICES.filter(isActiveBackground)).toHaveLength(BACKGROUND_CHOICES.length - 1);
    expect(isActiveBackground(NO_BACKGROUND)).toBe(false);
  });

  it('have a picture, and a small one for the picker, for every scene', () => {
    for (const scene of SCENE_IDS) {
      expect(SCENE_PICTURES[scene].image, scene).toMatch(/\.jpg$/);
      expect(SCENE_PICTURES[scene].thumb, scene).toMatch(/-thumb\.jpg$/);
    }
  });
});
