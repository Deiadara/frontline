import { describe, expect, it } from 'vitest';
import {
  DISMISSAL_WEEKS,
  PAYROLL_BASE,
  MAX_PAYROLL_STEP_DISCOUNT,
  PAYROLL_STEP,
  PAYROLL_STEP_RESOURCE,
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
   * The maintainer's numbers (2026-10-01), written out rather than computed from the constants: a
   * test that derived them from `PAYROLL_STEP_FIRST_COST + n * PAYROLL_STEP_COST_RISE` would agree
   * with any pair of values, a wrong pair included.
   */
  it('prices expansions in caps at 300, 360, 420 and on, sixty more each time', () => {
    expect(PAYROLL_STEP_RESOURCE).toBe('caps');
    expect(PAYROLL_STEP).toBe(30);
    expect([0, 1, 2, 3, 9, 99].map((bought) => payrollStepCost(bought))).toEqual([
      300, 360, 420, 480, 840, 6240,
    ]);
  });

  /** There is no ceiling any more: every expansion costs sixty more than the one before it. */
  it('never stops climbing', () => {
    for (let bought = 1; bought <= 2000; bought++) {
      expect(payrollStepCost(bought) - payrollStepCost(bought - 1), `${bought} bought`).toBe(60);
    }
  });

  /** What the whole of a book costs: `300n + 30n(n - 1)` caps for `n` expansions. */
  it('costs 5,700 caps for the first ten and 327,000 for the first hundred', () => {
    const total = (count: number) => {
      let spent = 0;
      for (let bought = 0; bought < count; bought++) spent += payrollStepCost(bought);
      return spent;
    };
    expect(total(10)).toBe(5700);
    expect(total(100)).toBe(327_000);
  });

  /**
   * The cards multiply the Nexus's figure and nothing else (maintainer, 2026-10-01): an expansion
   * is 30 on the book with no card fitted and 30 with every card fitted.
   */
  it('adds what was bought after the cards, so thirty is thirty', () => {
    expect(payrollCapacity(20, 0, 100)).toBe(1400);
    expect(payrollCapacity(20, 10, 100)).toBe(1400 + 300);
    expect(payrollCapacity(20, 10, 220) - payrollCapacity(20, 9, 220)).toBe(30);
  });

  /** The perk channel still comes off the top, and never all the way off. */
  it('takes the step discount off an expansion and never below one', () => {
    expect(payrollStepCost(0, 10)).toBe(270);
    expect(payrollStepCost(0, MAX_PAYROLL_STEP_DISCOUNT)).toBe(120);
    // Asking for more than the channel allows is capped, not honoured.
    expect(payrollStepCost(0, 100)).toBe(payrollStepCost(0, MAX_PAYROLL_STEP_DISCOUNT));
    expect(payrollStepCost(500, 10)).toBe(Math.round((300 + 500 * 60) * 0.9));
  });

  it('quotes a price on every ledger, however much has been bought', () => {
    expect(payrollLedger({ ...startingPayroll(), purchasedSteps: 400 }, 0).nextStepCost).toBe(
      24_300,
    );
    expect(payrollLedger(startingPayroll(), 0).nextStepCost).toBe(300);
  });

  /** The button says `+stepSize`, so it has to be what buying the step does to the ceiling. */
  it('quotes the step as what it actually adds, which the district bonus no longer moves', () => {
    const at = { ...startingPayroll(), purchasedSteps: 3 };
    const bought = { ...at, purchasedSteps: 4 };
    expect(payrollLedger(at, 2).stepSize).toBe(PAYROLL_STEP);
    const ledger = payrollLedger(at, 2, 10);
    expect(ledger.stepSize).toBe(payrollLedger(bought, 2, 10).capacity - ledger.capacity);
    expect(ledger.stepSize).toBe(30);
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

  it('charges ten weeks of the fee to let somebody go', () => {
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
 * Pinned to the maintainer's own arithmetic rather than to the constant, because a test that reads
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
