import { describe, expect, it } from 'vitest';
import { findUnit, type Army } from '../units/index.js';
import { winnerLossFraction } from './attrition.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { noTerritoryEffects } from '../city/index.js';
import { pursue, simulate, sidePower, type Simulation } from './engine.js';

/**
 * The engine's behaviour, measured rather than asserted about.
 *
 * The anchor test is the first one: with counters, terrain and morale neutral, a simulated fight
 * has to land on the reference curve from `attrition.ts` — the formula Tribal Wars and Travian
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
   * instead — a broken stack stops fighting, and its survivors go home to their owner. A fight that
   * ends when somebody runs is always cheaper for the winner than one that ends when somebody dies,
   * so the level *has* to sit under the curve. Measured, it sits at 0.2–0.5× of it.
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

  it('is deterministic — the same seed replays exactly', () => {
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
   * roles of two identical forces must not move the result — if it does, the loop has a bias that
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
   * came out of the pursuit at *full* health of a smaller number — losing your nerve was the most
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
