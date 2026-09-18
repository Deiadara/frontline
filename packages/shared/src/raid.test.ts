/**
 * What a raid carries out.
 *
 * `plunder` had no test of its own until this file, and the gap showed: `planks` is priced in
 * `RESOURCE_KG` and stocked by every base, and it was missing from `PLUNDER_PRIORITY`, so no raid
 * in the game had ever taken one. A defender could bank thirty thousand planks behind a broken gate
 * and lose nothing.
 *
 * So the first test here is deliberately not "planks are lootable". It is "every resource the game
 * prices is lootable", derived from the resource list, because the specific omission is the cheap
 * half of the bug and the shape of it is the expensive half: the same hole opens again the day a
 * seventh resource is authored.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_RAID_DISRUPTION_PERCENT,
  MAX_RAID_SHARE,
  MIN_RAID_DISRUPTION_PERCENT,
  PLUNDER_PRIORITY,
  RAID_DISRUPTION_HOURS,
  RESOURCE_KEYS,
  RESOURCE_KG,
  disruptionFrom,
  disruptionPercentAt,
  noDisruption,
  plunder,
  raidDisruptionPercent,
  refreshDisruption,
  weightOf,
  type Resources,
} from './index.js';

/** A full stockpile, so nothing is empty for a reason other than the code under test. */
const stocked = (each = 10_000): Resources =>
  Object.fromEntries(RESOURCE_KEYS.map((key) => [key, each])) as unknown as Resources;

describe('what a raid can take', () => {
  it('can carry out every resource the game prices', () => {
    expect([...PLUNDER_PRIORITY].sort()).toEqual([...RESOURCE_KEYS].sort());
  });

  it('actually takes each one, given a hold big enough for everything', () => {
    // Twice the weight of a quarter of everything: enough that nothing is left behind for capacity.
    const capacity = RESOURCE_KEYS.reduce(
      (total, key) => total + 10_000 * MAX_RAID_SHARE * RESOURCE_KG[key],
      0,
    );
    const haul = plunder(stocked(), capacity * 2);
    for (const key of RESOURCE_KEYS) {
      expect(haul[key], `${key} was left behind by a raid with room for it`).toBe(
        10_000 * MAX_RAID_SHARE,
      );
    }
  });

  it('never takes more than a quarter of any one pile, however big the hold', () => {
    const haul = plunder(stocked(), Number.MAX_SAFE_INTEGER);
    for (const key of RESOURCE_KEYS) {
      expect(haul[key] ?? 0, key).toBeLessThanOrEqual(10_000 * MAX_RAID_SHARE);
    }
  });

  /**
   * The haul is a drawn mix, and the hold still comes home full (maintainer, 2026-09-18).
   *
   * This used to read "fills the hold in priority order and stops when it is full", and asserted
   * that a 100kg hold came home holding exactly 100 caps and nothing else: the top of
   * `PLUNDER_PRIORITY`, to the share cap, then the next. The maintainer asked for the haul to be
   * "assigned randomly between the resources it has", so the order is gone and what has to be true
   * instead is the pair below: more than one line is touched, and none of the hold is wasted.
   *
   * The second half is the half worth guarding. A random split that rounds each line down and stops
   * there leaves the raiders carrying air, which would be a quiet nerf to every raid in the game
   * rather than the mix that was asked for.
   */
  it('spreads the hold across lines and still comes home full', () => {
    const haul = plunder(stocked(), 100, [], 'mixed');
    const lines = RESOURCE_KEYS.filter((key) => (haul[key] ?? 0) > 0);
    expect(lines.length, `one line took the lot: ${JSON.stringify(haul)}`).toBeGreaterThan(1);
    expect(weightOf(haul)).toBeLessThanOrEqual(100);
    /*
     * Full means full: what is left over could not buy one more of anything still on the shelf.
     *
     * A looser bound was tried first and did not work. Asserting the hold came home within one
     * heavy unit of its capacity passed with the top-up pass deleted outright, because a six way
     * split of a hundred kilos rounds down by only a few kilos and the slack swallowed it. The
     * property that actually distinguishes the two is this one, and the mutation that removes the
     * second pass fails it.
     */
    const roomLeft = 100 - weightOf(haul);
    const cheapestStillStocked = Math.min(
      ...RESOURCE_KEYS.filter((key) => (haul[key] ?? 0) < 10_000 * MAX_RAID_SHARE).map(
        (key) => RESOURCE_KG[key],
      ),
    );
    expect(roomLeft, `${roomLeft}kg left with room on the shelf`).toBeLessThan(
      cheapestStillStocked,
    );
  });

  /** A raid is replayable, like everything else a fight decides. */
  it('draws the same haul from the same seed, and a different one from another', () => {
    expect(plunder(stocked(), 100, [], 'raid-a')).toEqual(plunder(stocked(), 100, [], 'raid-a'));
    const runs = ['s1', 's2', 's3', 's4', 's5'].map((seed) =>
      JSON.stringify(plunder(stocked(), 100, [], seed)),
    );
    expect(new Set(runs).size, 'every seed drew the same mix').toBeGreaterThan(1);
  });

  it('carries nothing out of an empty district, and nothing with no hold', () => {
    expect(plunder(stocked(0), 1_000)).toEqual({});
    expect(plunder(stocked(), 0)).toEqual({});
    expect(plunder(stocked(), -50)).toEqual({});
  });

  /** A pile too small for a quarter to round to a whole unit is not a fractional haul. */
  it('never takes a fraction of a unit', () => {
    const haul = plunder(stocked(3), 1_000);
    for (const amount of Object.values(haul)) expect(Number.isInteger(amount)).toBe(true);
  });
});

