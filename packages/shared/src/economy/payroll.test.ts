import { describe, expect, it } from 'vitest';
import {
  DISMISSAL_WEEKS,
  PAYROLL_BASE,
  PAYROLL_STEP,
  PAYROLL_STEP_BASE_COST,
  committedPayroll,
  dismissalFee,
  foodUpkeepFor,
  payrollCapacity,
  payrollFits,
  payrollLedger,
  payrollStepCost,
  runEconomyCycle,
  startOfPayWeek,
  startingPayroll,
} from './payroll.js';
import { STARTING_RESOURCES } from '../resources.js';

const NOW = '2026-08-24T09:00:00.000Z';

describe('the pay week (§H7)', () => {
  it('starts on Monday 00:00 UTC, whatever day it is asked on', () => {
    for (const day of ['2026-08-24T00:00:00.000Z', '2026-08-27T13:22:11.000Z']) {
      const monday = startOfPayWeek(new Date(day));
      expect(monday.getUTCDay()).toBe(1);
      expect(monday.toISOString()).toBe('2026-08-24T00:00:00.000Z');
    }
  });
});

describe('the payroll book (§H7)', () => {
  it('starts every crew at the same standing figure', () => {
    expect(payrollCapacity(0, 0)).toBe(PAYROLL_BASE);
  });

  it('grows with the Nexus, with what has been bought, and with the district', () => {
    expect(payrollCapacity(4, 0)).toBeGreaterThan(payrollCapacity(0, 0));
    expect(payrollCapacity(0, 1)).toBe(PAYROLL_BASE + PAYROLL_STEP);
    expect(payrollCapacity(0, 0, 10)).toBe(Math.round(PAYROLL_BASE * 1.1));
  });

  /**
   * The board's own example: at a book of 200, buying the step that takes it to 230 costs 500
   * caps. That is about seventeen weeks of the step, and it is meant to be: the step is permanent.
   */
  it('prices the first step the way the board priced it', () => {
    expect(payrollStepCost(0)).toBe(PAYROLL_STEP_BASE_COST);
    expect(payrollStepCost(0)).toBeGreaterThan(PAYROLL_STEP * 10);
  });

  it('charges more for every further step, without ever refusing one', () => {
    let previous = 0;
    for (const steps of [0, 1, 2, 5, 10, 25, 50]) {
      const cost = payrollStepCost(steps);
      expect(cost, `${steps} steps`).toBeGreaterThan(previous);
      expect(Number.isFinite(cost), `${steps} steps`).toBe(true);
      previous = cost;
    }
  });

  it('reports what is spoken for and what is left', () => {
    const payroll = { ...startingPayroll(NOW), commitments: { a: 60, b: 40 } };
    const ledger = payrollLedger(payroll, 0);
    expect(ledger.committed).toBe(100);
    expect(ledger.available).toBe(PAYROLL_BASE - 100);
    expect(committedPayroll(payroll.commitments)).toBe(100);
  });

  it('never reports a negative remainder, however far over the book a crew is', () => {
    const payroll = { ...startingPayroll(NOW), commitments: { a: PAYROLL_BASE + 500 } };
    expect(payrollLedger(payroll, 0).available).toBe(0);
  });

  /** The one rule the whole book exists to enforce: you cannot promise what you do not have. */
  it('refuses a commitment that does not fit in what is left', () => {
    const ledger = payrollLedger({ ...startingPayroll(NOW), commitments: { a: 150 } }, 0);
    expect(payrollFits(ledger, PAYROLL_BASE - 150)).toBe(true);
    expect(payrollFits(ledger, PAYROLL_BASE - 149)).toBe(false);
  });

  it('charges five weeks of the fee to let somebody go', () => {
    expect(dismissalFee(50)).toBe(50 * DISMISSAL_WEEKS);
    expect(dismissalFee(0)).toBe(0);
  });
});

describe('the weekly upkeep cycle (§D1)', () => {
  const cycle = (food: number, officers: number, now: string) =>
    runEconomyCycle({
      resources: { ...STARTING_RESOURCES, food },
      payroll: startingPayroll(NOW),
      officerCount: officers,
      now: new Date(now),
    });

  it('does nothing inside the week it already settled', () => {
    const result = cycle(500, 3, '2026-08-26T09:00:00.000Z');
    expect(result.weeksSettled).toBe(0);
    expect(result.foodDue).toBe(0);
  });

  it('eats food per officer, and more per officer as the crew grows', () => {
    expect(foodUpkeepFor(0)).toBe(0);
    expect(foodUpkeepFor(2) / 2).toBeLessThan(foodUpkeepFor(6) / 6);
    const result = cycle(500, 3, '2026-08-31T09:00:00.000Z');
    expect(result.weeksSettled).toBe(1);
    expect(result.foodDue).toBe(foodUpkeepFor(3));
    expect(result.resources.food).toBe(500 - result.foodConsumed);
  });

  it('catches up honestly across a long absence', () => {
    expect(cycle(9000, 2, '2026-09-21T09:00:00.000Z').weeksSettled).toBe(4);
  });

  it('eats what it can when the store is short and reports the rest', () => {
    const result = cycle(1, 6, '2026-08-31T09:00:00.000Z');
    expect(result.foodConsumed).toBe(1);
    expect(result.foodShortfall).toBe(result.foodDue - 1);
    expect(result.resources.food).toBe(0);
  });

  /** Caps are the book's business and the book is not a bill: nothing here touches them. */
  it('never takes caps out of the stockpile', () => {
    const result = cycle(500, 4, '2026-09-14T09:00:00.000Z');
    expect(result.resources.caps).toBe(STARTING_RESOURCES.caps);
  });

  it('never claws upkeep back when the clock runs backwards', () => {
    expect(cycle(500, 3, '2026-08-10T09:00:00.000Z').weeksSettled).toBe(0);
  });
});
