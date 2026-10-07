import { describe, expect, it } from 'vitest';
import { findUnit, isCombatUnit, UNIT_CATALOG, UNIT_MODIFIERS, type Army } from '../units/index.js';
import { winnerLossFraction } from './attrition.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats, outnumberedWeight } from './effects.js';
import { noTerritoryEffects } from '../city/index.js';
import { evasionCut, exchange, ignoresGate, missChance, targetBonusPercent } from './matchup.js';
import {
  nerve,
  intimidate,
  allocate,
  asFormed,
  intimidationReach,
  MAX_MEND_SHARE,
  MAX_INTIMIDATED_SHARE,
  bareLineRules,
  fightingSlots,
  mendShare,
  outnumberedBy,
  pursue,
  simulate,
  sidePower,
  TAUNT_CEILING,
  TAUNT_FULL_SHARE,
  TAUNT_PULL,
  tauntPull,
  type SideState,
  type Simulation,
  type Stack,
} from './engine.js';
import { PURSUIT_LOSS } from './morale.js';
import { mulberry32, seedFrom } from '../rng.js';

/** A side built the way the engine builds one, for the rules that read a whole side at once. */
const mendSide = (army: Army): SideState =>
  simulate({
    seed: 'mend-side',
    battlefield: bareBattlefield(),
    attacker: { name: 'A', army, defending: false },
    defender: { name: 'D', army: { razors: 1 }, defending: true },
  }).attacker;

/**
 * The engine's behaviour, measured rather than asserted about.
 *
 * The anchor test is the first one: with counters, terrain and morale neutral, a simulated fight
 * has to land on the reference curve from `attrition.ts`: the formula Tribal Wars and Travian
 * have run on for twenty years. That is what keeps a round loop with six tunable constants in it
 * from drifting somewhere unbalanced one pass at a time, and it is the only test here that would
 * fail if the *balance* moved rather than the code.
 */

const army = (entries: Record<string, number>): Army => entries;

function fight(attacking: Army, defending: Army, seed = 'seed-1'): Simulation {
  return simulate({
    seed,
    battlefield: bareBattlefield(),
    attacker: { name: 'A', army: attacking, defending: false },
    defender: { name: 'D', army: defending, defending: true },
  });
}

const bare = (unit: Parameters<typeof effectiveStats>[0]) =>
  effectiveStats(
    unit,
    bareBattlefield(),
    { defending: false, outnumbered: 0 },
    noTerritoryEffects(),
  );

/** Units lost as a fraction of units brought. */
function lossFraction(side: Simulation['attacker']): number {
  const started = side.stacks.reduce((total, stack) => total + stack.started, 0);
  const alive = side.stacks.reduce((total, stack) => total + stack.alive, 0);
  return started === 0 ? 0 : (started - alive) / started;
}

/**
 * A mirror matchup at a given strength ratio, averaged over seeds.
 *
 * Razors against Razors: one unit type, no resistances between them, no terrain, no gate.
 * The only thing left is numbers, which is exactly the case the reference curve describes.
 */
function mirrorLosses(attackers: number, defenders: number): { winnerLoss: number; ratio: number } {
  const runs = 24;
  let winnerLoss = 0;
  let powerRatio = 0;
  for (let seed = 0; seed < runs; seed += 1) {
    const simulation = fight(
      army({ razors: attackers }),
      army({ razors: defenders }),
      `mirror-${seed}`,
    );
    const winner = simulation.winner === 'attacker' ? simulation.attacker : simulation.defender;
    const loser = simulation.winner === 'attacker' ? simulation.defender : simulation.attacker;
    winnerLoss += lossFraction(winner);
    powerRatio += Math.min(defenders, attackers) / Math.max(defenders, attackers);
    void loser;
  }
  return { winnerLoss: winnerLoss / runs, ratio: powerRatio / runs };
}

describe('calibration against the reference curve', () => {
  /**
   * The engine is **strictly kinder to the winner than the reference formula**, and that is a
   * design decision rather than a miss.
   *
   * Tribal Wars and Travian assume a fight to the last body: the loser is annihilated, so it keeps
   * inflicting damage right to the end and the winner pays for every round of it. This game routs
   * instead: a broken stack stops fighting, and its survivors go home to their owner. A fight that
   * ends when somebody runs is always cheaper for the winner than one that ends when somebody dies,
   * so the level *has* to sit under the curve. Measured, it sits at 0.2-0.5× of it.
   *
   * What must still hold is the **shape**, because the shape is what stops a numerically superior
   * player from attacking for free: the cost of winning has to climb steeply as the fight gets
   * closer. These four assertions pin that and nothing else.
   */
  it('never costs the winner more than a fight to the last unit would', () => {
    for (const [attackers, defenders] of [
      [40, 10],
      [40, 20],
      [40, 30],
      [40, 36],
    ] as const) {
      const { winnerLoss, ratio } = mirrorLosses(attackers, defenders);
      expect(winnerLoss, `${attackers} v ${defenders}`).toBeLessThanOrEqual(
        winnerLossFraction(1, ratio),
      );
    }
  });

  it('costs the winner steeply more the closer the fight was', () => {
    const curve = [
      mirrorLosses(40, 10).winnerLoss,
      mirrorLosses(40, 20).winnerLoss,
      mirrorLosses(40, 30).winnerLoss,
      mirrorLosses(40, 36).winnerLoss,
    ];
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i], `step ${i}`).toBeGreaterThan(curve[i - 1]!);
    }
    // ...and accelerating, not linear. A linear cost curve makes every attack equally worth making.
    expect(curve[3]! - curve[2]!).toBeGreaterThan(curve[1]! - curve[0]!);
  });

  /**
   * The number that decides whether the game snowballs. A player who can win a near-even fight
   * cheaply can attack every hour and never rebuild; the reference formula answers this with 85%,
   * and anything in the same neighbourhood keeps attrition a real cost.
   */
  it('makes a near-even win expensive', () => {
    // 0.25 from 0.3 on 2026-09-21: the eight-ratings retune made a line break from its casualties
    // sooner and dodge a little more, and a 40 v 36 mirror now costs the winner about 28% rather
    // than 44%. Still a real price, and the shape assertions above are the ones that carry the
    // calibration; this one only says the price is not small.
    expect(mirrorLosses(40, 36).winnerLoss).toBeGreaterThan(0.25);
  });

  /** ...and the mirror of it: a walkover must stay a walkover, or nobody would ever build up. */
  it('makes a lopsided win cheap', () => {
    expect(mirrorLosses(40, 10).winnerLoss).toBeLessThan(0.12);
  });

  it('gives the bigger force the win in a mirror', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const simulation = fight(army({ razors: 40 }), army({ razors: 12 }), `big-${seed}`);
      expect(simulation.winner, `seed ${seed}`).toBe('attacker');
    }
  });

  /** Round counts are what the log is made of. One-round fights have nothing to report. */
  it('runs long enough to have a story in it', () => {
    const close = fight(army({ razors: 40 }), army({ razors: 36 }), 'length');
    expect(close.rounds.length).toBeGreaterThanOrEqual(4);
    expect(close.rounds.length).toBeLessThanOrEqual(12);
  });
});

