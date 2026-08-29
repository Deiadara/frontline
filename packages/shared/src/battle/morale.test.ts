import { describe, expect, it } from 'vitest';
import { noTerritoryEffects, type TerritoryEffects } from '../city/index.js';
import { findUnit } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { simulate, type SideState } from './engine.js';
import {
  CASUALTY_SHOCK,
  fragility,
  moraleDelta,
  moraleState,
  MORALE_RECOVERY,
  WINNING_RELIEF,
  type MoraleShock,
} from './morale.js';
import { fleeChance, pursuitSpeed, routSurvivors } from './rout.js';
import { mulberry32 } from './rng.js';

/**
 * Morale, and who gets away.
 *
 * The non-linearity is the whole design: the *same* shock has to hurt more the lower a stack
 * already is, because that is what turns intimidation from a stat into a strategy and what makes a
 * collapse feel like a collapse rather than a slow subtraction.
 */

const quiet: MoraleShock = {
  casualtyFraction: 0,
  enemyCasualtyFraction: 0,
  enemyIntimidation: 0,
  outnumberedRatio: 1,
  alliesBroken: 0,
  resolvePercent: 0,
};

describe('the ladder', () => {
  it('reads the four states off the thresholds', () => {
    expect(moraleState(100)).toBe('steady');
    expect(moraleState(60)).toBe('steady');
    expect(moraleState(59)).toBe('shaken');
    expect(moraleState(35)).toBe('shaken');
    expect(moraleState(34)).toBe('wavering');
    expect(moraleState(15)).toBe('wavering');
    expect(moraleState(14)).toBe('routed');
    expect(moraleState(0)).toBe('routed');
  });

  it('steadies a stack that had a quiet round, wherever it is on the ladder', () => {
    expect(moraleDelta(quiet, 80)).toBe(MORALE_RECOVERY);
    expect(moraleDelta(quiet, 20)).toBe(MORALE_RECOVERY);
  });
});

describe('the same shock hurts more the lower you already are', () => {
  it('scales every hit by how close the stack is to breaking', () => {
    expect(fragility(100)).toBe(1);
    expect(fragility(0)).toBeGreaterThan(2);
    expect(fragility(30)).toBeGreaterThan(fragility(70));
  });

  /** The brief, stated as an assertion: intimidation works on low morale. */
  it('makes the same intimidation worth more against a shaken stack', () => {
    const pressure: MoraleShock = { ...quiet, enemyIntimidation: 80 };
    const onSteady = Math.abs(moraleDelta(pressure, 90));
    const onShaken = Math.abs(moraleDelta(pressure, 20));
    expect(onShaken).toBeGreaterThan(onSteady * 1.5);
  });
});

describe('winning is what stops a fight ending in mutual collapse', () => {
  it('costs a stack nothing to lose less than the other side', () => {
    const winning: MoraleShock = { ...quiet, casualtyFraction: 0.1, enemyCasualtyFraction: 0.4 };
    expect(moraleDelta(winning, 60)).toBe(MORALE_RECOVERY);
  });

  it('costs a stack the difference when it is losing more', () => {
    const losing: MoraleShock = { ...quiet, casualtyFraction: 0.4, enemyCasualtyFraction: 0.1 };
    const net = 0.4 - WINNING_RELIEF * 0.1;
    expect(moraleDelta(losing, 100)).toBeCloseTo(-CASUALTY_SHOCK * net, 5);
  });
});

describe('a collapse spreads', () => {
  it('drags the neighbours down when a stack breaks', () => {
    const alone: MoraleShock = { ...quiet, casualtyFraction: 0.2 };
    const witnessed: MoraleShock = { ...alone, alliesBroken: 2 };
    expect(Math.abs(moraleDelta(witnessed, 50))).toBeGreaterThan(
      Math.abs(moraleDelta(alone, 50)) * 1.5,
    );
  });

  it('steadies a stack that is holding ground it has dug into', () => {
    const shock: MoraleShock = { ...quiet, casualtyFraction: 0.3, enemyIntimidation: 50 };
    expect(Math.abs(moraleDelta({ ...shock, resolvePercent: 25 }, 50))).toBeLessThan(
      Math.abs(moraleDelta(shock, 50)),
    );
  });
});

