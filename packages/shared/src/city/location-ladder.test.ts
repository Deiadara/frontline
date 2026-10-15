import { describe, expect, it } from 'vitest';
import { cancelRefund } from '../time/cancel.js';
import { buildCostCut, buildTimeCut } from '../building/cost.js';
import { researchTimeCut } from '../building/standing.js';
import { heldDefense } from '../battle/effects.js';
import { cohesionWidening } from '../battle/engine.js';
import { musterSpeedAfterTaper } from '../time/speed.js';
import { effectiveMarketDiscount, MARKET_DISCOUNT_ASYMPTOTE } from '../market/discount.js';
import { findDistrict, findLocation } from './atlas.js';
import { missionSpeedPercentIn, territoryEffectsFor, type LocationControl } from './control.js';
import {
  LEVEL_SCALE,
  MAX_LOCATION_LEVEL,
  UPGRADE_COST_SCALE,
  bonusesAt,
  clampLevel,
  describeHoldBonus,
  upgradeCost,
  type HoldBonus,
  type Location,
} from './locations.js';

/**
 * The location ladder and the territory fold, pinned to exact figures (bug pass, 2026-10-05).
 *
 * `levels.test.ts` and `city.test.ts` hold the shape of the ladder. This file holds the numbers a
 * player is quoted: what one bonus is worth at a level, what an order costs with and without the
 * Engineer, what a cancel hands back, what a whole district adds and takes away, and how each
 * curved channel bends. Every expected figure is worked by hand from the atlas, so a change
 * to a rounding path or a ceiling shows up here as a number rather than as a direction.
 */

const at = (id: string): Location => findLocation(id)!;

/** The first value of a location's bonus of `bonusKind`, at `level`. */
function figure(id: string, bonusKind: HoldBonus['kind'], level: number): number {
  const bonus = bonusesAt(at(id), level).find((one) => one.kind === bonusKind);
  if (!bonus) throw new Error(`${id} pays no ${bonusKind}`);
  if ('perHour' in bonus) return bonus.perHour;
  if ('flat' in bonus) return bonus.flat;
  if ('percent' in bonus) return bonus.percent;
  throw new Error(`${bonusKind} carries no figure`);
}

describe('the level ladder', () => {
  it('is five levels with a double last step, priced off the old ladder’s even rungs', () => {
    expect(LEVEL_SCALE).toEqual([1, 2, 3, 4, 6]);
    expect(LEVEL_SCALE).toHaveLength(MAX_LOCATION_LEVEL);
    expect(UPGRADE_COST_SCALE).toEqual([4.5, 8.8, 17.2, 33.7]);
  });

  it('clamps a level into 1..5 and drops a fraction', () => {
    expect(clampLevel(0)).toBe(1);
    expect(clampLevel(-3)).toBe(1);
    expect(clampLevel(2.9)).toBe(2);
    expect(clampLevel(11)).toBe(MAX_LOCATION_LEVEL);
  });

  it('multiplies a figure by the level, whole, and bends a share of a fight on the combat ladder', () => {
    // The Foundry's 3 HQ metal: three a step, and the last level two steps.
    expect([1, 2, 3, 4, 5].map((level) => figure('annexes-coldrow', 'resource', level))).toEqual([
      3, 6, 9, 12, 18,
    ]);
    // A Pirate Radio's 3 intimidation reads the same path through the flat channels.
    expect([1, 2, 4].map((level) => figure('annexes-loft', 'intimidation', level))).toEqual([
      3, 6, 12,
    ]);
    expect(bonusesAt(at('steelbelt-press'), 4)).toEqual([
      { kind: 'resource', resource: 'scrap', perHour: 96 },
      { kind: 'resource', resource: 'planks', perHour: 72 },
    ]);
    // A Hospital's 12% vitality tops out at 4.75 times, not six (`COMBAT_LEVEL_SCALE`).
    expect(
      [1, 2, 3, 4, 5].map((level) => figure('chrome-row-ferrous', 'unit_vitality', level)),
    ).toEqual([12, 21, 30, 39, 57]);
  });

  it('pays at least one more session and one more syringe at every level', () => {
    expect(
      Array.from({ length: 5 }, (_, i) => figure('blacksite-drill', 'training_sessions', i + 1)),
    ).toEqual([1, 2, 3, 4, 6]);
    expect(
      Array.from({ length: 5 }, (_, i) => figure('blacksite-blackward', 'battle_stims', i + 1)),
    ).toEqual([2, 4, 6, 8, 12]);
  });

  it('leaves the rules alone at any level', () => {
    // A fight pit, a chapel and a barricade.
    for (const id of ['blacksite-pit17', 'glasshouse-fields-fieldchapel', 'blacksite-outer']) {
      const rules = (level: number) =>
        bonusesAt(at(id), level).filter((one) => !('percent' in one || 'flat' in one));
      expect(rules(MAX_LOCATION_LEVEL), id).toEqual(rules(1));
    }
  });

  // The one rule a level moves (maintainer, 2026-10-09): the rails out of a Station run 15 minutes
  // at level 1 down to 5 at level 5 (the last step double), so the link carries its level.
  it('stamps the Station`s level on its link, and says the minutes on the card', () => {
    const link = (level: number) => bonusesAt(at('coldwater-halt-platform'), level)[0];
    expect(link(1)).toEqual({ kind: 'rail_link', level: 1 });
    expect(link(MAX_LOCATION_LEVEL)).toEqual({ kind: 'rail_link', level: MAX_LOCATION_LEVEL });
    expect(describeHoldBonus(link(1)!)).toContain('15 min');
    expect(describeHoldBonus(link(2)!)).toContain('13 min');
    expect(describeHoldBonus(link(MAX_LOCATION_LEVEL)!)).toContain('5 min');
  });

  // The Tram Depot's flat minutes became travel points on 2026-10-07, so its one bonus ladders
  // like every other percentage.
  it('scales the Tram Depot`s travel points like any other quantity', () => {
    expect([1, 2, 5].map((level) => figure('undergrid-depot', 'travel_speed', level))).toEqual([
      22, 44, 132,
    ]);
  });
});