describe('the loop itself', () => {
  it('always terminates with somebody holding the ground', () => {
    const rosters: [Army, Army][] = [
      [{ razors: 20 }, { razors: 20 }],
      [{ razors: 1 }, { the_colossus: 1 }],
      [{ snipers: 10 }, { road_reavers: 10 }],
      [{ razors: 200 }, { ironsides: 40, snipers: 20 }],
      [{}, { razors: 5 }],
      [{ razors: 5 }, {}],
    ];
    for (const [attacking, defending] of rosters) {
      const simulation = fight(attacking, defending);
      expect(['attacker', 'defender']).toContain(simulation.winner);
      expect(simulation.rounds.length).toBeLessThanOrEqual(12);
    }
  });

  it('is deterministic: the same seed replays exactly', () => {
    const first = fight(army({ razors: 20, snipers: 5 }), army({ wardens: 12 }), 'replay');
    const second = fight(army({ razors: 20, snipers: 5 }), army({ wardens: 12 }), 'replay');
    expect(second.winner).toBe(first.winner);
    expect(second.rounds).toEqual(first.rounds);
  });

  it('gives different seeds different fights', () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 20; seed += 1) {
      const simulation = fight(army({ razors: 20 }), army({ razors: 19 }), `spread-${seed}`);
      outcomes.add(`${simulation.winner}:${simulation.rounds.length}`);
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  /**
   * Both sides fire from one snapshot, so nothing wins by being first in an array. Swapping the
   * roles of two identical forces must not move the result, if it does, the loop has a bias that
   * would quietly favour whoever the caller happened to put first.
   */
  it('has no first-mover bias', () => {
    let attackerWins = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      if (fight(army({ razors: 20 }), army({ razors: 20 }), `bias-${seed}`).winner === 'attacker') {
        attackerWins += 1;
      }
    }
    expect(attackerWins).toBeGreaterThan(15);
    expect(attackerWins).toBeLessThan(45);
  });

  it('never lets a side finish with more units than it brought', () => {
    const simulation = fight(army({ razors: 30, breakers: 5 }), army({ wardens: 20 }));
    for (const side of [simulation.attacker, simulation.defender]) {
      for (const stack of side.stacks) expect(stack.alive).toBeLessThanOrEqual(stack.started);
    }
  });

  it('rates an empty side at zero power', () => {
    const simulation = fight(army({ razors: 5 }), {});
    expect(sidePower(simulation.defender)).toBe(0);
    expect(simulation.winner).toBe('attacker');
  });
});

describe('the sheet actually drives the result', () => {
  /** The whole point of replacing the coin flip: supply-for-supply, better units win. */
  it('beats rabble with regulars at the same unit-slot cost', () => {
    const razors = findUnit('razors');
    const wardens = findUnit('wardens');
    expect(razors && wardens).toBeTruthy();
    if (!razors || !wardens) return;

    const count = 24;
    let regularsHeld = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const simulation = fight(
        army({ razors: count * wardens.unitSlots }),
        army({ wardens: count * razors.unitSlots }),
        `quality-${seed}`,
      );
      if (simulation.winner === 'defender') regularsHeld += 1;
    }
    expect(regularsHeld).toBeGreaterThan(14);
  });
});

describe('regressions', () => {
  /**
   * A stack that breaks must not be healed by breaking.
   *
   * `pursue` rebuilt the pool as `survivors × full vitality`, so a stack at 40% health that routed
   * came out of the pursuit at *full* health of a smaller number: losing your nerve was the most
   * reliable way to survive a fight. Found by inspection.
   *
   * Tested on `pursue` directly, because the first version of this test asserted
   * `pool <= alive × vitality`, which the buggy code satisfies by construction and which therefore
   * passed against the bug. The invariant that actually holds is that the pool only ever goes down.
   */
  it('takes health off a routing stack rather than restoring it', () => {
    const razors = findUnit('razors');
    expect(razors).toBeDefined();
    if (!razors) return;

    const wounded = {
      unit: razors,
      effective: { ...bare(razors), vitality: 45 },
      alive: 10,
      // Ten units at 40% health. A rebuild would put the survivors back to 45 each.
      pool: 180,
      bodies: new Array<number>(10).fill(18),
      morale: 0,
      brokeAt: 1,
      started: 10,
      charged: 0,
      suppressed: 0,
      dealt: 0,
      sheet: razors.stats,
      modGain: {},
      loudTier: 0,
    };
    const before = {
      alive: wounded.alive,
      pool: wounded.pool,
      perBody: wounded.pool / wounded.alive,
    };

    // Every fifth draw under the pursuit's odds: two of the ten are caught.
    let draw = 0;
    pursue([wounded], () => (draw++ % 5 === 0 ? 0.1 : 0.9));

    expect(wounded.alive).toBe(8);
    expect(wounded.pool).toBeLessThan(before.pool);
    expect(wounded.pool / wounded.alive).toBeCloseTo(before.perBody, 6);
  });

  /**
   * A stack of one or two could not be run down (maintainer, 2026-09-29: "roll per unit"). The
   * share was rounded, so one body stayed one and two stayed two. Each body has its own draw now.
   */
  it('runs down a stack of one or two a fifth of the time a body, like any other', () => {
    const razors = findUnit('razors')!;
    const stackOf = (count: number) => ({
      unit: razors,
      effective: bare(razors),
      alive: count,
      pool: count * bare(razors).vitality,
      bodies: new Array<number>(count).fill(bare(razors).vitality),
      morale: 0,
      brokeAt: 1,
      started: count,
      charged: 0,
      suppressed: 0,
      dealt: 0,
      sheet: razors.stats,
      modGain: {},
      loudTier: 0,
    });
    const next = mulberry32(seedFrom('pursuit-per-body'));
    for (const size of [1, 2, 3, 40]) {
      const trials = 2_000;
      let caught = 0;
      for (let trial = 0; trial < trials; trial += 1) {
        const stack = stackOf(size);
        pursue([stack], next);
        caught += size - stack.alive;
      }
      expect(caught / (trials * size), `a stack of ${size}`).toBeCloseTo(PURSUIT_LOSS, 1);
    }
  });

  it('never leaves a stack holding more health than its units can carry', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const simulation = fight(
        army({ razors: 30, sparks: 10 }),
        army({ wardens: 14, snipers: 6 }),
        `heal-${seed}`,
      );
      for (const side of [simulation.attacker, simulation.defender]) {
        for (const stack of side.stacks) {
          expect(stack.pool, stack.unit.id).toBeLessThanOrEqual(
            stack.alive * stack.effective.vitality + 1e-9,
          );
        }
      }
    }
  });
});

