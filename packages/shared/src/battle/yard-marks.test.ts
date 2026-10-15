import { describe, expect, it } from 'vitest';
import { findUnit } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { findLocation, noTerritoryEffects, type TerritoryEffects } from '../city/index.js';
import { applyHoldBonus, bonusesAt, describeHoldBonus } from '../city/locations.js';
import { markedUnit } from './line.js';
import {
  DRUNK_RABBLE_PERCENT,
  SAFE_DISTANCE_COST,
  allocate,
  intimidate,
  simulate,
  type SideState,
  type Stack,
} from './engine.js';

/**
 * The Marshalling Yards' two unit grounds (maintainer, 2026-10-09): Box Nine's spotters for the
 * Snipers and the Mess Room's bar for the Breakers, with SAFE DISTANCE and DRUNK at level 5.
 */

const field = bareBattlefield();
const side = { defending: false, outnumbered: 0 };

function stackOf(id: string, alive: number, territory: TerritoryEffects = noTerritoryEffects()) {
  const spec = markedUnit(findUnit(id)!, territory);
  const effective = effectiveStats(spec, field, side, territory);
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
  } as Stack;
}

const sideOf = (stacks: Stack[]): SideState =>
  ({ stacks, luck: 0, swing: 1, name: 'side', defending: false }) as unknown as SideState;

/** What holding a location at a level folds to, on its own. */
const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus),
    noTerritoryEffects(),
  );

describe('the global sheet changes', () => {
  it('puts Snipers at 90 range and Breakers at 300 vitality, with Breaching their gold mark', () => {
    expect(findUnit('snipers')!.stats.range).toBe(90);
    expect(findUnit('breakers')!.stats.vitality).toBe(300);
    expect(findUnit('breakers')!.goldenModifiers).toEqual(['breaching']);
  });
});

describe('Box Nine', () => {
  it('lends the Snipers range and damage from level 2, and nobody else', () => {
    const sniper = findUnit('snipers')!;
    const bare = effectiveStats(sniper, field, side, noTerritoryEffects());
    // Points on the sheet before the percentages, as every flat lands (`effectiveStats`), so the
    // damage is read back off the sheet through the multiplier the ground already puts on it.
    const multiplier = bare.offense / sniper.stats.offense;
    const ladder = [1, 2, 3, 4, 5].map((level) => {
      const at = effectiveStats(sniper, field, side, holding('marshalling-yards-signalbox', level));
      return [at.range, Math.round(at.offense / multiplier - sniper.stats.offense)];
    });
    expect(ladder).toEqual([
      [90, 0],
      [92, 20],
      [94, 40],
      [96, 60],
      [100, 100],
    ]);
    const razors = findUnit('razors')!;
    expect(effectiveStats(razors, field, side, holding('marshalling-yards-signalbox', 5))).toEqual(
      effectiveStats(razors, field, side, noTerritoryEffects()),
    );
  });

  it('pays nothing at level 1 and SAFE DISTANCE at level 5 alone', () => {
    const at = (level: number) => bonusesAt(findLocation('marshalling-yards-signalbox')!, level);
    expect(at(1)).toEqual([]);
    expect(at(4).map((bonus) => bonus.kind)).toEqual(['unit_stat_flat', 'unit_stat_flat']);
    expect(holding('marshalling-yards-signalbox', 4).unitMarks).toEqual({});
    expect(holding('marshalling-yards-signalbox', 5).unitMarks).toEqual({
      snipers: ['safe_distance'],
    });
    expect(at(5).map((bonus) => describeHoldBonus(bonus))).toEqual([
      '+10 range on Snipers',
      '+100 damage on Snipers',
      'Safe Distance for Snipers',
    ]);
  });

  it('makes SAFE DISTANCE cost twice the menace to silence', () => {
    const marked = holding('marshalling-yards-signalbox', 5);
    const plain = stackOf('snipers', 4);
    const safe = stackOf('snipers', 4, marked);
    expect(safe.unit.safe_distance).toBe(true);
    const morale = plain.effective.morale;
    expect(safe.effective.morale).toBe(morale);
    // A menace that buys two plain Snipers past the nerve of four buys one at a safe distance.
    const against = 4 * morale + 2 * morale;
    expect(intimidate(sideOf([plain]), against)).toBe(2);
    expect(SAFE_DISTANCE_COST).toBe(2);
    expect(intimidate(sideOf([safe]), against)).toBe(1);
  });
});

describe('the Mess Room', () => {
  it('lends the Breakers damage and vitality from level 2', () => {
    const breaker = findUnit('breakers')!;
    const bare = effectiveStats(breaker, field, side, noTerritoryEffects());
    const offense = bare.offense / breaker.stats.offense;
    const vitality = bare.vitality / breaker.stats.vitality;
    const ladder = [1, 2, 3, 4, 5].map((level) => {
      const at = effectiveStats(breaker, field, side, holding('marshalling-yards-messroom', level));
      return [
        Math.round(at.offense / offense - breaker.stats.offense),
        Math.round(at.vitality / vitality - breaker.stats.vitality),
      ];
    });
    expect(ladder).toEqual([
      [0, 0],
      [20, 30],
      [40, 60],
      [60, 90],
      [100, 150],
    ]);
    expect(holding('marshalling-yards-messroom', 5).unitMarks).toEqual({ breakers: ['drunk'] });
  });

  it('sends DRUNK Breakers at the Rabble first, and only while there is Rabble', () => {
    const drunk = stackOf('breakers', 10, holding('marshalling-yards-messroom', 5));
    const sober = stackOf('breakers', 10);
    const rabble = stackOf('razors', 10);
    const heavy = stackOf('wardens', 5);
    expect(findUnit('razors')!.tier).toBe('rabble');
    expect(findUnit('wardens')!.tier).not.toBe('rabble');

    expect(allocate(drunk, [rabble, heavy]).map((part) => part.target.unit.id)).toEqual(['razors']);
    expect(
      allocate(sober, [rabble, heavy])
        .map((part) => part.target.unit.id)
        .sort(),
    ).toEqual(['razors', 'wardens']);
    expect(allocate(drunk, [heavy]).map((part) => part.target.unit.id)).toEqual(['wardens']);
  });

  it('hits the Rabble harder, and nobody else', () => {
    const marks = { ...noTerritoryEffects(), unitMarks: { breakers: ['drunk' as const] } };
    const dealt = (defending: Record<string, number>, drunk: boolean) =>
      simulate({
        seed: 'mess-room',
        battlefield: field,
        attacker: {
          name: 'A',
          army: { breakers: 10 },
          defending: false,
          ...(drunk ? { territory: marks } : {}),
        },
        defender: { name: 'D', army: defending, defending: true },
      }).attacker.stacks.reduce((total, stack) => total + stack.dealt, 0);
    expect(DRUNK_RABBLE_PERCENT).toBe(10);
    expect(dealt({ razors: 40 }, true)).toBeGreaterThan(dealt({ razors: 40 }, false));
    expect(dealt({ wardens: 8 }, true)).toBe(dealt({ wardens: 8 }, false));
  });
});
