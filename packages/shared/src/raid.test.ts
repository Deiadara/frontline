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
  MAX_RAID_SHARE,
  PLUNDER_PRIORITY,
  RAID_CUT_ASYMPTOTE,
  RAID_DISRUPTION_HOURS,
  RESOURCE_KEYS,
  RESOURCE_KG,
  disruptionFrom,
  disruptionPercentAt,
  leadLootExtra,
  noDisruption,
  plunder,
  raidDisruptionPercent,
  stackDisruption,
  weightOf,
  type Disruption,
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
/** The officer's loot perk (maintainer, 2026-10-06): more of what was carried, from the victim. */
describe('what a leading officer adds to the haul', () => {
  it('takes the percentage of each line carried off', () => {
    expect(leadLootExtra(stocked(), { scrap: 1_000, oil: 50 }, 12)).toEqual({ scrap: 120, oil: 6 });
  });

  it('never takes more than the victim still holds once the haul is out', () => {
    const stock = { ...stocked(), scrap: 1_050, oil: 50 };
    expect(leadLootExtra(stock, { scrap: 1_000, oil: 50 }, 12)).toEqual({ scrap: 50 });
  });

  it('adds nothing without the perk, and nothing to a line nobody carried', () => {
    expect(leadLootExtra(stocked(), { scrap: 1_000 }, 0)).toEqual({});
    expect(leadLootExtra(stocked(), {}, 12)).toEqual({});
  });
});

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
 * §A4: what a lost raid leaves behind (maintainer ruling, 2026-09-29).
 *
 * A cut to what the district's structures make, for six hours, sized by the raid's blow (the share
 * of the defending line lost) through a curve with no clamp on it. The numbers are pinned by hand
 * because they are what the ruling's "not too punishing" was measured against: a light raid 10%,
 * a medium one 20%, a crushing one 30%.
 */