/**
 * §A4, maintainer 2026-09-09: a raid on a home takes a share of everything **except caps**.
 *
 * The exclusion is the whole reason the carry sheet matters. Caps weigh one apiece and used to sit
 * at the top of a ranked order, so a raid that could take them filled its hold with the victim's
 * wallet and left every material behind. The order is a drawn split since 2026-09-18, which spreads
 * the hold on its own, but the wallet stays off the table: a district's caps are what its owner
 * spends on everything, and a raid is meant to cost them stock rather than options.
 */
describe('what a raid leaves in the till', () => {
  it('never carries out an excluded line, however much room it has', () => {
    const haul = plunder(stocked(), Number.MAX_SAFE_INTEGER, ['caps']);
    expect(haul.caps ?? 0).toBe(0);
  });

  it('spends the hold on the other lines instead of stopping at the excluded one', () => {
    // A 100kg hold, with the wallet off the table: the raiders still go home with 100kg of
    // something. Which something is the draw's business, so this asserts the weight rather than a
    // line: the exclusion must cost the raiders nothing but the caps themselves.
    const haul = plunder(stocked(), 100, ['caps'], 'excluded');
    expect(haul.caps ?? 0).toBe(0);
    expect(weightOf(haul)).toBeGreaterThan(90);
  });

  it('still respects the quarter share and the carry with a line excluded', () => {
    const haul = plunder(stocked(), Number.MAX_SAFE_INTEGER, ['caps']);
    for (const key of RESOURCE_KEYS.filter((key) => key !== 'caps')) {
      expect(haul[key], `${key} was left behind by a raid with room for it`).toBe(
        10_000 * MAX_RAID_SHARE,
      );
    }
    // And the carry still bounds it. Which line a 5kg hold comes home with is the draw's business
    // now, so what is asserted is the bound: a hold that small cannot be over its own weight.
    const small = plunder(stocked(), 5, ['caps'], 'small');
    expect(weightOf(small)).toBeGreaterThan(0);
    expect(weightOf(small)).toBeLessThanOrEqual(5);
  });

  it('takes caps like anything else when nothing is excluded', () => {
    // The positive control for the three above: the exclusion is doing the work, not the stock.
    // Over seeds, because one draw may legitimately leave a line alone; what may not happen is
    // caps never turning up at all when nothing is keeping them off the table.
    const seeds = Array.from({ length: 12 }, (_, i) => `caps-${i}`);
    const withCaps = seeds.filter((seed) => (plunder(stocked(), 100, [], seed).caps ?? 0) > 0);
    expect(withCaps.length, 'caps were never taken by any draw').toBeGreaterThan(0);
  });
});

