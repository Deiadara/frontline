import { describe, expect, it } from 'vitest';
import { STARTING_RESOURCES, type Resources } from '../resources.js';
import { MORALE_PER_STARVED_WEEK, MORALE_PER_UNPAID_WAGE_WEEK } from './meters.js';
import {
  PAY_WEEK_MS,
  foodUpkeepFor,
  moralePenaltyFor,
  proratedFirstWage,
  runEconomyCycle,
  startOfPayWeek,
  startingPayroll,
  weeklyWageBill,
  type PayrollState,
} from './payroll.js';

/** 2026-08-10 and 2026-08-17 are Mondays; 2026-08-13 is the Thursday between them. */
const MONDAY = '2026-08-10T00:00:00.000Z';
const THURSDAY = '2026-08-13T09:30:00.000Z';
const SUNDAY_LATE = '2026-08-16T23:59:59.999Z';
const NEXT_MONDAY = '2026-08-17T00:00:00.000Z';

describe('startOfPayWeek', () => {
  it('snaps every instant in a week back to its Monday 00:00 UTC', () => {
    for (const instant of [MONDAY, THURSDAY, SUNDAY_LATE]) {
      expect(startOfPayWeek(new Date(instant)).toISOString()).toBe(MONDAY);
    }
  });

  it('treats a Monday midnight as the start of its own week, not the previous one', () => {
    expect(startOfPayWeek(new Date(NEXT_MONDAY)).toISOString()).toBe(NEXT_MONDAY);
  });

  it('is exactly one week apart across a boundary', () => {
    const delta = new Date(NEXT_MONDAY).getTime() - new Date(MONDAY).getTime();
    expect(delta).toBe(PAY_WEEK_MS);
  });
});

describe('proratedFirstWage (§H7: first payment covers what is left of the week)', () => {
  it('charges a full week when recruitment lands exactly on the boundary', () => {
    expect(proratedFirstWage(700, new Date(MONDAY))).toBe(700);
  });

  it('charges half a week at the midpoint', () => {
    const midweek = new Date(new Date(MONDAY).getTime() + PAY_WEEK_MS / 2);
    expect(proratedFirstWage(700, midweek)).toBe(350);
  });

  it('charges close to nothing an hour before the boundary', () => {
    const lastHour = new Date(new Date(NEXT_MONDAY).getTime() - 60 * 60 * 1000);
    // One hour of a 168-hour week at 700 caps.
    expect(proratedFirstWage(700, lastHour)).toBe(Math.round(700 / 168));
  });
});

describe('foodUpkeepFor (§D1: more officers require more food)', () => {
  it('costs nothing with no officers', () => {
    expect(foodUpkeepFor(0)).toBe(0);
  });

  it('charges a whole number of food at every crew size', () => {
    expect([1, 2, 3, 4, 5, 6].map(foodUpkeepFor)).toEqual([2, 5, 9, 14, 20, 27]);
  });

  it('makes each additional officer cost more than the one before', () => {
    const marginals = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => foodUpkeepFor(n) - foodUpkeepFor(n - 1));
    for (let i = 1; i < marginals.length; i++) {
      expect(marginals[i]).toBeGreaterThan(marginals[i - 1] ?? 0);
    }
  });
});

describe('runEconomyCycle', () => {
  const wages = { 'officer-a': 120, 'officer-b': 80 };
  const payrollAt = (paidThroughAt: string): PayrollState => ({ paidThroughAt, wages });
  const richly: Resources = { ...STARTING_RESOURCES, caps: 5000, food: 5000 };

  it('settles nothing before the week turns over', () => {
    const result = runEconomyCycle({
      resources: richly,
      payroll: payrollAt(MONDAY),
      officerCount: 2,
      now: new Date(SUNDAY_LATE),
    });

    expect(result.weeksSettled).toBe(0);
    expect(result.resources).toEqual(richly);
    expect(result.payroll.paidThroughAt).toBe(MONDAY);
  });

  it('settles exactly one week the instant the boundary is reached', () => {
    const result = runEconomyCycle({
      resources: richly,
      payroll: payrollAt(MONDAY),
      officerCount: 2,
      now: new Date(NEXT_MONDAY),
    });

    expect(result.weeksSettled).toBe(1);
    expect(result.capsDue).toBe(200);
    expect(result.capsPaid).toBe(200);
    expect(result.foodDue).toBe(foodUpkeepFor(2));
    expect(result.resources.caps).toBe(richly.caps - 200);
    expect(result.resources.food).toBe(richly.food - foodUpkeepFor(2));
    expect(result.payroll.paidThroughAt).toBe(NEXT_MONDAY);
  });

  it('does not settle one millisecond before the boundary', () => {
    const justBefore = new Date(new Date(NEXT_MONDAY).getTime() - 1);
    const result = runEconomyCycle({
      resources: richly,
      payroll: payrollAt(MONDAY),
      officerCount: 2,
      now: justBefore,
    });

    expect(result.weeksSettled).toBe(0);
  });

  it('catches up honestly across a long absence', () => {
    const threeWeeksOn = new Date(new Date(MONDAY).getTime() + 3 * PAY_WEEK_MS);
    const result = runEconomyCycle({
      resources: richly,
      payroll: payrollAt(MONDAY),
      officerCount: 2,
      now: threeWeeksOn,
    });

    expect(result.weeksSettled).toBe(3);
    expect(result.capsDue).toBe(3 * weeklyWageBill(wages));
    expect(result.foodDue).toBe(3 * foodUpkeepFor(2));
  });

  it('pays what it can and reports the shortfall when the stockpile is short', () => {
    const broke: Resources = { ...STARTING_RESOURCES, caps: 50, food: 3 };
    const result = runEconomyCycle({
      resources: broke,
      payroll: payrollAt(MONDAY),
      officerCount: 2,
      now: new Date(NEXT_MONDAY),
    });

    expect(result.capsPaid).toBe(50);
    expect(result.capsShortfall).toBe(150);
    expect(result.foodConsumed).toBe(3);
    expect(result.foodShortfall).toBe(foodUpkeepFor(2) - 3);
    expect(result.resources.caps).toBe(0);
    expect(result.resources.food).toBe(0);
    // The week is still settled: an unpaid week must not be billed twice.
    expect(result.payroll.paidThroughAt).toBe(NEXT_MONDAY);
  });

  it('never claws wages back when the clock jumps backwards', () => {
    const result = runEconomyCycle({
      resources: richly,
      payroll: payrollAt(NEXT_MONDAY),
      officerCount: 2,
      now: new Date(MONDAY),
    });

    expect(result.weeksSettled).toBe(0);
    expect(result.resources).toEqual(richly);
    expect(result.payroll.paidThroughAt).toBe(NEXT_MONDAY);
  });

  it('still charges food upkeep when no wage has been negotiated yet', () => {
    const result = runEconomyCycle({
      resources: richly,
      payroll: { paidThroughAt: MONDAY, wages: {} },
      officerCount: 3,
      now: new Date(NEXT_MONDAY),
    });

    expect(result.capsDue).toBe(0);
    expect(result.foodDue).toBe(foodUpkeepFor(3));
  });

  it('starts a new base already settled for the week it was founded in', () => {
    const payroll = startingPayroll(THURSDAY);
    expect(payroll.paidThroughAt).toBe(MONDAY);

    const sameWeek = runEconomyCycle({
      resources: richly,
      payroll,
      officerCount: 1,
      now: new Date(SUNDAY_LATE),
    });
    expect(sameWeek.weeksSettled).toBe(0);
  });
});

