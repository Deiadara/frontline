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
  roughAccuracy,
  roughUnseen,
  spyReportStands,
  spyDefenceMean,
  spyDefencePercent,
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
 *
 * Retuned on 2026-10-01, after the spy bonuses came off every rating and rung: the intel and
 * resistance figures below are perks, ground and cards now, and each rival's other officers carry
 * their Signals and Cryptography as `officersPercent`, at means a crew of that stage typically has
 * (20 early, 35 mid, 45 good, 55 strong, 70 the strongest). The three middle boosts rose (0.4, 1.2
 * and 1.6 to 0.8, 1.7 and 2.1) on the maintainer's ask for the cheap tiers to read an equal crew
 * as they did; the one anchor that moved says so where it is.
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
  return expose({ forces: [{ army, stealthOf }], visible, budget });
}

const LOOTER_CAMP: CounterStrength = { kind: 'looters', districtDifficulty: 2, baseDefense: 30 };
const EARLY_RIVAL: CounterStrength = {
  kind: 'crew',
  whispersChairPoints: 45,
  intelResistancePercent: 5,
  gateLevel: 2,
  officersPercent: spyDefencePercent(20),
};
const MID_RIVAL: CounterStrength = {
  kind: 'crew',
  whispersChairPoints: 60,
  intelResistancePercent: 8,
  gateLevel: 3,
  officersPercent: spyDefencePercent(35),
};
const GOOD_RIVAL: CounterStrength = {
  kind: 'crew',
  whispersChairPoints: 72,
  intelResistancePercent: 15,
  gateLevel: 5,
  officersPercent: spyDefencePercent(45),
};
const STRONG_RIVAL: CounterStrength = {
  kind: 'crew',
  whispersChairPoints: 85,
  intelResistancePercent: 25,
  gateLevel: 6,
  officersPercent: spyDefencePercent(55),
};
const STRONGEST_RIVAL: CounterStrength = {
  kind: 'crew',
  whispersChairPoints: 100,
  intelResistancePercent: 45,
  gateLevel: 10,
  officersPercent: spyDefencePercent(70),
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
    const out = expose({ forces: [{ army: CAMP, stealthOf }], visible, budget: 10_000 });
    expect(out.exposed).toEqual(CAMP);
    expect(out.accuracy).toBe(1);
    expect(out.unseen).toBe(0);
  });

  // An empty gate used to read perfectly whatever the defence, so a failed report alone said that
  // somebody stood there (bug pass, 2026-10-02). Empty ground now reads only to a spy who beat it.
  it('reads empty ground only when the spy beat the counter', () => {
    const empty = { forces: [{ army: {}, stealthOf }], visible };
    expect(spyReportStands(expose({ ...empty, budget: 5 }).accuracy)).toBe(true);
    expect(spyReportStands(expose({ ...empty, budget: 0 }).accuracy)).toBe(false);
    expect(spyReportStands(expose({ ...empty, budget: -40 }).accuracy)).toBe(false);
  });

  it('spends cheapest first and stops inside a stack rather than rounding it up', () => {
    const cost = bodyCost(stealthOf('razors'));
    const out = expose({
      forces: [{ army: { ghosts: 5, razors: 10 }, stealthOf }],
      visible,
      budget: cost * 6.5,
    });
    expect(out.exposed).toEqual({ razors: 6 });
    expect(out.accuracy).toBeCloseTo(6 / 15, 5);
  });

  it('never lists a Specter, and never a Sleeper without the rung, and does not count them', () => {
    const out = expose({ forces: [{ army: LATE_ARMY, stealthOf }], visible, budget: 10_000 });
    expect(out.exposed).toEqual({ razors: 30, snipers: 20, ghosts: 30 });
    expect(out.countable).toBe(80);
    expect(out.accuracy).toBe(1);
    const withSleepers = expose({
      forces: [{ army: LATE_ARMY, stealthOf }],
      visible: (id) => findUnit(id)!.unspyable !== true,
      budget: 10_000,
    });
    expect(withSleepers.exposed).toEqual({ razors: 30, snipers: 20, ghosts: 30, sleepers: 4 });
  });

  it('is the same report twice for the same ground and budget', () => {
    const a = expose({ forces: [{ army: LATE_ARMY, stealthOf }], visible, budget: 60 });
    const b = expose({ forces: [{ army: { ...LATE_ARMY }, stealthOf }], visible, budget: 60 });
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

  /*
   * Bought Eyes read this rival at 40% to 60% until 2026-10-01, when the maintainer asked for it to
   * read an equal crew at 90% or more (the case below). This rival is not an equal: a gate of 3
   * the spy has nothing against, and its officers at 35. It reads 70% now, and the band says so.
   */
  it('mid game: the cheapest tier is not competitive and the middle ones are', () => {
    const mid = (tier: SpyTier) => ({ chairPoints: 60, intelPercent: 8, tier });
    expect(read(mid('loose_ears'), MID_RIVAL, MID_LINE).accuracy).toBeLessThan(SPY_REPORT_FLOOR);
    expect(read(mid('paid_whisper'), MID_RIVAL, MID_LINE).accuracy).toBeLessThan(0.5);
    const bought = read(mid('bought_eyes'), MID_RIVAL, MID_LINE);
    expect(bought.accuracy, `read ${bought.accuracy}`).toBeGreaterThanOrEqual(0.6);
    expect(bought.accuracy, `read ${bought.accuracy}`).toBeLessThanOrEqual(0.8);
  });

  /*
   * The maintainer's ask of 2026-10-01: a mid-game crew spying an equal crew lands where it did
   * before the spy bonuses came off, Paid Whisper about 40% and Bought Eyes 90% or more. The crew
   * is the modelled one the retune was measured on: a D chair (42 points), Street Ears and a level 3
   * Pirate Radio (32 spy points), a gate at 4, and other officers at 30 to 45 on the two skills.
   */
  it('a mid crew reads its equal at about 40% on Paid Whisper and 90% or more on Bought Eyes', () => {
    const spy = (tier: SpyTier) => ({ chairPoints: 42.2, intelPercent: 32, tier });
    for (const mean of [30, 38, 45]) {
      const equal: CounterStrength = {
        kind: 'crew',
        whispersChairPoints: 42.2,
        intelResistancePercent: 0,
        gateLevel: 4,
        officersPercent: spyDefencePercent(mean),
      };
      const paid = read(spy('paid_whisper'), equal, MID_LINE).accuracy;
      expect(paid, `officers at ${mean}: read ${paid}`).toBeGreaterThanOrEqual(0.33);
      expect(paid, `officers at ${mean}: read ${paid}`).toBeLessThanOrEqual(0.5);
      const bought = read(spy('bought_eyes'), equal, MID_LINE).accuracy;
      expect(bought, `officers at ${mean}: read ${bought}`).toBeGreaterThanOrEqual(0.9);
      expect(read(spy('loose_ears'), equal, MID_LINE).accuracy).toBeLessThan(SPY_REPORT_FLOOR);
    }
  });

  /*
   * "about 80%" until 2026-10-01, when the maintainer took Network Compromise to 2.1 so that it is
   * clearly worth its 5,000 caps over Bought Eyes, knowing it reads this rival at about 97%. Still
   * not the whole of it: the last few Ghosts are what Total Intelligence is for.
   */
  it('a B+ chair with the second-best tier, against good counter-intel and good stealth: about 97%', () => {
    const out = read(
      { chairPoints: 85, intelPercent: 10, tier: 'network_compromise' },
      GOOD_RIVAL,
      QUIET_LINE,
    );
    expect(out.accuracy, `read ${out.accuracy}`).toBeGreaterThanOrEqual(0.93);
    expect(out.accuracy, `read ${out.accuracy}`).toBeLessThan(1);
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
    // Written out, not read back: 2.6 on 10,000 caps was the tier before the ruling, and the
    // half is on the job's score (maintainer, 2026-10-01), not on the boost alone.
    const before = { chairPoints: 60, intelPercent: 10 };
    expect(spyScore({ ...before, tier: 'total_intelligence' })).toBeCloseTo(
      70 * (1 + 2.6) * 1.5,
      10,
    );
    expect(SPY_TIER_SPECS.total_intelligence.caps).toBe(10_000 * 1.2);
  });

  it('late game needs the late tiers: the middle one no longer reads a strong rival', () => {
    const late = (tier: SpyTier) => ({ chairPoints: 85, intelPercent: 15, tier });
    expect(read(late('bought_eyes'), STRONG_RIVAL, LATE_ARMY).accuracy).toBeLessThan(0.5);
    expect(read(late('total_intelligence'), STRONG_RIVAL, LATE_ARMY).accuracy).toBeGreaterThan(0.9);
  });

  it('reads Combine ground harder than looter ground, and harder the deeper the district', () => {
    // Paid Whisper, not Bought Eyes: since Bought Eyes rose to 1.7 (2026-10-01) it reads a camp and
    // a shallow Combine district whole, and a test of "harder" needs a read that is not full.
    const chosen = { chairPoints: 60, intelPercent: 8, tier: 'paid_whisper' as const };
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

describe('the defending Master of Whispers', () => {
  /*
   * Maintainer, 2026-10-01: "a master of whispers in defense with same grade ... cancels out a
   * spying master of whispers with equivalent strength ... so if they have the same attributes the
   * bonus becomes 0 and it's up to the rest".
   */
  it('cancels an equal chair on the cheapest tier, leaving the rest to decide', () => {
    for (const points of [10, 45, 72, 100]) {
      const spy = spyScore({ chairPoints: points, intelPercent: 0, tier: 'loose_ears' });
      const bare: CounterStrength = {
        kind: 'crew',
        whispersChairPoints: points,
        intelResistancePercent: 0,
        gateLevel: 0,
        officersPercent: 0,
      };
      expect(spy - counterScore(bare)).toBe(0);
      expect(spy + 12 - counterScore(bare)).toBe(12);
      expect(spy - counterScore({ ...bare, gateLevel: 1 })).toBe(-SPY_GATE_POINTS_PER_LEVEL);
    }
  });

  it('defends nothing with nobody working the chair', () => {
    const empty: CounterStrength = {
      kind: 'crew',
      whispersChairPoints: null,
      intelResistancePercent: 0,
      gateLevel: 0,
      officersPercent: 0,
    };
    expect(counterScore(empty)).toBe(0);
    expect(counterScore({ ...empty, whispersChairPoints: 60 })).toBe(60);
  });
});

/**
 * The other officers' Signals and Cryptography (maintainer, 2026-10-01): "if they are below 30
 * they apply a penalty ... at worst making it about 10% easier if they were both 1. it's about
 * break even at 30, and then they add the more they go up, but again not too much, up to roughly
 * 25%". The anchors are written out, not read back from the constants.
 */
describe("the other officers' guard against spies", () => {
  it('is -10% at a mean of 1, nothing at 30, and linear between', () => {
    expect(spyDefencePercent(1)).toBeCloseTo(-10, 9);
    expect(spyDefencePercent(0)).toBeCloseTo(-10, 9);
    expect(spyDefencePercent(30)).toBeCloseTo(0, 9);
    expect(spyDefencePercent(15.5)).toBeCloseTo(-5, 9);
  });

  it('climbs past 30 to about +20% at 70 and closes on +25% without reaching it', () => {
    expect(spyDefencePercent(31)).toBeGreaterThan(0);
    expect(spyDefencePercent(45)).toBeCloseTo(11.3, 1);
    expect(spyDefencePercent(70)).toBeCloseTo(20, 0);
    expect(spyDefencePercent(100)).toBeGreaterThan(23);
    expect(spyDefencePercent(100)).toBeLessThan(25);
    let previous = spyDefencePercent(1);
    for (let mean = 2; mean <= 100; mean += 1) {
      const next = spyDefencePercent(mean);
      expect(next, `mean ${mean}`).toBeGreaterThan(previous);
      previous = next;
    }
  });

  it('reads nothing either way with no officer to read', () => {
    expect(spyDefenceMean([])).toBeNull();
    expect(spyDefencePercent(null)).toBe(0);
  });

  it('averages the two skills over every sheet it is given, and nothing else on them', () => {
    const sheet = (signals: number, cryptography: number) =>
      makeAttributes(90, { signals, cryptography });
    expect(spyDefenceMean([sheet(10, 30)])).toBe(20);
    expect(spyDefenceMean([sheet(10, 30), sheet(50, 70)])).toBe(40);
  });

  it('moves the whole of a crew counter by its percentage, after the sum', () => {
    const counter: CounterStrength = {
      kind: 'crew',
      whispersChairPoints: 50,
      intelResistancePercent: 10,
      gateLevel: 4,
      officersPercent: 0,
    };
    expect(counterScore(counter)).toBe(100);
    expect(counterScore({ ...counter, officersPercent: -10 })).toBeCloseTo(90, 9);
    expect(counterScore({ ...counter, officersPercent: 20 })).toBeCloseTo(120, 9);
  });

  it('makes a read of the same ground easier below 30 and harder above it', () => {
    const spy = { chairPoints: 60, intelPercent: 8, tier: 'paid_whisper' as const };
    const at = (mean: number) =>
      read(spy, { ...MID_RIVAL, officersPercent: spyDefencePercent(mean) }, MID_LINE).accuracy;
    expect(at(1)).toBeGreaterThan(at(30));
    expect(at(30)).toBeGreaterThan(at(70));
  });
});

describe('several owners on one place', () => {
  it("reads each owner's units at that owner's stealth, and merges what it saw by unit", () => {
    const plain = (unitId: string) => findUnit(unitId)!.stats.stealth;
    const hidden = (unitId: string) => findUnit(unitId)!.stats.stealth + 200;
    const cost = bodyCost(plain('razors'));
    // Budget for nine cheap Razors: read at the holder's stealth the ally's would be four more,
    // but at their own stealth not one of them is affordable with what is left.
    const out = expose({
      forces: [
        { army: { razors: 5 }, stealthOf: plain },
        { army: { razors: 5 }, stealthOf: hidden },
      ],
      visible,
      budget: cost * 9,
    });
    expect(out.exposed).toEqual({ razors: 5 });
    expect(out.countable).toBe(10);
    const same = expose({
      forces: [
        { army: { razors: 5 }, stealthOf: plain },
        { army: { razors: 5 }, stealthOf: plain },
      ],
      visible,
      budget: cost * 9,
    });
    expect(same.exposed).toEqual({ razors: 9 });
  });
});

describe('the printed figures', () => {
  it('rounds the accuracy to a tenth, and never to a full hundred with anything missed', () => {
    expect(roughAccuracy(1)).toBe(1);
    expect(roughAccuracy(0.99)).toBe(0.9);
    expect(roughAccuracy(0.64)).toBe(0.6);
    expect(roughAccuracy(0.25)).toBe(0.3);
  });

  it('turns the bodies missed into a guess rather than a count', () => {
    expect(roughUnseen(0)).toBe(0);
    for (const n of [1, 4, 7]) expect(roughUnseen(n)).toBe(5);
    expect(roughUnseen(8)).toBe(10);
    expect(roughUnseen(34)).toBe(30);
    expect(roughUnseen(96)).toBe(100);
    expect(roughUnseen(170)).toBe(150);
    // Across a run of real counts the guess is off by up to half a band, and lands on the count
    // itself only where the count is a round number.
    const exact = Array.from({ length: 200 }, (_, i) => i + 1).filter((n) => roughUnseen(n) === n);
    expect(exact.every((n) => n % 5 === 0)).toBe(true);
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