/**
 * The taunt, tested where it actually lives.
 *
 * `matchup.test.ts` pins that the wall would be ignored on threat alone and that its sheet carries
 * the flag. Neither of those is the rule: the rule is that `allocate` reads the flag and moves the
 * fire, and the first version of these tests asserted only the two facts either side of it. Cutting
 * the taunt out of `allocate` entirely left all 262 battle tests green, which is a gate that cannot
 * fail over a mechanic that had stopped working.
 */
describe('a taunting stack takes the fire off the line behind it', () => {
  const stackOf = (id: string, alive: number): Stack => {
    const spec = findUnit(id);
    if (!spec) throw new Error(`no unit ${id}`);
    const effective = effectiveStats(
      spec,
      bareBattlefield(),
      { defending: false, outnumbered: 0 },
      noTerritoryEffects(),
    );
    return {
      unit: spec,
      effective,
      alive,
      pool: alive * effective.vitality,
      bodies: new Array<number>(alive).fill(effective.vitality),
      morale: effective.morale,
      brokeAt: null,
      started: alive,
      charged: 0,
      suppressed: 0,
      dealt: 0,
      sheet: spec.stats,
      modGain: {},
      loudTier: 0,
    };
  };
  const shareOf = (split: { target: Stack; share: number }[], id: string): number =>
    split.find((part) => part.target.unit.id === id)?.share ?? 0;

  const shooter = stackOf('snipers', 10);

  it('pulls at least the full taunt share onto a wall that is half its line or more', () => {
    const wall = stackOf('ironsides', 6);
    const soft = stackOf('stitchers', 6);
    const split = allocate(shooter, [wall, soft]);

    expect(shareOf(split, 'ironsides')).toBeGreaterThanOrEqual(TAUNT_PULL);
    expect(shareOf(split, 'ironsides')).toBeLessThan(TAUNT_PULL * TAUNT_CEILING);
    expect(shareOf(split, 'stitchers')).toBeCloseTo(1 - shareOf(split, 'ironsides'), 10);
    // Whatever the rule does, a stack fires all of its fire.
    expect(split.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1, 10);
  });

  /** The maintainer's rule, 2026-09-29: no hard caps. Every Ironside pulls a little more. */
  it('pulls more for every Ironside, past the knee as well as before it', () => {
    const pulls = [1, 2, 5, 10, 20, 40, 80].map((count) =>
      tauntPull([stackOf('ironsides', count), stackOf('razors', 30)]),
    );
    for (let i = 1; i < pulls.length; i += 1) expect(pulls[i]!).toBeGreaterThan(pulls[i - 1]!);
    expect(pulls.at(-1)!).toBeLessThan(TAUNT_PULL * TAUNT_CEILING);
  });

  /**
   * The 2026-09-29 ruling: the pull scales with the wall's share of its line's unit slots, reaching
   * the ceiling at {@link TAUNT_FULL_SHARE}. A flat 75% let one Ironside screen 200 Razors.
   */
  it('pulls in proportion to the wall share of the line, below the ceiling', () => {
    const slots = findUnit('ironsides')!.unitSlots;
    for (const razors of [4, 10, 40, 200]) {
      const line = [stackOf('ironsides', 1), stackOf('razors', razors)];
      const share = slots / (slots + razors * findUnit('razors')!.unitSlots);
      const expected = TAUNT_PULL * Math.min(1, share / TAUNT_FULL_SHARE);
      expect(tauntPull(line), `1 Ironside and ${razors} Razors`).toBeCloseTo(expected, 10);
      expect(shareOf(allocate(shooter, line), 'ironsides')).toBeCloseTo(expected, 10);
    }
    // A lone Ironside in front of forty Razors takes about a tenth of the fire, not three quarters.
    expect(tauntPull([stackOf('ironsides', 1), stackOf('razors', 40)])).toBeLessThan(0.11);
  });

  it('reads who is standing, so a wall shot down to a sliver screens like a sliver', () => {
    const whole = tauntPull([stackOf('ironsides', 6), stackOf('razors', 30)]);
    const thinned = tauntPull([stackOf('ironsides', 2), stackOf('razors', 30)]);
    expect(thinned).toBeLessThan(whole);
  });

  /** The bit that makes it a taunt rather than a preference: it beats being the better target. */
  it('holds the fire even when everything behind it is a softer target', () => {
    const wall = stackOf('ironsides', 6);
    const behind = [stackOf('stitchers', 6), stackOf('snipers', 6), stackOf('sparks', 10)];
    const split = allocate(shooter, [wall, ...behind]);
    const pull = tauntPull([wall, ...behind]);

    expect(pull).toBeGreaterThan(0.5);
    expect(shareOf(split, 'ironsides')).toBeCloseTo(pull, 10);
    for (const soft of behind) {
      expect(shareOf(split, soft.unit.id), soft.unit.id).toBeLessThan(pull);
    }
  });

  it('goes back to a plain threat split once the wall is down', () => {
    const dead = { ...stackOf('ironsides', 6), alive: 0, pool: 0, bodies: [] };
    const soft = stackOf('stitchers', 6);
    const other = stackOf('sparks', 10);
    const split = allocate(shooter, [dead, soft, other]);

    expect(shareOf(split, 'ironsides')).toBe(0);
    expect(shareOf(split, 'stitchers') + shareOf(split, 'sparks')).toBeCloseTo(1, 10);
  });

  it('changes nothing when there is no wall, and nothing when there is only a wall', () => {
    const soft = stackOf('stitchers', 6);
    const other = stackOf('sparks', 10);
    const none = allocate(shooter, [soft, other]);
    expect(none.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1, 10);
    expect(shareOf(none, 'stitchers')).toBeGreaterThan(0);

    const only = allocate(shooter, [stackOf('ironsides', 6), stackOf('ironsides', 4)]);
    expect(only.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1, 10);
  });

  /**
   * The maintainer's rule, 2026-09-16: a stack that broke is out of the fight.
   *
   * It already did not shoot, and `fighting` already left it out of every reading the engine takes
   * of a side's strength. It was still a target, which was wrong twice over: the line spent its
   * fire on people who had stopped fighting, and a routing stack stood between the enemy and the
   * units still holding, soaking rounds it had no business soaking. A crew whose flank broke was
   * better protected than one whose flank held.
   */
  it('does not fire at a stack that has already broken', () => {
    const broken = { ...stackOf('stitchers', 6), brokeAt: 2 };
    const holding = stackOf('sparks', 10);
    const split = allocate(shooter, [broken, holding]);

    expect(shareOf(split, 'stitchers'), 'a broken stack was still being shot at').toBe(0);
    // ...and the fire is not simply lost: whoever is still fighting takes all of it.
    expect(shareOf(split, 'sparks')).toBeCloseTo(1, 10);
  });

  /** Even a taunting wall stops pulling fire once it has broken: a routed shield is not a shield. */
  it('lets the taunt go when the wall itself breaks', () => {
    const wall = { ...stackOf('ironsides', 6), brokeAt: 3 };
    const soft = stackOf('stitchers', 6);
    const split = allocate(shooter, [wall, soft]);

    expect(shareOf(split, 'ironsides')).toBe(0);
    expect(shareOf(split, 'stitchers')).toBeCloseTo(1, 10);
  });
});