describe('moralePenaltyFor (§D4: an unpaid crew notices)', () => {
  const wages = { 'officer-a': 120, 'officer-b': 80 };
  const cycleFrom = (resources: Partial<Resources>, weeks: number) =>
    runEconomyCycle({
      resources: { ...STARTING_RESOURCES, caps: 0, food: 0, ...resources },
      payroll: { paidThroughAt: MONDAY, wages },
      officerCount: 2,
      now: new Date(new Date(MONDAY).getTime() + weeks * PAY_WEEK_MS),
    });

  it('costs nothing when everyone was paid and fed', () => {
    const cycle = cycleFrom({ caps: 5000, food: 5000 }, 1);

    expect(cycle.capsShortfall).toBe(0);
    expect(cycle.foodShortfall).toBe(0);
    expect(moralePenaltyFor(cycle)).toBe(0);
  });

  it('costs nothing when no week turned over', () => {
    expect(moralePenaltyFor(cycleFrom({ caps: 0, food: 0 }, 0))).toBe(0);
  });

  it('charges wages and rations separately, and wages more', () => {
    const starved = cycleFrom({ caps: 5000, food: 0 }, 1);
    const unpaid = cycleFrom({ caps: 0, food: 5000 }, 1);

    expect(moralePenaltyFor(starved)).toBe(MORALE_PER_STARVED_WEEK);
    expect(moralePenaltyFor(unpaid)).toBe(MORALE_PER_UNPAID_WAGE_WEEK);
    expect(moralePenaltyFor(unpaid)).toBeLessThan(moralePenaltyFor(starved));
  });

  it('charges both when the stockpile is empty', () => {
    expect(moralePenaltyFor(cycleFrom({ caps: 0, food: 0 }, 1))).toBe(
      MORALE_PER_UNPAID_WAGE_WEEK + MORALE_PER_STARVED_WEEK,
    );
  });

  it('costs three weeks of morale for a three-week absence', () => {
    const cycle = cycleFrom({ caps: 0, food: 0 }, 3);

    expect(cycle.weeksSettled).toBe(3);
    expect(moralePenaltyFor(cycle)).toBe(
      3 * (MORALE_PER_UNPAID_WAGE_WEEK + MORALE_PER_STARVED_WEEK),
    );
  });

  it('counts a part-paid week as a missed payday rather than rounding it away', () => {
    // One week owed, all but a single cap covered: the crew was still not paid.
    const cycle = cycleFrom({ caps: 199, food: 5000 }, 1);

    expect(cycle.capsShortfall).toBe(1);
    expect(moralePenaltyFor(cycle)).toBe(MORALE_PER_UNPAID_WAGE_WEEK);
  });

  it('cannot be short when nothing was owed', () => {
    const noPayroll = runEconomyCycle({
      resources: { ...STARTING_RESOURCES, caps: 0, food: 0 },
      payroll: { paidThroughAt: MONDAY, wages: {} },
      officerCount: 0,
      now: new Date(new Date(MONDAY).getTime() + PAY_WEEK_MS),
    });

    expect(noPayroll.capsDue).toBe(0);
    expect(noPayroll.foodDue).toBe(0);
    expect(moralePenaltyFor(noPayroll)).toBe(0);
  });
});
