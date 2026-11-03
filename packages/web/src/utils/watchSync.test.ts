import { describe, expect, it } from 'vitest';
import { clockOffset, needsSeek, roomPositionMs } from './watchSync';

// A player keeps with its room by the server's stamp and the offset between the two clocks.

describe('keeping a player with its room', () => {
  it('reads the room on this clock through the offset the stamp arrived with', () => {
    // The server's clock runs 5 s ahead of this one.
    const offset = clockOffset(105_000, 100_000);
    expect(offset).toBe(5_000);
    const session = { playing: true, positionMs: 30_000, stateAt: 104_000 };
    // Two seconds later here is three seconds after the stamp there.
    expect(roomPositionMs(session, offset, 102_000)).toBe(33_000);
    expect(roomPositionMs({ ...session, playing: false }, offset, 102_000)).toBe(30_000);
  });

  it('moves a player back only once it has run off by more than the tolerance', () => {
    expect(needsSeek(31_500, 30_000)).toBe(false);
    expect(needsSeek(28_100, 30_000)).toBe(false);
    expect(needsSeek(32_500, 30_000)).toBe(true);
    expect(needsSeek(27_000, 30_000)).toBe(true);
    // A player that cannot say where it is yet is put where the room is.
    expect(needsSeek(null, 30_000)).toBe(true);
  });
});