/**
 * The taunt, measured in whole fights over a sweep of seeds (the 2026-09-29 ruling).
 *
 * The allocate tests above pin the split; these pin what it is for. A flat 75% pull made one
 * Ironside worth more than anything else in a line of any size: 36 Razors and 1 Ironside beat 40
 * Razors in 300 of 300 fights, the Ironside never fell, and 200 and 1 beat 203 every time. Ranges
 * rather than points, because the engine is retuned often and a sweep keeps its direction.
 */
describe('a shield line screens in proportion to its size', () => {
  const SEEDS = 300;
  const sweep = (attacking: Army, defending: Army) => {
    let wins = 0;
    let wallFell = 0;
    for (let i = 0; i < SEEDS; i += 1) {
      const result = fight(attacking, defending, `taunt-${i}`);
      if (result.winner === 'attacker') wins += 1;
      const wall = result.attacker.stacks.find((stack) => stack.unit.id === 'ironsides');
      if (wall && wall.alive < wall.started) wallFell += 1;
    }
    return { rate: wins / SEEDS, wallFell: wallFell / SEEDS };
  };

  const token = sweep({ razors: 36, ironsides: 1 }, { razors: 40 });
  const middling = sweep({ razors: 30, ironsides: 3 }, { razors: 40 });
  const half = sweep({ razors: 22, ironsides: 6 }, { razors: 40 });

  // Re-measured 2026-10-02, when being outnumbered started counting unit slots instead of heads
  // (maintainer ruling P10-B). A line with Ironsides in it had felt outnumbered by a Razor line
  // of the same weight, two heads for every Ironside; it no longer does, so every rate rose.
  it('no longer lets one Ironside carry a losing line', () => {
    // Measured 41% (36% by heads, 100% before the screen was sized). The Ironside falls in about
    // one fight of nine since morale reads wounds (2026-10-05, three of five before): the line it
    // screens breaks and runs before the wall is ground down, which is the morale change working.
    expect(token.rate).toBeGreaterThan(0.25);
    expect(token.rate).toBeLessThan(0.55);
    expect(token.wallFell).toBeGreaterThan(0.05);
  });

  it('gives a wall about half its line the fire it was built for', () => {
    // Measured 71% for 30+3 and 100% for 22+6 (25% and 67% by heads; 100% and 93% before the
    // screen was sized). 39 Razors alone take 30% off the same 40.
    expect(middling.rate).toBeGreaterThan(0.55);
    expect(middling.rate).toBeLessThan(0.85);
    expect(half.rate).toBeGreaterThan(0.9);
    expect(half.rate).toBeGreaterThan(token.rate + 0.15);
  });

  it('screens a big line no more than its three slots are worth', () => {
    // Measured 58% against 203 Razors (55% by heads, 100% before the screen was sized); a plain
    // mirror of 203 is about 49%.
    expect(sweep({ razors: 200, ironsides: 1 }, { razors: 203 }).rate).toBeLessThan(0.75);
  });
});

/** Win rates of `armies` in turn against one defender, over the same seeds each. */
const sweepRates = (armies: Army[], defending: Army, prefix: string, seeds = 300): number[] =>
  armies.map((attacking) => {
    let wins = 0;
    for (let i = 0; i < seeds; i += 1) {
      if (fight(attacking, defending, `${prefix}-${i}`).winner === 'attacker') wins += 1;
    }
    return wins / seeds;
  });

/** No step down past the noise of a 300-seed rate: more of a unit is never worse (2026-09-29). */
const NOISE = 0.04;
const neverFalls = (rates: number[], what: string) => {
  for (let i = 1; i < rates.length; i += 1) {
    expect(rates[i]!, `${what}: ${rates.join(', ')}`).toBeGreaterThanOrEqual(rates[i - 1]! - NOISE);
  }
};

describe('more of a unit is never worse, and nothing hard-caps (maintainer, 2026-09-29)', () => {
  /**
   * Last Stand was a step at 1.5 to 1 until 2026-10-02, and Wardens holding against 90 Razors
   * won 55% with 29, 74% with 30 and 39% with 31: the 31st switched it off for the whole line.
   * It ramps now (`outnumberedWeight`), and the same sweep reads 0, 7, 39, 70, 85, 94, 99.
   */
  it('never lowers a held line for another Warden in it, across where Last Stand fades', () => {
    const rates = [26, 27, 28, 29, 30, 31, 32, 33].map((wardens) => {
      let held = 0;
      for (let i = 0; i < 300; i += 1) {
        if (fight({ razors: 90 }, { wardens }, `stand-${i}`).winner === 'defender') held += 1;
      }
      return held / 300;
    });
    neverFalls(rates, 'Wardens holding against 90 Razors');
  });

  it('ramps "when outnumbered" from even numbers to two to one', () => {
    expect(outnumberedWeight(20, 20)).toBe(0);
    expect(outnumberedWeight(16, 20)).toBe(0);
    expect(outnumberedWeight(30, 20)).toBe(0.5);
    expect(outnumberedWeight(40, 20)).toBe(1);
    expect(outnumberedWeight(90, 20)).toBe(1);
    expect(outnumberedWeight(10, 0)).toBe(0);
    const wardens = findUnit('wardens')!;
    const half = effectiveStats(
      wardens,
      bareBattlefield(),
      { defending: false, outnumbered: 0.5 },
      noTerritoryEffects(),
    );
    const full = effectiveStats(
      wardens,
      bareBattlefield(),
      { defending: false, outnumbered: 1 },
      noTerritoryEffects(),
    );
    const none = bare(wardens);
    expect(half.offense - none.offense).toBeCloseTo((full.offense - none.offense) / 2);
    expect(full.offense).toBeGreaterThan(none.offense);
  });

  it('never lowers a line for another Ironside in it', () => {
    const rates = sweepRates(
      [0, 1, 2, 3, 4, 6, 8].map((n) => ({ razors: 30, ...(n > 0 ? { ironsides: n } : {}) })),
      { razors: 40 },
      'wall',
    );
    neverFalls(rates, 'Ironsides added to 30 Razors against 40');
    expect(rates.at(-1)!).toBeGreaterThan(rates[0]! + 0.5);
  });

  it('never lowers a side for another Juggernaut in it', () => {
    const rates = sweepRates(
      [1, 2, 3, 4, 6].map((n) => ({ juggernauts: n })),
      { razors: 40 },
      'fear',
    );
    neverFalls(rates, 'Juggernauts against 40 Razors');
  });

  it('never lowers a line for another medic behind it', () => {
    const rates = sweepRates(
      [0, 2, 4, 6, 8, 10, 12].map((n) => ({ razors: 30, ...(n > 0 ? { stitchers: n } : {}) })),
      { razors: 38 },
      'mend',
    );
    neverFalls(rates, 'Stitchers behind 30 Razors against 38');
  });
});