/**
 * §A4: what a lost raid leaves behind, now that it is the *only* thing it leaves behind.
 *
 * A won raid used to charge the victim twice: three roofs wrecked on a day-long repair clock, and
 * a flat quarter off the whole district for six hours. The maintainer kept the district-wide half
 * and asked for it to move with the defeat. So the two things worth pinning are that the number
 * actually depends on the loss, and that it cannot climb past half however badly the night went.
 */
describe('what a raid leaves behind', () => {
  it('scales the cut with how badly the defence lost', () => {
    expect(raidDisruptionPercent(0)).toBe(MIN_RAID_DISRUPTION_PERCENT);
    expect(raidDisruptionPercent(1)).toBe(MAX_RAID_DISRUPTION_PERCENT);
    // Monotone across the range rather than at the two ends, where a function that ignored its
    // argument between them would still pass.
    const steps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(raidDisruptionPercent);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!, `${steps[i]} is not above ${steps[i - 1]}`).toBeGreaterThan(steps[i - 1]!);
    }
  });

  it('never takes more than half, and never nothing at all', () => {
    expect(MAX_RAID_DISRUPTION_PERCENT).toBeLessThanOrEqual(50);
    expect(MIN_RAID_DISRUPTION_PERCENT).toBeGreaterThan(0);
    // Out of range in both directions, which a caller dividing by a force of zero can produce.
    for (const share of [-5, -0.2, 1.5, Number.POSITIVE_INFINITY]) {
      expect(raidDisruptionPercent(share)).toBeGreaterThanOrEqual(MIN_RAID_DISRUPTION_PERCENT);
      expect(raidDisruptionPercent(share)).toBeLessThanOrEqual(MAX_RAID_DISRUPTION_PERCENT);
    }
  });

  it('runs for six hours from the raid, at the percentage the defeat named', () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const half = disruptionFrom(now, 0.5);
    // Strictly inside the range, so a `raidDisruptionPercent` that ignored its argument would be
    // caught here as well as above rather than agreeing with itself.
    expect(half.percent).toBeGreaterThan(MIN_RAID_DISRUPTION_PERCENT);
    expect(half.percent).toBeLessThan(MAX_RAID_DISRUPTION_PERCENT);
    expect(half.percent).toBe(raidDisruptionPercent(0.5));
    expect(Date.parse(half.until!) - now.getTime()).toBe(RAID_DISRUPTION_HOURS * 3_600_000);
    expect(disruptionPercentAt(half, new Date(now.getTime() + 3_600_000))).toBe(half.percent);
    expect(
      disruptionPercentAt(half, new Date(now.getTime() + (RAID_DISRUPTION_HOURS + 1) * 3_600_000)),
    ).toBe(0);
  });

  /**
   * A second raid refreshes rather than stacks, field by field.
   *
   * Both halves matter now that the percentage moves. Taking the whole of the later record would
   * let a crew who had just flattened a district throw a token raid at it and *lift* the cut from
   * half back to a tenth; summing them would let two crews hold a district at zero for ever, which
   * is the grief tactic this function was written to refuse.
   */
  it('refreshes rather than stacks, and never lifts a standing cut', () => {
    const early = disruptionFrom(new Date('2026-09-18T12:00:00.000Z'), 1);
    const lateAndWeak = disruptionFrom(new Date('2026-09-18T15:00:00.000Z'), 0);

    const after = refreshDisruption(early, lateAndWeak);
    expect(after.until).toBe(lateAndWeak.until);
    expect(after.percent).toBe(early.percent);
    expect(after.percent).toBeLessThanOrEqual(MAX_RAID_DISRUPTION_PERCENT);

    // ...and the other way round: a harsher raid inside a longer standing window raises the cut
    // without shortening it.
    const longStandingWeak = { until: '2026-09-19T12:00:00.000Z', percent: 10 };
    const harsh = disruptionFrom(new Date('2026-09-18T15:00:00.000Z'), 1);
    const harder = refreshDisruption(longStandingWeak, harsh);
    expect(harder.until).toBe(longStandingWeak.until);
    expect(harder.percent).toBe(harsh.percent);

    // Nothing standing takes the fresh one whole, and a fresh one that is nothing leaves it alone.
    expect(refreshDisruption(noDisruption(), harsh)).toEqual(harsh);
    expect(refreshDisruption(harsh, noDisruption())).toEqual(harsh);
  });
});
