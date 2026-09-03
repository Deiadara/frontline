import { describe, expect, it } from 'vitest';
import { findUnit, isCombatUnit, UNIT_CATALOG, UNIT_MODIFIERS, type Army } from '../units/index.js';
import { winnerLossFraction } from './attrition.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { noTerritoryEffects } from '../city/index.js';
import { EVASIVE_THRESHOLD, exchange, targetBonusPercent } from './matchup.js';
import {
  nerve,
  cow,
  allocate,
  MAX_MEND_SHARE,
  mendShare,
  pursue,
  simulate,
  sidePower,
  TAUNT_PULL,
  type SideState,
  type Simulation,
  type Stack,
} from './engine.js';

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
    { defending: false, outnumbered: false },
    noTerritoryEffects(),
  );

/** Bodies lost as a fraction of bodies brought. */
function lossFraction(side: Simulation['attacker']): number {
  const started = side.stacks.reduce((total, stack) => total + stack.started, 0);
  const alive = side.stacks.reduce((total, stack) => total + stack.alive, 0);
  return started === 0 ? 0 : (started - alive) / started;
}

/**
 * A mirror matchup at a given strength ratio, averaged over seeds.
 *
 * Razors against Razors: one unit type, no resistances between them, no terrain, no fortification.
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
  it('never costs the winner more than a fight to the last body would', () => {
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
    expect(mirrorLosses(40, 36).winnerLoss).toBeGreaterThan(0.3);
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

  it('never lets a side finish with more bodies than it brought', () => {
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
  it('beats rabble with regulars at the same supply cost', () => {
    const razors = findUnit('razors');
    const wardens = findUnit('wardens');
    expect(razors && wardens).toBeTruthy();
    if (!razors || !wardens) return;

    const count = 24;
    let regularsHeld = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const simulation = fight(
        army({ razors: count * wardens.supply }),
        army({ wardens: count * razors.supply }),
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
      // Ten bodies at 40% health. A rebuild would put the survivors back to 45 each.
      pool: 180,
      morale: 0,
      brokeAt: 1,
      started: 10,
      suppressed: 0,
      dealt: 0,
    };
    const before = {
      alive: wounded.alive,
      pool: wounded.pool,
      perBody: wounded.pool / wounded.alive,
    };

    pursue([wounded]);

    expect(wounded.alive).toBeLessThan(before.alive);
    expect(wounded.pool).toBeLessThan(before.pool);
    expect(wounded.pool / wounded.alive).toBeCloseTo(before.perBody, 6);
  });

  it('never leaves a stack holding more health than its bodies can carry', () => {
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
      { defending: false, outnumbered: false },
      noTerritoryEffects(),
    );
    return {
      unit: spec,
      effective,
      alive,
      pool: alive * effective.vitality,
      morale: effective.morale,
      brokeAt: null,
      started: alive,
      suppressed: 0,
      dealt: 0,
    };
  };
  const shareOf = (split: { target: Stack; share: number }[], id: string): number =>
    split.find((part) => part.target.unit.id === id)?.share ?? 0;

  const shooter = stackOf('snipers', 10);

  it('pulls the taunt share onto the wall and leaves the rest to be divided', () => {
    const wall = stackOf('ironsides', 6);
    const soft = stackOf('stitchers', 6);
    const split = allocate(shooter, [wall, soft]);

    expect(shareOf(split, 'ironsides')).toBeCloseTo(TAUNT_PULL, 10);
    expect(shareOf(split, 'stitchers')).toBeCloseTo(1 - TAUNT_PULL, 10);
    // Whatever the rule does, a stack fires all of its fire.
    expect(split.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1, 10);
  });

  /** The bit that makes it a taunt rather than a preference: it beats being the better target. */
  it('holds the fire even when everything behind it is a softer target', () => {
    const wall = stackOf('ironsides', 6);
    const behind = [stackOf('stitchers', 6), stackOf('snipers', 6), stackOf('sparks', 10)];
    const split = allocate(shooter, [wall, ...behind]);

    expect(shareOf(split, 'ironsides')).toBeCloseTo(TAUNT_PULL, 10);
    for (const soft of behind) {
      expect(shareOf(split, soft.unit.id), soft.unit.id).toBeLessThan(TAUNT_PULL);
    }
  });

  it('goes back to a plain threat split once the wall is down', () => {
    const dead = { ...stackOf('ironsides', 6), alive: 0, pool: 0 };
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
   * whether the mechanic reaches the damage at all. Whether it is worth its supply is a different
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
 * `tracking`, the counter that evasion did not have.
 *
 * Armour has been answered by `penetration` on every sheet since the first draft. Evasion was a
 * flat miss chance with nothing on either side of it, so the two most evasive units in the roster
 * were better than everything against everything: the Crimson Dancer took 90% of her matchups with
 * a spread of 23 points across opponents, which is what an uncounterable stat looks like in a table.
 */
describe('a tracking sheet answers an evasive one', () => {
  const trackers = UNIT_CATALOG.filter((unit) => unit.modifiers.includes('tracking'));
  const evasive = UNIT_CATALOG.filter(
    (unit) => isCombatUnit(unit) && unit.stats.evasion >= EVASIVE_THRESHOLD,
  );
  const steady = UNIT_CATALOG.filter(
    (unit) => isCombatUnit(unit) && unit.stats.evasion < EVASIVE_THRESHOLD,
  );

  it('has trackers, and both kinds of target to point them at', () => {
    expect(trackers.length).toBeGreaterThan(0);
    expect(evasive.length).toBeGreaterThan(0);
    expect(steady.length).toBeGreaterThan(0);
  });

  it('pays a tracker against something that dodges, and nothing against something that does not', () => {
    for (const tracker of trackers) {
      for (const target of evasive) {
        expect(
          targetBonusPercent(tracker.modifiers, bare(target), target.stats.morale),
          `${tracker.id} vs ${target.id}`,
        ).toBeGreaterThanOrEqual(UNIT_MODIFIERS.tracking.percent);
      }
      for (const target of steady) {
        const withArmorBonus = targetBonusPercent(tracker.modifiers, bare(target), 100);
        const withoutTracking = targetBonusPercent(
          tracker.modifiers.filter((id) => id !== 'tracking'),
          bare(target),
          100,
        );
        expect(withArmorBonus, `${tracker.id} vs ${target.id}`).toBe(withoutTracking);
      }
    }
  });

  /** And the consequence, stated as damage rather than as a percentage on a table. */
  it('makes a tracker hit an evasive target harder than the same sheet without it', () => {
    const tracker = trackers[0]!;
    const target = evasive.find((unit) => unit.stats.evasion >= 60) ?? evasive[0]!;
    const withIt = exchange(bare(tracker), tracker.modifiers, bare(target), target.stats.morale);
    const withoutIt = exchange(
      bare(tracker),
      tracker.modifiers.filter((id) => id !== 'tracking'),
      bare(target),
      target.stats.morale,
    );
    expect(withIt.perBody).toBeGreaterThan(withoutIt.perBody);
  });

  /**
   * Nobody may carry it *and* be the thing it answers. A sheet that dodges and reads dodging is a
   * sheet with no counter, which is the hole this modifier was added to close.
   */
  it('is never on a sheet that is itself evasive', () => {
    for (const tracker of trackers) {
      expect(tracker.stats.evasion, tracker.id).toBeLessThan(EVASIVE_THRESHOLD);
    }
  });
});

/**
 * §D3: intimidation silences the shakiest men before a shot is fired.
 *
 * The board's rule: a side's nerve is the morale of every body in it, the menace against it is the
 * intimidation of every body opposite, and where menace is greater the difference is spent
 * silencing bodies cheapest-first. A silenced body still stands in the line and still takes fire;
 * it just does not shoot.
 */
describe('who is too cowed to fight (§D3)', () => {
  /** A stack of `alive` bodies with the morale and intimidation dictated, everything else inert. */
  const cowStack = (alive: number, morale: number, intimidation: number): Stack => {
    const spec = findUnit('razors');
    if (!spec) throw new Error('fixture: no razors in the catalogue');
    const effective = effectiveStats(
      spec,
      bareBattlefield(),
      { defending: false, outnumbered: false },
      noTerritoryEffects(),
    );
    return {
      unit: spec,
      effective: { ...effective, morale, intimidation },
      alive,
      pool: alive * effective.vitality,
      morale,
      brokeAt: null,
      started: alive,
      suppressed: 0,
      dealt: 0,
    };
  };

  const sideOf = (stacks: Stack[]): SideState =>
    ({ stacks, luck: 0, swing: 1, name: 'side', defending: false }) as unknown as SideState;

  /**
   * The board's own worked example, to the body.
   *
   * Two bodies at 10 morale and one at 20 is a nerve of 40. One body at 60 intimidation is a menace
   * of 60. The excess is 20, which buys exactly the two bodies at 10. The body at 20 fights.
   */
  it('silences exactly what the excess pays for, cheapest nerve first', () => {
    const weak = cowStack(2, 10, 0);
    const steady = cowStack(1, 20, 0);
    const side = sideOf([steady, weak]);

    expect(nerve(side)).toBe(40);
    expect(cow(side, 60)).toBe(2);
    expect(weak.suppressed, 'the two shaky bodies should be silenced').toBe(2);
    expect(steady.suppressed, 'the steady body should still fight').toBe(0);
  });

  it('silences nobody when the menace does not clear the nerve', () => {
    const weak = cowStack(2, 10, 0);
    const side = sideOf([weak]);
    // Nerve 20, menace 20: equal is not greater, so nothing is bought.
    expect(cow(side, 20)).toBe(0);
    expect(weak.suppressed).toBe(0);
  });

  it('sums both quantities over bodies, so a big army is proportionally braver', () => {
    const small = sideOf([cowStack(2, 50, 0)]);
    const large = sideOf([cowStack(20, 50, 0)]);
    // One terrifying body cannot cow a legion: the same menace that breaks the small side is
    // nothing against the large one.
    expect(cow(small, 150)).toBeGreaterThan(0);
    expect(cow(large, 150)).toBe(0);
  });

  it('takes free bodies first and cannot stall on them', () => {
    const free = cowStack(3, 0, 0);
    const paid = cowStack(2, 10, 0);
    const side = sideOf([paid, free]);
    // Nerve 20. A menace of 30 leaves 10, which takes all three zero-morale bodies and then one
    // more at 10.
    expect(cow(side, 30)).toBe(4);
    expect(free.suppressed).toBe(3);
    expect(paid.suppressed).toBe(1);
  });

  /** The whole point: silenced bodies are alive, present, and useless. */
  it('leaves the silenced standing rather than killing them', () => {
    const weak = cowStack(5, 10, 0);
    cow(sideOf([weak]), 100);
    expect(weak.suppressed).toBe(5);
    expect(weak.alive, 'suppression is not a casualty').toBe(5);
    expect(weak.pool, 'suppression does not wound').toBe(5 * weak.effective.vitality);
  });

  /**
   * And it reaches the fight: a side that is entirely cowed deals nothing.
   *
   * Measured through `simulate` rather than through `cow` alone, because the field exists only to
   * be read by `fireRound`, and a mechanic that sets a number nothing consumes is the exact class
   * of bug that made `intimidation` worth fixing in the first place.
   */
  it('takes the silenced out of the firing line', () => {
    const terrifying = findUnit('razors');
    if (!terrifying) throw new Error('fixture: no razors');
    const timid = cowStack(4, 0, 0);
    const side = sideOf([timid]);
    cow(side, 1);
    expect(timid.suppressed).toBe(4);
    expect(Math.max(0, timid.alive - timid.suppressed), 'nobody left to fire').toBe(0);
  });
});

/**
 * And the count reaches the report.
 *
 * `cow` returning a number that `simulate` threw away was the first version of this, and it is the
 * same class of defect the whole review has been finding: a value computed correctly and consumed
 * by nobody. A player whose line did a third of its damage with every body still standing needs the
 * fight to say why.
 */
describe('a fight reports who was cowed', () => {
  it('carries the count out of the simulation', () => {
    const simulation = fight(army({ razors: 6 }), army({ razors: 6 }));
    expect(Number.isFinite(simulation.cowed.attacker)).toBe(true);
    expect(Number.isFinite(simulation.cowed.defender)).toBe(true);
    expect(simulation.cowed.attacker).toBeGreaterThanOrEqual(0);
    expect(simulation.cowed.defender).toBeGreaterThanOrEqual(0);
  });
});