describe('what a level costs', () => {
  // The Chandlery, a pawn shop, asks 80 planks for its first upgrade, the cheapest on the map.
  const PAWN = at('neon-docks-chandler').upgradeCost;

  it('is the location`s own figure, times the step, a tenth dearer, in the shared mix', () => {
    expect(PAWN).toBe(80);
    // 80 x 4.5 x 1.1 = 396 planks, and the rest of the mix off that: 39.6, 118.8, 158.4, 79.2.
    expect(upgradeCost(at('neon-docks-chandler'), 1)).toEqual({
      planks: 396,
      highQualityMetal: 40,
      scrap: 119,
      oil: 158,
      caps: 79,
    });
    // The last step: 80 x 33.7 x 1.1 = 2965.6 planks, what the old upgrade to 10 cost.
    expect(upgradeCost(at('neon-docks-chandler'), 4)).toEqual({
      planks: 2966,
      highQualityMetal: 297,
      scrap: 890,
      oil: 1186,
      caps: 593,
    });
    expect(upgradeCost(at('neon-docks-chandler'), MAX_LOCATION_LEVEL)).toBeNull();
  });

  it('takes the Engineer`s cut on top, never past half and never below nothing', () => {
    const half = { planks: 198, highQualityMetal: 20, scrap: 59, oil: 79, caps: 40 };
    expect(upgradeCost(at('neon-docks-chandler'), 1, 50)).toEqual(half);
    expect(upgradeCost(at('neon-docks-chandler'), 1, 90)).toEqual(half);
    expect(upgradeCost(at('neon-docks-chandler'), 1, -20)).toEqual(
      upgradeCost(at('neon-docks-chandler'), 1),
    );
  });

  it('hands back ninety percent of what was paid, floored per line', () => {
    expect(cancelRefund(upgradeCost(at('neon-docks-chandler'), 1)!)).toEqual({
      planks: 356,
      highQualityMetal: 36,
      scrap: 107,
      oil: 142,
      caps: 71,
    });
  });
});

/** A control row held by `baseId` at `level`. */
function held(location: Location, baseId: string, level = 1): [string, LocationControl] {
  return [
    location.id,
    {
      locationId: location.id,
      holder: { kind: 'crew', baseId },
      level,
      upgradingUntil: null,
      garrison: {},
    },
  ];
}

