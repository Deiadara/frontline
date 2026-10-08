import { describe, expect, it } from 'vitest';
import {
  applyHoldBonus,
  describeHoldBonus,
  noTerritoryEffects,
  type HoldBonus,
  type TerritoryEffects,
} from './locations.js';
import { combineEffects, mergeCrewEffects, noCrewEffects } from '../crew/effects.js';
import { creditedLevel, buildingCost } from '../building/cost.js';
import { ridingUnitSlots, unitColumnSpeed } from '../units/catalog.js';
import { bareBattlefield } from '../battle/battlefield.js';
import { markedUnit, simulate, standsInLine, type Simulation } from '../battle/engine.js';
import { findUnit, type Army, type UnitSpec } from '../units/index.js';

/**
 * The seven bonus kinds the 2026-09-09 pass added to the shared union.
 *
 * They are on `HoldBonus` rather than beside it, so authoring one gives it to the map, the perk
 * book and the Lab's thirteen tracks at once: that is the design `crew/effects.ts` is built around
 * and it is why the channel and the fold are the load-bearing half. What each of them changes is a
 * *rule*, so the interesting assertions are about permissions and about shapes, not about sizes.
 *
 * Two folds have to agree about every one of them and they are written independently:
 * `combineEffects` (ground plus people) and `mergeCrewEffects` (the Lab, on top). The second one
 * was reading a boolean as an empty record and handing back `{}`, which is truthy, so every crew in
 * the game could seat a Colossus and no channel list anywhere would have shown it. That is what the
 * last block here pins.
 */

const fold = (...bonuses: readonly HoldBonus[]): TerritoryEffects =>
  bonuses.reduce((into, bonus) => applyHoldBonus(into, bonus), noTerritoryEffects());

const spec = (unitId: string): UnitSpec => {
  const found = findUnit(unitId);
  if (!found) throw new Error(`${unitId} is not in the catalogue`);
  return found;
};

const fight = (
  attacking: Army,
  defending: Army,
  seed: string,
  held?: TerritoryEffects,
): Simulation =>
  simulate({
    seed,
    battlefield: bareBattlefield(),
    attacker: {
      name: 'A',
      army: attacking,
      defending: false,
      ...(held ? { territory: held } : {}),
    },
    defender: { name: 'D', army: defending, defending: true },
  });

