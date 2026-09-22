import { describe, expect, it } from 'vitest';
import { findUnit } from '../units/index.js';
import {
  SPY_REPORT_FLOOR,
  SPY_TIERS,
  SPY_TIER_SPECS,
  bodyCost,
  counterScore,
  expose,
  spyReportStands,
  spyScore,
  type CounterStrength,
  type SpyTier,
  SPY_GATE_POINTS_PER_LEVEL,
} from './spying.js';
import { GATE_INTEL_RESISTANCE_PER_LEVEL } from '../building/standing.js';

/**
 * The spy contest, tuned to the maintainer's anchors (2026-09-22).
 *
 * The anchors are the ruling, quoted: early game, the cheapest tier, a bad Master of Whispers and
 * few bonuses read "around 30%" of a looter camp "which does not have good counter intelligence",
 * and "below 25%" against real counter-intelligence; mid game needs the middle tiers to be
 * competitive and late game the late ones; S grade with Total Intelligence reads "most at exactly
 * 100% other than maybe the strongest counter intelligence"; a B+ officer with the second-best
 * tier against mid-to-good counter-intelligence and good stealth reads "about 80%"; and "to get
 * 50% you have a similar setup to the counter intelligence with mid tier stealth units and mid caps
 * spent". Each is a scenario below with a band round it, and the constants in `spying.ts` were set
 * by running these rather than by reasoning about them.
 *
 * The chair figures are fit points, 10..100, which is what `officerFitReader` hands the
 * server: a bad chair around 25, a B+ around 85, an S at the ceiling.
 */
const stealthOf = (unitId: string): number => findUnit(unitId)!.stats.stealth;
const visible = (unitId: string): boolean => {
  const spec = findUnit(unitId)!;
  return spec.unspyable !== true && spec.sleeper !== true;
};

function read(
  spy: Parameters<typeof spyScore>[0],
  counter: CounterStrength,
  army: Record<string, number>,
) {
  const budget = spyScore(spy) - counterScore(counter);
  return expose({ army, stealthOf, visible, budget });
}

const LOOTER_CAMP: CounterStrength = { kind: 'looters', districtDifficulty: 2, baseDefense: 30 };
const EARLY_RIVAL: CounterStrength = {
  kind: 'crew',
  consigliereChairPoints: 45,
  intelResistancePercent: 5,
  gateLevel: 2,
};
const MID_RIVAL: CounterStrength = {
  kind: 'crew',
  consigliereChairPoints: 60,
  intelResistancePercent: 8,
  gateLevel: 3,
};
const GOOD_RIVAL: CounterStrength = {
  kind: 'crew',
  consigliereChairPoints: 72,
  intelResistancePercent: 15,
  gateLevel: 5,
};
const STRONG_RIVAL: CounterStrength = {
  kind: 'crew',
  consigliereChairPoints: 85,
  intelResistancePercent: 25,
  gateLevel: 6,
};
const STRONGEST_RIVAL: CounterStrength = {
  kind: 'crew',
  consigliereChairPoints: 100,
  intelResistancePercent: 45,
  gateLevel: 10,
};

/** Twenty bodies of the cheapest ground a camp holds. */
const CAMP = { razors: 14, scrapers: 6 };
/** A mid line: mid stealth, sixty bodies. */
const MID_LINE = { razors: 30, scrapers: 30 };
/** Good stealth: a third of it Ghosts. */
const QUIET_LINE = { razors: 20, scrapers: 20, ghosts: 20 };
/** A late army with everything in it, Sleepers and a Specter included. */
const LATE_ARMY = { razors: 30, snipers: 20, ghosts: 30, sleepers: 4, the_specter: 1 };

describe('the tiers', () => {
  it('cost what the maintainer priced them at, in order, and each buys more than the last', () => {
    expect(SPY_TIERS.map((tier) => SPY_TIER_SPECS[tier].caps)).toEqual([
      100, 500, 2000, 5000, 10000,
    ]);
    const boosts = SPY_TIERS.map((tier) => SPY_TIER_SPECS[tier].boost);
    expect(boosts[0]).toBe(0);
    for (let i = 1; i < boosts.length; i += 1) expect(boosts[i]).toBeGreaterThan(boosts[i - 1]!);
  });

  it('raise the score as a share of the points, not a flat sum', () => {
    const weak = spyScore({ chairPoints: 20, intelPercent: 0, tier: 'total_intelligence' });
    const strong = spyScore({ chairPoints: 100, intelPercent: 0, tier: 'total_intelligence' });
    expect(strong / weak).toBeCloseTo(5, 5);
  });
});

