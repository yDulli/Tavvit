import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetProcessGuards, installProcessGuards, reportUnhandledRejection, unhandledRejectionCount } from './processGuards.js';

// A promise nobody awaits that is rejected ends a Node process by default, and with it every call
// and connection of the instance. The server writes such a failure down and goes on.

afterEach(() => _resetProcessGuards());

describe('a rejection nobody handled', () => {
  it('is written down with its error, and counted', () => {
    const log = { error: vi.fn() };
    reportUnhandledRejection(new Error('the push service is gone'), log);
    reportUnhandledRejection('a bare reason', log);
    expect(log.error).toHaveBeenCalledTimes(2);
    expect((log.error.mock.calls[0]![0] as { err: Error }).err.message).toBe('the push service is gone');
    expect((log.error.mock.calls[1]![0] as { err: Error }).err).toBeInstanceOf(Error);
    expect(unhandledRejectionCount()).toBe(2);
  });

  it('does not become the next one when writing it down fails', () => {
    const log = { error: () => { throw new Error('the log is gone too'); } };
    expect(() => reportUnhandledRejection(new Error('x'), log)).not.toThrow();
  });

  it('has one listener on the process, however often it is installed', () => {
    const before = process.listenerCount('unhandledRejection');
    const log = { error: vi.fn() };
    installProcessGuards(log);
    installProcessGuards(log);
    expect(process.listenerCount('unhandledRejection')).toBe(before + 1);
    // What the process would call. (Emitting the event here would fail the test run itself.)
    const listener = process.listeners('unhandledRejection').at(-1) as (reason: unknown, promise: Promise<unknown>) => void;
    listener(new Error('late'), Promise.resolve());
    expect(log.error).toHaveBeenCalledTimes(1);
    _resetProcessGuards();
    expect(process.listenerCount('unhandledRejection')).toBe(before);
  });
});