describe('every new kind says what it is in one line', () => {
  const LINES: readonly [HoldBonus, string][] = [
    [{ kind: 'carriers_fight' }, 'porters fight'],
    [{ kind: 'any_ride' }, 'anything can be put on a machine'],
    [{ kind: 'steady_nerve' }, 'a stack that breaks shakes nobody'],
    [{ kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' }, 'Holds the Line for one unit'],
  ];

  it('prints the catalogue label rather than the field name', () => {
    for (const [bonus, line] of LINES) expect(describeHoldBonus(bonus), bonus.kind).toBe(line);
  });
});

describe('the switches are permissions, not amounts', () => {
  it('is off until something grants it, and granting it twice is granting it once', () => {
    expect(noTerritoryEffects().carriersFight).toBe(false);
    expect(fold({ kind: 'carriers_fight' }).carriersFight).toBe(true);
    expect(fold({ kind: 'carriers_fight' }, { kind: 'carriers_fight' }).carriersFight).toBe(true);
    expect(fold({ kind: 'any_ride' }).anyRide).toBe(true);
    expect(fold({ kind: 'steady_nerve' }).steadyNerve).toBe(true);
  });

  it('adds the counted ones and takes the union of the marks', () => {
    expect(
      fold({ kind: 'travel_speed', percent: 4 }, { kind: 'travel_speed', percent: 3 })
        .travelSpeedPercent,
    ).toBe(7);

    const marks = fold(
      { kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' },
      { kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' },
      { kind: 'unit_mark', unitId: 'ironsides', mark: 'taunts' },
      { kind: 'unit_mark', unitId: 'razors', mark: 'pack' },
    ).unitMarks;
    // Deduplicated: two holdings granting the same mark grant one mark, not a list with a repeat
    // in it that a consumer counting entries would read as two.
    expect(marks['ironsides']).toEqual(['stalwart', 'taunts']);
    expect(marks['razors']).toEqual(['pack']);
  });
});

describe('a structure priced a level lower', () => {
  it('walks the level down the curve and never below the first one', () => {
    expect(creditedLevel(8, 1)).toBe(7);
    expect(creditedLevel(8, 3)).toBe(5);
    expect(creditedLevel(1, 4)).toBe(1);
    expect(creditedLevel(8)).toBe(8);
  });

  it('is worth the same share of the bill high up the ladder as low down it', () => {
    const share = (level: number): number => {
      const full = buildingCost('gauntlet', level, [])['scrap'] ?? 0;
      const credited = buildingCost('gauntlet', creditedLevel(level, 1), [])['scrap'] ?? 0;
      return 1 - credited / full;
    };
    // That property is the whole argument for the kind: a percentage off the bill is worth a
    // constant share too, but it shrinks as a crew's other discounts pile onto the same number.
    expect(share(4)).toBeCloseTo(share(18), 2);
    expect(share(18)).toBeGreaterThan(0.2);
  });
});

describe('the porters take a place in the line', () => {
  it('is refused by the sheet until the crew has bought the permission', () => {
    const porter = spec('scavengers');
    expect(standsInLine(porter, noTerritoryEffects())).toBe(false);
    expect(standsInLine(porter, fold({ kind: 'carriers_fight' }))).toBe(true);
    // A fighter is a fighter either way: the permission lifts a refusal, it does not grant one.
    expect(standsInLine(spec('razors'), noTerritoryEffects())).toBe(true);
  });

  it('puts them on the field, where the engine would not have built them a stack at all', () => {
    const without = fight({ scavengers: 40 }, { razors: 10 }, 'carry-1');
    const with_ = fight(
      { scavengers: 40 },
      { razors: 10 },
      'carry-1',
      fold({ kind: 'carriers_fight' }),
    );
    expect(without.attacker.stacks).toHaveLength(0);
    expect(with_.attacker.stacks).toHaveLength(1);
    // ...at their own sheet (maintainer, 2026-09-27): a hauler's numbers, not a cut on top of them.
    const stack = with_.attacker.stacks[0]!;
    expect(stack.effective.vitality).toBeCloseTo(spec('scavengers').stats.vitality, 6);
  });
});

describe('a mark granted to a unit that was not written with one', () => {
  it('writes the flag onto the sheet the engine reads', () => {
    expect(spec('ironsides').stalwart).toBeUndefined();
    const granted = markedUnit(
      spec('ironsides'),
      fold({ kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' }),
    );
    expect(granted.stalwart).toBe(true);
    // The catalogue entry itself is untouched: `markedUnit` copies, so one crew's holding cannot
    // hand the mark to everybody else's Ironsides for the rest of the process.
    expect(spec('ironsides').stalwart).toBeUndefined();
  });

  it('leaves a unit nothing was granted to exactly as it was', () => {
    const rules = fold({ kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' });
    expect(markedUnit(spec('razors'), rules)).toBe(spec('razors'));
  });
});

describe('a machine for the things there is no seat for', () => {
  it('turns a walking sheet into a riding one', () => {
    expect(unitColumnSpeed('the_colossus').rides).toBe(false);
    expect(unitColumnSpeed('the_colossus', { anyRide: true }).rides).toBe(true);
  });

  it('counts the unit slots that now fill a seat, not the heads', () => {
    const colossus = findUnit('the_colossus')?.unitSlots ?? 0;
    expect(colossus).toBeGreaterThan(1);
    // Walking, the Colossus fills nothing: five Razors at a slot each is the whole of it.
    expect(ridingUnitSlots({ the_colossus: 1, razors: 5 })).toBe(5);
    // Riding, it fills what it costs to house, which is the point of the currency.
    expect(ridingUnitSlots({ the_colossus: 1, razors: 5 }, true)).toBe(5 + colossus);
  });
});

describe('the two folds agree about a switch', () => {
  /**
   * The regression. `mergeCrewEffects` is the Lab's fold and it is written independently of
   * `combineEffects`; its final arm is `mergeCounts`, which reads a boolean as an empty record and
   * returns `{}`. `{}` is truthy, so a crew that had bought none of these permissions held all of
   * them, and every channel readout in the game would still have shown the struct as correct.
   */
  it('ors them rather than turning them into an empty record', () => {
    const off = noCrewEffects();
    const on = { ...noCrewEffects(), anyRide: true, carriersFight: true, steadyNerve: true };

    for (const merged of [mergeCrewEffects(off, off), combineEffects(noTerritoryEffects(), off)]) {
      expect(merged.anyRide).toBe(false);
      expect(merged.carriersFight).toBe(false);
      expect(merged.steadyNerve).toBe(false);
    }
    expect(mergeCrewEffects(off, on).anyRide).toBe(true);
    expect(mergeCrewEffects(on, off).carriersFight).toBe(true);
    expect(combineEffects({ ...noTerritoryEffects(), steadyNerve: true }, off).steadyNerve).toBe(
      true,
    );
  });

  it('takes the union of the granted marks through both of them', () => {
    const ground = { ...noTerritoryEffects(), unitMarks: { ironsides: ['stalwart'] as const } };
    const lab = {
      ...noCrewEffects(),
      unitMarks: { ironsides: ['taunts'] as const, razors: ['pack'] as const },
    };
    expect(combineEffects(ground, lab).unitMarks['ironsides']).toEqual(['taunts', 'stalwart']);
    expect(mergeCrewEffects({ ...noCrewEffects(), ...ground }, lab).unitMarks).toEqual({
      ironsides: ['stalwart', 'taunts'],
      razors: ['pack'],
    });
  });
});

describe('nobody runs because somebody else did', () => {
  it('reaches the engine as a fact about the side', () => {
    expect(fight({ razors: 10 }, { razors: 10 }, 'nerve-0').attacker.steadyNerve).toBe(false);
    expect(
      fight({ razors: 10 }, { razors: 10 }, 'nerve-0', fold({ kind: 'steady_nerve' })).attacker
        .steadyNerve,
    ).toBe(true);
  });

  /**
   * The holding keeps stacks the same fights lose to the panic beside them.
   *
   * Read over thirty seeds rather than pinned on one. It was a single found case, refound twice
   * (2026-09-18 for `overstackPenalty` and a resistance retune, 2026-09-21 for the Suppressors),
   * and it broke a third time when the cascade started charging the **share** of the side that
   * ran instead of the number of stacks: one seed either side of a threshold is a fixture with an
   * expiry date on it, and three expiries is enough.
   *
   * Four equal stacks, so a stack breaking really is a quarter of the line and the cascade has
   * something to be proportional to. Swept over the defender's size as well since 2026-10-02,
   * when Last Stand started ramping with the odds and moved the one size this read (20
   * Suppressors) from 19 kept fights to 3: the cascade only decides fights near the edge of the
   * attack holding, and where that edge sits moves with every retune. Measured that day over 17
   * to 20 Suppressors and thirty seeds each: the holding kept a stack in 7, 17, 5 and 3 fights,
   * and cost one in none. Re-swept on 2026-10-07 when the Suppressors' Dug In became GUARD, a
   * quarter more toughness on the defending side: the edge moved a step down, to 16 and 17
   * Suppressors (12, 11, 2 and 1 kept over 16 to 19, none cost). Both halves are asserted,
   * because "fewer overall" alone would pass on a rule that helped twice as often as it hurt.
   */
  it('keeps stacks that the same fights lose to the panic beside them', () => {
    const attacking: Army = { razors: 25, sparks: 25, scrapers: 25, anodics: 25 };
    const broke = (side: Simulation['attacker']): number =>
      side.stacks.filter((stack) => stack.brokeAt !== null).length;

    let shakenTotal = 0;
    let steadyTotal = 0;
    let kept = 0;
    for (const suppressor of [16, 17, 18, 19]) {
      const defending: Army = { suppressor };
      for (let seed = 0; seed < 30; seed += 1) {
        // The seed is part of the fixture, since a fight is deterministic from it.
        const shaken = broke(fight(attacking, defending, `c${seed}`).attacker);
        const steady = broke(
          fight(attacking, defending, `c${seed}`, fold({ kind: 'steady_nerve' })).attacker,
        );
        shakenTotal += shaken;
        steadyTotal += steady;
        if (shaken > steady) kept += 1;
        const where = `${suppressor} Suppressors, seed c${seed}`;
        expect(steady, `steady nerve cost a stack at ${where}`).toBeLessThanOrEqual(shaken);
      }
    }
    expect(kept, 'the holding changed nothing in 120 fights').toBeGreaterThanOrEqual(16);
    expect(steadyTotal).toBeLessThan(shakenTotal);
  });
});