/**
 * Fear reaches about 1.5 times the intimidating side's own unit slots (maintainer, 2026-09-29).
 *
 * The pressure was the enemy's mean intimidation with no term for numbers, so two Juggernauts (12
 * slots) beat 40 Razors 100% of the time and 100 Razors 99%.
 */
describe('intimidation frightens in proportion to how many are doing it', () => {
  const formed = (army: Army) => asFormed(mendSide(army));

  it('reaches a mirror in full, so even fights are unchanged', () => {
    expect(intimidationReach(formed({ razors: 40 }), formed({ razors: 40 }))).toBeGreaterThan(0.99);
  });

  it('reaches about 1.5 slots of line per slot, and a little more for every unit past that', () => {
    const line = formed({ razors: 40 });
    const reach = [1, 2, 4, 6, 10, 20].map((n) =>
      intimidationReach(formed({ juggernauts: n }), line),
    );
    // Two Juggernauts are 20 slots (ten each since 2026-10-07), so they reach 30 of the 40.
    expect(reach[1]).toBeCloseTo(30 / 40, 10);
    for (let i = 1; i < reach.length; i += 1) expect(reach[i]!).toBeGreaterThan(reach[i - 1]!);
    expect(reach.at(-1)!).toBeLessThan(1);
  });

  it('no longer lets two Juggernauts rout any number of Razors', () => {
    const against = (razors: number) => sweepRates([{ juggernauts: 2 }], { razors }, 'fear')[0]!;
    // Measured 0% and 0% (were 100% and 99%); against a line they do reach, still 100%.
    expect(against(40)).toBeLessThan(0.1);
    expect(against(100)).toBeLessThan(0.05);
    expect(against(12)).toBeGreaterThan(0.9);
  });
});

/**
 * Medics nerfed without a hard cap (maintainer, 2026-09-29): "still a strong unit", "sending 12
 * medics rather than 10 should always be better, but they should not be OP".
 */
describe('a field hospital pays less for every medic past the knee, and never stops paying', () => {
  it('undoes about a quarter of a round with six Stitchers behind thirty', () => {
    const share = mendShare(mendSide({ razors: 30, stitchers: 6 }));
    // Was 0.36 under the hard 0.45 ceiling.
    expect(share).toBeGreaterThan(0.22);
    expect(share).toBeLessThan(0.25);
  });

  it('pays something for every medic, however many came', () => {
    const shares = [1, 4, 8, 10, 12, 20, 40].map((n) =>
      mendShare(mendSide({ razors: 30, stitchers: n })),
    );
    for (let i = 1; i < shares.length; i += 1) expect(shares[i]!).toBeGreaterThan(shares[i - 1]!);
    expect(shares.at(-1)!).toBeLessThan(MAX_MEND_SHARE);
  });

  it('is still strong, and no longer a sure thing', () => {
    const [withMedics, sameSlotsOnTheLine] = sweepRates(
      [{ razors: 30, stitchers: 6 }, { razors: 36 }],
      { razors: 38 },
      'mend',
    );
    // Measured 76% against 9% (was 100% against 10%).
    expect(withMedics!).toBeLessThan(0.9);
    expect(withMedics!).toBeGreaterThan(sameSlotsOnTheLine! + 0.3);
  });
});

/**
 * The porters are never in the line, on **either** side.
 *
 * `combat: false` is a hard rule, and it was enforced only where a force is *chosen*: three server
 * doors refuse to send a porter to a fight. A defender chooses nothing, so a raided crew defended
 * with whatever stood in its district, and 25 Breakers against 20 Razors, 40 Scavengers and 30
 * Haulers killed 24 Scavengers and 23 Haulers. Every one of the 2,524 tests in this repo passed
 * over that, which is why the rule now lives in `buildStacks` where there is no door to forget.
 */
describe('who is actually in the line', () => {
  const fight = (attacking: Army, defending: Army) =>
    simulate({
      seed: 'porters',
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: attacking, defending: false },
      defender: { name: 'D', army: defending, defending: true },
    });

  const porters = UNIT_CATALOG.filter((unit) => !isCombatUnit(unit)).map((unit) => unit.id);

  it('has porters to test with, so this is not vacuous', () => {
    expect(porters.length).toBeGreaterThan(0);
  });

  it('leaves a defending crew’s porters out of the ranks entirely', () => {
    const army: Army = { razors: 20, ...Object.fromEntries(porters.map((id) => [id, 30])) };
    const battle = fight({ breakers: 25 }, army);
    const named = battle.defender.stacks.map((stack) => stack.unit.id);
    for (const id of porters) expect(named, id).not.toContain(id);
    expect(named).toContain('razors');
  });

  it('leaves an attacking crew’s porters out too, wherever the force came from', () => {
    const army: Army = { razors: 20, ...Object.fromEntries(porters.map((id) => [id, 30])) };
    const battle = fight(army, { breakers: 25 });
    for (const id of porters) {
      expect(
        battle.attacker.stacks.map((stack) => stack.unit.id),
        id,
      ).not.toContain(id);
    }
  });

  /** And the consequence that matters: they cannot be killed in a fight they were never in. */
  it('never counts a porter as a casualty', () => {
    const army: Army = { razors: 20, ...Object.fromEntries(porters.map((id) => [id, 30])) };
    const battle = fight({ breakers: 40 }, army);
    for (const stack of [...battle.attacker.stacks, ...battle.defender.stacks]) {
      expect(isCombatUnit(stack.unit), stack.unit.id).toBe(true);
    }
  });

  /**
   * A force of nothing but porters has no line at all, which is the rule read correctly rather
   * than a special case: there is nobody there to fight, so the other side walks in. It used to
   * *win*: forty Scavengers took a location off five Razors.
   */
  it('gives a porters-only force no line, whichever side it is on', () => {
    const only: Army = Object.fromEntries(porters.map((id) => [id, 40]));
    expect(fight(only, { razors: 5 }).defender.stacks.length).toBeGreaterThan(0);
    expect(fight(only, { razors: 5 }).attacker.stacks).toHaveLength(0);
    expect(fight({ razors: 5 }, only).defender.stacks).toHaveLength(0);
  });
});

/**
 * The medics (`UnitSpec.mends`), and the four rules that make them a unit rather than a discount.
 *
 * Every one of these is written the way the mechanic was found to be wrong the first time. The
 * first draft undid a flat number of hit points per medic per round, and the {@link MAX_MEND_SHARE}
 * ceiling bound before that number ever did: sweeping it from 55 to 800 moved not one figure in the
 * trial table, so two medics and twelve medics did exactly the same thing. The cover model is what
 * replaced it, and `scales with how many medics came` is the test that would have caught it.
 */
