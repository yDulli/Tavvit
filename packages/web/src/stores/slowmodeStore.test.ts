import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slowmodeKey, useSlowmodeStore } from './slowmodeStore';

const REMOTE = 'https://remote.test';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
});

afterEach(() => {
  useSlowmodeStore.getState().reset();
  vi.useRealTimers();
});

describe('slowmodeStore', () => {
  it('keys a wait by instance as well as by channel', () => {
    useSlowmodeStore.getState().startWait('', 'general', 5_000);
    useSlowmodeStore.getState().startWait(REMOTE, 'general', 9_000);
    const { readyAt } = useSlowmodeStore.getState();
    expect(readyAt.get(slowmodeKey('', 'general'))).toBe(6_000);
    expect(readyAt.get(slowmodeKey(REMOTE, 'general'))).toBe(10_000);
  });

  it('drops waits that have run out when another one starts', () => {
    useSlowmodeStore.getState().startWait('', 'general', 2_000);
    vi.setSystemTime(4_000);
    useSlowmodeStore.getState().startWait('', 'random', 2_000);
    expect([...useSlowmodeStore.getState().readyAt.keys()]).toEqual([slowmodeKey('', 'random')]);
  });

  it('ignores a wait of no length', () => {
    useSlowmodeStore.getState().startWait('', 'general', 0);
    expect(useSlowmodeStore.getState().readyAt.size).toBe(0);
  });

  it('forgets the waits of an instance that is gone and keeps the others', () => {
    useSlowmodeStore.getState().startWait('', 'general', 5_000);
    useSlowmodeStore.getState().startWait(REMOTE, 'general', 5_000);
    useSlowmodeStore.getState().forgetOrigin(REMOTE);
    expect([...useSlowmodeStore.getState().readyAt.keys()]).toEqual([slowmodeKey('', 'general')]);
  });
});
