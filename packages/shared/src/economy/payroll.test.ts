import { describe, expect, it } from 'vitest';
import {
  DISMISSAL_WEEKS,
  PAYROLL_BASE,
  PAYROLL_STEP,
  PAYROLL_STEP_BASE_COST,
  PayrollStateSchema,
  committedPayroll,
  dismissalFee,
  payrollCapacity,
  payrollFits,
  payrollLedger,
  payrollStepCost,
  startingPayroll,
} from './payroll.js';

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
    const payroll = { ...startingPayroll(), commitments: { a: 60, b: 40 } };
    const ledger = payrollLedger(payroll, 0);
    expect(ledger.committed).toBe(100);
    expect(ledger.available).toBe(PAYROLL_BASE - 100);
    expect(committedPayroll(payroll.commitments)).toBe(100);
  });

  it('never reports a negative remainder, however far over the book a crew is', () => {
    const payroll = { ...startingPayroll(), commitments: { a: PAYROLL_BASE + 500 } };
    expect(payrollLedger(payroll, 0).available).toBe(0);
  });

  /** The one rule the whole book exists to enforce: you cannot promise what you do not have. */
  it('refuses a commitment that does not fit in what is left', () => {
    const ledger = payrollLedger({ ...startingPayroll(), commitments: { a: 150 } }, 0);
    expect(payrollFits(ledger, PAYROLL_BASE - 150)).toBe(true);
    expect(payrollFits(ledger, PAYROLL_BASE - 149)).toBe(false);
  });

  it('charges five weeks of the fee to let somebody go', () => {
    expect(dismissalFee(50)).toBe(50 * DISMISSAL_WEEKS);
    expect(dismissalFee(0)).toBe(0);
  });
});

/**
 * Nothing in the game is charged on a clock, and this is the guard on that.
 *
 * The payroll module is where every recurring draw lived: caps every Monday, then supplies every
 * Monday after the caps went. Both are gone, and what pins it is the *state*: a book with no
 * settled-through date has nothing for a cycle to catch up from, so a reinstated weekly draw
 * cannot be written without changing this shape and failing here.
 *
 * `DISMISSAL_WEEKS` is deliberately not caught by this. Weeks are still the unit a fee is quoted
 * in; what is gone is anything that comes due on its own.
 */
describe('nothing recurs', () => {
  it('starts a crew with a book and no settled-through date', () => {
    expect(startingPayroll()).toEqual({ purchasedSteps: 0, commitments: {} });
  });

  it('keeps no timestamp on the book, so there is nothing to settle from', () => {
    const shape = Object.keys(PayrollStateSchema.shape);
    expect(shape).toEqual(['purchasedSteps', 'commitments']);
  });

  it('has dropped the weekly cycle outright', async () => {
    const payroll = await import('./payroll.js');
    for (const gone of [
      'runEconomyCycle',
      'foodUpkeepFor',
      'suppliesUpkeepFor',
      'startOfPayWeek',
      'PAY_WEEK_MS',
    ]) {
      expect(payroll, gone).not.toHaveProperty(gone);
    }
  });
});

/**
 * §H7: what walking a commitment back costs.
 *
 * Pinned to the board's own arithmetic rather than to the constant, because a test that reads
 * `DISMISSAL_WEEKS` to compute what it expects agrees with any value of it, including a wrong one.
 * The board's example is the anchor: an officer on 30 caps a week costs 300 to release.
 *
 * Nothing asserted this before. The rate could be changed to any number and the whole suite stayed
 * green, which is how it sat at half the intended figure without anybody noticing.
 */
describe('letting somebody go', () => {
  it('costs ten times what they are on, in caps, on the spot', () => {
    expect(dismissalFee(30)).toBe(300);
    expect(dismissalFee(7)).toBe(70);
    expect(DISMISSAL_WEEKS).toBe(10);
  });

  it('costs nothing for somebody who was never committed to', () => {
    expect(dismissalFee(0)).toBe(0);
  });

  /** A fee is never a refund, whatever a caller hands in. */
  it('never returns caps', () => {
    expect(dismissalFee(-40)).toBe(0);
  });

  it('rounds the weekly figure before multiplying, so the fee is whole caps', () => {
    expect(dismissalFee(12.4)).toBe(120);
    expect(dismissalFee(12.6)).toBe(130);
  });
});