describe('medics undo part of a round before anybody counts it', () => {
  const medics = UNIT_CATALOG.filter((unit) => unit.mends === true);
  const line = UNIT_CATALOG.filter(
    (unit) => isCombatUnit(unit) && unit.mends !== true && unit.taunts !== true,
  );

  it('has a mending unit and a line to put behind it, so none of this is vacuous', () => {
    expect(medics.length).toBeGreaterThan(0);
    expect(line.length).toBeGreaterThan(0);
  });

  const defenderPool = (attacking: Army, defending: Army, seed: string): number =>
    fight(attacking, defending, seed).defender.stacks.reduce((total, s) => total + s.pool, 0);

  /**
   * The positive control: the same line, the same enemy, the same seed, medics or not.
   *
   * The line is held *constant* rather than traded against the medics, because this test is about
   * whether the mechanic reaches the damage at all. Whether it is worth its unit slots is a different
   * question and a different measurement (see the Stitchers sheet).
   */
  it('leaves a line holding more than it would have without them', () => {
    const without = defenderPool({ breakers: 16 }, { wardens: 20 }, 'mend-a');
    const with8 = defenderPool({ breakers: 16 }, { wardens: 20, stitchers: 8 }, 'mend-a');
    expect(with8).toBeGreaterThan(without);
  });

  it('scales with how many medics came, rather than flipping on at the first one', () => {
    const at = (count: number) =>
      defenderPool(
        { breakers: 16 },
        { wardens: 20, ...(count ? { stitchers: count } : {}) },
        'mend-b',
      );
    const series = [0, 4, 8, 16].map(at);
    expect([...series].sort((a, b) => a - b)).toEqual(series);
    // ...and the ends are far enough apart that the ordering above is not four ties.
    expect(series.at(-1)!).toBeGreaterThan(series[0]! * 1.1);
  });

  it('never lets a hospital cancel a whole round, however many of them there are', () => {
    for (const side of [
      mendSide({ wardens: 4, stitchers: 400 }),
      mendSide({ wardens: 1, stitchers: 1 }),
    ]) {
      expect(mendShare(side)).toBeLessThanOrEqual(MAX_MEND_SHARE);
    }
  });

  /**
   * The rule that keeps a field hospital from being a cheap Warden: medics do not mend medics.
   *
   * Without it, a force of nothing but Stitchers is a force that takes 45% less damage than
   * anybody, which is the opposite of a unit whose blurb is "contribute nothing to a fight".
   */
  it('gives a force of nothing but medics no mending at all', () => {
    expect(mendShare(mendSide({ stitchers: 40 }))).toBe(0);
    expect(mendShare(mendSide({ wardens: 40 }))).toBe(0);
    expect(mendShare(mendSide({ wardens: 40, stitchers: 10 }))).toBeGreaterThan(0);
  });

  /**
   * And the other half of the same rule: a broken *line* is nobody to treat.
   *
   * `allocate` stops firing at a routed stack, so nothing lands on it and there is nothing on it
   * for the medics to undo. It stayed in the denominator anyway, which diluted the hospital exactly
   * as the line was collapsing: twenty Wardens, twenty Razors and five Stitchers sat at 0.225 with
   * the Razors routed, when five medics cover the twenty who are left in full.
   */
  it('stops counting a routed stack as somebody the medics are treating', () => {
    const side = mendSide({ wardens: 20, razors: 20, stitchers: 5 });
    const whole = mendShare(side);
    expect(
      whole,
      'the fixture has to be under the cap or there is nothing to measure',
    ).toBeLessThan(MAX_MEND_SHARE);

    for (const stack of side.stacks) if (stack.unit.id === 'razors') stack.brokeAt = 2;

    expect(mendShare(side)).toBeGreaterThan(whole);
  });

  /** A broken hospital is people running, not people working. */
  it('stops mending once the medics have broken', () => {
    const side = mendSide({ wardens: 20, stitchers: 10 });
    const before = mendShare(side);
    for (const stack of side.stacks) if (stack.unit.mends === true) stack.brokeAt = 3;
    expect(before).toBeGreaterThan(0);
    expect(mendShare(side)).toBe(0);
  });
});

/**
 * `tracking`, the counter that evasion did not have, and since 2026-09-26 a cut to the dodge itself.
 *
 * It was +45% damage against anything at 30 evasion or more, which made 30 a cliff: a unit at 30
 * took more from a tracker than one at 29 and stayed worse off all the way to 60. The maintainer's
 * rule now is that it takes half the target's dodge away, on every target, and adds nothing else.
 */
describe('a tracking sheet halves the dodge of whatever it shoots at', () => {
  const trackers = UNIT_CATALOG.filter((unit) => unit.modifiers.includes('tracking'));
  const dodgers = UNIT_CATALOG.filter((unit) => isCombatUnit(unit) && unit.stats.evasion > 0);

  it('is carried by the trackers and not by the Netrunners, whose shots do nothing', () => {
    expect(trackers.map((unit) => unit.id).sort()).toEqual(['kite_crews', 'the_cartographer']);
    expect(evasionCut(trackers[0]!.modifiers)).toBe(0.5);
    expect(evasionCut(findUnit('netrunners')!.modifiers)).toBe(0);
  });

  it('never pays as a damage bonus on the table', () => {
    for (const tracker of trackers) {
      for (const target of dodgers) {
        expect(
          targetBonusPercent(tracker.modifiers, bare(target), 100),
          `${tracker.id} vs ${target.id}`,
        ).toBe(
          targetBonusPercent(
            tracker.modifiers.filter((id) => id !== 'tracking'),
            bare(target),
            100,
          ),
        );
      }
    }
  });

  /** The consequence, as the share of the fire that goes past and as damage. */
  it('lets half as much of its fire be dodged, at every level of evasion, with no step', () => {
    const tracker = trackers[0]!;
    const without = tracker.modifiers.filter((id) => id !== 'tracking');
    let lastGap = -1;
    for (const evasion of [10, 29, 30, 31, 45, 60, 90]) {
      const target = { ...bare(findUnit('razors')!), evasion };
      const tracked = exchange(bare(tracker), tracker.modifiers, target, 100);
      const plain = exchange(bare(tracker), without, target, 100);
      const missTracked = 1 - tracked.parts.dodge;
      const missPlain = 1 - plain.parts.dodge;
      expect(missTracked, `evasion ${evasion}`).toBeCloseTo(missPlain / 2, 10);
      // Worth more the more there is to cut, and never a jump: the old 30 was a cliff.
      const gap = tracked.perBody - plain.perBody;
      expect(gap, `evasion ${evasion}`).toBeGreaterThan(lastGap);
      lastGap = gap;
    }
    expect(missChance(0)).toBe(0);
  });
});

/**
 * `breaching`: the gate is not there for this unit's hits (maintainer, 2026-09-26).
 *
 * Breakers and Demolishers; every other unit on their side still meets the wall, and the Colossus
 * has the whole side's version instead (`wall_breaker`).
 */
