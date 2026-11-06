/**
 * The background could not be laid over the picture, on the graphics card or
 * off it. Kept apart from `processor.ts` so the code that turns the camera on
 * can recognise it without loading the processor.
 */
export class CameraBackgroundFailed extends Error {
  constructor(cause: unknown) {
    super('the camera background could not start', { cause });
    this.name = 'CameraBackgroundFailed';
  }
}
