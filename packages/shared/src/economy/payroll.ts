import { z } from 'zod';
import { IdSchema } from '../primitives.js';
import type { ResourceKey } from '../resources.js';

/**
 * The payroll book (GDD §H7): what the crew can commit to officers, and what it has committed.
 *
 * ## A budget, not a bill
 *
 * Officers used to draw caps out of the stockpile every Monday, which made hiring a good one a
 * slow bleed a player could not see coming and could not plan against. The book replaces that
 * outright: **payroll is a capacity**, like beds or power. It is a standing figure in caps; every
 * officer on the books commits a slice of it; and what is left is the only thing that decides
 * whether you can sign the next one. Nothing is ever deducted from the stockpile for it.
 *
 * That turns a wage into a decision made once, at the table, about a resource the player can see
 * the whole of. The interesting question stops being "can I survive this" and becomes "is this
 * person worth a fifth of my book".
 *
 * ## Growing it costs caps, and there is always another expansion
 *
 * `Increase Payroll` buys `PAYROLL_STEP` of standing capacity (maintainer, 2026-10-01: "It should
 * start at 300 caps for 30 extra payroll, and then scale, being 360 caps for another 30, then 420
 * etc etc and keep going like that"). The price climbs by `PAYROLL_STEP_COST_RISE` with every
 * expansion already bought and never stops climbing, so the sum of the first `n` is
 * `300n + 30n(n - 1)`: a straight line on the button and a parabola on the bill.
 *
 * What is bought is added after the district's payroll cards, not multiplied by them, so the
 * button that says `+30` widens the book by exactly 30 whatever is fitted.
 *
 * ## Letting somebody go
 *
 * Releasing an officer frees their slice immediately and costs `DISMISSAL_WEEKS` of it in caps on
 * the spot. Firing is meant to be a real decision rather than a way to rotate the roster for free.
 *
 * ## Nothing is charged on a clock
 *
 * There is no weekly draw of any kind left in the game. Officers used to take caps every Monday and
 * the district used to eat supplies on the same boundary; both are gone. A cost a player is not
 * present for is a cost they cannot plan against, and the two of them together meant a crew could
 * come back from a fortnight away poorer than they left with nothing on screen to say why. Every
 * price in the game is now paid at the moment somebody presses something.
 */

// --- the book itself ---

/** What every crew starts with, in caps, before a Nexus or a single purchase. */
export const PAYROLL_BASE = 200;

/** Caps the Nexus adds per level: the book grows with the district on its own. */
export const PAYROLL_PER_NEXUS_LEVEL = 25;

/**
 * Caps one expansion adds, flat: the payroll cards do not multiply it.
 *
 * Small on purpose (maintainer, 2026-10-01: "+30 exactly per purchase"). A late officer asks 820
 * to 1,130, so the cards on the Nexus's own figure carry most of a late book and the expansions
 * are the top-up a crew buys one chair's worth at a time.
 */
export const PAYROLL_STEP = 30;

/** What every expansion is paid in. */
export const PAYROLL_STEP_RESOURCE = 'caps' satisfies ResourceKey;

/** Caps the first expansion costs. */
export const PAYROLL_STEP_FIRST_COST = 300;

/** Caps each expansion costs over the one before it: 300, 360, 420 and on, with no ceiling. */
export const PAYROLL_STEP_COST_RISE = 60;

/**
 * Weeks of an officer's own commitment it costs to let them go, paid in caps on the spot.
 *
 * Ten, at the board's rate: an officer on 30 caps a week costs 300 to release. Doubled from five,
 * and the reason is what the book is *for*. Committing costs nothing and releasing is the only
 * thing that walks it back, so the fee is the whole difference between a payroll and a scratch pad
 * a crew rewrites every time a better sheet walks into the Bar. At five weeks the sums worked out
 * in the player's favour too often: sign, try, release, sign again.
 */
export const DISMISSAL_WEEKS = 10;

export const PayrollStateSchema = z.object({
  /**
   * How many `PAYROLL_STEP` expansions the crew has bought.
   *
   * Steps rather than caps, because the price of the next one is a function of how many have been
   * bought and storing the total would make that a second expression of the same fact. Defaulted
   * so a base written before the book existed parses as having bought none.
   */
  purchasedSteps: z.number().int().nonnegative().default(0),
  /**
   * What each officer's contract commits, in caps, keyed by officer id.
   *
   * Whole caps: a fee is a number two people agreed on out loud, and the `.int()` is here so a
   * hand-written row cannot smuggle a fraction into the committed total.
   */
  commitments: z.record(IdSchema, z.number().int().nonnegative()).default({}),
});
export type PayrollState = z.infer<typeof PayrollStateSchema>;

export function startingPayroll(): PayrollState {
  return { purchasedSteps: 0, commitments: {} };
}

