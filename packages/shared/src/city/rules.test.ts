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
import { MIN_TRAVEL_MINUTES } from './geography.js';
import { roadMinutes } from '../time/speed.js';
import { ridingBodies, unitColumnSpeed } from '../units/catalog.js';
import { bareBattlefield } from '../battle/battlefield.js';
import { markedUnit, simulate, standsInLine, type Simulation } from '../battle/engine.js';
import { findUnit, type Army, type UnitSpec } from '../units/index.js';

/**
 * The seven bonus kinds the 2026-09-09 pass added to the shared union.
 *
 * They are on `HoldBonus` rather than beside it, so authoring one gives it to the map, the perk
 * book and the Lab's nineteen tracks at once: that is the design `crew/effects.ts` is built around
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
  bonuses.reduce(applyHoldBonus, noTerritoryEffects());

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
    [{ kind: 'road_shortcut', minutes: 4 }, '-4 min off every road'],
    [{ kind: 'carriers_fight' }, 'porters fight, at half strength'],
    [{ kind: 'any_ride' }, 'anything can be put on a machine'],
    [{ kind: 'steady_nerve' }, 'a stack that breaks shakes nobody'],
    [{ kind: 'scout_parties', flat: 1 }, '+1 scouting party out at once'],
    [{ kind: 'scout_parties', flat: 2 }, '+2 scouting parties out at once'],
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
      fold({ kind: 'road_shortcut', minutes: 4 }, { kind: 'road_shortcut', minutes: 3 })
        .roadMinutesOff,
    ).toBe(7);
    expect(
      fold({ kind: 'scout_parties', flat: 1 }, { kind: 'scout_parties', flat: 1 }).scoutPartiesFlat,
    ).toBe(2);

    const marks = fold(
      { kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' },
      { kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' },
      { kind: 'unit_mark', unitId: 'ironsides', mark: 'picker' },
      { kind: 'unit_mark', unitId: 'razors', mark: 'pack' },
    ).unitMarks;
    // Deduplicated: two holdings granting the same mark grant one mark, not a list with a repeat
    // in it that a consumer counting entries would read as two.
    expect(marks['ironsides']).toEqual(['stalwart', 'picker']);
    expect(marks['razors']).toEqual(['pack']);
  });
});

describe('a flat cut off the road', () => {
  it('comes off after the pace and the percentage, which is why it is worth anything short', () => {
    // Twenty minutes at speed 100 is ten; ten per cent off that is nine; four flat is five.
    expect(roadMinutes(20, 100, 10)).toBe(9);
    expect(roadMinutes(20, 100, 10, 4)).toBe(5);
  });

  it('never makes a road free, however much of it a crew holds', () => {
    expect(roadMinutes(9, 0, 0, 100)).toBe(1);
    expect(roadMinutes(9, 0, 0, 100)).toBeLessThan(MIN_TRAVEL_MINUTES);
  });

  it('is worth the same on a short hop as on a long march, unlike the percentage', () => {
    const shortPercent = roadMinutes(10, 0, 0) - roadMinutes(10, 0, 18);
    const longPercent = roadMinutes(120, 0, 0) - roadMinutes(120, 0, 18);
    expect(longPercent).toBeGreaterThan(shortPercent * 5);
    expect(roadMinutes(10, 0, 0) - roadMinutes(10, 0, 0, 4)).toBe(4);
    expect(roadMinutes(120, 0, 0) - roadMinutes(120, 0, 0, 4)).toBe(4);
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
    // ...and they are worth half of what they read, which is what stops the cheapest sheet in the
    // game being the correct one. See `CARRIER_STRENGTH`.
    const stack = with_.attacker.stacks[0]!;
    expect(stack.effective.vitality).toBeCloseTo(spec('scavengers').stats.vitality / 2, 6);
    expect(stack.effective.reasons).toContain('Turned out to fight');
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

  it('counts the bodies that now fill a seat', () => {
    expect(ridingBodies({ the_colossus: 1, razors: 5 })).toBe(5);
    expect(ridingBodies({ the_colossus: 1, razors: 5 }, true)).toBe(6);
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
      unitMarks: { ironsides: ['picker'] as const, razors: ['pack'] as const },
    };
    expect(combineEffects(ground, lab).unitMarks['ironsides']).toEqual(['picker', 'stalwart']);
    expect(mergeCrewEffects({ ...noCrewEffects(), ...ground }, lab).unitMarks).toEqual({
      ironsides: ['stalwart', 'picker'],
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
   * A found case, like the stalwart one in `marks.test.ts`: this exact matchup and seed lose a
   * second stack to the cascade without the holding and keep it with it. Pinning a case the rule
   * changes is the only way the test fails when the engine stops reading it.
   */
  it('keeps a stack that the same fight loses to the panic beside it', () => {
    const attacking: Army = { the_condemned: 60, razors: 20, sparks: 20 };
    // The seed is part of the fixture: a fight is deterministic from it, and the sweep that found
    // this case found the cascade taking a third stack on four of the five seeds tried.
    const shaken = fight(attacking, { hollow_men: 40 }, 's1');
    const steady = fight(attacking, { hollow_men: 40 }, 's1', fold({ kind: 'steady_nerve' }));
    const broke = (side: Simulation['attacker']): number =>
      side.stacks.filter((stack) => stack.brokeAt !== null).length;
    expect(broke(shaken.attacker)).toBe(3);
    expect(broke(steady.attacker)).toBe(2);
  });
});