describe('what a raid leaves behind', () => {
  it('cuts by the measured amounts for a light, a medium and a crushing raid', () => {
    expect(raidDisruptionPercent(0)).toBe(0);
    expect(raidDisruptionPercent(0.2)).toBeCloseTo(10, 9);
    expect(raidDisruptionPercent(0.5)).toBeCloseTo(20, 9);
    expect(raidDisruptionPercent(1)).toBeCloseTo(30, 9);
    // A blow below zero is nothing, not a bonus.
    expect(raidDisruptionPercent(-3)).toBe(0);
  });

  /**
   * No hard cap (the maintainer's standing rule): every extra bit of blow costs something, each
   * costs less than the one before, and the asymptote is never reached however hard the night.
   */
  it('climbs for ever, by less each time, and never reaches its asymptote', () => {
    const blows = [0, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 100, 1e6];
    const cuts = blows.map(raidDisruptionPercent);
    for (let i = 1; i < cuts.length; i += 1) {
      expect(cuts[i]!, `${blows[i]} did not cut more than ${blows[i - 1]}`).toBeGreaterThan(
        cuts[i - 1]!,
      );
      expect(cuts[i]!).toBeLessThan(RAID_CUT_ASYMPTOTE);
    }
    // Diminishing: the same step of blow buys less the further along it is taken.
    const step = (at: number): number =>
      raidDisruptionPercent(at + 0.25) - raidDisruptionPercent(at);
    expect(step(0)).toBeGreaterThan(step(0.5));
    expect(step(0.5)).toBeGreaterThan(step(1));
    expect(step(1)).toBeGreaterThan(step(3));
  });

  it('runs for six hours from the raid, at the percentage the blow named', () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const half = disruptionFrom(now, 0.5);
    expect(half.percent).toBe(raidDisruptionPercent(0.5));
    expect(Date.parse(half.until!) - now.getTime()).toBe(RAID_DISRUPTION_HOURS * 3_600_000);
    expect(disruptionPercentAt(half, new Date(now.getTime() + 3_600_000))).toBe(half.percent);
    expect(
      disruptionPercentAt(half, new Date(now.getTime() + (RAID_DISRUPTION_HOURS + 1) * 3_600_000)),
    ).toBe(0);
  });

  /**
   * Repeated raids add their blows, not their cuts, and the old blow counts for what is left of
   * its window. Back to back, two crushing raids are 40% and three are 45%: smooth, where
   * multiplying what each leaves (70% of 70% of 70%) would be 66% and heading for zero.
   */
  it('stacks back-to-back raids through the curve, not by multiplying them', () => {
    const at = new Date('2026-09-18T12:00:00.000Z');
    const two = stackDisruption(disruptionFrom(at, 1), disruptionFrom(at, 1));
    expect(two.percent).toBeCloseTo(40, 9);
    const three = stackDisruption(two, disruptionFrom(at, 1));
    expect(three.percent).toBeCloseTo(45, 9);
    const multiplied = 100 * (1 - 0.7 ** 3);
    expect(three.percent).toBeLessThan(multiplied);

    // Ten crushing raids in one breath are still short of the asymptote.
    let piled = noDisruption();
    for (let i = 0; i < 10; i += 1) piled = stackDisruption(piled, disruptionFrom(at, 1));
    expect(piled.percent).toBeCloseTo(raidDisruptionPercent(10), 9);
    expect(piled.percent).toBeLessThan(RAID_CUT_ASYMPTOTE);
  });

  it('counts the first raid for what is left of its window', () => {
    const first = disruptionFrom(new Date('2026-09-18T12:00:00.000Z'), 1);
    // Three of its six hours gone: half of its blow is still standing.
    const second = disruptionFrom(new Date('2026-09-18T15:00:00.000Z'), 1);
    const after = stackDisruption(first, second);
    expect(after.percent).toBeCloseTo(raidDisruptionPercent(1.5), 9);
    // The new record starts at the new raid and runs its six hours: the caller has already
    // banked the hours before it at the old rate.
    expect(after.since).toBe(second.since);
    expect(after.until).toBe(second.until);

    // Nothing standing takes the fresh one whole, and a fresh one that is nothing leaves it alone.
    expect(stackDisruption(noDisruption(), second)).toEqual(second);
    expect(stackDisruption(second, noDisruption())).toEqual(second);
  });

  /**
   * The grief case, from the other side: a token raid on a district that was just flattened must
   * not be a way out of the cut. The rate it leaves can be lower for a few hours, spread over six
   * fresh ones, but the production still owed never falls. Measured across the whole of the old
   * window and a spread of blows rather than at one point.
   */
  it('never lowers the cut still owed, whatever the second raid was', () => {
    const owed = (record: Disruption, from: number): number => {
      if (record.until === null) return 0;
      const hours = Math.max(0, Date.parse(record.until) - from) / 3_600_000;
      return (record.percent * hours) / 100;
    };
    const landed = Date.parse('2026-09-18T12:00:00.000Z');
    for (const standing of [0.2, 0.5, 1, 3]) {
      const first = disruptionFrom(new Date(landed), standing);
      for (const hoursLater of [0.01, 1, 3, 5, 5.99]) {
        for (const token of [0, 0.01, 0.2, 1]) {
          const when = landed + hoursLater * 3_600_000;
          const after = stackDisruption(first, disruptionFrom(new Date(when), token));
          expect(
            owed(after, when),
            `blow ${standing} then ${token} after ${hoursLater}h`,
          ).toBeGreaterThanOrEqual(owed(first, when) - 1e-9);
        }
      }
    }
  });

  /** Audit, 2026-09-28: the old record's rate and start used to survive its own expiry. */
  it('lets a disruption that has run out go, rather than merging it into the next raid', () => {
    const first = disruptionFrom(new Date('2026-09-18T10:00:00.000Z'), 1);
    const second = disruptionFrom(new Date('2026-09-18T20:00:00.000Z'), 0.2);
    expect(first.percent).toBeGreaterThan(second.percent);

    const after = stackDisruption(first, second);
    expect(after).toEqual(second);
    // The evening between the two ran at full strength, and the new raid runs at its own rate.
    expect(disruptionPercentAt(after, new Date('2026-09-18T18:00:00.000Z'))).toBe(0);
    expect(disruptionPercentAt(after, new Date('2026-09-18T21:00:00.000Z'))).toBe(second.percent);
    // Expiring on the very instant the next raid lands is expired too.
    const onTheMark = disruptionFrom(new Date(Date.parse(first.until!)), 0.2);
    expect(stackDisruption(first, onTheMark)).toEqual(onTheMark);
  });

  /** A record written before this ruling, at the old ceiling of 50, still stacks like any other. */
  it('reads a record from before the ruling as the blow it stands for', () => {
    const at = '2026-09-18T12:00:00.000Z';
    const old: Disruption = { since: at, until: '2026-09-18T18:00:00.000Z', percent: 50 };
    const after = stackDisruption(old, disruptionFrom(new Date(at), 0));
    expect(after.percent).toBeCloseTo(50, 9);
  });
});