describe('the territory fold', () => {
  const steelbelt = findDistrict('steelbelt')!;
  const blockhouse = findDistrict('blockhouse')!;
  const glasshouse = findDistrict('glasshouse-fields')!;

  it('pays 20 beds for the block, 7 a level above the first, and the location`s own on top', () => {
    const kitchen = glasshouse.locations.find((one) => one.id === 'glasshouse-fields-ladle')!;
    const controls = new Map([held(kitchen, 'mine', 4)]);
    // 20 + 7 x 3 + 15 x 4 = 101.
    expect(territoryEffectsFor('mine', [kitchen], controls).unitSlotBonus).toBe(101);
    expect(territoryEffectsFor('theirs', [kitchen], controls).unitSlotBonus).toBe(0);
  });

  it('adds the unified bonus only while every location is held, at its face value', () => {
    // Run of the Belt is the only muster cut in the Steelbelt: 2, whatever the levels.
    const whole = new Map(steelbelt.locations.map((one) => held(one, 'mine', MAX_LOCATION_LEVEL)));
    expect(territoryEffectsFor('mine', steelbelt.locations, whole).musterCostPercent).toBe(2);

    // One location lost: the figure goes with it on the next read, nothing is kept.
    const [first] = steelbelt.locations;
    const split = new Map(whole);
    split.set(first!.id, { ...whole.get(first!.id)!, holder: { kind: 'crew', baseId: 'theirs' } });
    expect(territoryEffectsFor('mine', steelbelt.locations, split).musterCostPercent).toBe(0);
    expect(territoryEffectsFor('theirs', steelbelt.locations, split).musterCostPercent).toBe(0);

    // A row nobody wrote is not a location held.
    const missing = new Map(whole);
    missing.delete(first!.id);
    expect(territoryEffectsFor('mine', steelbelt.locations, missing).musterCostPercent).toBe(0);
  });

  it('pays the Blockhouse held whole in a level of ANTI-COMBINE and nothing on the clock', () => {
    const controls = new Map(blockhouse.locations.map((one) => held(one, 'mine')));
    const effects = territoryEffectsFor('mine', blockhouse.locations, controls);
    expect(effects.antiCombineLevels).toBe(1);
    expect(effects.missionSpeedPercent).toBe(0);
    expect(missionSpeedPercentIn(effects, 'coldwater-halt')).toBe(0);
    expect(missionSpeedPercentIn(effects, 'misc')).toBe(0);
  });
});

/** The curved channels, as `[name, curve, knee, ceiling, below zero]`. */
const TAPERS: readonly [
  string,
  (points: number) => number,
  number,
  number,
  'surcharge' | 'zero',
][] = [
  ['build cost', buildCostCut, 20, 46, 'surcharge'],
  ['build time', buildTimeCut, 35, 85, 'surcharge'],
  ['research time', researchTimeCut, 30, 92, 'surcharge'],
  ['held defence', heldDefense, 55, 85, 'zero'],
  ['muster speed', musterSpeedAfterTaper, 55, 80, 'zero'],
  ['cohesion', cohesionWidening, 45, 65, 'zero'],
];

describe('every channel summed then bounded once', () => {
  it.each(TAPERS)('%s pays face value to the knee', (_, curve, knee) => {
    for (let points = 0; points <= knee; points += 0.5) expect(curve(points)).toBe(points);
  });

  it.each(TAPERS)(
    '%s keeps climbing past the knee and stays under its ceiling',
    (_, curve, knee, ceiling) => {
      const room = ceiling - knee;
      let last = curve(knee);
      // Thirty widths of the room past the knee: far past anything the catalogue can stack.
      for (let points = knee + 1; points <= knee + 30 * room; points += 1) {
        const now = curve(points);
        expect(now).toBeGreaterThan(last);
        expect(now).toBeLessThan(ceiling);
        last = now;
      }
    },
  );

  it.each(TAPERS)('%s reads a negative sum as its own rule', (_, curve, _knee, _ceiling, below) => {
    expect(curve(-10)).toBe(below === 'surcharge' ? -10 : 0);
  });

  it('lands on the anchors the doc comments quote', () => {
    expect(buildCostCut(25)).toBeCloseTo(24.55, 2);
    expect(buildCostCut(102)).toBeCloseTo(44.89, 2);
    expect(buildTimeCut(50)).toBeCloseTo(47.96, 2);
    expect(heldDefense(65)).toBeCloseTo(63.5, 1);
    expect(heldDefense(100)).toBeCloseTo(78.3, 1);
    expect(musterSpeedAfterTaper(60)).toBeCloseTo(59.5, 1);
    expect(musterSpeedAfterTaper(110)).toBeCloseTo(77.2, 1);
    expect(cohesionWidening(64)).toBeCloseTo(57.3, 1);
    expect(cohesionWidening(100)).toBeCloseTo(63.7, 1);
  });

  it('bends the market discount on its hyperbola, never past 60 and never below nothing', () => {
    expect(effectiveMarketDiscount(20)).toBeCloseTo(15, 6);
    expect(effectiveMarketDiscount(100)).toBeCloseTo(37.5, 6);
    expect(effectiveMarketDiscount(-15)).toBe(0);
    let last = 0;
    for (let points = 1; points <= 2000; points += 1) {
      const now = effectiveMarketDiscount(points);
      expect(now).toBeGreaterThan(last);
      expect(now).toBeLessThan(MARKET_DISCOUNT_ASYMPTOTE);
      last = now;
    }
  });
});
