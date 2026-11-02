import React from 'react';

interface RangeSliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max' | 'onChange' | 'style'> {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** A CSS background for the whole track, for a slider that runs through colours. */
  track?: string;
}

/**
 * A slider (`.range-slider`): the part of the track up to the thumb is violet,
 * the rest the muted control tone, unless `track` paints it.
 */
export function RangeSlider({ value, min, max, onChange, track, className = '', ...rest }: RangeSliderProps): React.JSX.Element {
  const filled = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const style: React.CSSProperties & { '--range-fill': string; '--range-track'?: string } = {
    '--range-fill': `${filled}%`,
    ...(track ? { '--range-track': track } : {}),
  };
  return (
    <input
      {...rest}
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className={`range-slider ${className}`}
      style={style}
    />
  );
}