/**
 * The part of the book the district's payroll cards multiply: the base and the Nexus.
 *
 * Expansions are not in it. They are added after the multiplier (`payrollCapacity`), so a `+30`
 * on the button is 30 on the book.
 */
export function basePayrollCapacity(nexusLevel: number): number {
  return PAYROLL_BASE + Math.max(0, Math.trunc(nexusLevel)) * PAYROLL_PER_NEXUS_LEVEL;
}

/**
 * The whole ceiling: the Nexus with the district's bonus on it, then what has been bought.
 *
 * `bonusPercent` is `payrollBonusPercent` from `building/standing.ts`, passed in as a plain number
 * so this module never has to know what a building is.
 */
export function payrollCapacity(
  nexusLevel: number,
  purchasedSteps: number,
  bonusPercent = 0,
  /**
   * The Fixer's passive (`passives.ts`, maintainer 2026-10-04): a share of the whole book, the
   * bought expansions included, since it is "the payroll you have" that grows.
   */
  fixerPercent = 0,
): number {
  const multiplied = Math.round(
    basePayrollCapacity(nexusLevel) * (1 + Math.max(0, bonusPercent) / 100),
  );
  const book = multiplied + Math.max(0, Math.trunc(purchasedSteps)) * PAYROLL_STEP;
  return Math.round(book * (1 + Math.max(0, fixerPercent) / 100));
}

/**
 * Caps the next expansion costs, given how many have already been bought.
 *
 * Always a price, and always dearer than the last: there is no last rung, so every screen and
 * route can quote it without a "bought out" case.
 *
 * `discountPercent` is `payrollStepDiscountPercent` off `CrewEffects`: the perk channel for
 * officers who make widening the book cheaper. Passed in as a plain number so this module never
 * has to know what a crew is, the same way `payrollCapacity` takes its bonus.
 */
export function payrollStepCost(purchasedSteps: number, discountPercent = 0): number {
  const bought = Math.max(0, Math.trunc(purchasedSteps));
  const full = PAYROLL_STEP_FIRST_COST + bought * PAYROLL_STEP_COST_RISE;
  const off = Math.min(MAX_PAYROLL_STEP_DISCOUNT, Math.max(0, discountPercent));
  // At least one, so no stack of perks makes widening the book free.
  return Math.max(1, Math.round(full * (1 - off / 100)));
}

/** However many ledger clerks a crew hires, the next step still costs something. */
export const MAX_PAYROLL_STEP_DISCOUNT = 60;

/** Caps already promised to officers. */
export function committedPayroll(commitments: PayrollState['commitments']): number {
  return Object.values(commitments).reduce((total, fee) => total + fee, 0);
}

/** What letting this officer go costs, in caps, right now. */
export function dismissalFee(weeklyFee: number): number {
  return Math.max(0, Math.round(weeklyFee)) * DISMISSAL_WEEKS;
}

/** The book as a screen shows it: the ceiling, what is spoken for, and what is left. */
export const PayrollLedgerSchema = z.object({
  capacity: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  purchasedSteps: z.number().int().nonnegative(),
  /** Caps (`PAYROLL_STEP_RESOURCE`) the next expansion costs. There is always a next one. */
  nextStepCost: z.number().int().positive(),
  /**
   * Caps that purchase would add to `capacity`: `PAYROLL_STEP`, since the district's bonus no
   * longer multiplies what was bought. Derived from the capacity rather than copied from the
   * constant, so the button cannot promise a number the book does not move by.
   */
  stepSize: z.number().int().positive(),
});
export type PayrollLedger = z.infer<typeof PayrollLedgerSchema>;

export function payrollLedger(
  payroll: PayrollState,
  nexusLevel: number,
  bonusPercent = 0,
  stepDiscountPercent = 0,
  fixerPercent = 0,
): PayrollLedger {
  const capacity = payrollCapacity(nexusLevel, payroll.purchasedSteps, bonusPercent, fixerPercent);
  const committed = committedPayroll(payroll.commitments);
  return {
    capacity,
    committed,
    // Never negative on screen. It can genuinely go negative for a crew that demolished its Nexus
    // with a full book, and a player reading "-40 available" learns nothing they cannot see from
    // the two figures above it.
    available: Math.max(0, capacity - committed),
    purchasedSteps: payroll.purchasedSteps,
    nextStepCost: payrollStepCost(payroll.purchasedSteps, stepDiscountPercent),
    stepSize:
      payrollCapacity(nexusLevel, payroll.purchasedSteps + 1, bonusPercent, fixerPercent) -
      capacity,
  };
}

/** Whether one more commitment of this size fits in what is left. */
export function payrollFits(ledger: PayrollLedger, weeklyFee: number): boolean {
  return ledger.committed + Math.max(0, Math.round(weeklyFee)) <= ledger.capacity;
}