describe('a breaching sheet hits through the gate', () => {
  const gatedWardens = (gatePercent: number) =>
    effectiveStats(
      findUnit('wardens')!,
      bareBattlefield(),
      { defending: true, outnumbered: 0 },
      { ...noTerritoryEffects(), gatePercent },
    );

  it('is carried by the Breakers and the Demolishers, and no longer by the Colossus', () => {
    expect(ignoresGate(findUnit('breakers')!.modifiers)).toBe(true);
    expect(ignoresGate(findUnit('demolishers')!.modifiers)).toBe(true);
    expect(ignoresGate(findUnit('the_colossus')!.modifiers)).toBe(false);
  });

  it('does to a gated defender exactly what it would do with the gate down, as a share of its life', () => {
    const breaker = findUnit('breakers')!;
    const razor = findUnit('razors')!;
    const gated = gatedWardens(60);
    const open = gatedWardens(0);
    expect(gated.vitality).toBeGreaterThan(open.vitality);

    // Damage as a share of one body's life, which is what a gate is supposed to change.
    const share = (attacker: typeof breaker, target: typeof gated) =>
      exchange(bare(attacker), attacker.modifiers, target, 100).perBody / target.vitality;
    expect(share(breaker, gated)).toBeCloseTo(share(breaker, open), 10);
    // Anybody else still meets the wall.
    expect(share(razor, gated)).toBeLessThan(share(razor, open));
  });
});

/**
 * §D3: intimidation silences the shakiest men before a shot is fired.
 *
 * The board's rule: a side's nerve is the morale of every unit in it, the menace against it is the
 * intimidation of every unit opposite, and where menace is greater the difference is spent
 * silencing units cheapest-first. A silenced unit still stands in the line and still takes fire;
 * it just does not shoot.
 */
describe('who is too intimidated to fight (§D3)', () => {
  /** A stack of `alive` units with the morale and intimidation dictated, everything else inert. */
  const intimidatedStack = (alive: number, morale: number, intimidation: number): Stack => {
    const spec = findUnit('razors');
    if (!spec) throw new Error('fixture: no razors in the catalogue');
    const effective = effectiveStats(
      spec,
      bareBattlefield(),
      { defending: false, outnumbered: 0 },
      noTerritoryEffects(),
    );
    return {
      unit: spec,
      effective: { ...effective, morale, intimidation },
      alive,
      pool: alive * effective.vitality,
      bodies: new Array<number>(alive).fill(effective.vitality),
      morale,
      brokeAt: null,
      started: alive,
      charged: 0,
      suppressed: 0,
      dealt: 0,
      sheet: spec.stats,
      modGain: {},
      loudTier: 0,
    };
  };

  const sideOf = (stacks: Stack[]): SideState =>
    ({ stacks, luck: 0, swing: 1, name: 'side', defending: false }) as unknown as SideState;

  /**
   * The board's own worked example, to the unit.
   *
   * Two units at 10 morale and one at 20 is a nerve of 40. One unit at 60 intimidation is a menace
   * of 60. The excess is 20, which buys exactly the two units at 10. The unit at 20 fights.
   */
  it('silences exactly what the excess pays for, cheapest nerve first', () => {
    const weak = intimidatedStack(2, 10, 0);
    const steady = intimidatedStack(1, 20, 0);
    const side = sideOf([steady, weak]);

    expect(nerve(side)).toBe(40);
    expect(intimidate(side, 60)).toBe(2);
    expect(weak.suppressed, 'the two shaky units should be silenced').toBe(2);
    expect(steady.suppressed, 'the steady unit should still fight').toBe(0);
  });

  it('silences nobody when the menace does not clear the nerve', () => {
    const weak = intimidatedStack(2, 10, 0);
    const side = sideOf([weak]);
    // Nerve 20, menace 20: equal is not greater, so nothing is bought.
    expect(intimidate(side, 20)).toBe(0);
    expect(weak.suppressed).toBe(0);
  });

  it('sums both quantities over units, so a big army is proportionally braver', () => {
    const small = sideOf([intimidatedStack(2, 50, 0)]);
    const large = sideOf([intimidatedStack(20, 50, 0)]);
    // One terrifying unit cannot intimidate a legion: the same menace that breaks the small side is
    // nothing against the large one.
    expect(intimidate(small, 150)).toBeGreaterThan(0);
    expect(intimidate(large, 150)).toBe(0);
  });

  it('takes free units first and cannot stall on them', () => {
    const free = intimidatedStack(4, 0, 0);
    const paid = intimidatedStack(4, 10, 0);
    const side = sideOf([paid, free]);
    // Nerve 40. A menace of 60 leaves 20, which takes all four zero-morale units and then two
    // more at 10. Eight units standing, so the ceiling is six and does not bind.
    expect(intimidate(side, 60)).toBe(6);
    expect(free.suppressed).toBe(4);
    expect(paid.suppressed).toBe(2);
  });

  /**
   * And the ceiling, which is the whole of what stops this being a win button (2026-09-17).
   *
   * Menace and nerve are both sums over units, so the comparison scales with the difference in size
   * rather than the ratio: a force three times the size of what it is facing carries a budget that
   * would silence the other side outright. Measured on the shipped sheets before this, 745 against
   * 220 with a +30 intimidation bonus silenced 220 of 220, which is a fight decided from the
   * opening rosters with nothing the loser could do about it.
   */
  it('never silences the whole line, however loud the other side is', () => {
    const line = intimidatedStack(20, 10, 0);
    const side = sideOf([line]);
    // A menace far past anything the sheets can produce, so only the ceiling can be what binds.
    expect(intimidate(side, 1_000_000)).toBe(Math.floor(20 * MAX_INTIMIDATED_SHARE));
    expect(
      Math.max(0, line.alive - line.suppressed),
      'a quarter of the line has to be left shooting',
    ).toBeGreaterThan(0);
  });

  /** The whole point: silenced units are alive, present, and useless. */
  it('leaves the silenced standing rather than killing them', () => {
    const weak = intimidatedStack(8, 10, 0);
    const silenced = intimidate(sideOf([weak]), 1000);
    expect(silenced, 'the fixture has to silence somebody').toBeGreaterThan(0);
    expect(weak.suppressed).toBe(silenced);
    expect(weak.alive, 'suppression is not a casualty').toBe(8);
    expect(weak.pool, 'suppression does not wound').toBe(8 * weak.effective.vitality);
  });

  /**
   * And it reaches the fight: a side that is entirely intimidated deals nothing.
   *
   * Measured through `simulate` rather than through `intimidate` alone, because the field exists only to
   * be read by `fireRound`, and a mechanic that sets a number nothing consumes is the exact class
   * of bug that made `intimidation` worth fixing in the first place.
   */
  it('takes the silenced out of the firing line', () => {
    const timid = intimidatedStack(8, 0, 0);
    const side = sideOf([timid]);
    const silenced = intimidate(side, 1);
    // Free to silence, so the ceiling is the only thing deciding how many.
    expect(silenced).toBe(Math.floor(8 * MAX_INTIMIDATED_SHARE));
    expect(timid.suppressed).toBe(silenced);
    expect(
      Math.max(0, timid.alive - timid.suppressed),
      'what is left over is what still fires',
    ).toBe(8 - silenced);
  });
});

