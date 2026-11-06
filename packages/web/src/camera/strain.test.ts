import { afterEach, describe, expect, it } from 'vitest';
import { EASED_BELOW_MS, FRAMES_BEFORE_JUDGING, STRAINED_ABOVE_MS, createStrainMeter, useCameraStrain } from './strain';

afterEach(() => useCameraStrain.setState({ strained: false }));

function feed(meter: ReturnType<typeof createStrainMeter>, ms: number, frames: number): void {
  for (let i = 0; i < frames; i += 1) meter.onFrame(ms);
}

describe('the strain on the device', () => {
  it('is not judged while the first frames warm up', () => {
    const meter = createStrainMeter();
    feed(meter, 80, FRAMES_BEFORE_JUDGING - 1);
    expect(useCameraStrain.getState().strained).toBe(false);
    meter.onFrame(80);
    expect(useCameraStrain.getState().strained).toBe(true);
  });

  it('says so when frames keep taking longer than a frame has, and not for one slow frame', () => {
    const meter = createStrainMeter();
    feed(meter, 10, FRAMES_BEFORE_JUDGING);
    meter.onFrame(200);
    expect(useCameraStrain.getState().strained).toBe(false);
    feed(meter, STRAINED_ABOVE_MS + 15, 120);
    expect(useCameraStrain.getState().strained).toBe(true);
  });

  it('goes quiet only well under the line, so the note does not flicker at the border', () => {
    const meter = createStrainMeter();
    feed(meter, 60, 120);
    expect(useCameraStrain.getState().strained).toBe(true);
    feed(meter, (STRAINED_ABOVE_MS + EASED_BELOW_MS) / 2, 200);
    expect(useCameraStrain.getState().strained).toBe(true);
    feed(meter, EASED_BELOW_MS - 10, 200);
    expect(useCameraStrain.getState().strained).toBe(false);
  });

  it('ends with the processor, and a stopped meter says nothing more', () => {
    const meter = createStrainMeter();
    feed(meter, 60, 120);
    meter.stop();
    expect(useCameraStrain.getState().strained).toBe(false);
    feed(meter, 60, 120);
    expect(useCameraStrain.getState().strained).toBe(false);
  });

  it('takes no account of a time that is not one', () => {
    const meter = createStrainMeter();
    feed(meter, Number.NaN, 100);
    feed(meter, -5, 100);
    expect(useCameraStrain.getState().strained).toBe(false);
  });
});
