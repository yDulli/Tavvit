import { useState } from 'react';

/**
 * How many times `value` has changed since this mounted. Used as a `key`, it restarts
 * a CSS animation on every change; being 0 at first, it lets a class leave out the
 * first render, so a count already there does not jump when a list comes into view.
 */
export function useBump(value: unknown): number {
  const [seen, setSeen] = useState({ value, bumps: 0 });
  if (Object.is(seen.value, value)) return seen.bumps;
  const next = { value, bumps: seen.bumps + 1 };
  setSeen(next);
  return next.bumps;
}
