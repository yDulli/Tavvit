import { describe, it, expect } from 'vitest';
import { EMPTY_BLOCKED_PLAN, planBlockedRuns, type BlockableMessage } from './blockedRuns';

const msg = (id: string, userId: string, type?: 'user' | 'system'): BlockableMessage => ({ id, userId, type });
const blocked = (...ids: string[]) => (userId: string) => ids.includes(userId);

describe('planBlockedRuns', () => {
  it('finds nothing when nobody is blocked', () => {
    const plan = planBlockedRuns([msg('1', 'a'), msg('2', 'b')], blocked());
    expect(plan).toBe(EMPTY_BLOCKED_PLAN);
  });

  it('makes one run of neighbours from blocked authors', () => {
    const plan = planBlockedRuns([msg('1', 'a'), msg('2', 'x'), msg('3', 'x'), msg('4', 'b')], blocked('x'));
    expect([...plan.counts]).toEqual([['2', 2]]);
    expect(plan.startOf.get('2')).toBe('2');
    expect(plan.startOf.get('3')).toBe('2');
    expect(plan.startOf.has('1')).toBe(false);
    expect(plan.startOf.has('4')).toBe(false);
  });

  it('joins different blocked authors who are neighbours into one run', () => {
    const plan = planBlockedRuns([msg('1', 'x'), msg('2', 'y')], blocked('x', 'y'));
    expect([...plan.counts]).toEqual([['1', 2]]);
  });

  it('starts a new run after a message from anybody else', () => {
    const plan = planBlockedRuns([msg('1', 'x'), msg('2', 'a'), msg('3', 'x')], blocked('x'));
    expect([...plan.counts]).toEqual([['1', 1], ['3', 1]]);
    expect(plan.startOf.get('3')).toBe('3');
  });

  it('never folds a system message into a run, and a system message ends one', () => {
    const plan = planBlockedRuns([msg('1', 'x'), msg('2', 'x', 'system'), msg('3', 'x')], blocked('x'));
    expect([...plan.counts]).toEqual([['1', 1], ['3', 1]]);
    expect(plan.startOf.has('2')).toBe(false);
  });

  it('handles an empty list', () => {
    expect(planBlockedRuns([], blocked('x'))).toBe(EMPTY_BLOCKED_PLAN);
  });
});