describe('intimidation decides fights, not just morale numbers', () => {
  /**
   * End-to-end, with **one** variable.
   *
   * This used to pit a terror unit against a plain one and assert the terror unit won more, which
   * measured "is this unit stronger" at least as much as it measured terror, and it broke the day
   * the cheap terror unit left the roster. Two further attempts were no better: win rate saturates
   * (a heavy attacker takes 24 of 24 against both defences, so every gap reads as zero), and
   * swapping the defending *unit* to change its nerve changes its toughness and its damage with it.
   *
   * So the defender is one army and the only thing that moves is its morale, through the territory
   * bonus the engine already applies as a flat shift. A shaken enemy fights worse for everybody, so
   * the bare gap proves nothing on its own: Breakers are the control at the same 30 supply, and
   * what is asserted is that the unit carrying Terror gains *more* from the same collapse.
   */
  it('pays a terror unit more against a shaken line than a unit without it', () => {
    const nerve = (flat: number): TerritoryEffects => ({
      ...noTerritoryEffects(),
      unitMoraleFlat: flat,
    });
    /** Share of the attacking force still standing at the end, averaged over the seeds. */
    const survived = (army: Record<string, number>, flat: number) => {
      let total = 0;
      for (let seed = 0; seed < 24; seed += 1) {
        const simulation = simulate({
          seed: `terror-${seed}`,
          battlefield: bareBattlefield(),
          attacker: { name: 'A', army, defending: false },
          defender: { name: 'D', army: { razors: 60 }, defending: true, territory: nerve(flat) },
        });
        const alive = simulation.attacker.stacks.reduce((sum, stack) => sum + stack.alive, 0);
        const sent = simulation.attacker.stacks.reduce((sum, stack) => sum + stack.started, 0);
        total += sent === 0 ? 0 : alive / sent;
      }
      return total / 24;
    };
    const gap = (army: Record<string, number>) => survived(army, -30) - survived(army, 40);

    // Hollow Men carry Terror. Breakers do not, and 15 of them is the same 30 supply.
    const terror = gap({ hollow_men: 6 });
    const control = gap({ breakers: 15 });
    expect(control, 'a shaken line should be easier for anybody').toBeGreaterThan(0.2);
    expect(terror, 'Terror bought nothing against a collapse').toBeGreaterThan(control * 1.2);
  });
});

describe('who gets away', () => {
  const stackOf = (id: string, alive: number, brokeAt: number | null = null) => {
    const unit = findUnit(id);
    if (!unit) throw new Error(id);
    return {
      unit,
      effective: effectiveStats(
        unit,
        bareBattlefield(),
        { defending: false, outnumbered: false },
        noTerritoryEffects(),
      ),
      alive,
      pool: alive * unit.stats.vitality,
      morale: unit.stats.morale,
      brokeAt,
      started: alive,
      dealt: 0,
    };
  };

  const context = { pursuit: 55, lastRound: 6, away: false };

  /**
   * One stat at a time.
   *
   * Comparing two real units does not isolate anything: Road Reavers escape Ironsides on speed
   * *and* on stealth, and a version of this test that compared them passed with the speed term
   * deleted entirely. Each of these moves exactly one number on an otherwise identical stack.
   */
  const withStat = (id: string, stat: 'speed' | 'stealth', value: number) => {
    const stack = stackOf(id, 10);
    return { ...stack, effective: { ...stack.effective, [stat]: value } };
  };

  it('gets a fast unit clear more often than an identical slow one', () => {
    expect(fleeChance(withStat('razors', 'speed', 90), context)).toBeGreaterThan(
      fleeChance(withStat('razors', 'speed', 20), context),
    );
  });

  it('gets a quiet unit clear more often than an identical loud one', () => {
    expect(fleeChance(withStat('razors', 'stealth', 95), context)).toBeGreaterThan(
      fleeChance(withStat('razors', 'stealth', 5), context),
    );
  });

  it('is harder to escape a fast pursuit than a slow one', () => {
    const stack = stackOf('razors', 10);
    expect(fleeChance(stack, { ...context, pursuit: 20 })).toBeGreaterThan(
      fleeChance(stack, { ...context, pursuit: 95 }),
    );
  });

  it('costs a unit something to be losing on ground it does not hold', () => {
    const stack = stackOf('razors', 10);
    expect(fleeChance(stack, { ...context, away: true })).toBeLessThan(
      fleeChance(stack, { ...context, away: false }),
    );
  });

  it('gets a stack that broke early clear more often than one that held to the end', () => {
    expect(fleeChance(stackOf('razors', 10, 1), context)).toBeGreaterThan(
      fleeChance(stackOf('razors', 10, 6), context),
    );
  });

  it('never makes escape or capture certain', () => {
    for (const id of ['the_colossus', 'road_reavers', 'the_cartographer', 'ironsides']) {
      const chance = fleeChance(stackOf(id, 5), { pursuit: 92, lastRound: 12, away: true });
      expect(chance, id).toBeGreaterThan(0);
      expect(chance, id).toBeLessThan(1);
    }
  });

  it('accounts for every body: the dead, the fled and the caught', () => {
    const losing = {
      name: 'D',
      defending: true,
      swing: 1,
      luck: 0,
      cohesionPercent: 0,
      stacks: [stackOf('razors', 6), stackOf('sparks', 4)],
    } satisfies SideState;
    losing.stacks[0]!.started = 10;
    losing.stacks[1]!.started = 10;

    const { fled, killed } = routSurvivors(losing, context, mulberry32(7));
    const total = (force: Record<string, number>) =>
      Object.values(force).reduce((sum, count) => sum + count, 0);
    expect(total(fled) + total(killed)).toBe(20);
  });

  it('measures the pursuit by the fastest thing the winner still has', () => {
    const winning = {
      name: 'A',
      defending: false,
      swing: 1,
      luck: 0,
      cohesionPercent: 0,
      stacks: [stackOf('ironsides', 5), stackOf('road_reavers', 3)],
    } satisfies SideState;
    expect(pursuitSpeed(winning)).toBe(92);
  });
});
