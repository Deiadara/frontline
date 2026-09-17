import { describe, expect, it } from 'vitest';
import {
  DISMISSAL_WEEKS,
  PAYROLL_BASE,
  MAX_PAYROLL_STEP_DISCOUNT,
  PAYROLL_STEP,
  PAYROLL_STEPS_MAX,
  PAYROLL_STEP_COST_RISE,
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
   * The maintainer's own arithmetic, written out rather than computed from the constants.
   *
   * A test that derives what it expects from `PAYROLL_STEP_FIRST_COST + n * PAYROLL_STEP_COST_RISE`
   * agrees with any pair of values for those two, including a wrong pair. These four are the rungs
   * as specified: step k costs (9 + k) times 60, so the multiplier runs 10, 11, 12, 13.
   */
  it('prices the first rungs the way the board priced them', () => {
    expect(payrollStepCost(0)).toBe(600);
    expect(payrollStepCost(1)).toBe(660);
    expect(payrollStepCost(2)).toBe(720);
    expect(payrollStepCost(3)).toBe(780);
  });

  it('charges the same amount more for every further rung', () => {
    for (const bought of [0, 1, 7, 20, PAYROLL_STEPS_MAX - 2]) {
      const here = payrollStepCost(bought);
      const next = payrollStepCost(bought + 1);
      expect(here, `${bought} bought`).not.toBeNull();
      expect(next, `${bought + 1} bought`).not.toBeNull();
      expect(next! - here!, `${bought} to ${bought + 1}`).toBe(PAYROLL_STEP_COST_RISE);
    }
  });

  /** The last rung: multiplier 60, which is 3,600 caps, and it is the fifty-first. */
  it('ends the ladder on a rung of 3,600 caps', () => {
    expect(PAYROLL_STEPS_MAX).toBe(51);
    expect(payrollStepCost(PAYROLL_STEPS_MAX - 1)).toBe(3600);
  });

  /**
   * Past the last rung there is no price, at any discount.
   *
   * The discount case is the one that would rot quietly: a perk stack multiplies whatever the
   * function returns, so an implementation that priced step 52 and clamped it somewhere else would
   * still look right at zero percent.
   */
  it('has nothing left to sell past the last rung', () => {
    expect(payrollStepCost(PAYROLL_STEPS_MAX)).toBeNull();
    expect(payrollStepCost(PAYROLL_STEPS_MAX + 40)).toBeNull();
    expect(payrollStepCost(PAYROLL_STEPS_MAX, MAX_PAYROLL_STEP_DISCOUNT)).toBeNull();
  });

  /**
   * What a finished ladder cost and what it bought.
   *
   * Both totals in one place, because the pair is what the ceiling was chosen for: 51 rungs of 30
   * caps a week, bought for 107,100 caps. A change to either constant that keeps the other looking
   * plausible moves one of these two numbers.
   */
  it('costs 107,100 caps to buy out, for 1,530 caps a week of room', () => {
    let spent = 0;
    for (let bought = 0; bought < PAYROLL_STEPS_MAX; bought++) {
      const cost = payrollStepCost(bought);
      expect(cost, `${bought} bought`).not.toBeNull();
      spent += cost!;
    }
    expect(spent).toBe(107_100);
    expect(payrollStepCost(PAYROLL_STEPS_MAX)).toBeNull();
    expect(PAYROLL_STEPS_MAX * PAYROLL_STEP).toBe(1530);
    expect(payrollCapacity(0, PAYROLL_STEPS_MAX)).toBe(PAYROLL_BASE + 1530);
  });

  /** The perk channel still comes off the top, and never all the way off. */
  it('takes the step discount off a rung and never below a cap', () => {
    expect(payrollStepCost(0, 10)).toBe(540);
    expect(payrollStepCost(0, MAX_PAYROLL_STEP_DISCOUNT)).toBe(240);
    // Asking for more than the channel allows is capped, not honoured.
    expect(payrollStepCost(0, 100)).toBe(payrollStepCost(0, MAX_PAYROLL_STEP_DISCOUNT));
  });

  /** A ledger says so too, rather than leaving the screen to work it out from the step count. */
  it('quotes no price on a bought-out book', () => {
    const maxed = { ...startingPayroll(), purchasedSteps: PAYROLL_STEPS_MAX };
    expect(payrollLedger(maxed, 0).nextStepCost).toBeNull();
    expect(payrollLedger(startingPayroll(), 0).nextStepCost).toBe(600);
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
