import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import { findUnit } from '../units/index.js';
import {
  SPY_LOOK_MINUTES_MAX,
  SPY_LOOK_MINUTES_MIN,
  SPY_PEAK_TOTAL,
  SPY_REPORT_FLOOR,
  sheetTotal,
  spyJobMinutes,
  spyLookMinutesFor,
  spyRecallWindowMs,
  spyRecallable,
  spyRecalledReturnsAt,
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
import { OFFICER_MARK_BAND, OFFICER_MARK_FLOOR } from '../crew/marks.js';
import { findResearchItem } from '../research/tracks.js';
import {
  SPY_BASE_PARTIES,
  openSpyTiers,
  spyFoundOut,
  spyPartiesAllowed,
  spyReportSummary,
  spyTierOpen,
  spyUnnoticedChance,
} from './spying.js';

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
    // Total Intelligence was 10,000 until the maintainer made it a fifth dearer (2026-09-28).
    expect(SPY_TIERS.map((tier) => SPY_TIER_SPECS[tier].caps)).toEqual([
      100, 500, 2000, 5000, 12000,
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

  /*
   * The anchor said "most at exactly 100% other than maybe the strongest counter intelligence".
   * Total Intelligence was made half as strong again on 2026-09-28, and the "maybe" went with it:
   * an S chair at the top tier now reads the strongest rival whole. The tier below still does not,
   * which is what keeps the top tier worth its twelve thousand.
   */
  it('an S chair with Total Intelligence reads everything, the strongest counter-intel included', () => {
    const top = { chairPoints: 100, intelPercent: 25, tier: 'total_intelligence' as const };
    expect(read(top, STRONG_RIVAL, LATE_ARMY).accuracy).toBe(1);
    expect(read(top, GOOD_RIVAL, LATE_ARMY).accuracy).toBe(1);
    expect(read(top, STRONGEST_RIVAL, LATE_ARMY).accuracy).toBe(1);
    const below = read({ ...top, tier: 'network_compromise' }, STRONGEST_RIVAL, LATE_ARMY);
    expect(below.accuracy, `read ${below.accuracy}`).toBeLessThan(1);
  });

  it('makes Total Intelligence half as strong again as it was, for a fifth more caps', () => {
    // Written out, not read back: 2.6 on 10,000 caps was the tier before the ruling.
    expect(SPY_TIER_SPECS.total_intelligence.boost).toBeCloseTo(2.6 * 1.5, 10);
    expect(SPY_TIER_SPECS.total_intelligence.caps).toBe(10_000 * 1.2);
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

/**
 * What a spy job costs in time (moved here with the clock when scouting left, 2026-09-29).
 *
 * The walk plus the looking, and the looking is the half the Master of Whispers changes. These pin
 * the shape, because "a better chair is faster" is the kind of claim that quietly stops being true
 * after a retune.
 */
describe('how long the runners spend on the ground', () => {
  it('takes the longest off a chair with nothing to recommend it', () => {
    expect(spyLookMinutesFor(makeAttributes(0))).toBe(SPY_LOOK_MINUTES_MAX);
  });

  it('takes the least off a chair at the top of the scale, and never less', () => {
    expect(spyLookMinutesFor(makeAttributes(100))).toBe(SPY_LOOK_MINUTES_MIN);
  });

  it('never gets slower as the sheet gets better', () => {
    let previous = Infinity;
    for (let rating = 0; rating <= 100; rating += 5) {
      const minutes = spyLookMinutesFor(makeAttributes(rating));
      expect(minutes).toBeLessThanOrEqual(previous);
      previous = minutes;
    }
  });

  /** The Bar rolls around 15 an attribute, so a fresh hire is slow and staying slow is the cost. */
  it('leaves a fresh recruit nearer the ceiling than the floor', () => {
    const midpoint = (SPY_LOOK_MINUTES_MIN + SPY_LOOK_MINUTES_MAX) / 2;
    expect(spyLookMinutesFor(makeAttributes(15))).toBeGreaterThan(midpoint);
  });

  it('is priced against the whole sheet rather than one attribute', () => {
    const specialist = makeAttributes(0, { stealth: 100, navigation: 100 });
    const rounded = makeAttributes(20);
    expect(sheetTotal(rounded)).toBeGreaterThan(sheetTotal(specialist));
    expect(spyLookMinutesFor(rounded)).toBeLessThan(spyLookMinutesFor(specialist));
  });

  it('reaches the floor at the peak total', () => {
    const atPeak = SPY_PEAK_TOTAL / Object.keys(makeAttributes(0)).length;
    expect(spyLookMinutesFor(makeAttributes(Math.ceil(atPeak)))).toBe(SPY_LOOK_MINUTES_MIN);
  });
});

describe('the whole job', () => {
  it('pays for the walk out and the walk home', () => {
    const sheet = makeAttributes(20);
    expect(spyJobMinutes(60, sheet) - spyJobMinutes(10, sheet)).toBe(100);
  });

  it('is the walk twice plus the looking, and nothing else', () => {
    const sheet = makeAttributes(35);
    expect(spyJobMinutes(25, sheet)).toBe(50 + spyLookMinutesFor(sheet));
  });

  it('still costs the looking when the ground is next door', () => {
    expect(spyJobMinutes(0, makeAttributes(100))).toBe(SPY_LOOK_MINUTES_MIN);
  });
});

/**
 * Turning the runners round (`time/cancel.ts`): the first tenth of the whole job, which for a slow
 * chair is often longer than the walk out, so the walk home is the distance covered capped at the
 * way out.
 */
describe('turning a spy job round', () => {
  const DEPART = Date.parse('2026-09-13T12:00:00.000Z');
  const slow = makeAttributes(0);
  const TRAVEL = 5;
  const run = {
    departedAt: new Date(DEPART).toISOString(),
    travelMinutes: TRAVEL,
    returnsAt: new Date(DEPART + spyJobMinutes(TRAVEL, slow) * 60_000).toISOString(),
    recalledAt: null,
  };

  it('shuts the window a tenth of the whole job, not a tenth of the way out', () => {
    // Five out, four hours looking and five back is 250 minutes, a tenth of which is 25.
    expect(spyRecallWindowMs(run, new Date(DEPART))).toBe(25 * 60_000);
    const shut = DEPART + 25 * 60_000;
    expect(spyRecallable(run, new Date(shut - 1_000))).toBe(true);
    expect(spyRecallable(run, new Date(shut + 1_000))).toBe(false);
  });

  it('stays open after the runners have arrived', () => {
    expect(spyRecallable(run, new Date(DEPART + TRAVEL * 60_000 + 60_000))).toBe(true);
  });

  it('never sends them home for longer than the walk out took', () => {
    const last = new Date(DEPART + spyRecallWindowMs(run, new Date(DEPART)) - 1);
    expect(spyRecalledReturnsAt(run, last).getTime() - last.getTime()).toBe(TRAVEL * 60_000);
    const early = new Date(DEPART + 60_000);
    expect(spyRecalledReturnsAt(run, early).getTime() - early.getTime()).toBe(60_000);
  });

  it('cannot be turned round twice', () => {
    const turned = { ...run, recalledAt: new Date(DEPART + 60_000).toISOString() };
    expect(spyRecallable(turned, new Date(DEPART + 90_000))).toBe(false);
    expect(spyRecallWindowMs(turned, new Date(DEPART + 90_000))).toBe(0);
  });
});

/**
 * The Master of Whispers' track as the maintainer redid it (2026-09-28): the tiers it opens, the
 * parties it lets out, and whether anybody sees them go.
 */
describe('the tiers a crew can buy', () => {
  it('opens Loose Ears to everybody and every other tier on its own rung', () => {
    expect(openSpyTiers([])).toEqual(['loose_ears']);
    // Written out rather than read off the specs, which are the thing under test.
    const opens: Record<SpyTier, { track: string; step: number } | null> = {
      loose_ears: null,
      paid_whisper: { track: 'master_of_whispers', step: 2 },
      bought_eyes: { track: 'master_of_whispers', step: 2 },
      network_compromise: { track: 'master_of_whispers', step: 7 },
      total_intelligence: { track: 'master_of_whispers', step: 10 },
    };
    for (const tier of SPY_TIERS) {
      const rung = SPY_TIER_SPECS[tier].opensWith;
      const expected = opens[tier];
      if (expected === null) {
        expect(rung, tier).toBeNull();
        continue;
      }
      const spec = findResearchItem(rung ?? '');
      expect(spec?.track, tier).toBe(expected.track);
      expect(spec?.step, tier).toBe(expected.step);
      expect(spyTierOpen(tier, []), tier).toBe(false);
      expect(spyTierOpen(tier, [rung!]), tier).toBe(true);
    }
  });

  it('opens them one rung at a time and never skips ahead', () => {
    const paid = SPY_TIER_SPECS.paid_whisper.opensWith!;
    const sleepers = SPY_TIER_SPECS.network_compromise.opensWith!;
    expect(openSpyTiers([paid])).toEqual(['loose_ears', 'paid_whisper', 'bought_eyes']);
    expect(openSpyTiers([paid, sleepers])).not.toContain('total_intelligence');
  });
});

describe('how many parties are out at once', () => {
  it('is one, and one more for every party a rung grants', () => {
    expect(SPY_BASE_PARTIES).toBe(1);
    expect(spyPartiesAllowed(0)).toBe(1);
    expect(spyPartiesAllowed(1)).toBe(2);
    expect(spyPartiesAllowed(-3)).toBe(1);
  });
});

describe('being seen', () => {
  /** The points at the bottom of a mark's band, so the ladder index is exactly `index`. */
  const pointsAt = (index: number) => OFFICER_MARK_FLOOR + index * OFFICER_MARK_BAND + 0.01;

  it('is certain before Traffic Analysis, whatever the chair', () => {
    for (const points of [10, 55, 100]) expect(spyUnnoticedChance(false, points)).toBe(0);
  });

  it('runs linearly from nothing at F- to certainty at S+ once the rung is in', () => {
    expect(spyUnnoticedChance(true, 0)).toBe(0);
    expect(spyUnnoticedChance(true, pointsAt(0))).toBe(0);
    expect(spyUnnoticedChance(true, 100)).toBe(1);
    // Twenty steps on a twenty-one band ladder: a twentieth each.
    for (let index = 0; index <= 20; index += 1) {
      expect(spyUnnoticedChance(true, pointsAt(index)), `band ${index}`).toBeCloseTo(
        index / 20,
        10,
      );
    }
  });

  it('rolls once per run and answers the same way every time it is asked', () => {
    for (const id of ['a', 'run-1', 'b3f0']) {
      expect(spyFoundOut(id, 0.5)).toBe(spyFoundOut(id, 0.5));
    }
    expect(spyFoundOut('any', 0)).toBe(true);
    expect(spyFoundOut('any', 1)).toBe(false);
  });

  it('comes out at the chance it was given, across many runs', () => {
    for (const chance of [0.1, 0.45, 0.9]) {
      const runs = 4000;
      let unseen = 0;
      for (let i = 0; i < runs; i += 1) if (!spyFoundOut(`run-${i}`, chance)) unseen += 1;
      expect(unseen / runs, `chance ${chance}`).toBeGreaterThan(chance - 0.03);
      expect(unseen / runs, `chance ${chance}`).toBeLessThan(chance + 0.03);
    }
  });
});

describe('what a report headline says', () => {
  it('counts heads once it names units, and unit slots before', () => {
    const exposed = { razors: 4, juggernauts: 2 };
    expect(spyReportSummary({ unitsShown: true, exposed, exposedSlots: 99 })).toBe('6 seen');
    expect(spyReportSummary({ unitsShown: false, exposed: {}, exposedSlots: 14 })).toBe(
      '14 unit slots seen',
    );
  });
});
