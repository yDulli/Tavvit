import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

/**
 * How well the event loop keeps up (docs/systems/operations.md). Everything the server does runs on
 * it, so this is the figure that says it has too much to do, before people notice. Measured over
 * windows of ten seconds: a figure since the start would hide today in last month.
 */

/** How often the timer behind the histogram fires. The histogram holds that interval plus the delay. */
const RESOLUTION_MS = 20;
const WINDOW_MS = 10_000;
const NANOSECONDS_PER_MS = 1e6;

export interface EventLoopStats {
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
}

let histogram: IntervalHistogram | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastWindow: EventLoopStats | null = null;

const delayOf = (nanoseconds: number): number => Math.max(0, Math.round(nanoseconds / NANOSECONDS_PER_MS - RESOLUTION_MS));

export function startRuntimeStats(): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  histogram.enable();
  timer = setInterval(() => {
    if (!histogram) return;
    lastWindow = { p50Ms: delayOf(histogram.percentile(50)), p99Ms: delayOf(histogram.percentile(99)), maxMs: delayOf(histogram.max) };
    histogram.reset();
  }, WINDOW_MS);
  timer.unref();
}

export function stopRuntimeStats(): void {
  if (timer) clearInterval(timer);
  timer = null;
  histogram?.disable();
  histogram = null;
  lastWindow = null;
}

/** The last full window. Null in the first seconds, and where nothing started the measuring. */
export function eventLoopStats(): EventLoopStats | null {
  return lastWindow;
}