describe('the report', () => {
  it('never names a unit that is not there, nor more of one than are there', () => {
    const out = expose({ army: CAMP, stealthOf, visible, budget: 10_000 });
    expect(out.exposed).toEqual(CAMP);
    expect(out.accuracy).toBe(1);
    expect(out.unseen).toBe(0);
  });

  it('spends cheapest first and stops inside a stack rather than rounding it up', () => {
    const cost = bodyCost(stealthOf('razors'));
    const out = expose({ army: { ghosts: 5, razors: 10 }, stealthOf, visible, budget: cost * 6.5 });
    expect(out.exposed).toEqual({ razors: 6 });
    expect(out.accuracy).toBeCloseTo(6 / 15, 5);
  });

  it('never lists a Specter, and never a Sleeper without the rung, and does not count them', () => {
    const out = expose({ army: LATE_ARMY, stealthOf, visible, budget: 10_000 });
    expect(out.exposed).toEqual({ razors: 30, snipers: 20, ghosts: 30 });
    expect(out.countable).toBe(80);
    expect(out.accuracy).toBe(1);
    const withSleepers = expose({
      army: LATE_ARMY,
      stealthOf,
      visible: (id) => findUnit(id)!.unspyable !== true,
      budget: 10_000,
    });
    expect(withSleepers.exposed).toEqual({ razors: 30, snipers: 20, ghosts: 30, sleepers: 4 });
  });

  it('is the same report twice for the same ground and budget', () => {
    const a = expose({ army: LATE_ARMY, stealthOf, visible, budget: 60 });
    const b = expose({ army: { ...LATE_ARMY }, stealthOf, visible, budget: 60 });
    expect(a).toEqual(b);
  });

  it('fails below a quarter', () => {
    expect(spyReportStands(SPY_REPORT_FLOOR)).toBe(true);
    expect(spyReportStands(SPY_REPORT_FLOOR - 0.001)).toBe(false);
  });
});

describe('the anchors', () => {
  const early = (tier: SpyTier) => ({ chairPoints: 25, intelPercent: 4, tier });

  it('early, cheapest tier, bad chair: about a third of a looter camp', () => {
    const out = read(early('loose_ears'), LOOTER_CAMP, CAMP);
    expect(out.accuracy, `read ${out.accuracy}`).toBeGreaterThanOrEqual(0.2);
    expect(out.accuracy, `read ${out.accuracy}`).toBeLessThanOrEqual(0.42);
  });

  it('early, cheapest tier: nothing against real counter-intelligence', () => {
    const out = read(early('loose_ears'), EARLY_RIVAL, CAMP);
    expect(spyReportStands(out.accuracy), `read ${out.accuracy}`).toBe(false);
  });

  it('mid game: the cheap tiers are not competitive and the middle one is', () => {
    const mid = (tier: SpyTier) => ({ chairPoints: 60, intelPercent: 8, tier });
    expect(read(mid('loose_ears'), MID_RIVAL, MID_LINE).accuracy).toBeLessThan(SPY_REPORT_FLOOR);
    expect(read(mid('paid_whisper'), MID_RIVAL, MID_LINE).accuracy).toBeLessThan(0.5);
    const bought = read(mid('bought_eyes'), MID_RIVAL, MID_LINE);
    expect(bought.accuracy, `read ${bought.accuracy}`).toBeGreaterThanOrEqual(0.4);
    expect(bought.accuracy, `read ${bought.accuracy}`).toBeLessThanOrEqual(0.6);
  });

  it('a B+ chair with the second-best tier, against good counter-intel and good stealth: about 80%', () => {
    const out = read(
      { chairPoints: 85, intelPercent: 10, tier: 'network_compromise' },
      GOOD_RIVAL,
      QUIET_LINE,
    );
    expect(out.accuracy, `read ${out.accuracy}`).toBeGreaterThanOrEqual(0.7);
    expect(out.accuracy, `read ${out.accuracy}`).toBeLessThanOrEqual(0.9);
  });

  it('an S chair with Total Intelligence reads everything, short of the strongest counter-intel', () => {
    const top = { chairPoints: 100, intelPercent: 25, tier: 'total_intelligence' as const };
    expect(read(top, STRONG_RIVAL, LATE_ARMY).accuracy).toBe(1);
    expect(read(top, GOOD_RIVAL, LATE_ARMY).accuracy).toBe(1);
    const hardest = read(top, STRONGEST_RIVAL, LATE_ARMY);
    expect(hardest.accuracy, `read ${hardest.accuracy}`).toBeGreaterThanOrEqual(0.75);
    expect(hardest.accuracy, `read ${hardest.accuracy}`).toBeLessThan(1);
  });

  it('late game needs the late tiers: the middle one no longer reads a strong rival', () => {
    const late = (tier: SpyTier) => ({ chairPoints: 85, intelPercent: 15, tier });
    expect(read(late('bought_eyes'), STRONG_RIVAL, LATE_ARMY).accuracy).toBeLessThan(0.5);
    expect(read(late('total_intelligence'), STRONG_RIVAL, LATE_ARMY).accuracy).toBeGreaterThan(0.9);
  });

  it('reads Combine ground harder than looter ground, and harder the deeper the district', () => {
    const chosen = { chairPoints: 60, intelPercent: 8, tier: 'bought_eyes' as const };
    const camp = read(chosen, LOOTER_CAMP, MID_LINE).accuracy;
    const shallow = read(
      chosen,
      { kind: 'government', districtDifficulty: 2, baseDefense: 30 },
      MID_LINE,
    ).accuracy;
    const deep = read(
      chosen,
      { kind: 'government', districtDifficulty: 9, baseDefense: 60 },
      MID_LINE,
    ).accuracy;
    expect(shallow).toBeLessThan(camp);
    expect(deep).toBeLessThan(shallow);
  });
});

describe('the gate', () => {
  it('is worth the same per level on the board as in the contest', () => {
    expect(SPY_GATE_POINTS_PER_LEVEL).toBe(GATE_INTEL_RESISTANCE_PER_LEVEL);
  });
});