/**
 * And the count reaches the report.
 *
 * `intimidate` returning a number that `simulate` threw away was the first version of this, and it is the
 * same class of defect the whole review has been finding: a value computed correctly and consumed
 * by nobody. A player whose line did a third of its damage with every unit still standing needs the
 * fight to say why.
 */
describe('a fight reports who was intimidated', () => {
  it('carries the count out of the simulation', () => {
    const simulation = fight(army({ razors: 6 }), army({ razors: 6 }));
    expect(Number.isFinite(simulation.intimidated.attacker)).toBe(true);
    expect(Number.isFinite(simulation.intimidated.defender)).toBe(true);
    expect(simulation.intimidated.attacker).toBeGreaterThanOrEqual(0);
    expect(simulation.intimidated.defender).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Two ways the line was miscounted, both found by running the engine a few thousand times.
 *
 * The intimidated stood in the line and took fire, and the count of them never moved: as units fell
 * the silenced number ate the shooters, so a stack that lost half its men had nobody left firing
 * even though three of the five who fell should have been the intimidated ones. And the "outnumbered"
 * reading counted porters, so forty Scavengers behind twenty Razors handed every Warden and
 * Juggernaut sent against them a last stand it had not earned.
 */
describe('counting the line honestly', () => {
  const matchups: [Army, Army][] = [
    [army({ juggernauts: 20 }), army({ razors: 8 })],
    [army({ juggernauts: 30, ironsides: 10 }), army({ razors: 10 })],
    [army({ the_colossus: 3 }), army({ razors: 6 })],
    [army({ juggernauts: 40 }), army({ sparks: 10 })],
  ];

  it('lets the intimidated fall with the rest of the line, never leaving more silenced than standing', () => {
    let intimidatedSomewhere = 0;
    for (const [attacking, defending] of matchups) {
      const simulation = fight(attacking, defending, 'intimidated');
      intimidatedSomewhere += simulation.intimidated.defender;
      for (const stack of simulation.defender.stacks) {
        expect(stack.suppressed, `${stack.unit.id}: silenced past the living`).toBeLessThanOrEqual(
          stack.alive,
        );
      }
    }
    expect(
      intimidatedSomewhere,
      'the matchups have to intimidate somebody or this proves nothing',
    ).toBeGreaterThan(0);
  });

  it('does not count porters as units to be outnumbered by', () => {
    const lastStand = UNIT_MODIFIERS.last_stand.label;
    const reasons = (defending: Army) =>
      fight(army({ wardens: 10 }), defending, 'porters').attacker.stacks[0]?.effective.reasons ??
      [];
    /*
     * Ten Wardens are twenty unit slots, not ten units (maintainer, 2026-09-25).
     *
     * This read sixteen Razors against them as an earned last stand, which was true while the
     * engine counted heads and is false now: sixteen slots against twenty is the Wardens being
     * the *heavier* line. Thirty Razors are past even, so Last Stand holds in part (`outnumberedWeight`).
     */
    expect(reasons(army({ razors: 30 }))).toContain(lastStand);
    // Ten Razors and forty porters do not: the porters never form a line.
    expect(reasons(army({ razors: 10, scavengers: 40 }))).not.toContain(lastStand);
  });

  /**
   * ...and a force is weighed in unit slots, not in bodies (maintainer, 2026-09-25).
   *
   * The engine counted heads while `line.ts` and the feats board counted slots, and two comments
   * asserted it counted slots. Measured before the change: eight Juggernauts, forty-eight slots
   * between them, collected the outnumbered bonus against sixteen Razors carrying sixteen. A side
   * three times the enemy's weight was paid for being outnumbered, and the board recorded the same
   * side as the larger one in the same breath.
   *
   * Both directions are asserted. A rule that simply never fires would satisfy the first line on
   * its own.
   */
  it('weighs a line in unit slots, so heavy units are not a mob to be outnumbered by', () => {
    const lastStand = UNIT_MODIFIERS.last_stand.label;
    const reasons = (attacking: Army, defending: Army) =>
      fight(attacking, defending, 'slots').attacker.stacks[0]?.effective.reasons ?? [];

    // Wardens rather than Juggernauts since 2026-10-07: the Juggernauts lost Last Stand with the
    // Reliquary rework, and the Wardens are the two-slot heavy that kept it. Eight Wardens are 16
    // slots; thirty-two Razors are 32. On heads that is 4:1 against them, and on slots it is 2:1.
    expect(fightingSlots(army({ wardens: 8 }), bareLineRules())).toBe(16);
    expect(fightingSlots(army({ razors: 12 }), bareLineRules())).toBe(12);
    expect(reasons(army({ wardens: 8 }), army({ razors: 12 }))).not.toContain(lastStand);

    // Twenty-four Razors really are half again the Wardens' weight, and it fires.
    expect(reasons(army({ wardens: 8 }), army({ razors: 24 }))).toContain(lastStand);
  });
});

/**
 * How outnumbered a line feels, which is not the same as how many bodies are opposite it.
 *
 * `moralePhase` read `standingUnits` on both halves of the ratio, and that counts the routed. Two
 * errors in opposite directions out of one reading: a line was pressed by men who had already run,
 * and was comforted by its own stacks that had run. Every other reading the engine takes of a
 * side's strength already skipped them (2026-09-16), so this was the odd one out rather than a
 * deliberate exception.
 */
describe('how outnumbered a side is', () => {
  const sideOf = (army: Army): SideState =>
    simulate({
      seed: 'outnumbered',
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army, defending: false },
      defender: { name: 'D', army: { razors: 1 }, defending: true },
    }).attacker;

  it('stops counting the enemy stacks that have run', () => {
    // In unit slots since 2026-10-02: a Warden is two of them.
    const us = sideOf({ razors: 10 });
    const them = sideOf({ razors: 10, wardens: 10 });
    expect(outnumberedBy(us, them)).toBe(3);

    for (const stack of them.stacks) if (stack.unit.id === 'wardens') stack.brokeAt = 2;

    expect(outnumberedBy(us, them)).toBe(1);
  });

  it('stops counting our own stacks that have run, which made a collapse feel safer', () => {
    const us = sideOf({ razors: 10, wardens: 5 });
    const them = sideOf({ razors: 20 });
    expect(outnumberedBy(us, them)).toBe(1);

    for (const stack of us.stacks) if (stack.unit.id === 'wardens') stack.brokeAt = 2;

    expect(outnumberedBy(us, them)).toBe(2);
  });
});
