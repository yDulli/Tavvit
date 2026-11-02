import { describe, expect, it } from 'vitest';
import { parseWaveform, VOICE_MESSAGE_LIMITS, waveformText } from '@backspace/shared/src/voiceMessages';
import { barsFromLevels } from './voiceRecorder';

describe('barsFromLevels', () => {
  it('scales so the loudest bar is full height, and no bar disappears', () => {
    expect(barsFromLevels([0, 0.25, 0.5])).toEqual([4, 50, 100]);
  });

  it('averages a long recording down to the limit', () => {
    const levels = Array.from({ length: 1000 }, (_, at) => (at % 2 === 0 ? 0.2 : 0.4));
    const bars = barsFromLevels(levels);
    expect(bars).toHaveLength(VOICE_MESSAGE_LIMITS.MAX_BARS);
    expect(Math.max(...bars) - Math.min(...bars)).toBeLessThan(5);
  });

  it('keeps a short recording as it is, and silence as low bars', () => {
    expect(barsFromLevels([0.1, 0.1])).toEqual([100, 100]);
    expect(barsFromLevels([0, 0])).toEqual([4, 4]);
    expect(barsFromLevels([])).toEqual([4]);
  });

  it('gives what the server takes', () => {
    const bars = barsFromLevels(Array.from({ length: 300 }, () => Math.random()));
    expect(parseWaveform(bars.join(','))).toEqual(bars);
  });
});

describe('parseWaveform', () => {
  it('reads a list and a text', () => {
    expect(parseWaveform('12,40,100')).toEqual([12, 40, 100]);
    expect(parseWaveform([12, 40])).toEqual([12, 40]);
    expect(waveformText([12, 40])).toBe('12,40');
  });

  it('refuses what is not a waveform', () => {
    for (const value of ['', 'x', '1,,2', '101', '-1', '1.5', '1;2', null, undefined, 7, [], [101], ['<b>'], {}, new Array(VOICE_MESSAGE_LIMITS.MAX_BARS + 1).fill(1)]) {
      expect(parseWaveform(value), JSON.stringify(value)).toBeNull();
    }
    expect(waveformText('nonsense')).toBeNull();
  });
});
