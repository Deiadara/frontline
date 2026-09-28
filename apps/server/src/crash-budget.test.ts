import { describe, expect, it } from 'vitest';
import { CrashBudget, isFatal } from './crash-budget.js';

describe('the crash budget', () => {
  it('lets a stray error through and carries on', () => {
    const budget = new CrashBudget(3, 60_000);
    expect(budget.spend(new Error('one bug'), 0)).toBe(false);
  });

  it('calls time on an error storm inside the window, and forgets errors outside it', () => {
    const budget = new CrashBudget(3, 60_000);
    for (const at of [0, 1, 2]) expect(budget.spend(new Error('again'), at)).toBe(false);
    expect(budget.spend(new Error('again'), 3)).toBe(true);

    const calm = new CrashBudget(3, 60_000);
    for (const at of [0, 70_000, 140_000, 210_000]) {
      expect(calm.spend(new Error('now and then'), at)).toBe(false);
    }
  });

  it('exits at once on a process that is out of descriptors or memory', () => {
    const budget = new CrashBudget(100, 60_000);
    expect(budget.spend(Object.assign(new Error('too many open files'), { code: 'EMFILE' }))).toBe(
      true,
    );
    expect(isFatal(new RangeError('Invalid array length'))).toBe(false);
    expect(isFatal(new RangeError('JavaScript heap out of memory'))).toBe(true);
  });
});
