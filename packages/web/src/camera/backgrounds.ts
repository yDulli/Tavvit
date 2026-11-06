/**
 * What the camera shows behind the person: the room as it is, the room made
 * soft, one of the app's scenes, or a picture of the person's own that stays
 * on this device (`ownImage.ts`). Chosen in Settings → Voice & Video, kept per
 * device (`voiceStore.cameraBackground`), and laid over the picture before a
 * single frame leaves the device (`processor.ts`).
 */

export const BLUR_STRENGTHS = ['light', 'strong'] as const;
export type BlurStrength = (typeof BLUR_STRENGTHS)[number];

export const SCENE_IDS = ['graphite', 'tavern', 'library', 'nightWindow', 'greenhouse'] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export type CameraBackground =
  | { kind: 'none' }
  | { kind: 'blur'; strength: BlurStrength }
  | { kind: 'scene'; scene: SceneId }
  | { kind: 'own' };

/** Every background but the room as it is: the ones that need the processor. */
export type ActiveBackground = Exclude<CameraBackground, { kind: 'none' }>;

export const NO_BACKGROUND: CameraBackground = { kind: 'none' };

/**
 * How soft each blur makes the room, as the processor's radius in pixels of
 * the camera picture. Light keeps the shapes of the room; strong leaves only
 * its colours.
 */
export const BLUR_RADIUS: Record<BlurStrength, number> = { light: 10, strong: 28 };

/** Every choice, in the order the picker shows them. */
export const BACKGROUND_CHOICES: readonly CameraBackground[] = [
  NO_BACKGROUND,
  ...BLUR_STRENGTHS.map((strength): CameraBackground => ({ kind: 'blur', strength })),
  ...SCENE_IDS.map((scene): CameraBackground => ({ kind: 'scene', scene })),
  { kind: 'own' },
];

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

/**
 * A stored choice as the app can use it. Anything else, an older shape or a
 * scene that is gone, is the room as it is: a background nobody chose is never
 * laid over the picture.
 */
export function parseCameraBackground(value: unknown): CameraBackground {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return NO_BACKGROUND;
  const { kind } = value;
  if (kind === 'blur' && 'strength' in value && isOneOf(BLUR_STRENGTHS, value.strength)) return { kind, strength: value.strength };
  if (kind === 'scene' && 'scene' in value && isOneOf(SCENE_IDS, value.scene)) return { kind, scene: value.scene };
  if (kind === 'own') return { kind };
  return NO_BACKGROUND;
}

/** One string per choice: a React key, a test id, a comparison. */
export function backgroundKey(background: CameraBackground): string {
  switch (background.kind) {
    case 'none':
      return 'none';
    case 'blur':
      return `blur:${background.strength}`;
    case 'scene':
      return `scene:${background.scene}`;
    case 'own':
      return 'own';
  }
}

export function sameBackground(a: CameraBackground, b: CameraBackground): boolean {
  return backgroundKey(a) === backgroundKey(b);
}

export function isActiveBackground(background: CameraBackground): background is ActiveBackground {
  return background.kind !== 'none';
}
